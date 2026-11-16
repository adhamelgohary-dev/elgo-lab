/* Unified Application Router & Boot Entry Point */
(function (root) {
  "use strict";

  const loadedAssets = new Set();
  let renderSeq = 0;

  function loadCssOnce(href) {
    if (typeof document === "undefined" || loadedAssets.has(href)) return;
    loadedAssets.add(href);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }

  function loadScriptOnce(src) {
    if (typeof document === "undefined") return Promise.resolve();
    if (loadedAssets.has(src)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = () => { loadedAssets.add(src); resolve(); };
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });
  }

  async function ensureAdminLoaded() {
    loadCssOnce("/src/styles/admin.css");
    if (!root.ElgoAdmin) {
      await loadScriptOnce("/src/app/admin.js");
    }
  }

  function currentUrlParams() {
    return new URLSearchParams(window.location.search);
  }

  async function route() {
    const seq = ++renderSeq;
    const main = document.getElementById("appWorkspace");
    if (!main) return;

    const params = currentUrlParams();
    const challengeToken = params.get("challenge");
    const panel = params.get("panel") || "";
    const flow = params.get("flow") || "";
    const activePlayer = root.ElgoPlayer && root.ElgoPlayer.getActiveSession && root.ElgoPlayer.getActiveSession();

    if (root.ElgoPlayer && typeof root.ElgoPlayer.stopTimer === "function" && flow !== "player" && panel !== "practice" && !challengeToken) {
      root.ElgoPlayer.stopTimer();
    }

    if (root.ElgoShell && typeof root.ElgoShell.syncActiveNav === "function") {
      root.ElgoShell.syncActiveNav();
    }

    if (challengeToken && root.ElgoModel && root.ElgoPlayer) {
      const decoded = root.ElgoModel.decodeChallenge(challengeToken);
      if (decoded && decoded.subjectId) {
        const catalog = await root.ElgoState.loadCatalog();
        if (seq !== renderSeq) return;
        const subject = root.ElgoModel.getSubject(catalog, decoded.subjectId);
        const questions = await root.ElgoState.loadQuestionsForSources(
          decoded.subjectId,
          decoded.sourceIds && decoded.sourceIds.length ? decoded.sourceIds : [decoded.sourceId || "quiz-1"]
        );
        if (seq !== renderSeq) return;
        if (subject && questions.length) {
          const filtered = Array.isArray(decoded.questionIds) && decoded.questionIds.length
            ? questions.filter((q) => decoded.questionIds.includes(q.id) || decoded.questionIds.includes(q.internalId))
            : questions;
          const spec = root.ElgoModel.buildSessionSpec({
            subject,
            questions: filtered.length ? filtered : questions,
            sourceIds: decoded.sourceIds || [decoded.sourceId || "quiz-1"],
            mode: "test",
            title: decoded.title || `${root.ElgoState.getSubjectName(subject)} · Challenge`,
            shuffleQuestions: false,
            challenge: decoded,
          });
          await root.ElgoPlayer.launchSpec(spec);
          return;
        }
      }
    }

    if ((flow === "player" || panel === "practice") && root.ElgoPlayer) {
      await root.ElgoPlayer.render(main, params);
      return;
    }

    if (panel === "admin") {
      await ensureAdminLoaded();
      if (seq !== renderSeq) return;
      if (root.ElgoAdmin) await root.ElgoAdmin.render(main, params);
      return;
    }

    if (panel && ["saved", "mistakes", "leaderboard", "settings"].includes(panel) && root.ElgoPanels) {
      await root.ElgoPanels.render(main, panel, params);
      return;
    }

    if (flow === "practice" && !params.get("course") && !params.get("subject")) {
      window.history.replaceState({}, "", "/?flow=hub");
    }

    if (root.ElgoHub) {
      await root.ElgoHub.render(main, params);
    }
  }

  function navigate(nextUrl, replace) {
    const target = nextUrl.startsWith("/") ? nextUrl : `/${nextUrl}`;
    const cur = `${window.location.pathname}${window.location.search}`;
    if (target !== cur) {
      if (replace) window.history.replaceState({}, "", target);
      else window.history.pushState({}, "", target);
    }
    route();
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function handleDocumentClick(e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
    const rawHref = link.getAttribute("href") || "";
    if (!rawHref.startsWith("/?") && !link.hasAttribute("data-nav") && !link.hasAttribute("data-route-link")) return;
    if (rawHref.startsWith("/learn/") || rawHref.startsWith("/content/") || rawHref.startsWith("/api/")) return;
    e.preventDefault();
    navigate(rawHref);
  }

  function registerServiceWorker() {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
      return;
    }
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((reg) => {
        if (reg && typeof reg.update === "function") {
          reg.update().catch(() => {});
        }
      })
      .catch(() => { /* offline SW registration optional */ });
  }

  function boot() {
    if (root.ElgoShell && typeof root.ElgoShell.init === "function") {
      root.ElgoShell.init();
    }
    document.addEventListener("click", handleDocumentClick);
    window.addEventListener("popstate", () => route());
    document.addEventListener("elgo:rerender", () => route());

    route();

    if (root.ElgoState) {
      root.ElgoState.loadPublicOverrides()
        .then((ov) => {
          if (root.ElgoShell && typeof root.ElgoShell.renderSiteBanner === "function") {
            root.ElgoShell.renderSiteBanner();
          }
          if (!ov) return;
          const curParams = new URLSearchParams(window.location.search);
          if (curParams.get("flow") !== "player" && curParams.get("panel") !== "admin") route();
        })
        .catch(() => null);
      root.ElgoState.refreshSession()
        .then((auth) => {
          if (root.ElgoShell && typeof root.ElgoShell.renderHeaderAndNav === "function") {
            root.ElgoShell.renderHeaderAndNav();
          }
          if (auth) {
            root.ElgoState.syncPendingAttempts().catch(() => null);
          }
          const curPanel = new URLSearchParams(window.location.search).get("panel");
          if (curPanel === "settings" || curPanel === "leaderboard" || curPanel === "saved" || curPanel === "mistakes") {
            route();
          }
        })
        .catch(() => null);
    }
    const syncOnResume = (throttleMs) => {
      if (!root.ElgoState || !root.ElgoState.getAuth()) return;
      const st = typeof root.ElgoState.getState === "function" ? root.ElgoState.getState() : null;
      if (st && st.pendingProgressSync && typeof root.ElgoState.syncProgressToCloud === "function") {
        root.ElgoState.syncProgressToCloud().catch(() => null);
      }
      if (typeof root.ElgoState.pullCloudProgress === "function") {
        root.ElgoState.pullCloudProgress({ throttleMs: throttleMs }).then((changed) => {
          if (!changed) return;
          if (root.ElgoShell && typeof root.ElgoShell.renderHeaderAndNav === "function") {
            root.ElgoShell.renderHeaderAndNav();
          }
          const curPanel = new URLSearchParams(window.location.search).get("panel");
          if (curPanel === "settings") route();
        }).catch(() => null);
      }
    };
    document.addEventListener("elgo:progresschange", () => {
      if (root.ElgoShell && typeof root.ElgoShell.renderHeaderAndNav === "function") {
        root.ElgoShell.renderHeaderAndNav();
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      syncOnResume(3000);
    });
    window.addEventListener("focus", () => {
      syncOnResume(4000);
    });
    window.addEventListener("online", () => {
      if (root.ElgoState && root.ElgoState.getAuth()) {
        root.ElgoState.syncPendingAttempts().catch(() => null);
        if (typeof root.ElgoState.syncProgressToCloud === "function") {
          root.ElgoState.syncProgressToCloud({ force: true }).catch(() => null);
        }
      }
    });
    window.addEventListener("pagehide", () => {
      if (root.ElgoState && root.ElgoState.getAuth() && root.ElgoState.getState().pendingProgressSync) {
        if (typeof root.ElgoState.syncProgressToCloud === "function") {
          root.ElgoState.syncProgressToCloud({ force: true, fromPageHide: true }).catch(() => null);
        }
      }
    });
    registerServiceWorker();
  }

  root.ElgoRouter = {
    navigate,
    route,
    boot,
  };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
      boot();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
