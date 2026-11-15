(function (root) {
  "use strict";

  function syncButton(theme) {
    var btn = document.getElementById("lecThemeToggle");
    var label = document.getElementById("lecThemeLabel");
    var sym = btn ? btn.querySelector(".theme-symbol") : null;
    var isEvening = theme === "evening";
    if (label) label.textContent = isEvening ? "Daylight" : "Evening";
    if (sym) sym.textContent = isEvening ? "☀" : "☾";
  }

  async function initOfflineDownloadButton() {
    var exporter = root.ElgoOfflineExport;
    var workspace = document.getElementById("appWorkspace");
    var actions = document.querySelector(".lecture-top-actions");
    if (!exporter || !workspace || !actions) return;

    var subjId = workspace.getAttribute("data-subject-id") || "";
    var lecId = workspace.getAttribute("data-lecture-id") || "";
    if (!subjId || !lecId) return;

    var settings = null;
    try {
      var res = await fetch("/api/site-settings", { cache: "no-store" });
      if (res && res.ok) {
        var data = await res.json().catch(function () { return null; });
        settings = data && data.settings ? data.settings : null;
      }
    } catch (_e) {
      // No backend / offline fallback: keep download hidden unless settings allow
    }

    if (!exporter.isLectureDownloadAllowed(settings, subjId, lecId)) return;

    var existing = document.getElementById("lecDownloadOfflineBtn");
    if (existing) return;

    var dlBtn = document.createElement("button");
    dlBtn.type = "button";
    dlBtn.id = "lecDownloadOfflineBtn";
    dlBtn.className = "lec-btn secondary";
    dlBtn.textContent = "⬇ Save Offline HTML";
    actions.insertBefore(dlBtn, actions.firstChild);

    dlBtn.addEventListener("click", function () {
      var h1 = workspace.querySelector("h1");
      var eyebrow = workspace.querySelector(".lecture-eyebrow");
      var leadEn = workspace.querySelector(".lecture-lead");
      var leadAr = workspace.querySelector(".lecture-lead-ar");
      var article = workspace.querySelector("article.lecture-article");
      var courseRaw = eyebrow ? eyebrow.textContent.replace(/^LECTURE EXPLANATION\s*·\s*/i, "").trim() : subjId;
      var html = exporter.buildOfflineLectureHtml({
        courseTitle: courseRaw || subjId,
        lectureTitle: h1 ? h1.textContent.trim() : lecId,
        guideEn: leadEn ? leadEn.textContent.trim() : "",
        guideAr: leadAr ? leadAr.textContent.trim() : "",
        bodyHtml: article ? article.innerHTML : "",
      });
      exporter.triggerHtmlDownload(subjId + "-" + lecId, html);
    });
  }

  function init() {
    var Theme = root.ElgoTheme;
    if (Theme) {
      syncButton(Theme.getTheme());

      var btn = document.getElementById("lecThemeToggle");
      if (btn) {
        btn.addEventListener("click", function () {
          var next = Theme.toggleTheme();
          syncButton(next);
        });
      }

      if (typeof root.addEventListener === "function") {
        root.addEventListener("elgo:themechange", function (e) {
          if (e && e.detail && e.detail.theme) {
            syncButton(e.detail.theme);
          }
        });
      }
    }

    initOfflineDownloadButton();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(typeof window !== "undefined" ? window : globalThis);
