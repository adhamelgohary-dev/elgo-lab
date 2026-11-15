(function (root) {
  "use strict";

  var THEME_KEY = "elgo_theme";
  var LANG_KEY = "elgo_lang";
  var MOTION_KEY = "elgo_motion";

  var LEGACY_THEME_KEY = "elgo_phase2_theme";
  var LEGACY_LANG_KEY = "elgo_ui_language_v1";
  var LEGACY_MOTION_KEY = "elgo_decoration_motion_v1";

  function getStorage() {
    try {
      if (typeof localStorage !== "undefined" && localStorage) return localStorage;
    } catch (_err) {
      // Ignore access errors
    }
    return root && root.localStorage ? root.localStorage : null;
  }

  function readStorage(key) {
    try {
      var st = getStorage();
      return st ? st.getItem(key) : null;
    } catch (_err) {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      var st = getStorage();
      if (st) {
        st.setItem(key, value);
      }
    } catch (_err) {
      // Ignore storage quota or private browsing errors
    }
  }

  function resolveTheme(override) {
    if (override === "evening" || override === "night" || override === "dark") return "evening";
    if (override === "daylight" || override === "day" || override === "light") return "daylight";
    var query = "";
    try {
      query = typeof location !== "undefined" ? new URLSearchParams(location.search).get("theme") || "" : "";
    } catch (_err) {
      query = "";
    }
    if (query === "evening" || query === "night" || query === "dark") return "evening";
    if (query === "daylight" || query === "day" || query === "light") return "daylight";
    var stored = readStorage(THEME_KEY) || readStorage(LEGACY_THEME_KEY);
    return stored === "daylight" || stored === "day" ? "daylight" : "evening";
  }

  function resolveLang(override) {
    if (override === "ar" || override === "en") return override;
    var query = "";
    try {
      query = typeof location !== "undefined" ? new URLSearchParams(location.search).get("lang") || "" : "";
    } catch (_err) {
      query = "";
    }
    if (query === "ar" || query === "en") return query;
    var stored = readStorage(LANG_KEY) || readStorage(LEGACY_LANG_KEY);
    return stored === "ar" ? "ar" : "en";
  }

  function resolveMotionPaused(override) {
    if (typeof override === "boolean") return override;
    var stored = readStorage(MOTION_KEY) || readStorage(LEGACY_MOTION_KEY);
    return stored === "paused" || stored === "1" || stored === "true";
  }

  function syncThemeColorMeta(theme) {
    if (typeof document === "undefined" || typeof document.querySelector !== "function") return;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta && typeof meta.setAttribute === "function") {
      meta.setAttribute("content", theme === "evening" ? "#191A1C" : "#DFDED8");
    }
  }

  function applyAll(opts) {
    if (typeof document === "undefined" || !document.documentElement) return;
    var docEl = document.documentElement;
    var theme = resolveTheme(opts && opts.theme);
    var lang = resolveLang(opts && opts.lang);
    var motionPaused = resolveMotionPaused(opts && opts.motionPaused);

    docEl.dataset.theme = theme;
    docEl.lang = lang;
    docEl.dir = lang === "ar" ? "rtl" : "ltr";
    docEl.dataset.decorMotion = motionPaused ? "paused" : "active";
    syncThemeColorMeta(theme);
  }

  function dispatch(name, detail) {
    try {
      if (typeof root.dispatchEvent === "function" && typeof root.CustomEvent === "function") {
        root.dispatchEvent(new root.CustomEvent(name, { detail: detail }));
      }
    } catch (_err) {
      // Ignore event errors in non-DOM test contexts
    }
  }

  function getTheme() {
    if (typeof document !== "undefined" && document.documentElement && document.documentElement.dataset.theme) {
      return document.documentElement.dataset.theme === "daylight" ? "daylight" : "evening";
    }
    return resolveTheme();
  }

  function setTheme(next) {
    var val = next === "daylight" || next === "day" ? "daylight" : "evening";
    writeStorage(THEME_KEY, val);
    applyAll({ theme: val });
    dispatch("elgo:themechange", { theme: val });
    return val;
  }

  function toggleTheme() {
    return setTheme(getTheme() === "evening" ? "daylight" : "evening");
  }

  function getLang() {
    if (typeof document !== "undefined" && document.documentElement && document.documentElement.lang) {
      return document.documentElement.lang === "ar" ? "ar" : "en";
    }
    return resolveLang();
  }

  function setLang(next) {
    var val = next === "ar" ? "ar" : "en";
    writeStorage(LANG_KEY, val);
    applyAll({ lang: val });
    dispatch("elgo:langchange", { lang: val });
    return val;
  }

  function toggleLang() {
    return setLang(getLang() === "ar" ? "en" : "ar");
  }

  function isMotionPaused() {
    if (typeof document !== "undefined" && document.documentElement && document.documentElement.dataset.decorMotion) {
      return document.documentElement.dataset.decorMotion === "paused";
    }
    return resolveMotionPaused();
  }

  function setMotionPaused(paused) {
    var val = Boolean(paused);
    writeStorage(MOTION_KEY, val ? "paused" : "active");
    applyAll({ motionPaused: val });
    dispatch("elgo:motionchange", { paused: val });
    return val;
  }

  applyAll();

  root.ElgoTheme = {
    THEME_KEY: THEME_KEY,
    LANG_KEY: LANG_KEY,
    MOTION_KEY: MOTION_KEY,
    getTheme: getTheme,
    setTheme: setTheme,
    toggleTheme: toggleTheme,
    getLang: getLang,
    setLang: setLang,
    toggleLang: toggleLang,
    isMotionPaused: isMotionPaused,
    setMotionPaused: setMotionPaused,
  };
})(typeof window !== "undefined" ? window : globalThis);
