(function (root) {
  "use strict";

  var authDialog = null;
  var aboutDialog = null;
  var teamDialog = null;
  var toastTimer = null;
  var globalListenersAttached = false;
  var presenceStarted = false;
  var presenceClient = null;
  var entryDismissedThisLoad = false;
  var entryCheckedOnBoot = false;

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

  function showToast(msg) {
    var existing = document.getElementById("elgoToast");
    if (existing) existing.remove();
    var el = document.createElement("div");
    el.id = "elgoToast";
    el.className = "elgo-toast";
    el.setAttribute("role", "status");
    el.textContent = String(msg || "");
    document.body.appendChild(el);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      if (el.parentNode) el.remove();
    }, 3200);
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
    var bookmarksCount = (State.getState().bookmarks || []).length;
    var unresolvedCount = State.getMistakes("", { status: "unresolved" }).length;

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

    if (bottomNav) {
      bottomNav.innerHTML = [
        '<a href="/?flow=hub" class="shell-mobile-link" data-nav="courses">' + svgIcon("courses") + '<span>' + esc(State.t("courses")) + '</span></a>',
        '<a href="/?panel=saved" class="shell-mobile-link" data-nav="saved">' + svgIcon("saved") + '<span>' + esc(State.t("saved")) + (bookmarksCount ? ' (' + bookmarksCount + ')' : '') + '</span></a>',
        '<a href="/?panel=mistakes" class="shell-mobile-link" data-nav="mistakes">' + svgIcon("mistakes") + '<span>' + esc(State.t("mistakes")) + (unresolvedCount ? ' (' + unresolvedCount + ')' : '') + '</span></a>',
        '<button type="button" class="shell-mobile-link" id="mobileMoreBtn">' + svgIcon("more") + '<span>' + esc(State.t("more")) + '</span></button>'
      ].join("\n");

      var mobileMoreBtn = document.getElementById("mobileMoreBtn");
      if (mobileMoreBtn) {
        mobileMoreBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          var menu = document.getElementById("shellMoreMenu");
          var btn = document.getElementById("shellMoreBtn");
          if (menu) {
            var opening = menu.classList.contains("hidden");
            menu.classList.toggle("hidden", !opening);
            menu.classList.toggle("is-mobile-sheet", opening);
            if (btn) btn.setAttribute("aria-expanded", opening ? "true" : "false");
          }
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
        moreMenu.classList.toggle("hidden", !opening);
        moreMenu.classList.remove("is-mobile-sheet");
        moreBtn.setAttribute("aria-expanded", opening ? "true" : "false");
      });
      moreMenu.querySelectorAll("[data-close-more]").forEach(function (item) {
        item.addEventListener("click", function () {
          moreMenu.classList.add("hidden");
          moreMenu.classList.remove("is-mobile-sheet");
          moreBtn.setAttribute("aria-expanded", "false");
        });
      });
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
    startPresenceLoop();
    if (!entryCheckedOnBoot) {
      entryCheckedOnBoot = true;
      setTimeout(ensureEntryGate, 80);
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

    function paintModal(activeTab, errorMsg) {
      var btnLabel = activeTab === "login"
        ? "Sign In"
        : activeTab === "register"
          ? "Create Account"
          : activeTab === "upgrade"
            ? "Keep Progress Across Devices"
            : "Join with Name (No Password)";

      authDialog.innerHTML = [
        '<form class="dialog-body entry-gate-card" id="elgoAuthForm">',
        '  <div class="dialog-head">',
        '    <div class="entry-brand">',
        '      <img src="/assets/mascot/mascot-hello.png" alt="elgo mascot" width="52" height="52">',
        '      <div>',
        '        <h2>' + (isEntryFlow ? esc(State.t("entryHeading")) : "elgo lab. account") + '</h2>',
        '        <small style="color:var(--muted);">' + esc(State.t("entrySubEn")) + '</small>',
        '        <small dir="rtl" lang="ar" style="display:block;color:var(--accent);margin-top:2px;">' + esc(State.t("entrySubAr")) + '</small>',
        '      </div>',
        '    </div>',
        '    <button type="button" class="quiet" id="closeAuthDialogBtn" aria-label="Close">✕</button>',
        '  </div>',
        '  <div class="auth-tabs">',
        '    <button type="button" class="course-tab-btn' + (activeTab === "guest" ? " is-active" : "") + '" data-auth-tab="guest">Name Only (No Password)</button>',
        '    <button type="button" class="course-tab-btn' + (activeTab === "login" ? " is-active" : "") + '" data-auth-tab="login">Sign In</button>',
        '    <button type="button" class="course-tab-btn' + (activeTab === "register" || activeTab === "upgrade" ? " is-active" : "") + '" data-auth-tab="' + (isGuest ? "upgrade" : "register") + '">' + (isGuest ? "Set Password" : "Create Account") + '</button>',
        '  </div>',
           errorMsg ? '<div class="dialog-error" role="alert">' + esc(errorMsg) + '</div>' : '',
        '  <div class="dialog-field">',
        '    <label for="authUsernameInput">Username / Display name</label>',
        '    <input id="authUsernameInput" type="text" required minlength="3" maxlength="24" autocomplete="username" placeholder="e.g. adham_ai" value="' + esc(activeTab === "upgrade" && auth && auth.profile ? auth.profile.username : "") + '">',
        '  </div>',
           activeTab !== "guest"
             ? '<div class="dialog-field"><label for="authPasswordInput">Password</label><input id="authPasswordInput" type="password" required minlength="6" autocomplete="' + (activeTab === "login" ? "current-password" : "new-password") + '" placeholder="At least 6 characters"></div>'
             : '',
        '  <div class="inline" style="justify-content:space-between;">',
        '    <button type="button" class="quiet" id="skipEntryBtn">Browse locally without saving online</button>',
        '    <button type="submit" class="primary" id="authSubmitBtn">' + esc(btnLabel) + '</button>',
        '  </div>',
        '</form>'
      ].join("\n");

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
        var submitBtn = authDialog.querySelector("#authSubmitBtn");
        submitBtn.disabled = true;

        try {
          var endpoint = activeTab === "login"
            ? "/api/auth/login"
            : activeTab === "register"
              ? "/api/auth/register"
              : activeTab === "upgrade"
                ? "/api/auth/upgrade"
                : "/api/auth/guest";

          var payload = activeTab === "guest" ? { username: username } : { username: username, password: password };
          var res = await fetch(endpoint, {
            method: "POST",
            headers: State.authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify(payload),
          });
          var data = await res.json().catch(function () { return null; });
          if (!res.ok || !data || !data.ok || !data.token) {
            paintModal(activeTab, (data && data.error) || "Authentication failed (" + res.status + ").");
            return;
          }

          State.setAuth({ token: data.token, profile: data.profile });
          if (data.progress) State.applyCloudProgress(data.progress);
          authDialog.close();
          renderHeaderAndNav();
          showToast("Welcome, " + data.profile.username + "!");
          if (root.ElgoRouter && typeof root.ElgoRouter.route === "function") {
            root.ElgoRouter.route();
          }
        } catch (_err) {
          paintModal(activeTab, "Could not reach server. Try again when online.");
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
          if (btn && (btn.contains(e.target) || menu.contains(e.target) || (mobileBtn && mobileBtn.contains(e.target)))) {
            return;
          }
          menu.classList.add("hidden");
          menu.classList.remove("is-mobile-sheet");
          if (btn) btn.setAttribute("aria-expanded", "false");
        }
      });

      document.addEventListener("keydown", function (e) {
        if ((e.ctrlKey || e.metaKey) && String(e.key || "").toLowerCase() === "k") {
          e.preventDefault();
          if (root.ElgoQuickSearch) root.ElgoQuickSearch.open();
        } else if (e.key === "Escape") {
          var menu = document.getElementById("shellMoreMenu");
          var btn = document.getElementById("shellMoreBtn");
          if (menu) {
            menu.classList.add("hidden");
            menu.classList.remove("is-mobile-sheet");
          }
          if (btn) btn.setAttribute("aria-expanded", "false");
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
    refreshPresence: refreshPresence,
    openAuthModal: openAuthModal,
    openAboutDialog: openAboutDialog,
    openTeamDialog: openTeamDialog,
    ensureEntryGate: ensureEntryGate,
    showToast: showToast,
  };
})(typeof window !== "undefined" ? window : globalThis);
