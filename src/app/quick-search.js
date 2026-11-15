(function (root) {
  "use strict";

  var searchDialog = null;

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function collectItems() {
    var State = root.ElgoState;
    var cat = State.getCatalog() || {};
    var items = [];

    (cat.subjects || []).forEach(function (s) {
      items.push({
        group: "Courses",
        title: State.getSubjectName(s),
        sub: s.nameAr && State.getSubjectName(s) !== s.nameAr ? s.nameAr : (s.counts ? (s.counts.totalQuestions + " Qs") : ""),
        tag: "Course",
        href: "/?flow=hub&subject=" + encodeURIComponent(s.id),
      });
    });

    (cat.lectures || []).forEach(function (lec) {
      items.push({
        group: "Lectures",
        title: lec.title || lec.id,
        sub: lec.subjectId,
        tag: "Learn",
        href: "/learn/" + encodeURIComponent(lec.subjectId) + "/" + encodeURIComponent(lec.id) + "/",
        fullNav: true,
      });
    });

    (cat.sources || []).forEach(function (src) {
      items.push({
        group: "Question Banks",
        title: src.title || src.id,
        sub: (src.questionCount || 0) + " questions · " + src.subjectId,
        tag: src.kind === "sheet" ? "Sheet" : src.kind === "lecture" ? "Lecture Qs" : "Bank",
        href: "/?flow=hub&subject=" + encodeURIComponent(src.subjectId) + "&view=sources",
      });
    });

    State.getPdfs().forEach(function (pdf) {
      items.push({
        group: "PDF Files",
        title: pdf.title || pdf.id,
        sub: pdf.topic || pdf.description || pdf.subjectId,
        tag: "PDF",
        href: pdf.path ? ("/" + String(pdf.path).replace(/^\/+/, "")) : ("/?flow=hub&subject=" + encodeURIComponent(pdf.subjectId) + "&view=resources"),
        external: Boolean(pdf.path),
      });
    });

    State.getVideos().forEach(function (vid) {
      items.push({
        group: "Videos",
        title: vid.title || vid.id,
        sub: vid.description || vid.topic || vid.subjectId,
        tag: "Video",
        href: "/?flow=hub&subject=" + encodeURIComponent(vid.subjectId) + "&view=videos",
      });
    });

    return items;
  }

  async function open() {
    var State = root.ElgoState;
    await State.loadCatalog().catch(function () {});

    if (!searchDialog) {
      searchDialog = document.createElement("dialog");
      searchDialog.className = "quick-search-dialog";
      searchDialog.id = "elgoQuickSearchDialog";
      document.body.appendChild(searchDialog);
      searchDialog.addEventListener("click", function (e) {
        if (e.target === searchDialog) searchDialog.close();
      });
    }

    var allItems = collectItems();

    searchDialog.innerHTML = [
      '<div class="quick-search-head">',
      '  <span aria-hidden="true">🔍</span>',
      '  <input type="search" class="quick-search-input" id="qsInput" placeholder="' + esc(State.t("searchPlaceholder")) + '" autofocus>',
      '  <button type="button" class="quiet" id="qsCloseBtn">Esc</button>',
      '</div>',
      '<div class="quick-search-results" id="qsResults"></div>'
    ].join("\n");

    var input = searchDialog.querySelector("#qsInput");
    var resultsEl = searchDialog.querySelector("#qsResults");
    searchDialog.querySelector("#qsCloseBtn").addEventListener("click", function () { searchDialog.close(); });

    function renderList(query) {
      var q = String(query || "").trim().toLowerCase();
      var matches = !q
        ? allItems.slice(0, 14)
        : allItems.filter(function (it) {
            return (it.title + " " + it.sub + " " + it.tag + " " + it.group).toLowerCase().includes(q);
          }).slice(0, 24);

      var isAr = root.ElgoTheme && typeof root.ElgoTheme.getLang === "function" && root.ElgoTheme.getLang() === "ar";
      if (!matches.length) {
        resultsEl.innerHTML = '<div class="quick-search-empty">' + esc(isAr ? 'مفيش نتائج مطابقة لـ "' : 'No matching courses, lectures, banks, PDFs, or videos found for "') + esc(query) + '".</div>';
        return;
      }

      var grouped = new Map();
      matches.forEach(function (it) {
        if (!grouped.has(it.group)) grouped.set(it.group, []);
        grouped.get(it.group).push(it);
      });

      var html = "";
      grouped.forEach(function (list, grpName) {
        html += '<div><p class="quick-search-group-title">' + esc(grpName) + '</p>';
        list.forEach(function (it, idx) {
          var flatIdx = matches.indexOf(it);
          html += [
            '<button type="button" class="quick-search-item" data-qs-idx="' + flatIdx + '">',
            '  <div><strong>' + esc(it.title) + '</strong><small>' + esc(it.sub) + '</small></div>',
            '  <span class="quick-search-tag">' + esc(it.tag) + '</span>',
            '</button>'
          ].join("");
        });
        html += '</div>';
      });
      resultsEl.innerHTML = html;

      resultsEl.querySelectorAll("[data-qs-idx]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var item = matches[Number(btn.getAttribute("data-qs-idx"))];
          if (!item) return;
          searchDialog.close();
          if (item.external) {
            window.open(item.href, "_blank", "noopener,noreferrer");
          } else if (item.fullNav) {
            window.location.assign(item.href);
          } else if (root.ElgoRouter) {
            root.ElgoRouter.navigate(item.href);
          }
        });
      });
    }

    input.addEventListener("input", function () {
      renderList(input.value);
    });

    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        var first = resultsEl.querySelector("[data-qs-idx]");
        if (first) {
          e.preventDefault();
          first.click();
        }
      }
    });

    renderList("");
    if (!searchDialog.open && typeof searchDialog.showModal === "function") {
      searchDialog.showModal();
    }
    setTimeout(function () { input.focus(); }, 20);
  }

  root.ElgoQuickSearch = { open: open };
})(typeof window !== "undefined" ? window : globalThis);
