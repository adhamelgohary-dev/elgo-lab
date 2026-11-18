(function (root) {
  "use strict";

  var videoModal = null;

  var COURSE_ACCENTS = [
    "#F59B59",
    "#F59B59",
    "#F59B59",
    "#F59B59",
    "#F59B59",
    "#F59B59"
  ];

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function courseSvgEmblem(idx, subjectId) {
    var key = String(subjectId || "");
    if (key.includes("machine-learning") || idx === 0) {
      return '<svg viewBox="0 0 56 56" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="15" y="15" width="26" height="26" rx="6"/><path d="M21 24h14M21 31h9M21 9v6m14-6v6M21 41v6m14-6v6M9 21h6m-6 14h6m26-14h6m-6 14h6"/></svg>';
    }
    if (key.includes("network") || idx === 1) {
      return '<svg viewBox="0 0 56 56" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="19" y="7" width="18" height="14" rx="4"/><rect x="5" y="35" width="18" height="14" rx="4"/><rect x="33" y="35" width="18" height="14" rx="4"/><path d="M28 21v7H14v7m14-7h14v7"/></svg>';
    }
    if (key.includes("data-mining") || idx === 2) {
      return '<svg viewBox="0 0 56 56" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="28" cy="13" rx="17" ry="7"/><path d="M11 13v26c0 9 34 9 34 0V13M11 26c0 9 34 9 34 0"/><path d="m33 31 6 6 11-12"/></svg>';
    }
    if (key.includes("logic") || idx === 3) {
      return '<svg viewBox="0 0 56 56" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 16h13c13 0 20 8 20 12S35 40 22 40H9c6-8 6-16 0-24Z"/><path d="M4 21h9M4 35h9m29-7h10"/><circle cx="46" cy="28" r="3"/></svg>';
    }
    if (key.includes("operations") || idx === 4) {
      return '<svg viewBox="0 0 56 56" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="40" r="5"/><circle cx="28" cy="13" r="5"/><circle cx="46" cy="37" r="5"/><path d="m14 36 12-18m6-1 12 16M16 40h25"/><path d="m23 31 4 4 9-11"/></svg>';
    }
    return '<svg viewBox="0 0 56 56" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 8v38h39M16 35c7-1 7-19 15-19s8 14 16 5"/><circle cx="23" cy="26" r="3"/><circle cx="38" cy="24" r="3"/></svg>';
  }

  function formatCourseMeta(subj) {
    var c = (subj && subj.counts) || {};
    var banks = Number(c.quizzes || subj.quizzesCount || 0);
    var lectures = Number(c.lectures || subj.lecturesCount || 0);
    var lang = root.ElgoTheme && root.ElgoTheme.getLang() === "ar";
    if (lang) {
      return banks + " بنوك · " + lectures + " محاضرات";
    }
    return banks + (banks === 1 ? " bank" : " banks") + " · " + lectures + (lectures === 1 ? " lecture" : " lectures");
  }

  function classifyPdfCollection(pdf) {
    var cat = String((pdf && pdf.category) || "").toLowerCase();
    if (cat === "lecture-notes") return "lecture-notes";
    if (cat === "summaries" || cat === "essay-ideas") return "summaries";
    if (cat === "assignments") return "assignments";
    if (cat === "references") return "references";
    return "exam-reviews";
  }

  function openVideoPreview(video) {
    if (!videoModal) {
      videoModal = document.createElement("dialog");
      videoModal.id = "elgoVideoModal";
      videoModal.className = "elgo-dialog quick-search-dialog";
      document.body.appendChild(videoModal);
      videoModal.addEventListener("click", function (e) {
        if (e.target === videoModal) {
          videoModal.innerHTML = "";
          videoModal.close();
        }
      });
      videoModal.addEventListener("close", function () {
        videoModal.innerHTML = "";
      });
    }

    var vidKey = video.videoId || video.youtubeId || "";
    var safeEmbed = video.embedUrl && String(video.embedUrl).startsWith("https://www.youtube-nocookie.com/")
      ? video.embedUrl
      : (vidKey ? ("https://www.youtube-nocookie.com/embed/" + encodeURIComponent(vidKey)) : "");

    videoModal.innerHTML = [
      '<div class="dialog-body">',
      '  <div class="dialog-head">',
      '    <div><h2 style="margin:0;">' + esc(video.title) + '</h2>' + (video.topic ? '<small style="color:var(--muted);">' + esc(video.topic) + '</small>' : '') + '</div>',
      '    <button type="button" class="quiet" id="closeVideoModalBtn">✕</button>',
      '  </div>',
      safeEmbed ? '<div class="video-embed-frame"><iframe src="' + esc(safeEmbed) + '" title="' + esc(video.title) + '" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>' : '',
      video.description ? '<p style="margin:0;color:var(--muted);font-size:0.9rem;">' + esc(video.description) + '</p>' : '',
      '  <div class="inline" style="justify-content:flex-end;">',
      video.youtubeUrl ? '<a class="primary" href="' + esc(video.youtubeUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(root.ElgoTheme && root.ElgoTheme.getLang() === "ar" ? "فتح على يوتيوب ↗" : "Open on YouTube ↗") + '</a>' : '',
      '  </div>',
      '</div>'
    ].join("\n");

    videoModal.querySelector("#closeVideoModalBtn").addEventListener("click", function () {
      videoModal.innerHTML = "";
      videoModal.close();
    });
    if (!videoModal.open && typeof videoModal.showModal === "function") {
      videoModal.showModal();
    }
  }

  /* ---------------------------------------------------------------------- */
  /* HOME / COURSE GARDEN                                                   */
  /* ---------------------------------------------------------------------- */
  async function renderHomeGarden(container, catalog, params) {
    var State = root.ElgoState;
    var Model = root.ElgoModel;
    var subjects = Model.listSubjects(catalog);
    var state = State.getState();
    var rec = Model.continueRecommendation(state, catalog);
    var isAr = root.ElgoTheme && root.ElgoTheme.getLang() === "ar";

    var challengeRaw = params && params.get("challenge");
    var challenge = challengeRaw ? Model.decodeChallenge(challengeRaw) : null;

    var challengeBanner = "";
    if (challenge && challenge.subjectId) {
      var cSubj = Model.getSubject(catalog, challenge.subjectId);
      challengeBanner = [
        '<div class="continue-block is-challenge">',
        '  <div>',
        '    <strong>⚔️ Friend Challenge — ' + esc(cSubj ? State.getSubjectName(cSubj) : challenge.subjectId) + '</strong>',
        '    <small>' + (challenge.total ? ('Target score to beat: ' + Number(challenge.score || 0) + '/' + Number(challenge.total)) : 'Jump into the exact same question set.') + '</small>',
        '  </div>',
        '  <button type="button" class="primary" id="acceptChallengeBtn">Accept Challenge →</button>',
        '</div>'
      ].join("\n");
    }

    var continueBanner = "";
    if (rec && rec.type === "activeSession") {
      var answered = Object.keys(rec.session.answers || {}).length;
      var qNum = Math.min(Math.max(1, Number(rec.session.currentIndex || 0) + 1), (rec.session.questions || []).length || 1);
      var modeLabel = rec.session.mode === "study" ? State.t("studyMode") : rec.session.mode === "test" ? State.t("testMode") : State.t("practiceMode");
      continueBanner = [
        '<div class="continue-block">',
        '  <div>',
        '    <strong>' + esc(rec.session.subjectName || rec.session.title) + '</strong>',
        '    <small>' + esc(modeLabel) + ' · ' + (isAr ? 'السؤال ' + qNum + ' من ' + (rec.session.questions || []).length + ' (' + answered + ' محلول)' : 'Question ' + qNum + ' of ' + (rec.session.questions || []).length) + '</small>',
        '  </div>',
        '  <div class="inline">',
        '    <button type="button" class="quiet" id="resumeActiveBtn">' + (isAr ? 'كمّل ←' : 'Resume →') + '</button>',
        '    <button type="button" class="quiet continue-discard" id="discardActiveBtn" title="' + (isAr ? 'تجاهل' : 'Discard') + '" aria-label="' + (isAr ? 'تجاهل الجلسة' : 'Discard session') + '">✕</button>',
        '  </div>',
        '</div>'
      ].join("\n");
    } else if (rec && rec.type === "lastSubject") {
      continueBanner = [
        '<div class="continue-block">',
        '  <div>',
        '    <strong>' + esc(State.getSubjectName(rec.subject)) + '</strong>',
        '    <small>' + esc(rec.attempt.title || rec.subject.name) + ' · ' + Number(rec.attempt.percentage || 0) + '%</small>',
        '  </div>',
        '  <a href="/?flow=hub&subject=' + encodeURIComponent(rec.subject.id) + '" class="quiet">' + (isAr ? 'كمّل ←' : 'Resume →') + '</a>',
        '</div>'
      ].join("\n");
    }

    var tilesHtml = subjects.map(function (s, idx) {
      return [
        '<button type="button" class="course-tile tile-' + idx + '" data-subject-id="' + esc(s.id) + '">',
        '  <span class="course-emblem" aria-hidden="true">' + courseSvgEmblem(idx, s.id) + '</span>',
        '  <span class="tile-copy">',
        '    <strong>' + esc(State.getSubjectName(s)) + '</strong>',
        '    <small>' + formatCourseMeta(s) + '</small>',
        '  </span>',
        '  <span class="tile-open">',
        '    <span>' + esc(State.t("openCourse")) + '</span>',
        '    <b aria-hidden="true">' + (isAr ? '↖' : '↗') + '</b>',
        '  </span>',
        '</button>'
      ].join("\n");
    }).join("\n");

    container.innerHTML = [
      '<section class="garden-intro">',
      '  <div class="intro-copy">',
      '    <p class="eyebrow">' + esc(State.t("heroEyebrow")) + '</p>',
      '    <h1>' + esc(State.t("heroTitleStart")) + '<span>' + esc(State.t("heroTitleAccent")) + '</span></h1>',
      '    <p>' + esc(State.t("heroSub")) + '</p>',
      '  </div>',
      '  <aside class="mascot-perch" aria-label="Study companion">',
      '    <img src="/assets/mascot/mascot-clay.webp" alt="elgo mascot welcoming you">',
      '  </aside>',
      '</section>',
      challengeBanner,
      continueBanner,
      '<div class="section-heading">',
      '  <h2>' + esc(State.t("yourCourses")) + '</h2>',
      '  <span>' + subjects.length + ' ' + esc(State.t("homeReadyMeta")) + '</span>',
      '</div>',
      '<div class="course-garden-grid">' + tilesHtml + '</div>',
      '<div class="garden-bottom"><p>' + esc(State.t("homeBottomTagline")) + '</p></div>'
    ].join("\n");

    container.querySelectorAll("[data-subject-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-subject-id");
        root.ElgoRouter.navigate("/?flow=hub&subject=" + encodeURIComponent(id));
      });
    });

    var resumeBtn = container.querySelector("#resumeActiveBtn");
    if (resumeBtn && rec && rec.session) {
      resumeBtn.addEventListener("click", function () {
        root.ElgoPlayer.launchSpec(rec.session);
      });
    }

    var discardBtn = container.querySelector("#discardActiveBtn");
    if (discardBtn) {
      discardBtn.addEventListener("click", function () {
        var st = State.getState();
        st.activeSession = null;
        State.saveState(st);
        if (root.ElgoPlayer && typeof root.ElgoPlayer.clearActiveSession === "function") {
          root.ElgoPlayer.clearActiveSession();
        }
        renderHomeGarden(container, catalog, params);
      });
    }

    var chalBtn = container.querySelector("#acceptChallengeBtn");
    if (chalBtn && challenge) {
      chalBtn.addEventListener("click", async function () {
        chalBtn.disabled = true;
        try {
          var subj = Model.getSubject(catalog, challenge.subjectId) || { id: challenge.subjectId, name: challenge.subjectId };
          var qs = await State.loadQuestionsForSources(challenge.subjectId, challenge.sourceIds || []);
          var spec = Model.buildSessionSpec({
            subject: subj,
            questions: qs,
            sourceIds: challenge.sourceIds || [],
            mode: "test",
            title: "Challenge · " + State.getSubjectName(subj),
          });
          root.ElgoPlayer.launchSpec(spec);
        } finally {
          chalBtn.disabled = false;
        }
      });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* COURSE HUB (4 BEGINNER-FRIENDLY PILLARS: QUESTIONS, LEARN, PDFS, VIDEOS) */
  /* ---------------------------------------------------------------------- */
  function renderCourseHubOverview(container, catalog, subj) {
    var State = root.ElgoState;
    var isAr = root.ElgoTheme && root.ElgoTheme.getLang() === "ar";
    var c = subj.counts || {};
    var bankCount = Number(c.quizzes || 0) + Number(c.sheets || 0) + Number(c.lectures || 0);
    var pdfCount = State.getPdfs(subj.id).length;
    var videoCount = State.getVideos(subj.id).length;

    container.innerHTML = [
      '<p class="eyebrow" style="margin-bottom:10px;">' + esc(State.t("courseHubEyebrow")) + '</p>',
      '<div class="route-grid">',
      '  <button type="button" class="course-route primary-route" data-hub-route="sources">',
      '    <span class="route-kicker">' + esc(State.t("practiceKicker")) + '</span>',
      '    <strong>' + esc(State.t("practiceTitle")) + '</strong>',
      '    <span class="course-arabic" lang="ar" dir="rtl">حل الأسئلة والامتحانات</span>',
      '    <p>' + esc(State.t("practiceDesc")) + '</p>',
      '    <div class="route-meta"><span>' + bankCount + (isAr ? ' مصادر · ' : ' banks · ') + Number(c.totalQuestions || 0) + (isAr ? ' سؤال' : ' Qs') + '</span><span>' + (isAr ? 'ابدأ ←' : 'Start solving →') + '</span></div>',
      '  </button>',
      '  <button type="button" class="course-route" data-hub-route="learn">',
      '    <span class="route-kicker">' + esc(State.t("learnKicker")) + '</span>',
      '    <strong>' + esc(State.t("learnTitle")) + '</strong>',
      '    <span class="course-arabic" lang="ar" dir="rtl">ملخصات وشرح المحاضرات</span>',
      '    <p>' + esc(State.t("learnDesc")) + '</p>',
      '    <div class="route-meta"><span>' + Number(c.lectures || 0) + (isAr ? ' محاضرات' : ' lectures') + '</span><span>' + (isAr ? 'اقرأ الشرح ←' : 'Read notes →') + '</span></div>',
      '  </button>',
      '  <button type="button" class="course-route" data-hub-route="resources">',
      '    <span class="route-kicker">' + esc(State.t("resourcesKicker")) + '</span>',
      '    <strong>' + esc(State.t("resourcesTitle")) + '</strong>',
      '    <span class="course-arabic" lang="ar" dir="rtl">ملفات PDF والملخصات</span>',
      '    <p>' + esc(State.t("resourcesDesc")) + '</p>',
      '    <div class="route-meta"><span>' + pdfCount + (isAr ? ' ملف PDF' : ' PDF files') + '</span><span>' + (isAr ? 'افتح الملفات ←' : 'Browse PDFs →') + '</span></div>',
      '  </button>',
      '  <button type="button" class="course-route" data-hub-route="videos">',
      '    <span class="route-kicker">' + esc(State.t("videosKicker")) + '</span>',
      '    <strong>' + esc(State.t("videosTitle")) + '</strong>',
      '    <span class="course-arabic" lang="ar" dir="rtl">فيديوهات شرح المحاضرات</span>',
      '    <p>' + esc(State.t("videosDesc")) + '</p>',
      '    <div class="route-meta"><span>' + videoCount + (isAr ? ' فيديو شرح' : (videoCount === 1 ? ' video' : ' videos')) + '</span><span>' + (isAr ? 'شاهد ←' : 'Watch →') + '</span></div>',
      '  </button>',
      '</div>'
    ].join("\n");

    container.querySelectorAll("[data-hub-route]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var view = btn.getAttribute("data-hub-route");
        root.ElgoRouter.navigate("/?flow=hub&subject=" + encodeURIComponent(subj.id) + "&view=" + encodeURIComponent(view));
      });
    });
  }

  /* ---------------------------------------------------------------------- */
  /* QUIZ SETUP                   */
  /* ---------------------------------------------------------------------- */
  function renderSourcesView(container, catalog, subj) {
    var State = root.ElgoState;
    var Model = root.ElgoModel;
    var allSources = Model.listSources(catalog, subj.id, "all");
    var savedSelected = State.getSelectedSources(subj.id);
    var selectedSet = new Set(savedSelected.filter(function (id) {
      return allSources.some(function (source) { return source.id === id; });
    }));

    if (selectedSet.size === 0 && allSources.length > 0) {
      selectedSet.add(allSources[0].id);
      State.setSelectedSources(subj.id, Array.from(selectedSet));
    }

    var step = 1;
    var launching = false;
    var kindFilter = "all";
    var mode = "test";
    var shuffleQ = false;
    var shuffleOpts = false;
    var questionLimit = 0;

    function filteredSources() {
      if (kindFilter === "all") return allSources;
      return allSources.filter(function (s) { return s.kind === kindFilter; });
    }

    var isAr = root.ElgoTheme && root.ElgoTheme.getLang() === "ar";
    function quizText(en, ar) { return isAr ? ar : en; }

    function paint(focusSelector) {
      var list = filteredSources();
      var selectedList = allSources.filter(function (s) { return selectedSet.has(s.id); });
      var totalQ = selectedList.reduce(function (acc, s) { return acc + Number(s.questionCount || 0); }, 0);
      if (questionLimit >= totalQ) questionLimit = 0;
      var effectiveQ = questionLimit > 0 ? Math.min(totalQ, questionLimit) : totalQ;
      var isSingleGradable = selectedList.length === 1 && questionLimit === 0;
      var selectionSummary = quizText(selectedList.length + " selected · " + effectiveQ + " questions",
        "المجموعات المختارة: " + selectedList.length + " · الأسئلة: " + effectiveQ);

      var modeHint = mode === "study"
        ? State.t("studyHint")
        : mode === "practice"
          ? State.t("practiceHint")
          : (isSingleGradable
              ? State.t("testHint")
              : quizText("Answers stay hidden until submission. Choose one complete set to be eligible for ranking.", "تظل الإجابات مخفية حتى التسليم. اختر مجموعة كاملة واحدة للتأهل للترتيب."));

      var exporter = root.ElgoOfflineExport;
      var siteSettings = typeof State.getSiteSettings === "function" ? State.getSiteSettings() : null;
      var canDownloadSelected = Boolean(
        exporter &&
        effectiveQ > 0 &&
        selectedList.length > 0 &&
        selectedList.every(function (s) { return exporter.isQuizDownloadAllowed(siteSettings, subj.id, s.id); })
      );

      var tilesHtml = list.map(function (src) {
        var checked = selectedSet.has(src.id);
        var kindLabel = src.kind === "sheet" ? quizText("Sheet", "شيت") : src.kind === "lecture" ? quizText("Lecture", "محاضرة") : quizText("Bank", "بنك أسئلة");
        var canDl = Boolean(exporter && exporter.isQuizDownloadAllowed(siteSettings, subj.id, src.id));
        return [
          '<button type="button" class="source-tile" data-src-id="' + esc(src.id) + '" aria-pressed="' + (checked ? "true" : "false") + '">',
          '  <div class="source-tile-top">',
          '    <span class="source-kind-tag is-' + esc(src.kind) + '">' + kindLabel + '</span>',
          '    <span class="source-tick" aria-hidden="true">' + (checked ? "✓" : "") + '</span>',
          '  </div>',
          '  <strong style="font-size:0.95rem;line-height:1.35;">' + esc(State.getQuizTitle(src)) + '</strong>',
          '  <small style="color:var(--muted);">' + Number(src.questionCount || 0) + quizText(' questions', ' سؤال') + (canDl ? ' · ⬇ HTML' : '') + '</small>',
          '</button>'
        ].join("\n");
      }).join("\n");

      container.innerHTML = [
        '<div class="sources-page-head">',
        '  <h2 id="quizSetupHeading" tabindex="-1">' + esc(step === 1
          ? quizText("Choose question sets", "اختر مجموعات الأسئلة")
          : quizText("Choose a quiz mode", "اختر وضع الاختبار")) + '</h2>',
        '</div>',
        ...(step === 1 ? [
        '  <div class="sources-main-col">',
        '    <div class="sources-toolbar">',
        '      <div class="filter-bar">',
        '        <button type="button" class="filter-pill' + (kindFilter === "all" ? " is-active" : "") + '" data-kind-filter="all">' + esc(State.t("allSources")) + ' (' + allSources.length + ')</button>',
        '        <button type="button" class="filter-pill' + (kindFilter === "quiz" ? " is-active" : "") + '" data-kind-filter="quiz">' + esc(State.t("banksQuizzes")) + '</button>',
        '        <button type="button" class="filter-pill' + (kindFilter === "sheet" ? " is-active" : "") + '" data-kind-filter="sheet">' + esc(State.t("sheets")) + '</button>',
        '        <button type="button" class="filter-pill' + (kindFilter === "lecture" ? " is-active" : "") + '" data-kind-filter="lecture">' + esc(State.t("lecturePractice")) + '</button>',
        '      </div>',
        '      <div class="inline">',
        '        <button type="button" class="quiet" id="selectAllSourcesBtn">' + esc(State.t("selectVisible")) + '</button>',
        '        <button type="button" class="quiet" id="clearSourcesBtn">' + esc(State.t("clearSelection")) + '</button>',
        '      </div>',
        '    </div>',
        list.length ? ('<div class="source-grid">' + tilesHtml + '</div>') : ('<div class="empty-state">' + esc(quizText("No question sets match this filter.", "لا توجد مجموعات أسئلة بهذا الفلتر.")) + '</div>'),
        '  </div>',
        '  <div class="quiz-setup-actions">',
        '    <span role="status">' + esc(selectionSummary) + '</span>',
        '    <button type="button" class="primary" id="nextQuizSetupBtn"' + (totalQ === 0 ? ' disabled' : '') + '>' + esc(quizText("Next", "التالي")) + '</button>',
        '  </div>',
        ] : [
        '  <div class="setup-panel quiz-mode-step">',
        '    <p role="status">' + esc(selectionSummary) + '</p>',
        '    <div class="mode-options" role="radiogroup" aria-labelledby="quizSetupHeading">',
        '      <label class="mode-choice"><input type="radio" name="sessionMode" value="study"' + (mode === "study" ? " checked" : "") + '><span><strong>' + esc(State.t("studyMode")) + ' <span class="mode-tag">' + esc(State.t("studyTag")) + '</span></strong><small style="display:block;color:var(--muted);">' + (isAr ? 'السؤال مع الإجابة الصح والشرح ظاهرين قدامك.' : 'Read questions with correct answers &amp; explanations shown.') + '</small></span></label>',
        '      <label class="mode-choice"><input type="radio" name="sessionMode" value="test"' + (mode === "test" ? " checked" : "") + '><span><strong>' + esc(State.t("testMode")) + ' <span class="mode-tag">' + esc(State.t("testTag")) + '</span></strong><small style="display:block;color:var(--muted);">' + (isAr ? 'امتحان حقيقي بوقت' : 'Exam flow') + (isSingleGradable ? (isAr ? " · محسوب في المتصدرين" : " · Ranked eligible") : (isAr ? " · اختار بنك واحد للترتيب" : " · Pick 1 bank to rank")) + '</small></span></label>',
        '      <label class="mode-choice"><input type="radio" name="sessionMode" value="practice"' + (mode === "practice" ? " checked" : "") + '><span><strong>' + esc(State.t("practiceMode")) + ' <span class="mode-tag">' + esc(State.t("practiceTag")) + '</span></strong><small style="display:block;color:var(--muted);">' + (isAr ? 'حل السؤال وشوف صح ولا غلط فوراً.' : 'Answer &amp; check right/wrong immediately.') + '</small></span></label>',
        '    </div>',
        '    <p style="margin:0;font-size:0.8rem;color:var(--muted);">' + esc(modeHint) + '</p>',
        '    <label class="setup-row" style="cursor:pointer;"><span>' + esc(quizText("Shuffle questions", "اخلط ترتيب الأسئلة")) + '</span><input type="checkbox" id="shuffleQCheck"' + (shuffleQ ? " checked" : "") + '></label>',
        '    <label class="setup-row" style="cursor:pointer;"><span>' + esc(quizText("Shuffle answers", "اخلط الاختيارات")) + '</span><input type="checkbox" id="shuffleOptsCheck"' + (shuffleOpts ? " checked" : "") + '></label>',
        '    <label class="setup-row"><span>' + esc(quizText("Question count", "عدد الأسئلة")) + '</span><select id="limitSelect" style="padding:5px 8px;border-radius:8px;border:1px solid var(--line);background:var(--tile);color:var(--ink);">',
        '      <option value="0"' + (questionLimit === 0 ? " selected" : "") + '>' + esc(quizText('All', 'الكل')) + ' (' + totalQ + ')</option>',
        totalQ > 10 ? '      <option value="10"' + (questionLimit === 10 ? " selected" : "") + '>10</option>' : "",
        totalQ > 20 ? '      <option value="20"' + (questionLimit === 20 ? " selected" : "") + '>20</option>' : "",
        totalQ > 30 ? '      <option value="30"' + (questionLimit === 30 ? " selected" : "") + '>30</option>' : "",
        totalQ > 50 ? '      <option value="50"' + (questionLimit === 50 ? " selected" : "") + '>50</option>' : "",
        '    </select></label>',
        '    <div class="quiz-setup-actions">',
        '      <button type="button" class="secondary" id="backQuizSetupBtn">' + esc(quizText("Back to sets", "الرجوع للمجموعات")) + '</button>',
        '      <button type="button" class="primary" id="startSessionBtn"' + (effectiveQ === 0 || launching ? " disabled" : "") + '>' + esc(quizText("Start quiz", "ابدأ الاختبار")) + '</button>',
        '    </div>',
        '    <p id="quizSetupFeedback" role="status" hidden></p>',
             canDownloadSelected ? ('    <button type="button" class="secondary" id="downloadOfflineQuizBtn">⬇ ' + esc(isAr ? "تحميل صفحة HTML أوفلاين" : "Download Offline HTML") + ' (' + effectiveQ + ')</button>') : '',
        '  </div>',
        ]),
      ].join("\n");

      if (focusSelector) {
        var focusTarget = container.querySelector(focusSelector);
        if (focusTarget) focusTarget.focus();
      }
      if (step === 1) {
        container.querySelector("#nextQuizSetupBtn").addEventListener("click", function () {
          if (!totalQ) return;
          step = 2;
          paint("#quizSetupHeading");
        });
        container.querySelectorAll("[data-kind-filter]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            kindFilter = btn.getAttribute("data-kind-filter");
            paint('[data-kind-filter="' + kindFilter + '"]');
          });
        });

        container.querySelectorAll("[data-src-id]").forEach(function (tile) {
          tile.addEventListener("click", function () {
            var sid = tile.getAttribute("data-src-id");
            if (selectedSet.has(sid)) {
              selectedSet.delete(sid);
            } else {
              selectedSet.add(sid);
            }
            State.setSelectedSources(subj.id, Array.from(selectedSet));
            paint('[data-src-id="' + CSS.escape(sid) + '"]');
          });
        });

        container.querySelector("#selectAllSourcesBtn").addEventListener("click", function () {
          list.forEach(function (s) { selectedSet.add(s.id); });
          State.setSelectedSources(subj.id, Array.from(selectedSet));
          paint("#selectAllSourcesBtn");
        });

        container.querySelector("#clearSourcesBtn").addEventListener("click", function () {
          selectedSet.clear();
          State.setSelectedSources(subj.id, []);
          paint("#clearSourcesBtn");
        });

        return;
      }
      container.querySelector("#backQuizSetupBtn").addEventListener("click", function () {
        step = 1;
        paint("#quizSetupHeading");
      });

      container.querySelectorAll('input[name="sessionMode"]').forEach(function (rad) {
        rad.addEventListener("change", function () {
          mode = rad.value;
          paint('input[name="sessionMode"][value="' + mode + '"]');
        });
      });

      container.querySelector("#shuffleQCheck").addEventListener("change", function (e) { shuffleQ = e.target.checked; });
      container.querySelector("#shuffleOptsCheck").addEventListener("change", function (e) { shuffleOpts = e.target.checked; });
      container.querySelector("#limitSelect").addEventListener("change", function (e) {
        questionLimit = Number(e.target.value) || 0;
        paint("#limitSelect");
      });

      var startSessionHandler = async function (btn) {
        var chosenIds = Array.from(selectedSet);
        if (!chosenIds.length || launching) return;
        launching = true;
        var setup = { mode: mode, shuffleQ: shuffleQ, shuffleOpts: shuffleOpts, limit: questionLimit };
        var authGeneration = State.getAuthGeneration();
        var feedback = container.querySelector("#quizSetupFeedback");
        feedback.hidden = false;
        feedback.textContent = quizText("Loading questions…", "جاري تحميل الأسئلة…");
        btn.disabled = true;
        try {
          var qs = await State.loadQuestionsForSources(subj.id, chosenIds);
          if (!btn.isConnected || !container.contains(btn)) return;
          if (State.getAuthGeneration() !== authGeneration) {
            feedback.textContent = quizText("Your session changed. Start the quiz again.", "تغيّرت جلستك. ابدأ الاختبار مرة أخرى.");
            return;
          }
          if (!qs.length) {
            feedback.textContent = quizText("No questions are available in the selected sets.", "لا توجد أسئلة في المجموعات المختارة.");
            return;
          }
          var workingQs = setup.shuffleQ ? Model.shuffleArray(qs) : qs;
          if (setup.limit > 0 && workingQs.length > setup.limit) {
            workingQs = workingQs.slice(0, setup.limit);
          }
          var firstMeta = allSources.find(function (s) { return s.id === chosenIds[0]; });
          var spec = Model.buildSessionSpec({
            subject: subj,
            questions: workingQs,
            sourceIds: chosenIds,
            mode: setup.mode,
            shuffleQuestions: false,
            shuffleOptions: setup.shuffleOpts,
            isGradableCollection: chosenIds.length === 1 && setup.limit === 0,
            title: chosenIds.length === 1 && firstMeta ? State.getQuizTitle(firstMeta, subj.id) : (State.getSubjectName(subj) + " (" + chosenIds.length + " sources)"),
          });
          root.ElgoPlayer.launchSpec(spec);
        } catch (err) {
          feedback.textContent = quizText("Could not load the quiz. Try again.", "تعذّر تحميل الاختبار. حاول مرة أخرى.");
        } finally {
          launching = false;
          var currentStart = container.querySelector("#startSessionBtn");
          if (currentStart) currentStart.disabled = false;
        }
      };

      var startButton = container.querySelector("#startSessionBtn");
      startButton.addEventListener("click", function () { return startSessionHandler(startButton); });

      var offlineQuizBtn = container.querySelector("#downloadOfflineQuizBtn");
      if (offlineQuizBtn && exporter) {
        offlineQuizBtn.addEventListener("click", async function () {
          var chosenIds = Array.from(selectedSet);
          if (!chosenIds.length) return;
          offlineQuizBtn.disabled = true;
          try {
            var qs = await State.loadQuestionsForSources(subj.id, chosenIds);
            if (questionLimit > 0 && qs.length > questionLimit) qs = qs.slice(0, questionLimit);
            if (typeof exporter.inlineQuizImages === "function") {
              qs = await exporter.inlineQuizImages(qs);
            }
            var firstMeta = allSources.find(function (s) { return s.id === chosenIds[0]; });
            var quizTitle = chosenIds.length === 1 && firstMeta
              ? State.getQuizTitle(firstMeta, subj.id)
              : (State.getSubjectName(subj) + " — " + chosenIds.length + " sources");
            var html = exporter.buildOfflineQuizHtml({
              courseTitle: State.getSubjectName(subj),
              quizTitle: quizTitle,
              subtitle: quizText(qs.length + " questions · Feedback is available online", qs.length + " سؤال · الإجابات متاحة على الموقع"),
              questions: qs.map(function (q) {
                return { question: q.question || q.text, options: q.options, images: q.images, image: q.image, imageAlt: q.imageAlt, imageCaption: q.imageCaption };
              }),
            });
            exporter.triggerHtmlDownload(subj.id + "-" + quizTitle, html);
            if (root.ElgoShell) root.ElgoShell.showToast(isAr ? "تم تحميل ملف الكويز أوفلاين." : "Offline quiz HTML downloaded.");
          } catch (err) {
            if (root.ElgoShell) root.ElgoShell.showToast((err && err.message) || "Offline export failed.");
          } finally {
            offlineQuizBtn.disabled = false;
          }
        });
      }
    }

    paint();
  }

  /* ---------------------------------------------------------------------- */
  /* LEARN / LECTURE EXPLANATIONS & SUMMARY PAGES                           */
  /* ---------------------------------------------------------------------- */
  async function renderLearnView(container, catalog, subj) {
    var State = root.ElgoState;
    var exporter = root.ElgoOfflineExport;
    var siteSettings = typeof State.getSiteSettings === "function" ? State.getSiteSettings() : null;
    var isAr = root.ElgoTheme && root.ElgoTheme.getLang() === "ar";
    container.innerHTML = '<div class="empty-state">Loading course lectures...</div>';
    var subjData = await State.loadSubject(subj.id).catch(function () { return null; });
    var lectures = (subjData && Array.isArray(subjData.lectures) ? subjData.lectures : []);

    if (!lectures.length) {
      container.innerHTML = '<div class="empty-state">No lectures published for this course yet.</div>';
      return;
    }

    var cardsHtml = lectures.map(function (lec, idx) {
      var qCount = Array.isArray(lec.questions)
        ? lec.questions.length
        : (lec.generatedQuiz && Array.isArray(lec.generatedQuiz.questions) ? lec.generatedQuiz.questions.length : 0);
      var sg = lec.studyGuide && typeof lec.studyGuide === "object" ? lec.studyGuide : {};
      var bullets = Array.isArray(sg.englishPoints || sg.summaryPoints) ? (sg.englishPoints || sg.summaryPoints) : [];
      var arText = sg.arabicExplanation || lec.arabicSummary || "";
      var lecHref = "/learn/" + encodeURIComponent(subj.id) + "/" + encodeURIComponent(lec.id) + "/";
      var canDlLec = Boolean(exporter && exporter.isLectureDownloadAllowed(siteSettings, subj.id, lec.id));

      return [
        '<article class="lecture-card">',
        '  <div class="lecture-card-head">',
        '    <div>',
        '      <span class="lecture-num-pill">Lecture ' + (idx + 1) + '</span>',
        '      <h3 style="margin:6px 0 4px;">' + esc(lec.title || lec.id) + '</h3>',
        '      <small style="color:var(--muted);">' + qCount + ' lecture quiz questions · Bilingual summary &amp; formulas</small>',
        '    </div>',
        '    <div class="inline">',
        '      <a href="' + lecHref + '" class="primary">Open Full Lecture ↗</a>',
               canDlLec ? '<button type="button" class="secondary" data-lec-offline="' + esc(lec.id) + '">' + esc(isAr ? "⬇ حفظ HTML أوفلاين" : "⬇ Offline HTML") + '</button>' : '',
               qCount ? '<button type="button" class="secondary" data-lec-quiz="' + esc(lec.id) + '">Practice ' + qCount + ' Qs →</button>' : '',
        '    </div>',
        '  </div>',
        (bullets.length || arText) ? [
          '<details style="margin-top:12px;">',
          '  <summary>Quick Study Guide Preview</summary>',
          '  <div class="lecture-guide-body">',
               bullets.length ? ('<ul>' + bullets.slice(0, 6).map(function (b) { return '<li>' + esc(b) + '</li>'; }).join("") + '</ul>') : '',
               arText ? ('<div class="lecture-guide-ar" dir="rtl" lang="ar">' + esc(arText) + '</div>') : '',
          '  </div>',
          '</details>'
        ].join("\n") : '',
        '</article>'
      ].join("\n");
    }).join("\n");

    container.innerHTML = '<div class="lecture-library">' + cardsHtml + '</div>';

    container.querySelectorAll("[data-lec-quiz]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        var lecId = btn.getAttribute("data-lec-quiz");
        btn.disabled = true;
        try {
          var srcId = subj.id + "::lecture::" + lecId;
          var qs = await State.loadQuestionsForSources(subj.id, [srcId]);
          var lecObj = lectures.find(function (l) { return l.id === lecId; });
          var spec = root.ElgoModel.buildSessionSpec({
            subject: subj,
            questions: qs,
            sourceIds: [srcId],
            mode: "practice",
            title: (lecObj && lecObj.title) || lecId,
          });
          root.ElgoPlayer.launchSpec(spec);
        } catch (err) {
          if (root.ElgoShell) root.ElgoShell.showToast((err && err.message) || "Could not start quiz session.");
        } finally {
          btn.disabled = false;
        }
      });
    });

    if (exporter) {
      container.querySelectorAll("[data-lec-offline]").forEach(function (btn) {
        btn.addEventListener("click", async function () {
          var lecId = btn.getAttribute("data-lec-offline");
          var lecObj = lectures.find(function (l) { return l.id === lecId; });
          if (!lecObj) return;
          btn.disabled = true;
          try {
            var sg = lecObj.studyGuide && typeof lecObj.studyGuide === "object" ? lecObj.studyGuide : {};
            var bullets = Array.isArray(sg.englishPoints || sg.summaryPoints) ? (sg.englishPoints || sg.summaryPoints) : [];
            var arText = sg.arabicExplanation || lecObj.arabicSummary || "";
            var enLead = sg.englishSummary || lecObj.summary || "";
            var bodyHtml = "";
            var lecUrl = "/learn/" + encodeURIComponent(subj.id) + "/" + encodeURIComponent(lecId) + "/";
            try {
              var pageRes = await fetch(lecUrl);
              if (pageRes && pageRes.ok) {
                var rawPage = await pageRes.text();
                var m = rawPage.match(/<article class="lecture-article">([\s\S]*?)<\/article>/i);
                if (m && m[1]) bodyHtml = m[1];
              }
            } catch (_e) { /* fall back to inline summary */ }
            if (!bodyHtml) {
              bodyHtml = bullets.length ? ("<h2>Key Study Points</h2><ul>" + bullets.map(function (b) { return "<li>" + esc(b) + "</li>"; }).join("") + "</ul>") : "<p>No detailed lecture article body available.</p>";
            }
            var html = exporter.buildOfflineLectureHtml({
              courseTitle: State.getSubjectName(subj),
              lectureTitle: lecObj.title || lecId,
              guideEn: enLead,
              guideAr: arText,
              bodyHtml: bodyHtml,
            });
            exporter.triggerHtmlDownload(subj.id + "-" + lecId, html);
            if (root.ElgoShell) root.ElgoShell.showToast(isAr ? "تم تحميل شرح المحاضرة أوفلاين." : "Offline lecture HTML downloaded.");
          } finally {
            btn.disabled = false;
          }
        });
      });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* RESOURCES SHELF (3 PDF COLLECTIONS) & DEDICATED VIDEOS TAB             */
  /* ---------------------------------------------------------------------- */
  function renderResourcesView(container, catalog, subj) {
    var State = root.ElgoState;
    var pdfs = State.getPdfs(subj.id);
    var activeCollection = "all";

    var countsByCol = { "lecture-notes": 0, summaries: 0, assignments: 0, "exam-reviews": 0, references: 0 };
    pdfs.forEach(function (p) {
      var k = classifyPdfCollection(p);
      countsByCol[k] = (countsByCol[k] || 0) + 1;
    });

    function paint() {
      var isAr = root.ElgoTheme && typeof root.ElgoTheme.getLang === "function" && root.ElgoTheme.getLang() === "ar";
      var visiblePdfs = activeCollection === "all"
        ? pdfs
        : pdfs.filter(function (p) { return classifyPdfCollection(p) === activeCollection; });

      var colsList = [
        { key: "lecture-notes", title: isAr ? "مذكرات المحاضرات" : "Lecture notes", sub: isAr ? "ملخصات وشرح ومراجعات" : "Summaries, slides & guides", count: countsByCol["lecture-notes"] },
        { key: "summaries", title: isAr ? "ملخصات سريعة" : "Quick summaries", sub: isAr ? "قوانين وورق مراجعة" : "Key formulas & cheat sheets", count: countsByCol.summaries },
        { key: "exam-reviews", title: isAr ? "امتحانات وتدريبات" : "Exam & practice", sub: isAr ? "ميدتيرم وبنوك أسئلة" : "Midterms, practice & banks", count: countsByCol["exam-reviews"] }
      ];
      if (countsByCol.assignments > 0) {
        colsList.push({ key: "assignments", title: isAr ? "شيتات وواجبات" : "Assignments", sub: isAr ? "شيتات ومهام التقييم" : "Course sheets & tasks", count: countsByCol.assignments });
      }
      if (countsByCol.references > 0) {
        colsList.push({ key: "references", title: isAr ? "مراجع ومصادر" : "References", sub: isAr ? "مراجع إضافية للمادة" : "Textbooks & extra docs", count: countsByCol.references });
      }
      var shelfCards = colsList.map(function (col) {
        var pressed = activeCollection === col.key;
        return [
          '<button type="button" class="shelf-collection-card" data-shelf-col="' + col.key + '" aria-pressed="' + (pressed ? "true" : "false") + '">',
          '  <strong>' + esc(col.title) + '</strong>',
          '  <small>' + esc(col.sub) + '</small>',
          '  <span class="shelf-count">' + col.count + ' ' + esc(isAr ? "ملف" : ("file" + (col.count === 1 ? "" : "s"))) + '</span>',
          '</button>'
        ].join("\n");
      }).join("\n");

      var pdfHtml = visiblePdfs.map(function (pdf) {
        var href = pdf.path ? ("/" + String(pdf.path).replace(/^\/+/, "")) : (pdf.url || "#");
        return [
          '<article class="resource-file">',
          '  <div>',
          '    <span class="source-kind-tag">' + esc(pdf.category || "PDF") + (pdf.topic ? " · " + esc(pdf.topic) : "") + '</span>',
          '    <h3 style="margin:8px 0 4px;font-size:1rem;">' + esc(pdf.title || pdf.id) + '</h3>',
               pdf.description ? '<p style="margin:0;font-size:0.84rem;color:var(--muted);">' + esc(pdf.description) + '</p>' : '',
          '  </div>',
          '  <div class="inline" style="justify-content:space-between;">',
          '    <small style="color:var(--muted);">' + (pdf.bytes ? Math.max(1, Math.round(pdf.bytes / 1024)) + ' KB' : (isAr ? 'ملف PDF' : 'PDF Document')) + '</small>',
          '    <div class="inline">',
          '      <a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer" class="secondary">' + esc(isAr ? "فتح PDF ↗" : "Open PDF ↗") + '</a>',
          '    </div>',
          '  </div>',
          '</article>'
        ].join("\n");
      }).join("\n");

      container.innerHTML = [
        '<div class="resource-collections">',
        '  <div class="dialog-head">',
        '    <div><h2 style="margin:0;">' + esc(State.t("yourResourceShelf")) + '</h2><p style="margin:4px 0 0;color:var(--muted);">' + pdfs.length + ' ' + esc(isAr ? "ملف PDF مرتب حسب نوع المذاكرة" : "PDF files organized by study stage") + '</p></div>',
             activeCollection !== "all" ? '<button type="button" class="quiet" id="resetShelfFilterBtn">' + esc(isAr ? "عرض الكل" : "Show all") + ' (' + pdfs.length + ')</button>' : '',
        '  </div>',
        pdfs.length ? '<div class="shelf-collections-grid">' + shelfCards + '</div>' : '',
        visiblePdfs.length
          ? '<div class="resource-file-list">' + pdfHtml + '</div>'
          : '<div class="empty-state">' + esc(pdfs.length ? (isAr ? "مفيش ملفات في القسم ده — اختار قسم تاني فوق." : "No PDFs in this category filter — click another collection above.") : (isAr ? "مفيش ملفات PDF مضافة للمادة دي لسه." : "No PDF files attached to this course yet.")) + '</div>',
        '</div>'
      ].join("\n");

      if (!container.dataset.resourcesBound) {
        container.dataset.resourcesBound = "1";
        container.addEventListener("click", function (e) {
          var colBtn = e.target.closest("[data-shelf-col]");
          if (colBtn && container.contains(colBtn)) {
            var k = colBtn.getAttribute("data-shelf-col");
            activeCollection = activeCollection === k ? "all" : k;
            paint();
            return;
          }
          var resetBtn = e.target.closest("#resetShelfFilterBtn");
          if (resetBtn && container.contains(resetBtn)) {
            activeCollection = "all";
            paint();
          }
        });
      }
    }

    paint();
  }

  function renderVideosView(container, catalog, subj) {
    var State = root.ElgoState;
    var isAr = root.ElgoTheme && typeof root.ElgoTheme.getLang === "function" && root.ElgoTheme.getLang() === "ar";
    var videos = State.getVideos(subj.id);

    if (!videos.length) {
      container.innerHTML = '<div class="empty-state">' + esc(isAr ? "مفيش فيديوهات شرح مضافة للمادة دي لسه." : "No walkthrough videos added for this course yet.") + '</div>';
      return;
    }

    var videoHtml = videos.map(function (vid, i) {
      var href = vid.youtubeUrl || vid.url || "#";
      return [
        '<article class="resource-file is-video">',
        vid.thumbnail ? '<img class="video-thumb" src="' + esc(vid.thumbnail) + '" alt="' + esc(vid.title) + '" loading="lazy">' : '',
        '  <div>',
        '    <span class="source-kind-tag">' + esc(isAr ? "فيديو" : "Video") + (vid.topic ? " · " + esc(vid.topic) : "") + '</span>',
        '    <h3 style="margin:8px 0 4px;font-size:0.98rem;">' + esc(vid.title || vid.id) + '</h3>',
             vid.description ? '<p style="margin:0;font-size:0.84rem;color:var(--muted);">' + esc(vid.description) + '</p>' : '',
        '  </div>',
        '  <div class="inline" style="justify-content:space-between;">',
        '    <button type="button" class="primary video-play-btn" data-play-vid="' + i + '">' + esc(isAr ? "▶ تشغيل هنا" : "▶ Watch here") + '</button>',
        '    <a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer" class="secondary">' + esc(isAr ? "يوتيوب ↗" : "YouTube ↗") + '</a>',
        '  </div>',
        '</article>'
      ].join("\n");
    }).join("\n");

    container.innerHTML = [
      '<div class="resource-collections">',
      '  <div class="dialog-head">',
      '    <div><h2 style="margin:0;">' + esc(State.t("yourVideosShelf")) + '</h2><p style="margin:4px 0 0;color:var(--muted);">' + videos.length + ' ' + esc(isAr ? "فيديو شرح" : ("walkthrough video" + (videos.length === 1 ? "" : "s"))) + '</p></div>',
      '  </div>',
      '  <div class="resource-file-list">' + videoHtml + '</div>',
      '</div>'
    ].join("\n");

    container._boundVideos = videos;
    if (!container.dataset.videosBound) {
      container.dataset.videosBound = "1";
      container.addEventListener("click", function (e) {
        var playBtn = e.target.closest("[data-play-vid]");
        if (playBtn && container.contains(playBtn)) {
          var list = container._boundVideos || videos;
          var v = list[Number(playBtn.getAttribute("data-play-vid"))];
          if (v) openVideoPreview(v);
        }
      });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* MAIN ENTRYPOINT: ElgoHub.render(container, params)                     */
  /* ---------------------------------------------------------------------- */
  async function render(container, params) {
    var State = root.ElgoState;
    var Model = root.ElgoModel;
    if (!container || !State || !Model) return;

    var catalog = State.getCatalog() || await State.loadCatalog();
    var subjectId = params && params.get("subject");
    var view = (params && params.get("view")) || "hub";

    if (!subjectId) {
      await renderHomeGarden(container, catalog, params);
      return;
    }

    var subj = Model.getSubject(catalog, subjectId);
    if (!subj) {
      await renderHomeGarden(container, catalog, params);
      return;
    }

    var subjIndex = Model.listSubjects(catalog).findIndex(function (s) { return s.id === subj.id; });
    var emblemAccent = COURSE_ACCENTS[(subjIndex >= 0 ? subjIndex : 0) % COURSE_ACCENTS.length];
    var pdfCount = State.getPdfs(subj.id).length;
    var videoCount = State.getVideos(subj.id).length;
    var viewLabel = view === "sources"
      ? State.t("tabQuestions")
      : view === "learn"
        ? State.t("tabLectures")
        : view === "resources"
          ? State.t("tabResources")
          : view === "videos"
            ? State.t("tabVideos")
            : State.t("tabOverview");

    container.innerHTML = [
      '<nav class="breadcrumbs" aria-label="Course Breadcrumbs">',
      '  <button type="button" id="crumbHomeBtn">' + esc(State.t("backCourses")) + '</button>',
      '  <span aria-hidden="true">/</span>',
         view === "hub"
           ? '<span>' + esc(State.getSubjectName(subj)) + '</span>'
           : '<button type="button" id="crumbCourseBtn">' + esc(State.getSubjectName(subj)) + '</button><span aria-hidden="true">/</span><span>' + esc(viewLabel) + '</span>',
      '</nav>',
      '<section class="workspace-head">',
      '  <div class="inline workspace-lead" style="align-items:flex-start;gap:14px;">',
      '    <div class="course-emblem" style="--emblem:' + emblemAccent + '">' + courseSvgEmblem(subjIndex, subj.id) + '</div>',
      '    <div>',
      '      <h1>' + esc(State.getSubjectName(subj)) + '</h1>',
      subj.description ? '<p class="workspace-desc">' + esc(subj.description) + '</p>' : '',
      '      <p class="workspace-meta" style="margin-top:6px;font-size:0.84rem;color:var(--accent-text);font-weight:700;">' + esc(formatCourseMeta(subj)) + '</p>',
      '    </div>',
      '  </div>',
      '  <div class="course-tabs-bar" role="tablist">',
      '    <button type="button" class="course-tab-btn' + (view === "hub" ? " is-active" : "") + '" data-course-tab="hub">' + esc(State.t("tabOverview")) + '</button>',
      '    <button type="button" class="course-tab-btn' + (view === "sources" ? " is-active" : "") + '" data-course-tab="sources">' + esc(State.t("tabQuestions")) + '</button>',
      '    <button type="button" class="course-tab-btn' + (view === "learn" ? " is-active" : "") + '" data-course-tab="learn">' + esc(State.t("tabLectures")) + '</button>',
      '    <button type="button" class="course-tab-btn' + (view === "resources" ? " is-active" : "") + '" data-course-tab="resources">' + esc(State.t("tabResources")) + (pdfCount ? ' (' + pdfCount + ')' : '') + '</button>',
      '    <button type="button" class="course-tab-btn' + (view === "videos" ? " is-active" : "") + '" data-course-tab="videos">' + esc(State.t("tabVideos")) + (videoCount ? ' (' + videoCount + ')' : '') + '</button>',
      '  </div>',
      '</section>',
      '<div id="courseWorkspaceBody"></div>'
    ].join("\n");

    container.querySelector("#crumbHomeBtn").addEventListener("click", function () {
      root.ElgoRouter.navigate("/?flow=hub");
    });

    var crumbCourse = container.querySelector("#crumbCourseBtn");
    if (crumbCourse) {
      crumbCourse.addEventListener("click", function () {
        root.ElgoRouter.navigate("/?flow=hub&subject=" + encodeURIComponent(subj.id));
      });
    }

    container.querySelectorAll("[data-course-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var nextView = btn.getAttribute("data-course-tab");
        var url = "/?flow=hub&subject=" + encodeURIComponent(subj.id) + (nextView === "hub" ? "" : "&view=" + encodeURIComponent(nextView));
        root.ElgoRouter.navigate(url);
      });
    });

    var body = container.querySelector("#courseWorkspaceBody");
    if (view === "sources") {
      renderSourcesView(body, catalog, subj);
    } else if (view === "learn") {
      await renderLearnView(body, catalog, subj);
    } else if (view === "resources") {
      renderResourcesView(body, catalog, subj);
    } else if (view === "videos") {
      renderVideosView(body, catalog, subj);
    } else {
      renderCourseHubOverview(body, catalog, subj);
    }
  }

  root.ElgoHub = { render: render };
})(typeof window !== "undefined" ? window : globalThis);
