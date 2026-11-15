(function (root) {
  "use strict";

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isAr() {
    return root.ElgoTheme && typeof root.ElgoTheme.getLang === "function" && root.ElgoTheme.getLang() === "ar";
  }

  function txt(en, ar) {
    return isAr() ? ar : en;
  }

  function showToast(msg) {
    if (root.ElgoShell && typeof root.ElgoShell.showToast === "function") {
      root.ElgoShell.showToast(msg);
    }
  }

  function navigateTo(url) {
    if (root.ElgoRouter && typeof root.ElgoRouter.navigate === "function") {
      root.ElgoRouter.navigate(url);
    } else {
      window.location.assign(url);
    }
  }

  async function hydrateQuestionsFromSubjects(items, catalog) {
    var state = root.ElgoState;
    var bySubject = new Map();
    var itemOrder = [];
    items.forEach(function (it) {
      if (!it || !it.subjectId) return;
      var key = it.internalId || it.id;
      if (!bySubject.has(it.subjectId)) bySubject.set(it.subjectId, new Set());
      bySubject.get(it.subjectId).add(key);
      itemOrder.push(key);
    });

    var byKey = new Map();
    for (var entry of bySubject.entries()) {
      var sid = entry[0];
      var idSet = entry[1];
      var allQs = await state.loadQuestionsForSources(sid, []);
      allQs.forEach(function (q) {
        var qKey = q.internalId || q.id;
        if (idSet.has(q.internalId) || idSet.has(q.id)) {
          byKey.set(qKey, Object.assign({}, q, { subjectId: q.subjectId || sid }));
        }
      });
    }

    var collected = [];
    var seen = new Set();
    itemOrder.forEach(function (k) {
      var matched = byKey.get(k);
      if (matched && !seen.has(matched.internalId || matched.id)) {
        seen.add(matched.internalId || matched.id);
        collected.push(matched);
      }
    });

    var firstSubjectId = items[0] && items[0].subjectId ? items[0].subjectId : "";
    var subjObj = (catalog.subjects || []).find(function (s) { return s.id === firstSubjectId; }) || {
      id: firstSubjectId || "review",
      name: "Review Deck",
    };

    return { subject: subjObj, questions: collected };
  }

  function renderPanelQuestionImages(item) {
    var Model = root.ElgoModel;
    var imgs = (Model && typeof Model.getQuestionImages === "function")
      ? Model.getQuestionImages(item)
      : (item && item.image ? [{ url: String(item.image) }] : []);
    if (!imgs.length) return "";
    return '<div class="question-images-grid is-compact">' + imgs.map(function (img, idx) {
      return [
        '<figure class="question-image-wrap">',
        '  <a href="' + esc(img.url) + '" target="_blank" rel="noopener noreferrer" title="' + esc(img.alt || ("Image " + (idx + 1))) + '">',
        '    <img src="' + esc(img.url) + '" alt="' + esc(img.alt || "Question diagram") + '" loading="lazy">',
        '  </a>',
        img.caption ? ('<figcaption class="question-image-caption">' + esc(img.caption) + '</figcaption>') : '',
        '</figure>'
      ].join("\n");
    }).join("\n") + '</div>';
  }

  /* ---------------------------------------------------------------------- */
  /* SAVED BOOKMARKS PANEL                                                  */
  /* ---------------------------------------------------------------------- */
  async function renderSavedPanel(container) {
    var state = root.ElgoState;
    var catalog = await state.loadCatalog();
    var bookmarks = state.getState().bookmarks || [];
    var filterCourse = "all";
    var savedMode = "practice";
    var savedShuffle = false;
    var selectedIds = new Set();

    function paint() {
      var visible = filterCourse === "all"
        ? bookmarks
        : bookmarks.filter(function (b) { return b.subjectId === filterCourse; });

      var countByCourse = {};
      bookmarks.forEach(function (b) {
        if (!b || !b.subjectId) return;
        countByCourse[b.subjectId] = (countByCourse[b.subjectId] || 0) + 1;
      });

      var activeKeys = new Set();
      bookmarks.forEach(function (b) { activeKeys.add(b.internalId || b.id); });
      Array.from(selectedIds).forEach(function (id) {
        if (!activeKeys.has(id)) selectedIds.delete(id);
      });

      var visibleSelected = visible.filter(function (b) { return selectedIds.has(b.internalId || b.id); });

      var courseOptions = (catalog.subjects || [])
        .map(function (s) {
          var cnt = countByCourse[s.id] || 0;
          return '<option value="' + esc(s.id) + '"' + (filterCourse === s.id ? " selected" : "") + '>' + esc(state.getSubjectName(s)) + (cnt ? (" (" + cnt + ")") : "") + '</option>';
        })
        .join("");

      var coursePillsHtml = (catalog.subjects || []).filter(function (s) { return (countByCourse[s.id] || 0) > 0; }).map(function (s) {
        return '<button type="button" class="filter-pill' + (filterCourse === s.id ? " is-active" : "") + '" data-saved-course-pill="' + esc(s.id) + '">' + esc(state.getSubjectName(s)) + ' (' + countByCourse[s.id] + ')</button>';
      }).join("");

      var currentCourseObj = (catalog.subjects || []).find(function (s) { return s.id === filterCourse; });
      var viewLabel = currentCourseObj ? state.getSubjectName(currentCourseObj) : txt("All Saved", "كل المحفوظين");

      container.innerHTML = [
        '<section class="hub-panel">',
        '  <div class="breadcrumbs">',
        '    <button type="button" id="savedBackHub">' + esc(state.t("backCourses")) + '</button>',
        '    <span>/</span>',
        '    <span>' + esc(state.t("saved")) + '</span>',
        '  </div>',
        '  <div class="dialog-head" style="flex-wrap:wrap;gap:12px;">',
        '    <div>',
        '      <h1 style="margin:0;font-size:1.35rem;">★ ' + esc(state.t("saved")) + ' (' + bookmarks.length + ')</h1>',
        '      <p class="question-meta" style="margin:4px 0 0;">' + esc(txt("Retake all saved questions in any course or pick specific ones freely — they stay saved until you remove them.", "عيد كل الأسئلة المحفوظة للمادة أو اختار شوية منهم براحتك — يفضلوا محفوظين لحد ما تشيلهم بنفسك.")) + '</p>',
        '    </div>',
        '    <div class="inline" style="flex-wrap:wrap;">',
               visible.length ? '<button type="button" class="primary" id="practiceSavedBtn">' + esc(txt("▶ Retake All (" + visible.length + ")", "▶ إعادة الكل (" + visible.length + ")")) + '</button>' : '',
               visible.length ? '<button type="button" class="secondary" id="practiceSelectedSavedBtn"' + (visibleSelected.length === 0 ? " disabled" : "") + '>' + esc(txt("▶ Retake Selected (" + visibleSelected.length + ")", "▶ إعادة المختارين (" + visibleSelected.length + ")")) + '</button>' : '',
        '    </div>',
        '  </div>',
        '  <div class="panel-tools" style="flex-wrap:wrap;gap:10px;align-items:center;">',
        '    <div class="inline" style="flex-wrap:wrap;">',
        '      <label for="savedCourseFilter" style="font-size:0.85rem;color:var(--muted);">' + esc(txt("Course:", "المادة:")) + '</label>',
        '      <select id="savedCourseFilter"><option value="all">' + esc(state.t("allCourses")) + ' (' + bookmarks.length + ')</option>' + courseOptions + '</select>',
        '      <select id="savedModeSelect" aria-label="Retake Mode" style="padding:7px 10px;border-radius:9px;border:1px solid var(--line);background:var(--tile);color:var(--ink);">',
        '        <option value="practice"' + (savedMode === "practice" ? " selected" : "") + '>' + esc(txt("Practice Mode (Immediate Check)", "تدريب (صح/غلط فوراً)")) + '</option>',
        '        <option value="study"' + (savedMode === "study" ? " selected" : "") + '>' + esc(txt("Study Mode (Answers & Notes)", "مذاكرة (الإجابات والشرح)")) + '</option>',
        '        <option value="test"' + (savedMode === "test" ? " selected" : "") + '>' + esc(txt("Self-Exam Mode (Score at End)", "اختبار تجريبي (النتيجة في الآخر)")) + '</option>',
        '      </select>',
        '      <label style="display:inline-flex;align-items:center;gap:6px;font-size:0.85rem;cursor:pointer;">',
        '        <input type="checkbox" id="savedShuffleCheck"' + (savedShuffle ? " checked" : "") + '>',
        '        <span>' + esc(txt("Shuffle order", "ترتيب عشوائي")) + '</span>',
        '      </label>',
        '    </div>',
             visible.length ? [
               '<div class="inline">',
               '  <button type="button" class="quiet" id="savedSelectAllBtn">' + esc(txt("Select All (" + visible.length + ")", "تحديد الكل (" + visible.length + ")")) + '</button>',
               '  <button type="button" class="quiet" id="savedClearSelBtn"' + (visibleSelected.length === 0 ? " disabled" : "") + '>' + esc(txt("Clear Selection", "إلغاء التحديد")) + '</button>',
               '</div>'
             ].join("") : '',
        '  </div>',
           bookmarks.length ? [
             '<div class="filter-bar" aria-label="Saved Courses">',
             '  <button type="button" class="filter-pill' + (filterCourse === "all" ? " is-active" : "") + '" data-saved-course-pill="all">' + esc(txt("All Courses", "كل المواد")) + ' (' + bookmarks.length + ')</button>',
                coursePillsHtml,
             '</div>'
           ].join("\n") : '',
           visible.length === 0 ? [
             '<div class="empty-state">',
             '  <p><strong>' + esc(txt("No saved questions here yet.", "مفيش أسئلة محفوظة هنا لسه.")) + '</strong></p>',
             '  <p>' + esc(txt("Click Save ★ inside any Study or Practice question to keep it in this list.", "اضغط حفظ ★ جوا أي سؤال في وضع المذاكرة أو التدريب علشان يظهر هنا.")) + '</p>',
             '  <a href="/?flow=hub" class="primary" data-nav="courses" style="margin-top:8px;">' + esc(txt("Explore Courses", "تصفح المواد")) + '</a>',
             '</div>'
           ].join("\n") : [
             '<div class="panel-list">',
             visible.map(function (b, idx) {
               var key = b.internalId || b.id;
               var checked = selectedIds.has(key);
               return [
                 '<article class="panel-item hub-review" data-bookmark-idx="' + idx + '">',
                 '  <div class="dialog-head">',
                 '    <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:0.84rem;">',
                 '      <input type="checkbox" class="saved-select-cb" data-select-saved-id="' + esc(key) + '"' + (checked ? " checked" : "") + '>',
                 '      <span class="question-meta">' + esc(b.subjectName || b.subjectId) + ' · ' + esc(b.sourceLabel || b.quizId || "") + '</span>',
                 '    </label>',
                 '    <button type="button" class="quiet" data-remove-id="' + esc(key) + '">' + esc(txt("Remove ★", "إزالة من المحفوظات")) + '</button>',
                 '  </div>',
                 '  <strong style="font-size:0.98rem;">' + esc(b.question || b.id) + '</strong>',
                    renderPanelQuestionImages(b),
                    b.correctAnswer ? ('<div style="font-size:0.84rem;color:var(--accent-text);">' + esc(txt("Verified Answer:", "الإجابة المعتمدة:")) + ' <strong>' + esc(b.correctAnswer) + '</strong></div>') : '',
                 '</article>'
               ].join("\n");
             }).join("\n"),
             '</div>'
           ].join("\n"),
        '</section>'
      ].join("\n");

      container.querySelector("#savedBackHub").addEventListener("click", function () { navigateTo("/?flow=hub"); });
      container.querySelector("#savedCourseFilter").addEventListener("change", function (e) {
        filterCourse = e.target.value;
        paint();
      });
      container.querySelectorAll("[data-saved-course-pill]").forEach(function (pill) {
        pill.addEventListener("click", function () {
          filterCourse = pill.getAttribute("data-saved-course-pill") || "all";
          paint();
        });
      });

      var modeSel = container.querySelector("#savedModeSelect");
      if (modeSel) {
        modeSel.addEventListener("change", function (e) {
          savedMode = e.target.value;
        });
      }
      var shuffleCb = container.querySelector("#savedShuffleCheck");
      if (shuffleCb) {
        shuffleCb.addEventListener("change", function (e) {
          savedShuffle = e.target.checked;
        });
      }

      var selectAllBtn = container.querySelector("#savedSelectAllBtn");
      if (selectAllBtn) {
        selectAllBtn.addEventListener("click", function () {
          visible.forEach(function (b) { selectedIds.add(b.internalId || b.id); });
          paint();
        });
      }
      var clearSelBtn = container.querySelector("#savedClearSelBtn");
      if (clearSelBtn) {
        clearSelBtn.addEventListener("click", function () {
          visible.forEach(function (b) { selectedIds.delete(b.internalId || b.id); });
          paint();
        });
      }
      container.querySelectorAll("[data-select-saved-id]").forEach(function (cb) {
        cb.addEventListener("change", function () {
          var id = cb.getAttribute("data-select-saved-id");
          if (cb.checked) selectedIds.add(id);
          else selectedIds.delete(id);
          paint();
        });
      });

      async function launchSavedDeck(targetItems, triggerBtn) {
        if (!targetItems.length) return;
        if (triggerBtn) triggerBtn.disabled = true;
        try {
          var hydrated = await hydrateQuestionsFromSubjects(targetItems, catalog);
          if (!hydrated.questions.length) {
            showToast(txt("Could not load saved questions from course files.", "تعذر تحميل الأسئلة المحفوظة من ملفات المادة."));
            return;
          }
          var spec = root.ElgoModel.buildSessionSpec({
            subject: hydrated.subject,
            questions: hydrated.questions,
            sourceId: "saved",
            mode: savedMode,
            isGradableCollection: false,
            title: viewLabel + " — Saved (" + hydrated.questions.length + ")",
            shuffleQuestions: savedShuffle,
          });
          root.ElgoPlayer.launchSpec(spec);
        } finally {
          if (triggerBtn) triggerBtn.disabled = false;
        }
      }

      var practiceBtn = container.querySelector("#practiceSavedBtn");
      if (practiceBtn) {
        practiceBtn.addEventListener("click", function () {
          launchSavedDeck(visible, practiceBtn);
        });
      }
      var practiceSelectedBtn = container.querySelector("#practiceSelectedSavedBtn");
      if (practiceSelectedBtn) {
        practiceSelectedBtn.addEventListener("click", function () {
          if (!visibleSelected.length) {
            showToast(txt("Select at least 1 saved question first.", "اختار سؤال واحد على الأقل الأول."));
            return;
          }
          launchSavedDeck(visibleSelected, practiceSelectedBtn);
        });
      }

      container.querySelectorAll("[data-remove-id]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.getAttribute("data-remove-id");
          selectedIds.delete(id);
          state.toggleBookmark({ internalId: id, id: id }, {});
          bookmarks = state.getState().bookmarks || [];
          if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
          paint();
        });
      });
    }

    paint();
  }

  /* ---------------------------------------------------------------------- */
  /* MISTAKES NOTEBOOK PANEL (Smart Review Deck + Resolve / Reopen)         */
  /* ---------------------------------------------------------------------- */
  async function renderMistakesPanel(container) {
    var state = root.ElgoState;
    var catalog = await state.loadCatalog();
    var filterCourse = "all";
    var statusFilter = state.getMistakes("", { status: "unresolved" }).length > 0 ? "unresolved" : "all";

    function paint() {
      var sid = filterCourse === "all" ? "" : filterCourse;
      var unresolvedList = state.getMistakes(sid, { status: "unresolved" });
      var resolvedList = state.getMistakes(sid, { status: "resolved" });
      var mistakes = state.getMistakes(sid, { status: statusFilter });
      var allCount = state.getMistakes("", { status: "all" }).length;

      var courseOptions = (catalog.subjects || [])
        .map(function (s) { return '<option value="' + esc(s.id) + '"' + (filterCourse === s.id ? " selected" : "") + '>' + esc(state.getSubjectName(s)) + '</option>'; })
        .join("");

      container.innerHTML = [
        '<section class="hub-panel">',
        '  <div class="breadcrumbs">',
        '    <button type="button" id="mistakesBackHub">' + esc(state.t("backCourses")) + '</button>',
        '    <span>/</span>',
        '    <span>' + esc(state.t("mistakes")) + '</span>',
        '  </div>',
        '  <div class="dialog-head">',
        '    <div>',
        '      <h1 style="margin:0;font-size:1.35rem;">↺ ' + esc(state.t("mistakes")) + ' (' + mistakes.length + ')</h1>',
        '      <p class="question-meta" style="margin:4px 0 0;">' + esc(state.t("smartReviewDesc")) + '</p>',
        '    </div>',
        '    <div class="inline">',
               unresolvedList.length ? '<button type="button" class="primary" id="practiceMistakesBtn">' + esc(txt("Smart Review Deck", "مجموعة المراجعة الذكية")) + ' (' + Math.min(unresolvedList.length, 25) + ') →</button>' : '',
               allCount ? '<button type="button" class="secondary" id="clearMistakesBtn">' + esc(state.t("clearAll")) + '</button>' : '',
        '    </div>',
        '  </div>',
        '  <div class="panel-tools">',
        '    <div class="filter-bar">',
        '      <button type="button" class="filter-pill' + (statusFilter === "unresolved" ? " is-active" : "") + '" data-m-status="unresolved">' + esc(state.t("unresolvedLabel")) + ' (' + unresolvedList.length + ')</button>',
        '      <button type="button" class="filter-pill' + (statusFilter === "resolved" ? " is-active" : "") + '" data-m-status="resolved">' + esc(state.t("resolvedLabel")) + ' (' + resolvedList.length + ')</button>',
        '      <button type="button" class="filter-pill' + (statusFilter === "all" ? " is-active" : "") + '" data-m-status="all">' + esc(state.t("allLabel")) + ' (' + (unresolvedList.length + resolvedList.length) + ')</button>',
        '    </div>',
        '    <select id="mistakesCourseFilter"><option value="all">' + esc(state.t("allCourses")) + '</option>' + courseOptions + '</select>',
        '  </div>',
           mistakes.length === 0 ? [
             '<div class="empty-state">',
             '  <p><strong>' + esc(txt("No mistakes in this view.", "مفيش أخطاء مسجلة في العرض ده.")) + '</strong></p>',
             '  <p>' + esc(txt("Missed answers from Practice or Ranked Tests will appear here for spaced repetition.", "الأسئلة اللي بتغلط فيها في التدريب أو الاختبار بتتحفظ هنا للمراجعة الذكية.")) + '</p>',
             '  <a href="/?flow=hub" class="primary" data-nav="courses" style="margin-top:8px;">' + esc(txt("Start Practicing", "ابدأ التدريب")) + '</a>',
             '</div>'
           ].join("\n") : [
             '<div class="panel-list">',
             mistakes.map(function (m, idx) {
               var id = m.internalId || m.id;
               return [
                 '<article class="panel-item hub-review">',
                 '  <div class="dialog-head">',
                 '    <span class="question-meta">' + esc(m.subjectName || m.subjectId) + ' · ' + esc(txt("Missed", "أخطأت")) + ' ' + Number(m.missCount || 1) + '×' + (m.resolved ? (" · ✓ " + esc(state.t("resolvedLabel"))) : "") + '</span>',
                 '    <div class="inline">',
                 m.resolved
                   ? '<button type="button" class="quiet" data-reopen-id="' + esc(id) + '">' + esc(state.t("reopenLabel")) + '</button>'
                   : '<button type="button" class="quiet" data-resolve-id="' + esc(id) + '">' + esc(state.t("resolveLabel")) + '</button>',
                 '      <button type="button" class="quiet" data-clear-id="' + esc(id) + '">' + esc(state.t("deleteLabel")) + '</button>',
                 '    </div>',
                 '  </div>',
                 '  <strong>' + esc(m.question || m.id) + '</strong>',
                    renderPanelQuestionImages(m),
                 '  <div style="font-size:0.84rem;color:var(--muted);">',
                 m.lastWrongOptionId ? (esc(txt("Your choice:", "إجابتك:")) + ' <strong>' + esc(m.lastWrongOptionId) + '</strong> · ') : '',
                 m.correctOptionId ? (esc(txt("Correct:", "الصحيح:")) + ' <strong style="color:var(--accent-text);">' + esc(m.correctOptionId) + '</strong>') : '',
                 '  </div>',
                 '  <details data-exp-subject="' + esc(m.subjectId) + '" data-exp-id="' + esc(id) + '" data-exp-idx="' + idx + '">',
                 '    <summary style="font-size:0.86rem;color:var(--accent-text);font-weight:700;">' + esc(txt("Explanation & notes", "الشرح والملاحظات")) + '</summary>',
                 '    <div class="mistake-exp-body" style="margin-top:8px;font-size:0.88rem;color:var(--muted);">' + esc(txt("Loading explanation...", "جاري تحميل الشرح...")) + '</div>',
                 '  </details>',
                 '</article>'
               ].join("\n");
             }).join("\n"),
             '</div>'
           ].join("\n"),
        '</section>'
      ].join("\n");

      container.querySelector("#mistakesBackHub").addEventListener("click", function () { navigateTo("/?flow=hub"); });
      container.querySelector("#mistakesCourseFilter").addEventListener("change", function (e) {
        filterCourse = e.target.value;
        paint();
      });

      container.querySelectorAll("[data-m-status]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          statusFilter = btn.getAttribute("data-m-status");
          paint();
        });
      });

      var clearAll = container.querySelector("#clearMistakesBtn");
      if (clearAll) {
        clearAll.addEventListener("click", function () {
          state.clearAllMistakes();
          if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
          showToast("Mistakes notebook cleared.");
          paint();
        });
      }

      var drillBtn = container.querySelector("#practiceMistakesBtn");
      if (drillBtn) {
        drillBtn.addEventListener("click", async function () {
          drillBtn.disabled = true;
          try {
            var deckItems = typeof state.getSmartReviewDeck === "function"
              ? state.getSmartReviewDeck(sid, { limit: 25 })
              : unresolvedList;
            var hydrated = await hydrateQuestionsFromSubjects(deckItems, catalog);
            if (!hydrated.questions.length) {
              showToast(txt("Could not load matching questions from course data.", "تعذر تحميل الأسئلة المطابقة من ملفات المادة."));
              return;
            }
            var spec = root.ElgoModel.buildSessionSpec({
              subject: hydrated.subject,
              questions: hydrated.questions,
              sourceId: "mistakes",
              mode: "practice",
              title: txt("Smart Review Deck", "مجموعة المراجعة الذكية") + " (" + hydrated.questions.length + ")",
              shuffleQuestions: false,
            });
            root.ElgoPlayer.launchSpec(spec);
          } finally {
            drillBtn.disabled = false;
          }
        });
      }

      container.querySelectorAll("[data-resolve-id]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          state.resolveMistake(btn.getAttribute("data-resolve-id"));
          if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
          paint();
        });
      });

      container.querySelectorAll("[data-reopen-id]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          state.reopenMistake(btn.getAttribute("data-reopen-id"));
          if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
          paint();
        });
      });

      container.querySelectorAll("[data-clear-id]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          state.clearMistake(btn.getAttribute("data-clear-id"));
          if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
          paint();
        });
      });

      container.querySelectorAll("details[data-exp-id]").forEach(function (det) {
        det.addEventListener("toggle", async function () {
          if (!det.open) return;
          var body = det.querySelector(".mistake-exp-body");
          var subjId = det.getAttribute("data-exp-subject");
          var expId = det.getAttribute("data-exp-id");
          var map = await state.loadSubjectExplanations(subjId);
          var exp = map[expId] || {};
          var en = exp.academicExplanation || exp.correctReasoning || "";
          var ar = exp.arabicExplanation || exp.arabicTranslation || "";
          var rule = exp.rule || "";
          if (!en && !ar && !rule) {
            body.textContent = "No detailed note attached for this item yet.";
          } else {
            body.innerHTML = [
              en ? '<p style="margin:0 0 6px;color:var(--ink);">' + esc(en) + '</p>' : '',
              rule ? '<p style="margin:0 0 6px;"><strong>Rule:</strong> ' + esc(rule) + '</p>' : '',
              ar ? '<p dir="rtl" lang="ar" style="margin:0;color:var(--ink);text-align:right;">' + esc(ar) + '</p>' : ''
            ].join("");
          }
        });
      });
    }

    paint();
  }

  /* ---------------------------------------------------------------------- */
  /* LIVE LEADERBOARD PANEL                                                 */
  /* ---------------------------------------------------------------------- */
  async function renderLeaderboardPanel(container, params) {
    var state = root.ElgoState;
    var catalog = await state.loadCatalog();
    var selectedSubject = (params && params.get("subject")) || "all";

    async function loadAndPaint() {
      container.innerHTML = '<section class="hub-panel"><p class="question-meta">' + esc(state.t("loadingRankings")) + '</p></section>';

      var entries = [];
      var onlineMode = false;
      var errMessage = "";

      if (state.getAuth()) {
        await state.syncPendingAttempts().catch(function () {});
      }

      try {
        var qs = new URLSearchParams({ limit: "200", includeAll: "1" });
        if (selectedSubject && selectedSubject !== "all") {
          qs.set("subjectId", selectedSubject);
        }
        var res = await fetch("/api/leaderboard?" + qs.toString(), {
          headers: state.authHeaders(),
          cache: "no-store",
        });
        var data = await res.json().catch(function () { return null; });
        if (res.ok && data && data.ok && Array.isArray(data.entries)) {
          entries = data.entries;
          onlineMode = true;
        } else {
          errMessage = (data && data.error) || "";
        }
      } catch (_err) {
        errMessage = txt("Server unreachable — showing local rankings.", "تعذر الاتصال بالسيرفر — يتم عرض الترتيب المحلي.");
      }

      if (!onlineMode) {
        var client = state.getOnlineClient();
        if (client && typeof client.computeLocalLeaderboard === "function") {
          var local = client.computeLocalLeaderboard({ subjectId: selectedSubject });
          entries = Array.isArray(local) ? local : ((local && local.entries) || []);
        }
      }

      var auth = state.getAuth();
      var myEntry = entries.find(function (e) { return e.isMe; }) || (auth && auth.profile ? entries.find(function (e) { return e.username === auth.profile.username; }) : null);
      var top3 = entries.slice(0, 3);
      var courseOptions = (catalog.subjects || [])
        .map(function (s) { return '<option value="' + esc(s.id) + '"' + (selectedSubject === s.id ? " selected" : "") + '>' + esc(state.getSubjectName(s)) + '</option>'; })
        .join("");

      container.innerHTML = [
        '<section class="hub-panel">',
        '  <div class="breadcrumbs">',
        '    <button type="button" id="lbBackHub">' + esc(state.t("backCourses")) + '</button>',
        '    <span>/</span>',
        '    <span>' + esc(state.t("leaderboard")) + '</span>',
        '  </div>',
        '  <div class="dialog-head">',
        '    <div>',
        '      <h1 style="margin:0;font-size:1.35rem;">🏆 ' + esc(state.t("leaderboard")) + '</h1>',
        '      <p class="question-meta" style="margin:4px 0 0;">' + esc(onlineMode ? txt("Server-validated Ranked Test scores (XP, Accuracy & Speed).", "نتائج الاختبارات المعتمدة من السيرفر (نقاط XP والدقة والسرعة).") : (errMessage || txt("Local offline rankings.", "الترتيب المحلي بدون اتصال."))) + '</p>',
        '    </div>',
        '    <button type="button" class="secondary" id="lbRefreshBtn">' + esc(txt("↻ Refresh", "↻ تحديث")) + '</button>',
        '  </div>',
        '  <div class="panel-tools">',
        '    <label for="lbSubjectSelect" style="font-size:0.85rem;color:var(--muted);">' + esc(txt("Filter Course:", "تصفية المادة:")) + '</label>',
        '    <select id="lbSubjectSelect"><option value="all">' + esc(txt("All Courses Combined", "كل المواد معاً")) + '</option>' + courseOptions + '</select>',
             !auth ? '<button type="button" class="secondary" id="lbSignInBtn">' + esc(txt("Have a password? Sign In", "عندك حساب بباسورد؟ تسجيل دخول")) + '</button>' : '',
        '  </div>',
           !auth ? [
             '<form class="continue-block" id="lbQuickJoinForm" style="margin-bottom:0;flex-wrap:wrap;gap:10px;">',
             '  <div style="flex:1 1 220px;">',
             '    <strong>🏆 ' + esc(txt("Join Leaderboard (No Password Needed)", "ادخل لوحة المتصدرين (بدون باسورد)")) + '</strong>',
             '    <small>' + esc(txt("Just type any display name (3–24 chars) to compete and save your rank.", "اكتب اسمك فقط (٣-٢٤ حرف) وابدأ تنافس فوراً من غير كلمة سر.")) + '</small>',
             '  </div>',
             '  <div class="inline" style="flex:1 1 240px;">',
             '    <input type="text" id="lbQuickNameInput" required minlength="3" maxlength="24" placeholder="' + esc(txt("Display name...", "اكتب اسمك...")) + '" style="flex:1;min-width:140px;padding:8px 10px;border-radius:10px;border:1px solid var(--line);background:var(--tile);color:var(--ink);">',
             '    <button type="submit" class="primary" id="lbQuickJoinBtn">' + esc(txt("Join with Name", "دخول بالاسم")) + '</button>',
             '  </div>',
             '</form>'
           ].join("\n") : '',
           myEntry ? [
             '<div class="continue-block" style="margin-bottom:0;">',
             '  <div>',
             '    <strong>' + esc(txt("Your Standing:", "ترتيبك:")) + ' #' + myEntry.rank + ' · ' + esc(myEntry.username) + '</strong>',
             '    <small>' + Number(myEntry.xp || myEntry.points || 0) + ' XP · ' + (Number(myEntry.quizzesCount || 0) > 0 ? (Number(myEntry.percentage || 0).toFixed(1) + '% · ' + Number(myEntry.quizzesCount) + ' ' + esc(txt("quiz(zes)", "اختبار"))) : esc(txt("0 / 0 · Joined", "0 / 0 · مسجل"))) + '</small>',
             '  </div>',
             '  <a href="/?flow=hub" class="primary" data-nav="courses">' + esc(txt("Boost Score →", "ارفع نقاطك →")) + '</a>',
             '</div>'
           ].join("\n") : '',
           top3.length ? [
             '<div class="results-grid">',
             top3.map(function (e, i) {
               return [
                 '<div class="result-stat">',
                 '  <span>' + (i === 0 ? "🥇 #1" : i === 1 ? "🥈 #2" : "🥉 #3") + ' · ' + esc(e.username) + (e.guest ? '<span class="hub-guest-tag">' + esc(state.t("guestTag")) + '</span>' : '') + '</span>',
                 '  <strong>' + Number(e.xp || e.points || 0) + ' XP · ' + Number(e.percentage || 0).toFixed(0) + '%</strong>',
                 '</div>'
               ].join("");
             }).join(""),
             '</div>'
           ].join("\n") : '',
           entries.length === 0 ? [
             '<div class="empty-state"><p>' + esc(txt("No ranked submissions recorded for this view yet.", "مفيش اختبارات معتمدة متسجلة في العرض ده لسه.")) + '</p></div>'
           ].join("") : [
             '<div class="table-scroll">',
             '  <table class="lb-table">',
             '    <thead><tr><th>' + esc(txt("Rank", "الترتيب")) + '</th><th>' + esc(txt("Student", "الطالب")) + '</th><th>XP</th><th>' + esc(txt("Score", "النتيجة")) + '</th></tr></thead>',
             '    <tbody>',
             entries.map(function (e) {
               var scoreLabel = Number(e.quizzesCount || 0) > 0
                 ? (Number(e.percentage || 0).toFixed(1) + '% · ' + Number(e.quizzesCount) + ' ' + txt("quiz" + (Number(e.quizzesCount) === 1 ? "" : "zes"), "اختبار"))
                 : txt("0 / 0 · Joined", "0 / 0 · مسجل");
               var badgeHtml = Array.isArray(e.badges) && e.badges.length
                 ? '<div class="hub-badge-row">' + e.badges.slice(0, 3).map(function (b) { return '<span class="hub-badge-pill">' + esc(b.label || b.id || b) + '</span>'; }).join("") + '</div>'
                 : '';
               return [
                 '<tr class="' + (e.isMe ? "is-me" : "") + '"' + (e.isMe ? ' data-me="true"' : '') + '>',
                 '  <td><strong>#' + e.rank + '</strong></td>',
                 '  <td><div>' + esc(e.username) + (e.guest ? '<span class="hub-guest-tag">' + esc(state.t("guestTag")) + '</span>' : '') + '</div>' + badgeHtml + '</td>',
                 '  <td>' + Number(e.xp || e.points || 0) + '</td>',
                 '  <td>' + esc(scoreLabel) + '</td>',
                 '</tr>'
               ].join("");
             }).join("\n"),
             '    </tbody>',
             '  </table>',
             '</div>'
           ].join("\n"),
        '</section>'
      ].join("\n");

      container.querySelector("#lbBackHub").addEventListener("click", function () { navigateTo("/?flow=hub"); });
      container.querySelector("#lbRefreshBtn").addEventListener("click", loadAndPaint);
      container.querySelector("#lbSubjectSelect").addEventListener("change", function (e) {
        selectedSubject = e.target.value;
        loadAndPaint();
      });

      var signBtn = container.querySelector("#lbSignInBtn");
      if (signBtn) {
        signBtn.addEventListener("click", function () { root.ElgoShell && root.ElgoShell.openAuthModal("guest"); });
      }

      var quickForm = container.querySelector("#lbQuickJoinForm");
      if (quickForm) {
        quickForm.addEventListener("submit", async function (e) {
          e.preventDefault();
          var input = container.querySelector("#lbQuickNameInput");
          var btn = container.querySelector("#lbQuickJoinBtn");
          var uname = input ? input.value.trim() : "";
          if (!uname) return;
          if (btn) btn.disabled = true;
          try {
            var res = await fetch("/api/auth/guest", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ username: uname }),
            });
            var data = await res.json().catch(function () { return null; });
            if (!res.ok || !data || !data.ok || !data.token) {
              if (root.ElgoShell) root.ElgoShell.showToast((data && data.error) || txt("Could not join with that name.", "الاسم ده غير متاح أو غير صالح."));
              return;
            }
            state.setAuth(data);
            await state.syncProgressToCloud().catch(function () {});
            if (root.ElgoShell) {
              root.ElgoShell.renderHeaderAndNav();
              root.ElgoShell.showToast(txt("Joined leaderboard as " + (data.profile && data.profile.username ? data.profile.username : uname) + "!", "تم دخولك الترتيب باسم " + (data.profile && data.profile.username ? data.profile.username : uname) + "!"));
            }
            await loadAndPaint();
          } catch (_err) {
            if (root.ElgoShell) root.ElgoShell.showToast(txt("Connection unavailable.", "تعذر الاتصال بالسيرفر."));
          } finally {
            if (btn) btn.disabled = false;
          }
        });
      }
    }

    await loadAndPaint();
  }

  /* ---------------------------------------------------------------------- */
  /* SETTINGS & PROFILE PANEL (Includes Faculty & Term + Team)              */
  /* ---------------------------------------------------------------------- */
  async function renderSettingsPanel(container) {
    var state = root.ElgoState;
    var theme = root.ElgoTheme;
    await state.loadCatalog().catch(function () {});

    function paint() {
      var auth = state.getAuth();
      var profile = auth && auth.profile;
      var curTheme = theme.getTheme();
      var curLang = theme.getLang();
      var paused = theme.isMotionPaused();
      var catalogMgr = state.getCatalogManager();
      var viewScope = catalogMgr && typeof catalogMgr.getActiveScope === "function"
        ? catalogMgr.getActiveScope()
        : { facultyId: "faculty-ai", levelId: "level-2", termId: "term-1" };

      var attemptCount = (state.getState().attemptHistory || []).length;

      var xpVal = profile
        ? Number((profile.stats && profile.stats.xp !== undefined ? profile.stats.xp : (profile.xp !== undefined ? profile.xp : profile.points)) || 0)
        : 0;
      var streakVal = profile
        ? Number((profile.stats && profile.stats.streakDays !== undefined ? profile.stats.streakDays : (profile.streakDays !== undefined ? profile.streakDays : profile.streak)) || 0)
        : 0;

      container.innerHTML = [
        '<section class="hub-panel">',
        '  <div class="breadcrumbs">',
        '    <button type="button" id="setBackHub">' + esc(state.t("backCourses")) + '</button>',
        '    <span>/</span>',
        '    <span>' + esc(state.t("settingsProfile")) + '</span>',
        '  </div>',
        '  <h1 style="margin:0;font-size:1.35rem;">' + esc(state.t("settingsProfile")) + '</h1>',
        '  <div class="panel-item hub-settings">',
        '    <strong>' + esc(state.t("studentAccountHeading")) + '</strong>',
             profile ? [
               '<p class="question-meta" style="margin:0;">' + esc(txt("Signed in as", "مسجل دخول باسم")) + ' <strong>' + esc(profile.username) + '</strong>' + esc(profile.guest ? txt(" (Guest — add a password to keep this handle across devices)", " (زائر — ضيف كلمة سر علشان تحفظ حسابك بين الأجهزة)") : txt(" (Registered account)", " (حساب مسجل)")) + '</p>',
               '<div class="hub-badge-row">',
               '  <span class="hub-badge-pill">⚡ ' + xpVal + ' XP</span>',
               '  <span class="hub-badge-pill">🔥 ' + streakVal + ' ' + esc(txt("streak", "أيام متتالية")) + '</span>',
               '  <span class="hub-badge-pill">📝 ' + attemptCount + ' ' + esc(txt("local sessions", "جلسات محلية")) + '</span>',
               '</div>',
               '<div class="inline">',
                 profile.guest ? '<button type="button" class="primary" id="upgradeAccBtn">' + esc(state.t("keepProgress")) + '</button>' : '',
               '  <button type="button" class="secondary" id="signOutBtn">' + esc(txt("Sign Out", "تسجيل الخروج")) + '</button>',
               '</div>',
               '<form id="renameForm" class="inline" style="margin-top:6px;">',
               '  <input type="text" id="renameInput" value="' + esc(profile.username) + '" minlength="3" maxlength="24" placeholder="' + esc(txt("New username", "الاسم الجديد")) + '">',
               '  <button type="submit" class="secondary">' + esc(txt("Save Username", "حفظ الاسم")) + '</button>',
               '</form>',
               !profile.guest ? [
                 '<details style="margin-top:6px;">',
                 '  <summary style="cursor:pointer;color:var(--danger);font-size:0.86rem;">' + esc(txt("Danger Zone: Delete Account", "منطقة الخطر: حذف الحساب")) + '</summary>',
                 '  <form id="deleteAccForm" class="inline" style="margin-top:8px;">',
                 '    <input type="password" id="delAccPass" required placeholder="' + esc(txt("Confirm password", "أكّد كلمة السر")) + '">',
                 '    <button type="submit" class="secondary" style="color:var(--danger);border-color:var(--danger-border);">' + esc(txt("Delete Permanently", "حذف نهائي")) + '</button>',
                 '  </form>',
                 '</details>'
               ].join("\n") : ''
             ].join("\n") : [
               '<p class="question-meta" style="margin:0;">' + esc(txt("You are browsing locally. Sign in or pick a guest name to save progress and rank on the Leaderboard.", "بتتصفح محلياً. سجل دخول أو اختار اسم زائر علشان تحفظ تقدمك وتدخل لوحة المتصدرين.")) + '</p>',
               '<div class="inline"><button type="button" class="primary" id="openLoginBtn">' + esc(txt("Sign In / Create Account", "تسجيل الدخول / إنشاء حساب")) + '</button></div>'
             ].join("\n"),
        '  </div>',
        '  <div class="panel-item hub-settings">',
        '    <strong>' + esc(state.t("appearanceLanguageHeading")) + '</strong>',
        '    <div class="inline">',
        '      <button type="button" class="' + (curTheme === "evening" ? "primary" : "secondary") + '" id="themeEveBtn">' + esc(txt("Evening Graphite", "داكن هادئ")) + '</button>',
        '      <button type="button" class="' + (curTheme === "daylight" ? "primary" : "secondary") + '" id="themeDayBtn">' + esc(txt("Daylight Warm", "نهاري دافئ")) + '</button>',
        '      <button type="button" class="' + (curLang === "en" ? "primary" : "secondary") + '" id="langEnBtn">English</button>',
        '      <button type="button" class="' + (curLang === "ar" ? "primary" : "secondary") + '" id="langArBtn">العربية</button>',
        '    </div>',
        '    <label class="inline" style="font-size:0.88rem;cursor:pointer;margin:6px 0 0;">',
        '      <input type="checkbox" id="motionToggle"' + (paused ? " checked" : "") + '>',
        '      ' + esc(txt("Pause subtle botanical background motion", "إيقاف حركة الخلفية الهادئة")),
        '    </label>',
        '  </div>',
        '  <div class="panel-item hub-settings" id="faculty">',
        '    <strong>' + esc(state.t("facultyTerm")) + '</strong>',
        '    <p class="question-meta" style="margin:0;">' + esc(txt("Active academic catalog scope for courses, banks, lectures, and resources.", "نطاق الكلية والترم النشط للمواد والبنوك والملفات.")) + '</p>',
        '    <div class="inline">',
        '      <span class="hub-badge-pill">🏛️ Faculty of Artificial Intelligence</span>',
        '      <span class="hub-badge-pill">📚 ' + esc(viewScope.levelId || "level-2") + '</span>',
        '      <span class="hub-badge-pill">🗓️ ' + esc(viewScope.termId || "term-1") + '</span>',
        '    </div>',
        '  </div>',
        '  <div class="panel-item hub-settings">',
        '    <strong>' + esc(state.t("offlineSyncHeading")) + '</strong>',
        '    <div class="inline">',
        '      <button type="button" class="secondary" id="openTeamSettingsBtn">' + esc(state.t("teamTitle")) + '</button>',
        '      <a href="/?panel=admin" class="secondary">' + esc(state.t("adminAccess")) + '</a>',
        '      <button type="button" class="secondary" id="syncPendingBtn">' + esc(state.t("syncPendingBtn")) + '</button>',
        '      <button type="button" class="secondary" id="exportProgressBtn">' + esc(state.t("exportProgressBtn")) + '</button>',
        '      <button type="button" class="secondary" id="resetLocalBtn">' + esc(state.t("clearLocalBtn")) + '</button>',
        '    </div>',
        '  </div>',
        '</section>'
      ].join("\n");

      container.querySelector("#setBackHub").addEventListener("click", function () { navigateTo("/?flow=hub"); });
      container.querySelector("#themeDayBtn").addEventListener("click", function () {
        theme.setTheme("daylight");
        if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
        paint();
      });
      container.querySelector("#themeEveBtn").addEventListener("click", function () {
        theme.setTheme("evening");
        if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
        paint();
      });
      container.querySelector("#langEnBtn").addEventListener("click", function () {
        theme.setLang("en");
        if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
        paint();
      });
      container.querySelector("#langArBtn").addEventListener("click", function () {
        theme.setLang("ar");
        if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
        paint();
      });
      container.querySelector("#motionToggle").addEventListener("change", function (e) {
        theme.setMotionPaused(e.target.checked);
      });

      var teamBtn = container.querySelector("#openTeamSettingsBtn");
      if (teamBtn) teamBtn.addEventListener("click", function () { root.ElgoShell && root.ElgoShell.openTeamDialog(); });

      var openLoginBtn = container.querySelector("#openLoginBtn");
      if (openLoginBtn) openLoginBtn.addEventListener("click", function () { root.ElgoShell && root.ElgoShell.openAuthModal("register"); });

      var upgradeAccBtn = container.querySelector("#upgradeAccBtn");
      if (upgradeAccBtn) upgradeAccBtn.addEventListener("click", function () { root.ElgoShell && root.ElgoShell.openAuthModal("upgrade"); });

      var signOutBtn = container.querySelector("#signOutBtn");
      if (signOutBtn) {
        signOutBtn.addEventListener("click", async function () {
          try {
            await fetch("/api/auth/logout", { method: "POST", headers: state.authHeaders() });
          } catch (_err) {
            // Ignore network failures on signout
          }
          state.setAuth(null);
          if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
          showToast("Signed out.");
          paint();
        });
      }

      var renameForm = container.querySelector("#renameForm");
      if (renameForm) {
        renameForm.addEventListener("submit", async function (e) {
          e.preventDefault();
          var nextName = container.querySelector("#renameInput").value.trim();
          var res = await fetch("/api/user/profile", {
            method: "POST",
            headers: state.authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ username: nextName }),
          });
          var data = await res.json().catch(function () { return null; });
          if (res.ok && data && data.ok && data.profile) {
            var cur = state.getAuth();
            state.setAuth(Object.assign({}, cur, { profile: Object.assign({}, cur && cur.profile, data.profile) }));
            if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
            showToast(txt("Username updated to ", "تم تحديث الاسم إلى ") + data.profile.username);
            paint();
          } else {
            showToast((data && data.error) || txt("Could not update username.", "تعذر تحديث اسم المستخدم."));
          }
        });
      }

      var delForm = container.querySelector("#deleteAccForm");
      if (delForm) {
        delForm.addEventListener("submit", async function (e) {
          e.preventDefault();
          var password = container.querySelector("#delAccPass").value;
          var res = await fetch("/api/user/profile", {
            method: "DELETE",
            headers: state.authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ password: password }),
          });
          var data = await res.json().catch(function () { return null; });
          if (res.ok && data && data.ok) {
            state.setAuth(null);
            if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
            showToast(txt("Account deleted.", "تم حذف الحساب."));
            paint();
          } else {
            showToast((data && data.error) || txt("Incorrect password.", "كلمة السر غير صحيحة."));
          }
        });
      }

      container.querySelector("#syncPendingBtn").addEventListener("click", async function () {
        var out = await state.syncPendingAttempts();
        showToast("Synced " + (out.synced || 0) + " pending attempt(s).");
      });

      container.querySelector("#exportProgressBtn").addEventListener("click", function () {
        var json = state.exportProgressBlob();
        var blob = new Blob([json], { type: "application/json" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "elgo-lab-progress.json";
        a.click();
        URL.revokeObjectURL(url);
      });

      container.querySelector("#resetLocalBtn").addEventListener("click", function () {
        state.saveState({
          selectedSourcesBySubject: {},
          bookmarks: [],
          mistakes: [],
          attemptHistory: [],
          activeSession: null,
          lastAttempt: null,
          quizModes: {},
        });
        if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
        showToast("Local study progress cleared.");
        paint();
      });
    }

    paint();
  }

  async function render(arg1, arg2, params) {
    var panelName = typeof arg1 === "string" ? arg1 : arg2;
    var container = typeof arg1 === "string" ? arg2 : arg1;
    if (!container) return;
    if (panelName === "saved") return renderSavedPanel(container);
    if (panelName === "mistakes") return renderMistakesPanel(container);
    if (panelName === "leaderboard") return renderLeaderboardPanel(container, params);
    if (panelName === "settings") return renderSettingsPanel(container);
  }

  root.ElgoPanels = { render: render };
})(typeof window !== "undefined" ? window : globalThis);
