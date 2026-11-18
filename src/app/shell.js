(function (root) {
  "use strict";

  var authDialog = null;
  var aboutDialog = null;
  var teamDialog = null;
  var confirmDialog = null;
  var toastTimer = null;
  var toastOnDismiss = null;
  var toastClosed = false;
  var globalListenersAttached = false;
  var presenceStarted = false;
  var presenceClient = null;
  var entryDismissedThisLoad = false;
  var entryCheckedOnBoot = false;

  function isArLang() {
    return root.ElgoTheme && typeof root.ElgoTheme.getLang === "function" && root.ElgoTheme.getLang() === "ar";
  }

  function txt(en, ar) {
    return isArLang() ? ar : en;
  }

  function normalizeMatch(val) {
    return String(val || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  }

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function svgIcon(name) {
    switch (name) {
      case "courses":
        return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/></svg>';
      case "saved":
        return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4Z"/></svg>';
      case "mistakes":
        return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3h14v18H5Z"/><path d="M9 8h6m-6 4h6m-6 4h3"/></svg>';
      case "leaderboard":
        return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3h8v6a4 4 0 0 1-8 0Z"/><path d="M8 5H4v3c0 3 4 3 4 3m8-6h4v3c0 3-4 3-4 3m-4 2v6m-4 0h8"/></svg>';
      case "more":
        return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>';
      case "search":
        return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>';
      default:
        return "";
    }
  }

  function showToast(msg, opts) {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    if (toastOnDismiss && !toastClosed) {
      var prevDismiss = toastOnDismiss;
      toastOnDismiss = null;
      toastClosed = true;
      try { prevDismiss(); } catch (_) {}
    }
    var existing = document.getElementById("elgoToast");
    if (existing) existing.remove();

    var options = opts && typeof opts === "object" ? opts : {};
    var hasAction = Boolean(options.actionLabel && typeof options.onAction === "function");
    var durationMs = typeof options.durationMs === "number" && options.durationMs > 0
      ? options.durationMs
      : (hasAction ? 8000 : 3200);

    var el = document.createElement("div");
    el.id = "elgoToast";
    el.className = "elgo-toast" + (hasAction ? " has-action" : "");
    el.setAttribute("role", "status");

    var textSpan = document.createElement("span");
    textSpan.className = "elgo-toast-msg";
    textSpan.textContent = String(msg || "");
    el.appendChild(textSpan);

    toastClosed = false;
    toastOnDismiss = typeof options.onDismiss === "function" ? options.onDismiss : null;

    if (hasAction) {
      var actionBtn = document.createElement("button");
      actionBtn.type = "button";
      actionBtn.className = "elgo-toast-action";
      actionBtn.textContent = String(options.actionLabel);
      actionBtn.addEventListener("click", function () {
        if (toastClosed) return;
        toastClosed = true;
        toastOnDismiss = null;
        if (toastTimer) {
          clearTimeout(toastTimer);
          toastTimer = null;
        }
        if (el.parentNode) el.remove();
        options.onAction();
      });
      el.appendChild(actionBtn);
    }

    document.body.appendChild(el);
    toastTimer = setTimeout(function () {
      toastTimer = null;
      if (el.parentNode) el.remove();
      if (toastOnDismiss && !toastClosed) {
        var dismissFn = toastOnDismiss;
        toastOnDismiss = null;
        toastClosed = true;
        try { dismissFn(); } catch (_) {}
      }
    }, durationMs);
  }

  function dismissToast() {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    var existing = document.getElementById("elgoToast");
    if (existing) existing.remove();
    if (toastOnDismiss && !toastClosed) {
      var dismissFn = toastOnDismiss;
      toastOnDismiss = null;
      toastClosed = true;
      try { dismissFn(); } catch (_) {}
    }
  }

  function currentRouteKey() {
    var params = new URLSearchParams(location.search || "");
    var panel = params.get("panel");
    if (panel === "saved" || panel === "mistakes" || panel === "leaderboard" || panel === "settings" || panel === "admin") {
      return panel;
    }
    return "courses";
  }

  function syncActiveNav() {
    var key = currentRouteKey();
    document.querySelectorAll("[data-nav]").forEach(function (el) {
      var isCurrent = el.getAttribute("data-nav") === key;
      if (isCurrent) {
        el.setAttribute("aria-current", "page");
      } else {
        el.removeAttribute("aria-current");
      }
    });
  }

  function syncFooterTranslation() {
    var lang = root.ElgoTheme && typeof root.ElgoTheme.getLang === "function" ? root.ElgoTheme.getLang() : "en";
    var crafted = document.querySelector('[data-i18n-footer="crafted"]');
    var author = document.querySelector('[data-i18n-footer="author"]');
    var contact = document.querySelector('[data-i18n-footer="contact"]');
    if (crafted) crafted.textContent = lang === "ar" ? "صُنع بعناية" : "crafted with care";
    if (author) author.innerHTML = lang === "ar" ? 'بواسطة أدهم<span aria-hidden="true">.</span>' : 'by Adham<span aria-hidden="true">.</span>';
    if (contact) contact.textContent = lang === "ar" ? "للتواصل" : "For contact";
  }

  function getOnlineCountText(count) {
    var n = Math.max(1, Number(count) || 1);
    return n + " " + root.ElgoState.t("onlineLabel");
  }

  function renderHeaderAndNav() {
    var header = document.getElementById("shellHeader");
    var bottomNav = document.getElementById("shellBottomNav");
    var State = root.ElgoState;
    var Theme = root.ElgoTheme;
    if (!header || !State || !Theme) return;

    var theme = Theme.getTheme();
    var paused = Theme.isMotionPaused();
    var auth = State.getAuth();
    var profile = auth && auth.profile;
    var isolated = typeof State.isIsolatedSignedOutState === "function" && State.isIsolatedSignedOutState();
    var bookmarksCount = isolated ? 0 : (State.getState().bookmarks || []).length;
    var unresolvedCount = State.getMistakes("", { status: "unresolved" }).length;
    var prevMenu = document.getElementById("shellMoreMenu");
    var wasMoreOpen = Boolean(prevMenu && !prevMenu.classList.contains("hidden"));
    var wasMobileSheet = Boolean(prevMenu && prevMenu.classList.contains("is-mobile-sheet"));

    header.className = "product-header";
    header.innerHTML = [
      '<div class="header-inner">',
      '  <a href="/?flow=hub" class="wordmark" data-nav="courses">',
      '    <img src="/assets/mascot/mascot-clay.webp" alt="elgo lab mascot" width="36" height="36">',
      '    <span>elgo lab<span class="brand-dot">.</span></span>',
      '  </a>',
      '  <nav class="shell-tabs" aria-label="Primary Navigation">',
      '    <a href="/?flow=hub" class="shell-nav-link" data-nav="courses">' + svgIcon("courses") + '<span>' + esc(State.t("courses")) + '</span></a>',
      '    <a href="/?panel=saved" class="shell-nav-link" data-nav="saved">' + svgIcon("saved") + '<span>' + esc(State.t("saved")) + (bookmarksCount ? ' <em class="nav-badge">' + bookmarksCount + '</em>' : '') + '</span></a>',
      '    <a href="/?panel=mistakes" class="shell-nav-link" data-nav="mistakes">' + svgIcon("mistakes") + '<span>' + esc(State.t("mistakes")) + (unresolvedCount ? ' <em class="nav-badge">' + unresolvedCount + '</em>' : '') + '</span></a>',
      '    <a href="/?panel=leaderboard" class="shell-nav-link" data-nav="leaderboard">' + svgIcon("leaderboard") + '<span>' + esc(State.t("leaderboard")) + '</span></a>',
      '  </nav>',
      '  <div class="shell-utility-bar">',
      '    <button type="button" class="shell-search-btn" id="shellSearchBtn" title="' + esc(State.t("searchTitle")) + '">' + svgIcon("search") + '<span class="btn-label">' + esc(State.t("search")) + '</span><kbd>Ctrl K</kbd></button>',
      '    <a href="/?panel=leaderboard" class="shell-header-rank" title="' + esc(State.t("leaderboard")) + '">' + svgIcon("leaderboard") + '</a>',
      '    <span class="presence-pill" id="shellPresencePill" title="Live active learners"><span class="presence-dot" aria-hidden="true"></span><span id="presenceCountText">1 ' + esc(State.t("onlineLabel")) + '</span></span>',
      '    <button type="button" class="ui-language-toggle" id="shellLangBtn" title="Switch language">' + esc(State.t("langToggle")) + '</button>',
      '    <button type="button" class="theme-toggle" id="shellThemeBtn" title="Toggle Daylight / Evening theme"><span class="theme-symbol" aria-hidden="true">' + (theme === "evening" ? '☀' : '☾') + '</span><span id="themeLabel" class="btn-label">' + esc(theme === "evening" ? State.t("daylight") : State.t("evening")) + '</span></button>',
             profile
               ? '<button type="button" class="shell-auth-pill" id="shellAccountBtn" title="' + esc(State.t("settingsProfile")) + '"><span>' + esc(profile.username) + '</span></button>'
               : '<button type="button" class="shell-auth-pill" id="shellSignInBtn">' + esc(State.t("signIn")) + '</button>',
      '    <div class="shell-menu">',
      '      <button type="button" class="shell-icon-btn shell-more-trigger" id="shellMoreBtn" aria-expanded="false" aria-haspopup="menu" title="' + esc(State.t("more")) + '">' + svgIcon("more") + '<span class="btn-label">' + esc(State.t("more")) + '</span></button>',
      '      <div class="shell-menu-panel hidden" id="shellMoreMenu" role="menu">',
      '        <div class="shell-menu-caption">' + (profile ? ('<strong>' + esc(profile.username) + '</strong>' + (profile.guest ? ' · ' + esc(State.t("guestTag")) : '')) : 'YOUR STUDY SPACE') + '</div>',
      '        <button type="button" class="shell-menu-item" id="menuSearchBtn" role="menuitem" data-close-more><span>' + esc(State.t("search")) + '</span><kbd>Ctrl K</kbd></button>',
               profile
                 ? '<button type="button" class="shell-menu-item" id="menuAccountBtn" role="menuitem" data-close-more><span>' + esc(State.t("settingsProfile")) + '</span><small class="menu-pill">' + esc(profile.username) + '</small></button>'
                 : '<button type="button" class="shell-menu-item" id="menuSignInBtn" role="menuitem" data-close-more>' + esc(State.t("signIn")) + '</button>',
      '        <a href="/?flow=hub" class="shell-menu-item" role="menuitem" data-close-more>' + esc(State.t("rankedQuizzes")) + '</a>',
      '        <a href="/?panel=leaderboard" class="shell-menu-item" role="menuitem" data-close-more>' + esc(State.t("leaderboard")) + '</a>',
      '        <button type="button" class="shell-menu-item" id="menuUpgradeBtn" role="menuitem" data-close-more>' + esc(State.t("keepProgress")) + '</button>',
      '        <a href="/?panel=settings" class="shell-menu-item" role="menuitem" data-close-more>' + esc(State.t("settingsProfile")) + '</a>',
      '        <a href="/?panel=settings#faculty" class="shell-menu-item" role="menuitem" data-close-more>' + esc(State.t("facultyTerm")) + '</a>',
      '        <button type="button" class="shell-menu-item" id="menuMotionBtn" role="menuitem" data-close-more>' + esc(paused ? State.t("resumeMotion") : State.t("pauseMotion")) + '</button>',
      '        <hr>',
      '        <span class="shell-menu-overline">MANAGE &amp; ABOUT</span>',
      '        <a href="/?panel=admin" class="shell-menu-item" role="menuitem" data-close-more>' + esc(State.t("adminAccess")) + '</a>',
      '        <button type="button" class="shell-menu-item" id="menuAboutBtn" role="menuitem" data-close-more>' + esc(State.t("aboutElgo")) + '</button>',
      '        <button type="button" class="shell-menu-item" id="menuTeamBtn" role="menuitem" data-close-more>' + esc(State.t("teamTitle")) + '</button>',
      '      </div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join("\n");

    function setMoreMenuOpen(opening, asMobileSheet) {
      var menu = document.getElementById("shellMoreMenu");
      var btn = document.getElementById("shellMoreBtn");
      var mobileBtn = document.getElementById("mobileMoreBtn");
      if (menu) {
        menu.classList.toggle("hidden", !opening);
        menu.classList.toggle("is-mobile-sheet", Boolean(opening && asMobileSheet));
      }
      if (btn) btn.setAttribute("aria-expanded", opening ? "true" : "false");
      if (mobileBtn) mobileBtn.setAttribute("aria-expanded", opening ? "true" : "false");
    }

    if (bottomNav) {
      bottomNav.innerHTML = [
        '<a href="/?flow=hub" class="shell-mobile-link" data-nav="courses">' + svgIcon("courses") + '<span>' + esc(State.t("courses")) + '</span></a>',
        '<a href="/?panel=saved" class="shell-mobile-link" data-nav="saved">' + svgIcon("saved") + '<span>' + esc(State.t("saved")) + (bookmarksCount ? ' (' + bookmarksCount + ')' : '') + '</span></a>',
        '<a href="/?panel=mistakes" class="shell-mobile-link" data-nav="mistakes">' + svgIcon("mistakes") + '<span>' + esc(State.t("mistakes")) + (unresolvedCount ? ' (' + unresolvedCount + ')' : '') + '</span></a>',
        '<button type="button" class="shell-mobile-link" id="mobileMoreBtn" aria-expanded="false" aria-haspopup="menu" aria-controls="shellMoreMenu">' + svgIcon("more") + '<span>' + esc(State.t("more")) + '</span></button>'
      ].join("\n");

      var mobileMoreBtn = document.getElementById("mobileMoreBtn");
      if (mobileMoreBtn) {
        mobileMoreBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          var menu = document.getElementById("shellMoreMenu");
          var opening = menu ? menu.classList.contains("hidden") : false;
          setMoreMenuOpen(opening, true);
        });
      }
    }

    var openSearch = function () {
      if (root.ElgoQuickSearch) root.ElgoQuickSearch.open();
    };
    var searchBtn = document.getElementById("shellSearchBtn");
    if (searchBtn) searchBtn.addEventListener("click", openSearch);
    var menuSearchBtn = document.getElementById("menuSearchBtn");
    if (menuSearchBtn) menuSearchBtn.addEventListener("click", openSearch);

    var langBtn = document.getElementById("shellLangBtn");
    if (langBtn) {
      langBtn.addEventListener("click", function () {
        Theme.toggleLang();
        renderHeaderAndNav();
        if (root.ElgoRouter && typeof root.ElgoRouter.route === "function") {
          root.ElgoRouter.route();
        }
      });
    }

    var themeBtn = document.getElementById("shellThemeBtn");
    if (themeBtn) {
      themeBtn.addEventListener("click", function () {
        Theme.toggleTheme();
        renderHeaderAndNav();
      });
    }

    var goAccount = function () { root.ElgoRouter.navigate("/?panel=settings"); };
    var openLogin = function () { openAuthModal("guest"); };
    var accountBtn = document.getElementById("shellAccountBtn");
    if (accountBtn) accountBtn.addEventListener("click", goAccount);
    var menuAccountBtn = document.getElementById("menuAccountBtn");
    if (menuAccountBtn) menuAccountBtn.addEventListener("click", goAccount);

    var signInBtn = document.getElementById("shellSignInBtn");
    if (signInBtn) signInBtn.addEventListener("click", openLogin);
    var menuSignInBtn = document.getElementById("menuSignInBtn");
    if (menuSignInBtn) menuSignInBtn.addEventListener("click", openLogin);

    var moreBtn = document.getElementById("shellMoreBtn");
    var moreMenu = document.getElementById("shellMoreMenu");
    if (moreBtn && moreMenu) {
      moreBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        var opening = moreMenu.classList.contains("hidden");
        setMoreMenuOpen(opening, false);
      });
    }
    if (moreMenu) {
      moreMenu.querySelectorAll("[data-close-more]").forEach(function (item) {
        item.addEventListener("click", function () {
          setMoreMenuOpen(false, false);
        });
      });
    }
    if (wasMoreOpen) {
      setMoreMenuOpen(true, wasMobileSheet);
    }

    var upgradeBtn = document.getElementById("menuUpgradeBtn");
    if (upgradeBtn) {
      upgradeBtn.addEventListener("click", function () {
        var curAuth = State.getAuth();
        openAuthModal(curAuth && curAuth.profile && curAuth.profile.guest ? "upgrade" : "register");
      });
    }

    var motionBtn = document.getElementById("menuMotionBtn");
    if (motionBtn) {
      motionBtn.addEventListener("click", function () {
        var nowPaused = !Theme.isMotionPaused();
        Theme.setMotionPaused(nowPaused);
        renderHeaderAndNav();
      });
    }

    var aboutBtn = document.getElementById("menuAboutBtn");
    if (aboutBtn) aboutBtn.addEventListener("click", openAboutDialog);

    var teamBtn = document.getElementById("menuTeamBtn");
    if (teamBtn) teamBtn.addEventListener("click", openTeamDialog);

    syncActiveNav();
    syncFooterTranslation();
    renderGuestProtectNudge();
    startPresenceLoop();
    if (!entryCheckedOnBoot) {
      entryCheckedOnBoot = true;
      setTimeout(ensureEntryGate, 80);
    }
  }

  function renderGuestProtectNudge() {
    if (typeof document === "undefined") return;
    var State = root.ElgoState;
    if (!State) return;
    var host = document.getElementById("guestProtectNudgeHost");
    var shouldShow = typeof State.shouldShowGuestProtectNudge === "function" && State.shouldShowGuestProtectNudge();
    if (!shouldShow) {
      if (host) host.innerHTML = "";
      return;
    }
    if (!host) {
      var bannerHost = document.getElementById("siteBannerHost");
      host = document.createElement("div");
      host.id = "guestProtectNudgeHost";
      if (bannerHost && bannerHost.parentNode) {
        bannerHost.parentNode.insertBefore(host, bannerHost.nextSibling);
      } else if (document.body) {
        document.body.insertBefore(host, document.body.firstChild);
      }
    }
    host.innerHTML = [
      '<div class="guest-protect-nudge" id="guestProtectNudge" role="region" aria-label="' + esc(State.t("protectNudgeAction")) + '">',
      '  <div class="guest-protect-nudge-text">' + esc(State.t("protectNudgeText")) + '</div>',
      '  <div class="inline" style="gap:8px;flex-shrink:0;">',
      '    <button type="button" class="primary" id="guestNudgeProtectBtn">' + esc(State.t("protectNudgeAction")) + '</button>',
      '    <button type="button" class="quiet" id="guestNudgeDismissBtn" aria-label="' + esc(State.t("protectNudgeDismiss")) + '">✕</button>',
      '  </div>',
      '</div>'
    ].join("\n");

    var protectBtn = host.querySelector("#guestNudgeProtectBtn");
    var dismissBtn = host.querySelector("#guestNudgeDismissBtn");
    if (protectBtn) {
      protectBtn.addEventListener("click", function () {
        if (typeof State.dismissGuestProtectNudge === "function") State.dismissGuestProtectNudge();
        renderGuestProtectNudge();
        openAuthModal("upgrade");
      });
    }
    if (dismissBtn) {
      dismissBtn.addEventListener("click", function () {
        if (typeof State.dismissGuestProtectNudge === "function") State.dismissGuestProtectNudge();
        renderGuestProtectNudge();
      });
    }
  }

  function getPresenceArea() {
    var params = new URLSearchParams(window.location.search || "");
    var panel = String(params.get("panel") || "").toLowerCase();
    var flow = String(params.get("flow") || "").toLowerCase();
    if (panel === "admin" || panel === "leaderboard" || panel === "saved" || panel === "mistakes" || panel === "settings") {
      return panel;
    }
    if (flow === "player" || panel === "practice") return "player";
    return "hub";
  }

  function startPresenceLoop() {
    if (presenceStarted) return;
    presenceStarted = true;
    var core = root.BankQuestionCore;
    if (!core || !core.Presence || typeof core.Presence.createPresenceClient !== "function") return;
    try {
      presenceClient = core.Presence.createPresenceClient({
        getHeaders: function () {
          var State = root.ElgoState;
          var auth = State && typeof State.getAuth === "function" ? State.getAuth() : null;
          return auth && auth.token ? { Authorization: "Bearer " + auth.token } : {};
        },
        getPayload: function () {
          return { area: getPresenceArea() };
        },
        onCount: function (n) {
          var el = document.getElementById("presenceCountText");
          if (el) el.textContent = getOnlineCountText(n);
        },
        onUnavailable: function (isOffline) {
          var el = document.getElementById("presenceCountText");
          var lang = root.ElgoTheme && typeof root.ElgoTheme.getLang === "function" ? root.ElgoTheme.getLang() : "en";
          if (el && isOffline) el.textContent = lang === "ar" ? "أوفلاين" : "Offline";
        },
      });
      if (presenceClient && typeof presenceClient.start === "function") presenceClient.start();
    } catch (_err) {
      // Ignore offline presence errors
    }
  }

  function refreshPresence() {
    if (presenceClient && typeof presenceClient.ping === "function") {
      presenceClient.ping();
    }
  }

  function renderSiteBanner() {
    var host = document.getElementById("siteBannerHost");
    var State = root.ElgoState;
    if (!host || !State) return;
    var settings = State.getSiteSettings() || {};
    var bannerText = String(settings.bannerText || settings.announcement || (settings.banner && settings.banner.text) || "").trim();
    var explicitlyHidden = settings.bannerVisible === false || (settings.banner && settings.banner.visible === false);
    if (!bannerText || explicitlyHidden) {
      host.innerHTML = "";
      return;
    }
    var rawUrl = String(settings.bannerUrl || (settings.banner && settings.banner.url) || "").trim();
    var safeUrl = (/^https?:\/\//i.test(rawUrl) || (rawUrl.startsWith("/") && !rawUrl.startsWith("//"))) ? rawUrl : "";
    if (safeUrl) {
      var extAttrs = /^https?:\/\//i.test(safeUrl) ? ' target="_blank" rel="noopener noreferrer"' : ' data-route-link="1"';
      host.innerHTML = '<div class="site-banner" role="region" aria-label="Announcement"><a href="' + esc(safeUrl) + '"' + extAttrs + '>' + esc(bannerText) + ' ↗</a></div>';
    } else {
      host.innerHTML = '<div class="site-banner" role="region" aria-label="Announcement">' + esc(bannerText) + '</div>';
    }
  }

  function confirmAction(opts) {
    var o = opts || {};
    return new Promise(function (resolve) {
      if (typeof document === "undefined") {
        resolve(false);
        return;
      }
      if (!confirmDialog || !document.body.contains(confirmDialog)) {
        confirmDialog = document.createElement("dialog");
        confirmDialog.className = "elgo-dialog";
        confirmDialog.id = "elgoConfirmDialog";
        document.body.appendChild(confirmDialog);
      }
      var settled = false;
      var finish = function (val) {
        if (settled) return;
        settled = true;
        resolve(Boolean(val));
      };
      var requiredTarget = o.requireTypedMatch ? String(o.requireTypedMatch) : "";
      var confirmBtnCls = o.danger ? "admin-btn-danger" : "primary";

      confirmDialog.innerHTML = [
        '<form class="dialog-body" id="elgoConfirmForm">',
        '  <div class="dialog-head">',
        '    <h2 style="margin:0;">' + esc(o.title || txt("Confirm Action", "تأكيد الإجراء")) + '</h2>',
        '    <button type="button" class="quiet" id="elgoConfirmCloseBtn" aria-label="Close">✕</button>',
        '  </div>',
        '  <p style="margin:0;color:var(--muted);font-size:0.9rem;line-height:1.55;">' + esc(o.message || "") + '</p>',
           requiredTarget ? [
             '<div class="dialog-field">',
             '  <label for="elgoConfirmMatchInput">' + esc(o.typedLabel || txt("Type your username to confirm", "اكتب اسم المستخدم للتأكيد")) + '</label>',
             '  <input id="elgoConfirmMatchInput" type="text" autocomplete="off" placeholder="' + esc(o.typedPlaceholder || requiredTarget) + '">',
             '</div>'
           ].join("\n") : '',
           o.checkboxLabel ? [
             '<label class="inline" style="font-size:0.86rem;cursor:pointer;gap:8px;align-items:flex-start;">',
             '  <input type="checkbox" id="elgoConfirmExtraCheck"' + (o.checkboxDefaultChecked !== false ? " checked" : "") + '>',
             '  <span>' + esc(o.checkboxLabel) + '</span>',
             '</label>'
           ].join("\n") : '',
        '  <div class="inline" style="justify-content:flex-end;">',
        '    <button type="button" class="secondary" id="elgoConfirmCancelBtn">' + esc(o.cancelLabel || txt("Cancel", "إلغاء")) + '</button>',
        '    <button type="submit" class="' + confirmBtnCls + '" id="elgoConfirmOkBtn"' + (requiredTarget ? " disabled" : "") + '>' + esc(o.confirmLabel || txt("Confirm", "تأكيد")) + '</button>',
        '  </div>',
        '</form>'
      ].join("\n");

      var formEl = confirmDialog.querySelector("#elgoConfirmForm");
      var okBtn = confirmDialog.querySelector("#elgoConfirmOkBtn");
      var matchInput = confirmDialog.querySelector("#elgoConfirmMatchInput");
      if (matchInput && okBtn) {
        matchInput.addEventListener("input", function () {
          okBtn.disabled = normalizeMatch(matchInput.value) !== normalizeMatch(requiredTarget);
        });
      }
      var closeWith = function (val) {
        finish(val);
        if (confirmDialog.open && typeof confirmDialog.close === "function") confirmDialog.close();
      };
      confirmDialog.addEventListener("close", function () { finish(false); }, { once: true });
      confirmDialog.addEventListener("click", function (e) {
        if (e.target === confirmDialog) closeWith(false);
      });
      confirmDialog.querySelector("#elgoConfirmCloseBtn").addEventListener("click", function () { closeWith(false); });
      confirmDialog.querySelector("#elgoConfirmCancelBtn").addEventListener("click", function () { closeWith(false); });
      formEl.addEventListener("submit", function (e) {
        e.preventDefault();
        if (requiredTarget && (!matchInput || normalizeMatch(matchInput.value) !== normalizeMatch(requiredTarget))) {
          return;
        }
        if (o.checkboxLabel) {
          var extraCheckEl = confirmDialog.querySelector("#elgoConfirmExtraCheck");
          o.checkboxChecked = extraCheckEl ? Boolean(extraCheckEl.checked) : Boolean(o.checkboxDefaultChecked !== false);
        }
        closeWith(true);
      });

      if (!confirmDialog.open && typeof confirmDialog.showModal === "function") {
        confirmDialog.showModal();
      } else {
        finish(false);
      }
    });
  }

  function openAuthModal(initialTab, options) {
    var State = root.ElgoState;
    var auth = State.getAuth();
    var isGuest = Boolean(auth && auth.profile && auth.profile.guest);
    var tab = initialTab || (isGuest ? "upgrade" : "guest");
    var isEntryFlow = Boolean(options && options.entryGate);

    if (!authDialog) {
      authDialog = document.createElement("dialog");
      authDialog.className = "elgo-dialog entry-gate";
      authDialog.id = "entryGate";
      document.body.appendChild(authDialog);
      authDialog.addEventListener("click", function (e) {
        if (e.target === authDialog) {
          entryDismissedThisLoad = true;
          authDialog.close();
        }
      });
    }

    function mapAuthError(data, status) {
      var code = data && data.code ? String(data.code) : "";
      if (isArLang()) {
        if (code === "GUEST_ACCOUNT") {
          return "الاسم ده اتعمل من غير كلمة سر على متصفح تاني. افتح Elgo Lab على المتصفح ده واختار «حماية الحساب» علشان تستخدمه هنا.";
        }
        if (code === "ACCOUNT_NEEDS_CLAIM") {
          return "الحساب ده لسه ملوش كلمة سر. تواصل مع مسؤول المنصة للمساعدة.";
        }
        if (code === "CLAIM_DISABLED") {
          return "استرداد الحسابات الذاتي معطل للأمان. تواصل مع مسؤول المنصة.";
        }
        if (code === "BAD_CREDENTIALS") {
          return "اسم المستخدم أو كلمة السر غير صحيحة.";
        }
        if (code === "USERNAME_TAKEN") {
          return "الاسم ده مستخدم قبل كده. سجل دخول أو اختار اسم تاني.";
        }
        if (code === "RATE_LIMITED") {
          return "محاولات كتير في وقت قصير. استنى شوية وحاول تاني.";
        }
        if (code === "BAD_PASSWORD") {
          return "كلمة السر لازم تكون من ٨ لـ ٢٠٠ حرف.";
        }
        if (code === "SYNC_CONTENTION") {
          return "تعذر إتمام العملية بسبب تحديث متزامن للبيانات. جرب تاني دلوقتي.";
        }
        if (code === "ALREADY_SECURED") {
          return "الحساب ده محمي بكلمة سر بالفعل. جرب تسجل دخول بكلمة السر.";
        }
        if (code === "MAINTENANCE_WRITE_FREEZE") {
          return "جاري تحديث قاعدة البيانات حالياً. الحفظ متوقف مؤقتاً، جرب بعد شوية.";
        }
        if (code === "TOO_LARGE") {
          return "حجم بيانات المذاكرة المحفوظة أكبر من الحد المسموح على الخادم.";
        }
      }
      return (data && data.error) || (State.t("authFailedFallback") + " (" + status + ").");
    }

    async function executeAuthSubmit(activeTab, username, password, includeLocalProgress, confirmGuestSwitch, discardUnresolved) {
      var curAuth = State.getAuth();
      var curIsGuest = Boolean(curAuth && curAuth.profile && curAuth.profile.guest);
      var oldGuestToken = curIsGuest && curAuth ? curAuth.token : "";
      var captureGen = typeof State.getAuthGeneration === "function" ? State.getAuthGeneration() : null;
      var endpoint = activeTab === "login"
        ? "/api/auth/login"
        : activeTab === "register"
          ? "/api/auth/register"
          : activeTab === "upgrade"
            ? "/api/auth/upgrade"
            : "/api/auth/guest";

      var stBeforeAuth = typeof State.getState === "function" ? State.getState() : null;
      var curStudentId = curAuth && curAuth.profile ? curAuth.profile.studentId : "";
      var payload = (typeof State.buildAuthPayload === "function")
        ? State.buildAuthPayload({
            mode: activeTab,
            username: username,
            password: password,
            includeLocalProgress: includeLocalProgress,
            currentStudentId: curStudentId,
          })
        : (activeTab === "guest" ? { username: username } : { username: username, password: password });
      var reqHeaders = activeTab === "upgrade"
        ? State.authHeaders({ "Content-Type": "application/json" }, curAuth ? curAuth.token : "")
        : { "Content-Type": "application/json" };

      var res = await fetch(endpoint, {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify(payload),
      });
      var data = await res.json().catch(function () { return null; });
      if (!res.ok || !data || !data.ok || !data.token) {
        return { ok: false, error: mapAuthError(data, res.status) };
      }
      if (captureGen != null && typeof State.getAuthGeneration === "function" && State.getAuthGeneration() !== captureGen) {
        return { ok: false, error: txt("Session changed while signing in. Please try again.", "تغيرت الجلسة أثناء تسجيل الدخول. جرب تاني.") };
      }

      var guestCleanupWarning = null;
      if (curIsGuest && activeTab !== "upgrade") {
        if (!confirmGuestSwitch) {
          return { ok: false, error: txt("Explicit confirmation required before leaving guest account.", "مطلوب تأكيد صريح قبل ترك حساب الزائر.") };
        }
        if (oldGuestToken) {
          await fetch("/api/auth/logout", {
            method: "POST",
            headers: { Authorization: "Bearer " + oldGuestToken },
          }).catch(function () {});
        }
        if (typeof State.clearPersonalDataFromDevice === "function") {
          var guestClearRes = State.clearPersonalDataFromDevice(curStudentId ? { purgeRecoveryForOwner: curStudentId } : undefined);
          if (guestClearRes && guestClearRes.ok === false) {
            guestCleanupWarning = guestClearRes;
          }
        }
        var guestAuthClearRes = State.setAuth(null);
        if (guestAuthClearRes && guestAuthClearRes.ok === false) {
          guestCleanupWarning = guestCleanupWarning
            ? Object.assign({}, guestCleanupWarning, {
                authCleanupFailed: true,
                failedKeys: (guestCleanupWarning.failedKeys || []).concat(guestAuthClearRes.failedKeys || []),
              })
            : guestAuthClearRes;
        }
        captureGen = typeof State.getAuthGeneration === "function" ? State.getAuthGeneration() : null;
      }

      if (typeof State.completeAuthTransition === "function") {
        var transitioned = await State.completeAuthTransitionWithLock(data, {
          confirmGuestSwitch: Boolean(confirmGuestSwitch),
          discardUnresolved: Boolean(discardUnresolved),
          expectedAuthGeneration: captureGen,
        });
        if (!transitioned) {
          var recErr = typeof State.consumeRecoveryError === "function" ? State.consumeRecoveryError() : null;
          if (recErr) {
            return {
              ok: false,
              recoveryFailed: true,
              recoveryError: recErr,
              pendingAuthData: data,
              confirmGuestSwitch: Boolean(confirmGuestSwitch),
              error: recErr.error || txt("Could not save local recovery copy.", "تعذر حفظ نسخة الاسترداد المحلية."),
            };
          }
          return { ok: false, error: txt("Session changed while signing in. Please try again.", "تغيرت الجلسة أثناء تسجيل الدخول. جرب تاني.") };
        }
      } else {
        State.setAuth({ token: data.token, profile: data.profile }, { confirmGuestSwitch: Boolean(confirmGuestSwitch) });
        var cloudProgress = (data.profile && data.profile.progress) || data.progress;
        if (cloudProgress && typeof State.applyCloudProgress === "function") {
          var shouldReplaceOnAuth = (activeTab === "guest" || activeTab === "register" || (curIsGuest && activeTab === "login"))
            && (Boolean(stBeforeAuth && stBeforeAuth.ownerStudentId) || !includeLocalProgress);
          State.applyCloudProgress(cloudProgress, {
            studentId: data.profile && data.profile.studentId,
            username: data.profile && data.profile.username,
            replace: shouldReplaceOnAuth,
            fromSyncResync: Boolean(data.syncResyncRequired),
            serverTime: data.serverTime,
          });
        }
      }
      var statePurgeWarn = typeof State.consumeRecoveryPurgeWarning === "function" ? State.consumeRecoveryPurgeWarning() : null;
      var combinedWarn = statePurgeWarn && guestCleanupWarning
        ? Object.assign({}, statePurgeWarn, {
            authCleanupFailed: Boolean(statePurgeWarn.authCleanupFailed || guestCleanupWarning.authCleanupFailed),
            failedKeys: (statePurgeWarn.failedKeys || []).concat(guestCleanupWarning.failedKeys || []),
          })
        : (statePurgeWarn || guestCleanupWarning);
      return { ok: true, profile: data.profile, cleanupWarning: combinedWarn };
    }

    function finishAuthSuccess(profile, cleanupWarning) {
      authDialog.close();
      renderHeaderAndNav();
      var purgeWarn = cleanupWarning || (typeof State.consumeRecoveryPurgeWarning === "function" ? State.consumeRecoveryPurgeWarning() : null);
      var recNotice = typeof State.consumeRecoveredUnresolvedNotice === "function" ? State.consumeRecoveredUnresolvedNotice() : null;
      if (purgeWarn) {
        var uname = (profile && profile.username) ? profile.username : "";
        var detailKind = purgeWarn.authCleanupFailed
          ? txt("session or local recovery data", "بيانات الجلسة أو الاسترداد المحلية")
          : txt("local recovery data", "بيانات الاسترداد المحلية");
        var warnText = txt(
          (uname ? ("Signed in as " + uname + ", but ") : "") + "local cleanup for the previous account failed. Some " + detailKind + " may remain in this browser.",
          (uname ? ("تم تسجيل الدخول باسم " + uname + "، لكن ") : "") + "تعذر إتمام مسح بيانات الحساب السابق. قد تبقى بعض " + detailKind + " في المتصفح ده."
        );
        if (recNotice && recNotice.message) warnText += " — " + recNotice.message;
        showToast(warnText, { durationMs: 7500 });
      } else {
        if (profile && profile.username) {
          showToast(State.t("authWelcomePrefix") + profile.username + "!");
        }
        if (recNotice && recNotice.message) showToast(recNotice.message, { durationMs: 6500 });
      }
      if (root.ElgoRouter && typeof root.ElgoRouter.route === "function") {
        root.ElgoRouter.route();
      }
    }

    function paintModal(activeTab, errorMsg, pendingSwitch) {
      auth = State.getAuth();
      isGuest = Boolean(auth && auth.profile && auth.profile.guest);

      if (pendingSwitch && isGuest && auth && auth.profile) {
        var guestUsername = auth.profile.username || "";
        var switchWarn = txt(
          "You are currently signed in as guest \"" + guestUsername + "\" without a password. Switching accounts will permanently cut off access to this guest identity and clear any unsynced data on this device.",
          "أنت مسجل دلوقتي بحساب زائر «" + guestUsername + "» من غير كلمة سر. لو بدّلت الحساب مش هتقدر تفتح حساب الزائر ده تاني أبداً، وأي بيانات لسه متزامنتش على الجهاز ده هتتمسح."
        );
        authDialog.innerHTML = [
          '<form class="dialog-body entry-gate-card" id="elgoAuthSwitchForm">',
          '  <div class="dialog-head">',
          '    <h2 style="margin:0;">' + esc(State.t("authGuestSwitchTitle")) + '</h2>',
          '    <button type="button" class="quiet" id="closeAuthDialogBtn" aria-label="' + esc(State.t("authCloseAria")) + '">✕</button>',
          '  </div>',
             errorMsg ? '<div class="dialog-error" role="alert">' + esc(errorMsg) + '</div>' : '',
          '  <div class="auth-guest-notice" id="authSwitchWarning" role="alert">' + esc(switchWarn) + '</div>',
          '  <div class="inline">',
          '    <button type="button" class="primary" id="authSwitchProtectBtn">' + esc(State.t("authGuestSwitchProtectFirst")) + '</button>',
          '  </div>',
          '  <div class="dialog-field">',
          '    <label for="authSwitchConfirmInput">' + esc(State.t("authGuestSwitchTypeLabel")) + '</label>',
          '    <input id="authSwitchConfirmInput" type="text" autocomplete="off" placeholder="' + esc(guestUsername) + '">',
          '  </div>',
          '  <div class="inline" style="justify-content:flex-end;">',
          '    <button type="button" class="secondary" id="authSwitchCancelBtn">' + esc(State.t("authGuestSwitchCancel")) + '</button>',
          '    <button type="submit" class="admin-btn-danger" id="authSwitchProceedBtn" disabled>' + esc(State.t("authGuestSwitchProceed")) + '</button>',
          '  </div>',
          '</form>'
        ].join("\n");

        var closeSwBtn = authDialog.querySelector("#closeAuthDialogBtn");
        var cancelSwBtn = authDialog.querySelector("#authSwitchCancelBtn");
        var protectSwBtn = authDialog.querySelector("#authSwitchProtectBtn");
        var matchSwInput = authDialog.querySelector("#authSwitchConfirmInput");
        var proceedSwBtn = authDialog.querySelector("#authSwitchProceedBtn");
        if (closeSwBtn) closeSwBtn.addEventListener("click", function () { authDialog.close(); });
        if (cancelSwBtn) cancelSwBtn.addEventListener("click", function () { paintModal("upgrade", ""); });
        if (protectSwBtn) protectSwBtn.addEventListener("click", function () { paintModal("upgrade", ""); });
        if (matchSwInput && proceedSwBtn) {
          matchSwInput.addEventListener("input", function () {
            proceedSwBtn.disabled = normalizeMatch(matchSwInput.value) !== normalizeMatch(guestUsername);
          });
        }
        authDialog.querySelector("#elgoAuthSwitchForm").addEventListener("submit", async function (e) {
          e.preventDefault();
          if (!matchSwInput || normalizeMatch(matchSwInput.value) !== normalizeMatch(guestUsername)) return;
          if (proceedSwBtn) proceedSwBtn.disabled = true;
          try {
            var out = await executeAuthSubmit(
              pendingSwitch.activeTab,
              pendingSwitch.username,
              pendingSwitch.password,
              pendingSwitch.includeLocalProgress,
              true
            );
            if (!out.ok) {
              if (out.recoveryFailed) {
                paintModal(pendingSwitch.activeTab, "", {
                  recoveryFailed: true,
                  activeTab: pendingSwitch.activeTab,
                  pendingAuthData: out.pendingAuthData,
                  confirmGuestSwitch: Boolean(out.confirmGuestSwitch),
                  recoveryError: out.recoveryError,
                });
                return;
              }
              paintModal(pendingSwitch.activeTab, out.error);
              return;
            }
            finishAuthSuccess(out.profile, out.cleanupWarning);
          } catch (_err) {
            paintModal(pendingSwitch.activeTab, State.t("authNetworkError"));
          }
        });
        return;
      }

      if (pendingSwitch && pendingSwitch.recoveryFailed && pendingSwitch.pendingAuthData) {
        var failErrMsg = (pendingSwitch.recoveryError && pendingSwitch.recoveryError.error) ||
          txt("Could not save a separate local recovery copy for this device's unsynced changes.", "تعذر حفظ نسخة استرداد محلية منفصلة للتغييرات غير المتزامنة على الجهاز ده.");
        var failBody = txt(
          "Your previous account's unsynced local work is still intact and protected from silent deletion (" + failErrMsg + "). Switching now without saving recovery will permanently discard those unsynced changes on this device.",
          "الشغل اللي متزامنش بتاع الحساب اللي فات لسه محفوظ ومتمسحش (" + failErrMsg + "). لو كمّلت التبديل دلوقتي من غير حفظ نسخة استرداد، التغييرات غير المتزامنة على الجهاز ده هتتمسح نهائياً."
        );
        authDialog.innerHTML = [
          '<form class="dialog-body entry-gate-card" id="elgoAuthRecoveryFailForm">',
          '  <div class="dialog-head">',
          '    <h2 style="margin:0;">' + esc(txt("Recovery storage failed — keep work?", "فشل حفظ نسخة الاسترداد — تحب تحافظ على شغلك؟")) + '</h2>',
          '    <button type="button" class="quiet" id="closeAuthDialogBtn" aria-label="' + esc(State.t("authCloseAria")) + '">✕</button>',
          '  </div>',
             errorMsg ? '<div class="dialog-error" role="alert">' + esc(errorMsg) + '</div>' : '',
          '  <div class="auth-guest-notice" id="authRecoveryFailNotice" role="alert">' + esc(failBody) + '</div>',
          '  <div class="inline" style="justify-content:flex-end;">',
          '    <button type="button" class="primary" id="authRecoveryStayBtn">' + esc(txt("Stay & keep unsynced work", "الرجوع وحفظ التغييرات")) + '</button>',
          '    <button type="submit" class="admin-btn-danger" id="authRecoveryDiscardBtn">' + esc(txt("Discard unsynced work & switch", "مسح غير المتزامن والتبديل")) + '</button>',
          '  </div>',
          '</form>'
        ].join("\n");

        var cancelPendingTargetAuth = function () {
          var pData = pendingSwitch.pendingAuthData;
          if (pData && pData.token) {
            fetch("/api/auth/logout", {
              method: "POST",
              headers: { Authorization: "Bearer " + pData.token },
            }).catch(function () {});
          }
          authDialog.close();
        };
        var closeRecFailBtn = authDialog.querySelector("#closeAuthDialogBtn");
        var stayRecFailBtn = authDialog.querySelector("#authRecoveryStayBtn");
        if (closeRecFailBtn) closeRecFailBtn.addEventListener("click", cancelPendingTargetAuth);
        if (stayRecFailBtn) stayRecFailBtn.addEventListener("click", cancelPendingTargetAuth);
        authDialog.querySelector("#elgoAuthRecoveryFailForm").addEventListener("submit", async function (e) {
          e.preventDefault();
          var done = typeof State.completeAuthTransition === "function"
            ? await State.completeAuthTransitionWithLock(pendingSwitch.pendingAuthData, {
                confirmGuestSwitch: Boolean(pendingSwitch.confirmGuestSwitch),
                discardUnresolved: true,
              })
            : false;
          if (!done) {
            paintModal(pendingSwitch.activeTab, txt("Session changed while switching. Please try again.", "تغيرت الجلسة أثناء التبديل. جرب تاني."));
            return;
          }
          finishAuthSuccess(pendingSwitch.pendingAuthData && pendingSwitch.pendingAuthData.profile, null);
        });
        return;
      }

      if (pendingSwitch && pendingSwitch.accountSwitch && !isGuest && auth && auth.profile) {
        var curAccountName = auth.profile.username || "";
        var curUnresList = (typeof State.getUnresolvedMutations === "function" ? State.getUnresolvedMutations().items : []) || [];
        var switchAcctMsg = curUnresList.length
          ? txt(
              "Account \"" + curAccountName + "\" has " + curUnresList.length + " unresolved offline or conflicted change(s). Switching accounts hides this work from the next account. Keep a 7-day local recovery copy in this browser (unencrypted and accessible to anyone using this browser profile) so you can review or discard it when returning to \"" + curAccountName + "\".",
              "حساب «" + curAccountName + "» عليه " + curUnresList.length + " تغيير متعارض أو لسه ماتحلش. تبديل الحساب بيخفي الشغل ده عن الحساب التاني. تقدر تحتفظ بنسخة استرداد محلية لمدة ٧ أيام في المتصفح ده (غير مشفرة ويقدر يقرأها أي حد بيستخدم نفس البروفايل) علشان تراجعه أو تمسحه لما ترجع لحساب «" + curAccountName + "»."
            )
          : txt(
              "Account \"" + curAccountName + "\" has unsynced local study changes that could not reach the cloud yet. Keep a 7-day local recovery copy in this browser (unencrypted and accessible to anyone using this browser profile) for \"" + curAccountName + "\" before switching?",
              "حساب «" + curAccountName + "» عليه تغييرات مذاكرة لسه متزامنتش مع السحابة. تحب تحتفظ بنسخة استرداد محلية لمدة ٧ أيام في المتصفح ده (غير مشفرة ويقدر يقرأها أي حد بيستخدم نفس البروفايل) لحساب «" + curAccountName + "» قبل تبديل الحساب؟"
            );
        authDialog.innerHTML = [
          '<form class="dialog-body entry-gate-card" id="elgoAuthAccountSwitchForm">',
          '  <div class="dialog-head">',
          '    <h2 style="margin:0;">' + esc(txt("Unsynced work on this account", "شغل لسه متزامنش على الحساب ده")) + '</h2>',
          '    <button type="button" class="quiet" id="closeAuthDialogBtn" aria-label="' + esc(State.t("authCloseAria")) + '">✕</button>',
          '  </div>',
             errorMsg ? '<div class="dialog-error" role="alert">' + esc(errorMsg) + '</div>' : '',
          '  <div class="auth-guest-notice" id="authAccountSwitchWarning" role="alert">' + esc(switchAcctMsg) + '</div>',
          '  <label class="inline" style="font-size:0.86rem;cursor:pointer;gap:8px;align-items:flex-start;">',
          '    <input type="checkbox" id="authSwitchKeepRecoveryCheck" checked>',
          '    <span>' + esc(txt("Keep 7-day local recovery copy in this browser (unencrypted; uncheck on shared computers)", "احتفظ بنسخة استرداد محلية لمدة ٧ أيام في المتصفح ده (غير مشفرة؛ الغي الاختيار على الأجهزة المشتركة)")) + '</span>',
          '  </label>',
          '  <div class="inline" style="justify-content:flex-end;">',
          '    <button type="button" class="secondary" id="authAccountSwitchBackBtn">' + esc(txt("Stay on account", "الرجوع للحساب الحالي")) + '</button>',
          '    <button type="submit" class="primary" id="authAccountSwitchProceedBtn">' + esc(txt("Switch Account", "تبديل الحساب")) + '</button>',
          '  </div>',
          '</form>'
        ].join("\n");

        var closeAcctSwBtn = authDialog.querySelector("#closeAuthDialogBtn");
        var backAcctSwBtn = authDialog.querySelector("#authAccountSwitchBackBtn");
        var proceedAcctSwBtn = authDialog.querySelector("#authAccountSwitchProceedBtn");
        if (closeAcctSwBtn) closeAcctSwBtn.addEventListener("click", function () { authDialog.close(); });
        if (backAcctSwBtn) backAcctSwBtn.addEventListener("click", function () { paintModal(pendingSwitch.activeTab, ""); });
        authDialog.querySelector("#elgoAuthAccountSwitchForm").addEventListener("submit", async function (e) {
          e.preventDefault();
          var keepRecCheck = authDialog.querySelector("#authSwitchKeepRecoveryCheck");
          var discardOnSwitch = keepRecCheck ? !keepRecCheck.checked : false;
          if (proceedAcctSwBtn) proceedAcctSwBtn.disabled = true;
          try {
            var out = await executeAuthSubmit(
              pendingSwitch.activeTab,
              pendingSwitch.username,
              pendingSwitch.password,
              pendingSwitch.includeLocalProgress,
              false,
              discardOnSwitch
            );
            if (!out.ok) {
              if (out.recoveryFailed) {
                paintModal(pendingSwitch.activeTab, "", {
                  recoveryFailed: true,
                  activeTab: pendingSwitch.activeTab,
                  pendingAuthData: out.pendingAuthData,
                  confirmGuestSwitch: Boolean(out.confirmGuestSwitch),
                  recoveryError: out.recoveryError,
                });
                return;
              }
              paintModal(pendingSwitch.activeTab, out.error);
              return;
            }
            finishAuthSuccess(out.profile, out.cleanupWarning);
          } catch (_err) {
            paintModal(pendingSwitch.activeTab, State.t("authNetworkError"));
          }
        });
        return;
      }

      var btnLabel = activeTab === "login"
        ? State.t("authSubmitLogin")
        : activeTab === "register"
          ? State.t("authSubmitRegister")
          : activeTab === "upgrade"
            ? State.t("authSubmitUpgrade")
            : State.t("authSubmitGuest");
      var anonSummary = (typeof State.getAnonymousLocalSummary === "function")
        ? State.getAnonymousLocalSummary()
        : { hasData: false, savedCount: 0, mistakesCount: 0 };
      var showLocalImportChoice = (activeTab === "guest" || activeTab === "register") && anonSummary.hasData;
      var localImportLabel = txt(
        "Add the " + anonSummary.savedCount + " saved questions and " + anonSummary.mistakesCount + " mistakes on this device to your new account?",
        "إضافة " + anonSummary.savedCount + " سؤال محفوظ و" + anonSummary.mistakesCount + " خطأ على الجهاز ده لحسابك الجديد؟"
      );
      var isNewPasswordTab = activeTab === "register" || activeTab === "upgrade";
      var isUpgradeTab = activeTab === "upgrade";
      var showGuestSwitchWarn = isGuest && activeTab !== "upgrade" && auth && auth.profile;

      authDialog.innerHTML = [
        '<form class="dialog-body entry-gate-card" id="elgoAuthForm">',
        '  <div class="dialog-head">',
        '    <div class="entry-brand">',
        '      <img src="/assets/mascot/mascot-hello.png" alt="elgo mascot" width="52" height="52">',
        '      <div>',
        '        <h2>' + esc(isEntryFlow ? State.t("entryHeading") : State.t("accountModalHeading")) + '</h2>',
        '        <small style="color:var(--muted);">' + esc(State.t("entrySubEn")) + '</small>',
        '        <small dir="rtl" lang="ar" style="display:block;color:var(--accent);margin-top:2px;">' + esc(State.t("entrySubAr")) + '</small>',
        '      </div>',
        '    </div>',
        '    <button type="button" class="quiet" id="closeAuthDialogBtn" aria-label="' + esc(State.t("authCloseAria")) + '">✕</button>',
        '  </div>',
        '  <div class="auth-tabs">',
        '    <button type="button" class="course-tab-btn' + (activeTab === "guest" ? " is-active" : "") + '" data-auth-tab="guest">' + esc(State.t("authTabGuest")) + '</button>',
        '    <button type="button" class="course-tab-btn' + (activeTab === "login" ? " is-active" : "") + '" data-auth-tab="login">' + esc(State.t("authTabLogin")) + '</button>',
        '    <button type="button" class="course-tab-btn' + (activeTab === "register" || activeTab === "upgrade" ? " is-active" : "") + '" data-auth-tab="' + (isGuest ? "upgrade" : "register") + '">' + esc(isGuest ? State.t("authTabUpgrade") : State.t("authTabRegister")) + '</button>',
        '  </div>',
           errorMsg ? '<div class="dialog-error" role="alert">' + esc(errorMsg) + '</div>' : '',
           showGuestSwitchWarn ? [
             '<div class="auth-guest-notice" id="authGuestSwitchBanner" role="alert">',
             '  <div>' + esc(txt(
                  "Signed in as unprotected guest \"" + auth.profile.username + "\". Switching accounts may permanently lose access to it unless you set a password first.",
                  "أنت مسجل بحساب زائر من غير كلمة سر «" + auth.profile.username + "». تبديل الحساب ممكن يضيع وصولك ليه للأبد لو مضفتش كلمة سر الأول."
                )) + '</div>',
             '  <div style="margin-top:8px;"><button type="button" class="primary" id="authProtectFirstBtn">' + esc(State.t("authGuestSwitchProtectFirst")) + '</button></div>',
             '</div>'
           ].join("\n") : '',
           activeTab === "guest" ? '<div class="auth-guest-notice" role="note">' + esc(State.t("authGuestNotice")) + '</div>' : '',
        '  <div class="dialog-field">',
        '    <label for="authUsernameInput">' + esc(State.t("authUsernameLabel")) + '</label>',
        '    <input id="authUsernameInput" type="text" required minlength="3" maxlength="24" autocomplete="username" placeholder="' + esc(State.t("authUsernamePlaceholder")) + '" value="' + esc(isUpgradeTab && auth && auth.profile ? auth.profile.username : "") + '"' + (isUpgradeTab ? " readonly" : "") + '>',
             isUpgradeTab ? '<small style="color:var(--muted);">' + esc(State.t("authUpgradeRenameHint")) + '</small>' : '',
        '  </div>',
           activeTab !== "guest"
             ? [
                 '<div class="dialog-field">',
                 '  <label for="authPasswordInput">' + esc(State.t("authPasswordLabel")) + '</label>',
                 '  <input id="authPasswordInput" type="password" required' + (isNewPasswordTab ? ' minlength="8"' : '') + ' autocomplete="' + (activeTab === "login" ? "current-password" : "new-password") + '" placeholder="' + esc(isNewPasswordTab ? State.t("authPasswordNewPlaceholder") : State.t("authPasswordLoginPlaceholder")) + '">',
                    isNewPasswordTab ? '<small style="color:var(--muted);">' + esc(State.t("authPasswordNewHint")) + '</small>' : '',
                 '</div>'
               ].join("\n")
             : '',
           showLocalImportChoice
             ? '<label class="inline" style="font-size:0.86rem;cursor:pointer;gap:8px;"><input type="checkbox" id="authIncludeLocalCheck" checked> <span>' + esc(localImportLabel) + '</span></label>'
             : '',
        '  <div class="inline" style="justify-content:space-between;">',
        '    <button type="button" class="quiet" id="skipEntryBtn">' + esc(State.t("authBrowseLocally")) + '</button>',
        '    <button type="submit" class="primary" id="authSubmitBtn">' + esc(btnLabel) + '</button>',
        '  </div>',
        '</form>'
      ].join("\n");

      var protectFirstBtn = authDialog.querySelector("#authProtectFirstBtn");
      if (protectFirstBtn) {
        protectFirstBtn.addEventListener("click", function () {
          paintModal("upgrade", "");
        });
      }

      authDialog.querySelectorAll("[data-auth-tab]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          paintModal(btn.getAttribute("data-auth-tab"), "");
        });
      });

      var closeBtn = authDialog.querySelector("#closeAuthDialogBtn");
      var skipBtn = authDialog.querySelector("#skipEntryBtn");
      var closeAndSkip = function () {
        entryDismissedThisLoad = true;
        authDialog.close();
      };
      if (closeBtn) closeBtn.addEventListener("click", closeAndSkip);
      if (skipBtn) skipBtn.addEventListener("click", closeAndSkip);

      authDialog.querySelector("#elgoAuthForm").addEventListener("submit", async function (e) {
        e.preventDefault();
        var username = authDialog.querySelector("#authUsernameInput").value.trim();
        var passEl = authDialog.querySelector("#authPasswordInput");
        var password = passEl ? passEl.value : "";
        var includeLocalEl = authDialog.querySelector("#authIncludeLocalCheck");
        var includeLocalProgress = includeLocalEl ? Boolean(includeLocalEl.checked) : true;
        var liveAuth = State.getAuth();
        var liveIsGuest = Boolean(liveAuth && liveAuth.profile && liveAuth.profile.guest);

        if (liveIsGuest && activeTab !== "upgrade") {
          paintModal(activeTab, "", {
            activeTab: activeTab,
            username: username,
            password: password,
            includeLocalProgress: includeLocalProgress,
          });
          return;
        }

        var submitBtn = authDialog.querySelector("#authSubmitBtn");
        submitBtn.disabled = true;

        var switchingRegisteredAccount = !liveIsGuest && liveAuth && liveAuth.profile && activeTab !== "upgrade" && (
          activeTab !== "login" ||
          username.toLowerCase() !== String(liveAuth.profile.username || "").toLowerCase()
        );
        if (switchingRegisteredAccount) {
          if (typeof State.getState === "function" && State.getState().pendingProgressSync && typeof State.syncProgressToCloud === "function") {
            await State.syncProgressToCloud({ force: true }).catch(function () {});
          }
          var hasAccountWork = typeof State.hasPendingOrUnresolvedWork === "function"
            ? State.hasPendingOrUnresolvedWork()
            : Boolean(typeof State.getState === "function" && State.getState().pendingProgressSync);
          if (hasAccountWork) {
            paintModal(activeTab, "", {
              accountSwitch: true,
              activeTab: activeTab,
              username: username,
              password: password,
              includeLocalProgress: includeLocalProgress,
            });
            return;
          }
        }

        try {
          var out = await executeAuthSubmit(activeTab, username, password, includeLocalProgress, false, false);
          if (!out.ok) {
            if (out.recoveryFailed) {
              paintModal(activeTab, "", {
                recoveryFailed: true,
                activeTab: activeTab,
                pendingAuthData: out.pendingAuthData,
                confirmGuestSwitch: Boolean(out.confirmGuestSwitch),
                recoveryError: out.recoveryError,
              });
              return;
            }
            paintModal(activeTab, out.error);
            return;
          }
          finishAuthSuccess(out.profile, out.cleanupWarning);
        } catch (_err) {
          paintModal(activeTab, State.t("authNetworkError"));
        }
      });
    }

    paintModal(tab, "");
    if (!authDialog.open && typeof authDialog.showModal === "function") {
      authDialog.showModal();
    }
  }

  function openAboutDialog() {
    if (!aboutDialog) {
      aboutDialog = document.createElement("dialog");
      aboutDialog.className = "elgo-dialog";
      document.body.appendChild(aboutDialog);
      aboutDialog.addEventListener("click", function (e) {
        if (e.target === aboutDialog) aboutDialog.close();
      });
    }

    var catalog = root.ElgoState.getCatalog() || {};
    var subjectsCount = (catalog.subjects || []).length || 6;
    var qCount = (catalog.subjects || []).reduce(function (acc, s) {
      return acc + Number((s.counts && s.counts.totalQuestions) || s.questionsCount || 0);
    }, 0);

    aboutDialog.innerHTML = [
      '<div class="dialog-body">',
      '  <div class="dialog-head">',
      '    <h2>About elgo lab.</h2>',
      '    <button type="button" class="quiet" id="closeAboutBtn">✕</button>',
      '  </div>',
      '  <div style="display:flex;align-items:center;gap:14px;">',
      '    <img src="/assets/mascot/mascot-study.png" alt="elgo mascot studying" width="68" height="68" style="border-radius:16px;">',
      '    <p style="margin:0;color:var(--muted);font-size:0.92rem;">A calm botanical study hub uniting <strong>' + subjectsCount + ' courses</strong>, <strong>' + qCount + ' practice questions</strong>, bilingual explanations, lecture summaries, PDFs, and walkthrough videos.</p>',
      '  </div>',
      '  <div class="panel-item">',
      '    <strong>Creator · أدهم إيهاب</strong>',
      '    <p style="margin:0;font-size:0.88rem;color:var(--muted);">Built with care by <strong>Adham Ehab</strong> for Faculty of AI students.</p>',
      '    <div class="inline">',
      '      <a class="secondary" href="https://adhamelgohary.com" target="_blank" rel="noopener noreferrer">adhamelgohary.com ↗</a>',
      '      <a class="secondary" href="https://www.linkedin.com/in/adham-elgohary-02a315387/" target="_blank" rel="noopener noreferrer">LinkedIn ↗</a>',
      '      <a class="secondary" href="https://t.me/elgoo_0" target="_blank" rel="noopener noreferrer">Telegram · @elgoo_0 ↗</a>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join("\n");

    aboutDialog.querySelector("#closeAboutBtn").addEventListener("click", function () { aboutDialog.close(); });
    if (!aboutDialog.open && typeof aboutDialog.showModal === "function") aboutDialog.showModal();
  }

  function openTeamDialog() {
    if (!teamDialog) {
      teamDialog = document.createElement("dialog");
      teamDialog.className = "elgo-dialog";
      document.body.appendChild(teamDialog);
      teamDialog.addEventListener("click", function (e) {
        if (e.target === teamDialog) teamDialog.close();
      });
    }

    teamDialog.innerHTML = [
      '<div class="dialog-body">',
      '  <div class="dialog-head">',
      '    <h2>' + esc(root.ElgoState.t("teamTitle")) + '</h2>',
      '    <button type="button" class="quiet" id="closeTeamBtn">✕</button>',
      '  </div>',
      '  <div class="panel-list">',
      '    <div class="panel-item">',
      '      <strong>Adham Ehab · أدهم إيهاب</strong>',
      '      <small style="color:var(--muted);">Founder &amp; Solo Engineer — full-stack study engine, bilingual EN/AR banks, lecture guides, PDFs, and ranked exam platform</small>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join("\n");

    teamDialog.querySelector("#closeTeamBtn").addEventListener("click", function () { teamDialog.close(); });
    if (!teamDialog.open && typeof teamDialog.showModal === "function") teamDialog.showModal();
  }

  function ensureEntryGate() {
    var State = root.ElgoState;
    if (!State || entryDismissedThisLoad) return;
    var params = new URLSearchParams(location.search || "");
    var openParam = params.get("open");
    if (openParam === "login") {
      openAuthModal("login", { entryGate: false });
      return;
    }
    if (openParam === "upgrade") {
      openAuthModal("upgrade", { entryGate: false });
      return;
    }
    if (!State.getAuth() && !params.has("panel") && !params.has("challenge")) {
      openAuthModal("guest", { entryGate: true });
    }
  }

  function init() {
    renderHeaderAndNav();
    renderSiteBanner();

    if (!globalListenersAttached) {
      globalListenersAttached = true;

      document.addEventListener("click", function (e) {
        var menu = document.getElementById("shellMoreMenu");
        var btn = document.getElementById("shellMoreBtn");
        var mobileBtn = document.getElementById("mobileMoreBtn");
        if (menu && !menu.classList.contains("hidden")) {
          if ((btn && btn.contains(e.target)) || menu.contains(e.target) || (mobileBtn && mobileBtn.contains(e.target))) {
            return;
          }
          menu.classList.add("hidden");
          menu.classList.remove("is-mobile-sheet");
          if (btn) btn.setAttribute("aria-expanded", "false");
          if (mobileBtn) mobileBtn.setAttribute("aria-expanded", "false");
        }
      });

      document.addEventListener("keydown", function (e) {
        if ((e.ctrlKey || e.metaKey) && String(e.key || "").toLowerCase() === "k") {
          e.preventDefault();
          if (root.ElgoQuickSearch) root.ElgoQuickSearch.open();
        } else if (e.key === "Escape") {
          var menu = document.getElementById("shellMoreMenu");
          var btn = document.getElementById("shellMoreBtn");
          var mobileBtn = document.getElementById("mobileMoreBtn");
          if (menu) {
            menu.classList.add("hidden");
            menu.classList.remove("is-mobile-sheet");
          }
          if (btn) btn.setAttribute("aria-expanded", "false");
          if (mobileBtn) mobileBtn.setAttribute("aria-expanded", "false");
        }
      });

      document.addEventListener("elgo:authchange", function () {
        refreshPresence();
      });
    }
  }

  root.ElgoShell = {
    init: init,
    renderHeaderAndNav: renderHeaderAndNav,
    syncActiveNav: syncActiveNav,
    renderSiteBanner: renderSiteBanner,
    renderGuestProtectNudge: renderGuestProtectNudge,
    refreshPresence: refreshPresence,
    openAuthModal: openAuthModal,
    openAboutDialog: openAboutDialog,
    openTeamDialog: openTeamDialog,
    confirmAction: confirmAction,
    ensureEntryGate: ensureEntryGate,
    showToast: showToast,
    dismissToast: dismissToast,
  };
})(typeof window !== "undefined" ? window : globalThis);
