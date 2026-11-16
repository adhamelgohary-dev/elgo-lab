(function (root) {
  "use strict";

  var STATE_KEY = "elgo_app_state_v1";
  var AUTH_KEY = "elgo_user_auth_v1";
  var CATALOG_PREFS_KEY = "elgo_catalog_prefs_v1";

  var LEGACY_AUTH_KEY = "mcq_bank_user_auth_v1";
  var LEGACY_BOOKMARKS_KEY = "mcq_bank_bookmarks_v1";
  var LEGACY_MISTAKES_KEY = "mcq_bank_mistakes_v1";
  var LEGACY_ATTEMPT_KEY = "mcq_bank_attempt_log_v1";

  var rawCatalogCache = null;
  var catalogCache = null;
  var catalogPromise = null;
  var overridesLoaded = false;
  var catalogManager = null;
  var contentLibrary = null;
  var onlineClient = null;
  var subjectCache = new Map();
  var explanationsCache = new Map();
  var publicOverridesCache = {
    subjectNames: {},
    quizNames: {},
    siteSettings: {},
    contentOverrides: null,
    dynamicCatalog: {
      customSubjects: {},
      deletedSubjectIds: [],
      customQuizzes: [],
      deletedQuizKeys: [],
    },
  };

  var I18N = {
    en: {
      brand: "elgo lab.",
      courses: "Courses",
      saved: "Saved",
      mistakes: "Mistakes",
      leaderboard: "Leaderboard",
      more: "More",
      search: "Search",
      searchTitle: "Quick search — courses, lectures, banks & files",
      searchPlaceholder: "Search courses, lectures, PDFs, videos, or banks...",
      daylight: "Daylight",
      evening: "Evening",
      langToggle: "عربي",
      guestTag: "Guest",
      signIn: "Sign in",
      rankedQuizzes: "Ranked quizzes",
      keepProgress: "Keep progress across devices",
      settingsProfile: "Settings & profile",
      facultyTerm: "Faculty & term",
      pauseMotion: "Pause motion",
      resumeMotion: "Resume motion",
      adminAccess: "Admin access",
      aboutElgo: "About elgo lab",
      teamTitle: "Project creator",
      heroEyebrow: "A LITTLE FOCUS GOES A LONG WAY",
      heroTitleStart: "Pick your next subject",
      heroTitleAccent: ".",
      heroSub: "Practice a little. Understand a little more.",
      mascotCaption: "",
      yourCourses: "Your courses",
      homeReadyMeta: "subjects · Ready to explore",
      homeBottomTagline: "One home for your questions, explanations & files.",
      openCourse: "Open course",
      courseHubEyebrow: "STEP-BY-STEP COURSE HUB · PICK WHAT YOU NEED",
      practiceTitle: "Solve Questions & Exams",
      practiceKicker: "Questions",
      practiceDesc: "Pick any lecture bank or sheet, choose Study (questions with answers), Test (ranked), or Practice (instant check).",
      learnTitle: "Lecture Explanations",
      learnKicker: "Lectures",
      learnDesc: "Read bilingual EN/AR summaries, formula sheets, and step-by-step concept breakdowns.",
      resourcesTitle: "PDFs & Study Files",
      resourcesKicker: "PDFs & Files",
      resourcesDesc: "Browse lecture slides, quick summaries, and exam revision sheets organized cleanly.",
      videosTitle: "Walkthrough Videos",
      videosKicker: "Videos",
      videosDesc: "Watch curated lecture walkthrough videos directly inside the course or open on YouTube.",
      tabOverview: "Overview",
      tabQuestions: "Solve Questions",
      tabLectures: "Lecture Notes",
      tabResources: "PDFs & Files",
      tabVideos: "Videos",
      buildPractice: "Build your practice session",
      chooseSourceSub: "Follow two simple steps: pick one or more question banks on the left, then pick how you want to solve on the right.",
      yourSession: "Your session",
      yourResourceShelf: "PDFs & Study Files",
      yourVideosShelf: "Walkthrough Videos",
      studyMode: "Study",
      studyTag: "(Questions with answers)",
      testMode: "Test",
      testTag: "(Timed exam + Leaderboard)",
      practiceMode: "Practice",
      practiceTag: "(Instant check)",
      studyHint: "Best for learning: reads every question with the verified answer & explanation already open.",
      testHint: "Timed exam mode. Solving a single bank in Test mode records your score on the Leaderboard.",
      practiceHint: "Interactive self-test: answer each question yourself and see right/wrong + explanation immediately.",
      startSession: "Start session",
      allSources: "All sources",
      banksQuizzes: "Banks & quizzes",
      sheets: "Sheets",
      lecturePractice: "Lecture practice",
      selectVisible: "Select visible",
      clearSelection: "Clear selection",
      backCourses: "All courses",
      backToHub: "Course hub",
      submitExam: "Finish exam",
      nextQuestion: "Next →",
      prevQuestion: "← Previous",
      flagQuestion: "Flag",
      bookmarkQuestion: "Save ★",
      reportIssue: "Report",
      studyCheckAnswer: "Verified answer",
      correct: "Correct!",
      incorrect: "Not quite right",
      entryHeading: "What should we call you?",
      entrySubEn: "Pick a name for your study session and ranked leaderboard standing.",
      entrySubAr: "اختار اسم نبدأ بيه جلسة المذاكرة والترتيب.",
      onlineLabel: "online",
      exitLabel: "← Exit",
      finishStudy: "Finish Study",
      flaggedLabel: "Flagged",
      savedLabel: "Saved ★",
      questionLabel: "Question",
      ofLabel: "of",
      answeredLabel: "Answered",
      keyRuleLabel: "Key Rule",
      memoryTrickLabel: "Memory Trick",
      whyMisleadLabel: "Why other options can mislead you",
      unkeyedNotice: "✓ Recorded (Unkeyed university bank item)",
      correctAnswerIs: "Correct answer is",
      modeStudyPill: "STUDY · Questions with answers",
      modePracticePill: "PRACTICE · Instant check",
      modeTestPill: "TEST · Exam mode",
      savedHeading: "Saved Questions",
      savedDesc: "Bookmarked questions from every course, ready for instant targeted revision.",
      clearAll: "Clear All",
      deleteLabel: "Delete",
      allCourses: "All Courses",
      practiceSaved: "Practice Saved",
      smartReviewDesc: "Smart Review Deck — track missed questions, read explanations, and resolve mastered items.",
      unresolvedLabel: "Unresolved",
      resolvedLabel: "Resolved",
      allLabel: "All",
      resolveLabel: "Resolve ✓",
      reopenLabel: "Reopen ↺",
      leaderboardHeading: "Ranked Leaderboard",
      leaderboardDesc: "Verified ranked Test submissions ordered by XP, best accuracy, then fastest completion.",
      loadingRankings: "Loading live rankings...",
      allSubjectsLabel: "All Subjects (Global Ranking)",
      searchStudentsPlaceholder: "Search student username...",
      studentAccountHeading: "Student Account & Progress",
      appearanceLanguageHeading: "Appearance & Language",
      offlineSyncHeading: "Offline & Cloud Sync",
      syncPendingBtn: "Retry Pending Uploads",
      exportProgressBtn: "Export Study JSON",
      clearLocalBtn: "Reset Local Data",
    },
    ar: {
      brand: "elgo lab.",
      courses: "المواد",
      saved: "المحفوظ",
      mistakes: "الأخطاء",
      leaderboard: "المتصدرين",
      more: "المزيد",
      search: "بحث",
      searchTitle: "بحث سريع — مواد، محاضرات، بنوك وملفات",
      searchPlaceholder: "دوّر في المواد، المحاضرات، الـ PDFs، الفيديوهات، أو البنوك...",
      daylight: "نهاري",
      evening: "مسائي",
      langToggle: "EN",
      guestTag: "زائر",
      signIn: "تسجيل الدخول",
      rankedQuizzes: "اختبارات الترتيب",
      keepProgress: "احفظ تقدمك بين الأجهزة",
      settingsProfile: "الإعدادات والحساب",
      facultyTerm: "الكلية والترم",
      pauseMotion: "إيقاف الحركة",
      resumeMotion: "تشغيل الحركة",
      adminAccess: "بوابة الأدمن",
      aboutElgo: "عن elgo lab",
      teamTitle: "مطور المنصة",
      heroEyebrow: "خطوة صغيرة بتفرق",
      heroTitleStart: "هنذاكر أنهي مادة",
      heroTitleAccent: "؟",
      heroSub: "حل شوية، وافهم أكتر.",
      mascotCaption: "",
      yourCourses: "موادك",
      homeReadyMeta: "مواد · جاهزة للاستكشاف",
      homeBottomTagline: "مكان واحد للأسئلة والشرح والملفات.",
      openCourse: "افتح المادة",
      courseHubEyebrow: "دليل المادة السريع · اختار اللي محتاجه في ثواني",
      practiceTitle: "حل الأسئلة والامتحانات",
      practiceKicker: "الأسئلة",
      practiceDesc: "اختار أي محاضرة أو شيت أو بنك، وحدد وضع المذاكرة (أسئلة بإجاباتها) أو الاختبار أو التدريب الفوري.",
      learnTitle: "شروحات المحاضرات",
      learnKicker: "الشرح",
      learnDesc: "ملخصات ثنائية اللغة، قوانين مهمة، وشرح مبسط خطوة بخطوة.",
      resourcesTitle: "ملفات PDF والملخصات",
      resourcesKicker: "ملفات PDF",
      resourcesDesc: "نزّل سلايدات المحاضرات، الملخصات السريعة، وشيتات المراجعة بسهولة.",
      videosTitle: "فيديوهات الشرح",
      videosKicker: "الفيديوهات",
      videosDesc: "شاهد فيديوهات شرح المحاضرات مباشرة جوه المنصة أو افتحها على يوتيوب.",
      tabOverview: "نظرة عامة",
      tabQuestions: "حل الأسئلة",
      tabLectures: "شرح المحاضرات",
      tabResources: "ملفات PDF",
      tabVideos: "الفيديوهات",
      buildPractice: "كوّن جلسة الأسئلة",
      chooseSourceSub: "خطوتين بس: اختار بنك أو محاضرة من هنا، وبعدين اختار طريقة الحل المناسبة ليك.",
      yourSession: "جلستك",
      yourResourceShelf: "ملفات PDF والملخصات",
      yourVideosShelf: "فيديوهات شرح المادة",
      studyMode: "مذاكرة",
      studyTag: "(أسئلة بالإجابات)",
      testMode: "اختبار",
      testTag: "(امتحان بوقت + متصدرين)",
      practiceMode: "تدريب",
      practiceTag: "(تصحيح فوري)",
      studyHint: "أحسن لو بتذاكر لأول مرة: بيعرضلك السؤال بالإجابة الصحيحة والشرح فوراً.",
      testHint: "وضع امتحان حقيقي بوقت. حل بنك لوحده بيتحسب في لوحة المتصدرين.",
      practiceHint: "اختبر نفسك بنفسك: جاوب واعرف إجابتك صح ولا غلط والشرح في ساعتها.",
      startSession: "ابدأ الجلسة",
      allSources: "كل المصادر",
      banksQuizzes: "بنوك وامتحانات",
      sheets: "الشيتات",
      lecturePractice: "أسئلة المحاضرات",
      selectVisible: "اختار الظاهر",
      clearSelection: "مسح التحديد",
      backCourses: "كل المواد",
      backToHub: "مركز المادة",
      submitExam: "إنهاء الاختبار",
      nextQuestion: "التالي ←",
      prevQuestion: "→ السابق",
      flagQuestion: "تمييز",
      bookmarkQuestion: "حفظ ★",
      reportIssue: "إبلاغ",
      studyCheckAnswer: "الإجابة الصحيحة",
      correct: "إجابة صحيحة!",
      incorrect: "إجابة غير دقيقة",
      entryHeading: "تحب نناديك بـ إيه؟",
      entrySubEn: "Pick a name for your study session and ranked leaderboard standing.",
      entrySubAr: "اختار اسم نبدأ بيه جلسة المذاكرة والترتيب.",
      onlineLabel: "متصل",
      exitLabel: "خروج →",
      finishStudy: "إنهاء المذاكرة",
      flaggedLabel: "مميز",
      savedLabel: "محفوظ ★",
      questionLabel: "سؤال",
      ofLabel: "من",
      answeredLabel: "تم حله",
      keyRuleLabel: "القاعدة الأساسية",
      memoryTrickLabel: "معلومة للحفظ",
      whyMisleadLabel: "ليه باقي الاختيارات ممكن تلخبطك",
      unkeyedNotice: "✓ مسجّل (سؤال بدون مفتاح إجابة رسمي)",
      correctAnswerIs: "الإجابة الصحيحة هي",
      modeStudyPill: "مذاكرة · أسئلة بالإجابات",
      modePracticePill: "تدريب · تصحيح فوري",
      modeTestPill: "اختبار · وضع امتحان",
      savedHeading: "الأسئلة المحفوظة",
      savedDesc: "الأسئلة اللي حفظتها من كل المواد جاهزة للمراجعة السريعة.",
      clearAll: "مسح الكل",
      deleteLabel: "حذف",
      allCourses: "كل المواد",
      practiceSaved: "حل المحفوظ",
      smartReviewDesc: "مذكرة المراجعة الذكية — راجع أخطاءك واقرأ الشرح وحدد الأسئلة اللي اتقنتها.",
      unresolvedLabel: "غير محلولة",
      resolvedLabel: "تم إتقانها",
      allLabel: "الكل",
      resolveLabel: "تم الإتقان ✓",
      reopenLabel: "إعادة للمراجعة ↺",
      leaderboardHeading: "لوحة المتصدرين",
      leaderboardDesc: "نتائج الاختبارات المعتمدة مرتبة حسب نقاط XP ثم الدقة ثم أسرع وقت.",
      loadingRankings: "جاري تحميل الترتيب المباشر...",
      allSubjectsLabel: "كل المواد (الترتيب العام)",
      searchStudentsPlaceholder: "ابحث باسم الطالب...",
      studentAccountHeading: "حساب الطالب والتقدم",
      appearanceLanguageHeading: "المظهر واللغة",
      offlineSyncHeading: "المزامنة والنسخ الاحتياطي",
      syncPendingBtn: "إعادة رفع المحاولات المعلقة",
      exportProgressBtn: "تصدير التقدم (JSON)",
      clearLocalBtn: "مسح البيانات المحلية",
    },
  };

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
      // Ignore quota or storage lock errors
    }
  }

  function removeStorage(key) {
    try {
      var st = getStorage();
      if (st) {
        st.removeItem(key);
      }
    } catch (_err) {
      // Ignore
    }
  }

  function safeJsonParse(raw, fallback) {
    if (!raw || typeof raw !== "string") return fallback;
    try {
      return JSON.parse(raw);
    } catch (_err) {
      return fallback;
    }
  }

  function t(key) {
    var lang = root.ElgoTheme && typeof root.ElgoTheme.getLang === "function" ? root.ElgoTheme.getLang() : "en";
    var dict = I18N[lang] || I18N.en;
    return dict[key] != null ? dict[key] : (I18N.en[key] != null ? I18N.en[key] : key);
  }

  function readLegacyStateSeed() {
    var bookmarks = safeJsonParse(readStorage(LEGACY_BOOKMARKS_KEY), []);
    var mistakesObj = safeJsonParse(readStorage(LEGACY_MISTAKES_KEY), null);
    var attempts = safeJsonParse(readStorage(LEGACY_ATTEMPT_KEY), []);
    var mistakes = [];
    if (Array.isArray(mistakesObj)) {
      mistakes = mistakesObj;
    } else if (mistakesObj && typeof mistakesObj === "object") {
      mistakes = Object.values(mistakesObj);
    }
    return {
      bookmarks: Array.isArray(bookmarks) ? bookmarks : [],
      mistakes: mistakes,
      attempts: Array.isArray(attempts) ? attempts : [],
    };
  }

  var lastMutationMs = 0;
  var localMutationSeq = 0;
  var progressSyncTimer = null;
  var progressSyncInFlight = null;
  var syncRetryTimer = null;
  var syncRetryAttempts = 0;
  var refreshSessionInFlight = null;
  var lastCloudPullAt = 0;
  var cloudPullInFlight = null;
  var legacySeedMergedThisLoad = false;
  var lastCloudSyncStatus = { ok: true, at: 0, status: 0, error: "", offline: false };

  function setLastSyncStatus(patch) {
    lastCloudSyncStatus = Object.assign({
      ok: true,
      at: Date.now(),
      status: 0,
      error: "",
      offline: false,
    }, patch || {}, { at: Date.now() });
  }

  function getSyncStatus() {
    return Object.assign({}, lastCloudSyncStatus);
  }

  function warnSyncFailure(label, errMsg, status) {
    try {
      if (typeof console !== "undefined" && typeof console.warn === "function") {
        console.warn("[ElgoSync]", label, status ? ("HTTP " + status) : "", errMsg || "");
      }
    } catch (_e) { /* ignore */ }
  }

  function parseIsoMsClient(val) {
    if (!val || typeof val !== "string") return 0;
    var ms = Date.parse(val);
    return Number.isFinite(ms) ? ms : 0;
  }

  function observeMutationIso(val) {
    var ms = parseIsoMsClient(val);
    var maxReasonable = Date.now() + 3600000;
    if (ms > lastMutationMs && ms <= maxReasonable) {
      lastMutationMs = ms;
    }
  }

  function nextMutationIso() {
    var now = Date.now();
    var minMs = 0;
    for (var i = 0; i < arguments.length; i++) {
      var candidate = parseIsoMsClient(arguments[i]);
      if (candidate > minMs) minMs = candidate;
    }
    var next = Math.max(now, lastMutationMs + 1, minMs + 1);
    lastMutationMs = next;
    return new Date(next).toISOString();
  }

  function trimTimestampMapClient(src, maxEntries) {
    if (!src || typeof src !== "object" || Array.isArray(src)) return {};
    var limit = maxEntries || 500;
    var entries = Object.entries(src).filter(function (pair) {
      return pair[0] && typeof pair[1] === "string" && parseIsoMsClient(pair[1]) > 0;
    });
    if (entries.length > limit) {
      entries.sort(function (a, b) { return parseIsoMsClient(b[1]) - parseIsoMsClient(a[1]); });
      entries.length = limit;
    }
    var out = {};
    entries.forEach(function (pair) { out[pair[0]] = pair[1]; });
    return out;
  }

  function getState() {
    var raw = readStorage(STATE_KEY);
    var parsed = safeJsonParse(raw, null);
    if (!parsed || typeof parsed !== "object") {
      var legacy = readLegacyStateSeed();
      legacySeedMergedThisLoad = true;
      return {
        selectedSourcesBySubject: {},
        bookmarks: legacy.bookmarks,
        deletedBookmarks: {},
        mistakes: legacy.mistakes,
        deletedMistakes: {},
        mistakesClearedAt: null,
        attemptHistory: legacy.attempts,
        activeSession: null,
        lastAttempt: null,
        quizModes: {},
        ownerStudentId: "",
        ownerUsername: "",
        pendingProgressSync: legacy.bookmarks.length > 0 || legacy.mistakes.length > 0,
        legacyMerged: true,
      };
    }
    var stateObj = Object.assign({
      selectedSourcesBySubject: {},
      bookmarks: [],
      deletedBookmarks: {},
      mistakes: [],
      deletedMistakes: {},
      mistakesClearedAt: null,
      attemptHistory: [],
      activeSession: null,
      lastAttempt: null,
      quizModes: {},
      ownerStudentId: "",
      ownerUsername: "",
      pendingProgressSync: false,
    }, parsed);

    if (!legacySeedMergedThisLoad && !parsed.legacyMerged) {
      legacySeedMergedThisLoad = true;
      var leg = readLegacyStateSeed();
      var addedLegacy = false;
      if (leg.bookmarks.length) {
        var existingBm = new Set((Array.isArray(stateObj.bookmarks) ? stateObj.bookmarks : []).map(function (b) {
          return b && (b.internalId || b.id || "");
        }).filter(Boolean));
        var delBm = stateObj.deletedBookmarks && typeof stateObj.deletedBookmarks === "object" ? stateObj.deletedBookmarks : {};
        leg.bookmarks.forEach(function (lb) {
          var key = lb && (lb.internalId || lb.id || lb.questionId || "");
          if (!key || existingBm.has(key)) return;
          var delIso = delBm[key] || (lb.id ? delBm[lb.id] : "") || (lb.internalId ? delBm[lb.internalId] : "");
          if (delIso && parseIsoMsClient(delIso) >= parseIsoMsClient(lb.savedAt)) return;
          existingBm.add(key);
          stateObj.bookmarks.push(lb);
          addedLegacy = true;
        });
      }
      if (leg.mistakes.length) {
        var existingMk = new Set((Array.isArray(stateObj.mistakes) ? stateObj.mistakes : []).map(function (m) {
          return m && (m.internalId || m.id || m.questionId || "");
        }).filter(Boolean));
        var delMk = stateObj.deletedMistakes && typeof stateObj.deletedMistakes === "object" ? stateObj.deletedMistakes : {};
        var clearedMs = parseIsoMsClient(stateObj.mistakesClearedAt);
        leg.mistakes.forEach(function (lm) {
          var key = lm && (lm.internalId || lm.id || lm.questionId || "");
          if (!key || existingMk.has(key)) return;
          var itemMs = Math.max(parseIsoMsClient(lm.updatedAt), parseIsoMsClient(lm.lastAttemptedAt), parseIsoMsClient(lm.resolvedAt));
          if (Math.max(parseIsoMsClient(delMk[key]), clearedMs) > itemMs) return;
          existingMk.add(key);
          stateObj.mistakes.push(lm);
          addedLegacy = true;
        });
      }
      if (addedLegacy) {
        stateObj.legacyMerged = true;
        stateObj.pendingProgressSync = true;
        saveState(stateObj);
      }
    }
    return stateObj;
  }

  function saveState(next) {
    writeStorage(STATE_KEY, JSON.stringify(next || {}));
    return next;
  }

  function getSelectedSources(subjectId) {
    var st = getState();
    var map = st.selectedSourcesBySubject || {};
    return Array.isArray(map[subjectId]) ? map[subjectId].slice() : [];
  }

  function setSelectedSources(subjectId, sourceIds) {
    var st = getState();
    st.selectedSourcesBySubject = Object.assign({}, st.selectedSourcesBySubject || {});
    st.selectedSourcesBySubject[subjectId] = Array.isArray(sourceIds) ? sourceIds.slice() : [];
    saveState(st);
    return st.selectedSourcesBySubject[subjectId];
  }

  function getAuth() {
    var raw = readStorage(AUTH_KEY) || readStorage(LEGACY_AUTH_KEY);
    var parsed = safeJsonParse(raw, null);
    if (!parsed || typeof parsed !== "object" || !parsed.token || !parsed.profile) {
      return null;
    }
    return parsed;
  }

  function setAuth(authObj) {
    if (!authObj || !authObj.token) {
      removeStorage(AUTH_KEY);
      removeStorage(LEGACY_AUTH_KEY);
      if (typeof document !== "undefined" && typeof document.dispatchEvent === "function" && typeof root.CustomEvent === "function") {
        document.dispatchEvent(new root.CustomEvent("elgo:authchange"));
      }
      return null;
    }
    writeStorage(AUTH_KEY, JSON.stringify(authObj));
    if (typeof document !== "undefined" && typeof document.dispatchEvent === "function" && typeof root.CustomEvent === "function") {
      document.dispatchEvent(new root.CustomEvent("elgo:authchange"));
    }
    return authObj;
  }

  function authHeaders(extra) {
    var headers = Object.assign({}, extra || {});
    var auth = getAuth();
    if (auth && auth.token) {
      headers.Authorization = "Bearer " + auth.token;
    }
    return headers;
  }

  function hasLocalUnsyncedItems(st, cloudProg) {
    if (!st || typeof st !== "object") return false;
    var localBm = Array.isArray(st.bookmarks) ? st.bookmarks : [];
    var localMk = Array.isArray(st.mistakes) ? st.mistakes : [];
    var localAtt = Array.isArray(st.attemptHistory) ? st.attemptHistory : [];
    var localDelBm = st.deletedBookmarks && typeof st.deletedBookmarks === "object" ? Object.keys(st.deletedBookmarks) : [];
    var localDelMk = st.deletedMistakes && typeof st.deletedMistakes === "object" ? Object.keys(st.deletedMistakes) : [];
    if (!localBm.length && !localMk.length && !localAtt.length && !localDelBm.length && !localDelMk.length && !st.mistakesClearedAt) {
      return false;
    }
    if (!cloudProg || typeof cloudProg !== "object") return true;
    var cloudBmById = {};
    (Array.isArray(cloudProg.bookmarks) ? cloudProg.bookmarks : []).forEach(function (b) {
      var cid = b && (b.internalId || b.id || b.questionId || "");
      if (cid) cloudBmById[cid] = b;
    });
    for (var i = 0; i < localBm.length; i++) {
      var lb = localBm[i];
      var bid = lb && (lb.internalId || lb.id || lb.questionId || "");
      if (!bid) continue;
      var cb = cloudBmById[bid];
      if (!cb) return true;
      if (parseIsoMsClient(lb.savedAt) > parseIsoMsClient(cb.savedAt)) return true;
      if (lb.subjectId && !cb.subjectId) return true;
    }
    var rawCloudMk = Array.isArray(cloudProg.mistakes)
      ? cloudProg.mistakes
      : (cloudProg.mistakes && Array.isArray(cloudProg.mistakes.items) ? cloudProg.mistakes.items : []);
    var cloudMkById = {};
    rawCloudMk.forEach(function (m) {
      var mid = m && (m.internalId || m.id || m.questionId || "");
      if (mid) cloudMkById[mid] = m;
    });
    for (var j = 0; j < localMk.length; j++) {
      var lm = localMk[j];
      var lmid = lm && (lm.internalId || lm.id || "");
      if (!lmid) continue;
      var cm = cloudMkById[lmid];
      if (!cm) return true;
      var lmTime = Math.max(parseIsoMsClient(lm.updatedAt), parseIsoMsClient(lm.resolvedAt));
      var cmTime = Math.max(parseIsoMsClient(cm.updatedAt), parseIsoMsClient(cm.lastAttemptedAt), parseIsoMsClient(cm.resolvedAt));
      if (lmTime > cmTime) return true;
    }
    var cloudDelBm = cloudProg.deletedBookmarks && typeof cloudProg.deletedBookmarks === "object" ? cloudProg.deletedBookmarks : {};
    for (var d1 = 0; d1 < localDelBm.length; d1++) {
      var dk1 = localDelBm[d1];
      if (parseIsoMsClient(st.deletedBookmarks[dk1]) > parseIsoMsClient(cloudDelBm[dk1])) return true;
    }
    var cloudDelMk = cloudProg.deletedMistakes && typeof cloudProg.deletedMistakes === "object" ? cloudProg.deletedMistakes : {};
    for (var d2 = 0; d2 < localDelMk.length; d2++) {
      var dk2 = localDelMk[d2];
      if (parseIsoMsClient(st.deletedMistakes[dk2]) > parseIsoMsClient(cloudDelMk[dk2])) return true;
    }
    if (parseIsoMsClient(st.mistakesClearedAt) > parseIsoMsClient(cloudProg.mistakesClearedAt)) return true;
    return false;
  }

  async function refreshSession() {
    var auth = getAuth();
    if (!auth || !auth.token) return null;
    if (refreshSessionInFlight) return refreshSessionInFlight;
    refreshSessionInFlight = (async function () {
      try {
        lastCloudPullAt = Date.now();
        var res = await fetch("/api/auth/me", {
          headers: authHeaders(),
          cache: "no-store",
        });
        if (res.status === 401) {
          setLastSyncStatus({ ok: false, status: 401, error: "Session expired — please sign in again.", offline: false });
          warnSyncFailure("refreshSession", "Session expired", 401);
          setAuth(null);
          return null;
        }
        var data = await res.json().catch(function () { return null; });
        if (res.ok && data && data.ok && data.profile) {
          var next = Object.assign({}, auth, { profile: data.profile });
          var cloudProg = data.profile.progress && typeof data.profile.progress === "object" ? data.profile.progress : null;
          var prevSt = getState();
          var differentOwner = Boolean(prevSt.ownerStudentId && data.profile.studentId && prevSt.ownerStudentId !== data.profile.studentId);
          var needPush = !differentOwner && (Boolean(prevSt.pendingProgressSync) || hasLocalUnsyncedItems(prevSt, cloudProg));
          var progressChanged = false;
          if (cloudProg) {
            progressChanged = applyCloudProgress(cloudProg, {
              studentId: data.profile.studentId || "",
              username: data.profile.username || "",
              replace: differentOwner,
            });
          }
          setAuth(next);
          if (needPush) {
            var pushRes = await syncProgressToCloud({ force: true }).catch(function () { return null; });
            if (pushRes && pushRes.changed) progressChanged = true;
          } else {
            setLastSyncStatus({ ok: true, status: res.status || 200, error: "", offline: false });
          }
          if (progressChanged && typeof document !== "undefined" && typeof document.dispatchEvent === "function" && typeof root.CustomEvent === "function") {
            document.dispatchEvent(new root.CustomEvent("elgo:progresschange"));
          }
          return next;
        }
        var pullErr = (data && data.error) || ("Failed to load cloud session (HTTP " + res.status + ")");
        setLastSyncStatus({ ok: false, status: res.status || 0, error: pullErr, offline: false });
        warnSyncFailure("refreshSession", pullErr, res.status || 0);
      } catch (err) {
        var netErr = (err && err.message) ? err.message : "Network error while loading cloud progress";
        setLastSyncStatus({ ok: false, status: 0, error: netErr, offline: true });
        warnSyncFailure("refreshSession", netErr, 0);
      }
      return auth;
    })().finally(function () {
      refreshSessionInFlight = null;
    });
    return refreshSessionInFlight;
  }

  function normalizeCatalogData(raw) {
    if (root.ElgoModel && typeof root.ElgoModel.normalizeCatalog === "function") {
      return root.ElgoModel.normalizeCatalog(raw);
    }
    return raw || { subjects: [], sources: [], lectures: [], resources: [] };
  }

  function stripSourceCollectionId(src) {
    var raw = String((src && (src.collectionId || src.id)) || "");
    return raw.indexOf("::") >= 0 ? raw.split("::").pop() : raw;
  }

  function mergeCatalogWithDynamic(raw, overrides) {
    if (!raw) return null;
    var clone = {
      schemaVersion: raw.schemaVersion || 1,
      hierarchy: raw.hierarchy ? Object.assign({}, raw.hierarchy) : null,
      subjects: (raw.subjects || []).map(function (s) {
        return Object.assign({}, s, { counts: s && s.counts ? Object.assign({}, s.counts) : { quizzes: 0, sheets: 0, lectures: 0, totalQuestions: 0 } });
      }),
      sources: (raw.sources || []).map(function (src) { return Object.assign({}, src); }),
      lectures: (raw.lectures || []).map(function (lec) { return Object.assign({}, lec); }),
      resources: (raw.resources || []).map(function (res) { return Object.assign({}, res); }),
    };

    var dyn = (overrides && overrides.dynamicCatalog) || {};
    var deletedSubs = new Set(Array.isArray(dyn.deletedSubjectIds) ? dyn.deletedSubjectIds : []);
    var customSubs = dyn.customSubjects && typeof dyn.customSubjects === "object" ? dyn.customSubjects : {};
    var deletedQuizzes = new Set(Array.isArray(dyn.deletedQuizKeys) ? dyn.deletedQuizKeys : []);
    var hiddenQuizzes = new Set(Array.isArray(dyn.hiddenQuizKeys) ? dyn.hiddenQuizKeys : []);
    var customQuizzes = Array.isArray(dyn.customQuizzes) ? dyn.customQuizzes : [];

    // 1. Merge subjects
    var subjectMap = new Map();
    clone.subjects = clone.subjects.filter(function (s) {
      if (!s || !s.id || deletedSubs.has(s.id)) return false;
      if (customSubs[s.id]) {
        Object.assign(s, customSubs[s.id]);
      }
      subjectMap.set(s.id, s);
      return true;
    });
    Object.keys(customSubs).forEach(function (sid) {
      if (deletedSubs.has(sid) || subjectMap.has(sid)) return;
      var cs = customSubs[sid];
      if (!cs || !cs.id) return;
      var entry = Object.assign({}, cs, {
        counts: { quizzes: 0, sheets: 0, lectures: 0, totalQuestions: 0 },
        isCustom: true,
      });
      subjectMap.set(sid, entry);
      clone.subjects.push(entry);
    });

    // 2. Merge sources (filter deleted courses & deleted quizzes, insert/update custom quizzes)
    clone.sources = clone.sources.filter(function (src) {
      if (!src || !src.subjectId || deletedSubs.has(src.subjectId)) return false;
      var cid = stripSourceCollectionId(src);
      return !deletedQuizzes.has(src.subjectId + "::" + cid);
    });

    customQuizzes.forEach(function (cq) {
      if (!cq || !cq.subjectId || !cq.quizId) return;
      if (deletedSubs.has(cq.subjectId)) return;
      var composite = cq.subjectId + "::" + cq.quizId;
      if (deletedQuizzes.has(composite)) return;
      var kind = cq.kind || "quiz";
      var newSrc = {
        id: cq.subjectId + "::" + kind + "::" + cq.quizId,
        collectionId: cq.quizId,
        subjectId: cq.subjectId,
        kind: kind,
        title: cq.title || cq.quizId,
        questionCount: Number(cq.questionCount) || 0,
        gradableCount: Number(cq.gradableCount) || 0,
        isCustom: true,
      };
      var existingIdx = clone.sources.findIndex(function (s) {
        return s.subjectId === cq.subjectId && stripSourceCollectionId(s) === cq.quizId;
      });
      if (existingIdx >= 0) clone.sources[existingIdx] = newSrc;
      else clone.sources.push(newSrc);
    });

    // Split out instructor-hidden quizzes from active student catalog while keeping metadata for Admin Portal
    var hiddenSourcesList = [];
    clone.sources = clone.sources.filter(function (src) {
      var cid = stripSourceCollectionId(src);
      if (hiddenQuizzes.has(src.subjectId + "::" + cid)) {
        hiddenSourcesList.push(Object.assign({}, src, { isHidden: true }));
        return false;
      }
      return true;
    });

    // 3. Filter lectures and resources by active subjects
    clone.lectures = clone.lectures.filter(function (lec) { return lec && !deletedSubs.has(lec.subjectId); });
    clone.resources = clone.resources.filter(function (res) { return res && !deletedSubs.has(res.subjectId); });

    // 4. Recompute per-subject counts when dynamic overrides exist
    var hasDynamicChanges = deletedSubs.size > 0 || Object.keys(customSubs).length > 0 || deletedQuizzes.size > 0 || hiddenQuizzes.size > 0 || customQuizzes.length > 0;
    if (hasDynamicChanges) {
      clone.subjects.forEach(function (s) {
        var sSources = clone.sources.filter(function (src) { return src.subjectId === s.id; });
        var qCount = 0;
        var shCount = 0;
        var lecSrcCount = 0;
        var totalQ = 0;
        sSources.forEach(function (src) {
          if (src.kind === "sheet") shCount += 1;
          else if (src.kind === "lecture") lecSrcCount += 1;
          else qCount += 1;
          totalQ += Number(src.questionCount || 0);
        });
        var lecPagesCount = clone.lectures.filter(function (l) { return l.subjectId === s.id; }).length;
        s.counts = {
          quizzes: qCount,
          sheets: shCount,
          lectures: Math.max(lecSrcCount, lecPagesCount),
          totalQuestions: totalQ,
        };
      });
    }

    var normalized = normalizeCatalogData(clone);
    normalized.hiddenSources = hiddenSourcesList.length > 0
      ? normalizeCatalogData({ subjects: [], sources: hiddenSourcesList }).sources
      : [];
    normalized.hiddenQuizKeys = Array.from(hiddenQuizzes);
    return normalized;
  }

  async function loadCatalog(forceRefresh) {
    if (catalogCache && !forceRefresh) return catalogCache;
    if (catalogPromise && !forceRefresh) return catalogPromise;

    catalogPromise = Promise.all([
      fetch("/data/catalog.json", { cache: "no-cache" }).then(function (res) {
        if (!res.ok) throw new Error("Failed to load catalog.json (" + res.status + ")");
        return res.json();
      }),
      (!overridesLoaded || forceRefresh)
        ? loadPublicOverrides().catch(function () { return null; })
        : Promise.resolve(publicOverridesCache),
    ])
      .then(function (pair) {
        rawCatalogCache = pair[0];
        catalogCache = mergeCatalogWithDynamic(rawCatalogCache, publicOverridesCache);
        catalogManager = null;
        contentLibrary = null;
        return catalogCache;
      })
      .finally(function () {
        catalogPromise = null;
      });

    return catalogPromise;
  }

  function getCatalog() {
    return catalogCache;
  }

  function getCatalogPrefs() {
    return safeJsonParse(readStorage(CATALOG_PREFS_KEY), null);
  }

  function saveCatalogPrefs(prefs) {
    writeStorage(CATALOG_PREFS_KEY, JSON.stringify(prefs || {}));
  }

  function getCatalogManager() {
    if (!catalogCache) return null;
    var core = root.BankQuestionCore;
    if (!core || !core.ContentCatalog || typeof core.ContentCatalog.createManager !== "function") {
      return null;
    }
    if (!catalogManager) {
      var saved = {};
      var memoryStorage = {
        getItem: function () {
          var prefs = getCatalogPrefs();
          return prefs ? JSON.stringify(prefs) : null;
        },
        setItem: function (_k, v) {
          var parsed = safeJsonParse(v, null);
          if (parsed) saveCatalogPrefs(parsed);
          saved.raw = v;
        },
      };
      catalogManager = core.ContentCatalog.createManager({
        catalog: {
          faculties: (catalogCache.hierarchy && catalogCache.hierarchy.faculties) || [
            {
              id: "faculty-ai",
              name: "Faculty of Artificial Intelligence",
              terms: [{ id: "term-1", name: "Term 1", levelId: "level-2" }],
            },
          ],
          subjects: catalogCache.subjects || [],
        },
        storage: memoryStorage,
      });
    }
    return catalogManager;
  }

  function getHiddenQuizSet() {
    var dyn = (publicOverridesCache && publicOverridesCache.dynamicCatalog) || {};
    return new Set(Array.isArray(dyn.hiddenQuizKeys) ? dyn.hiddenQuizKeys : []);
  }

  async function loadSubject(subjectId, options) {
    if (!subjectId) return null;
    var includeHidden = Boolean(options && options.includeHidden);
    var dyn = (publicOverridesCache && publicOverridesCache.dynamicCatalog) || {};
    var deletedSubs = new Set(Array.isArray(dyn.deletedSubjectIds) ? dyn.deletedSubjectIds : []);
    if (deletedSubs.has(subjectId)) {
      throw new Error("Course has been removed: " + subjectId);
    }

    var data = subjectCache.get(subjectId) || null;
    if (!data) {
      try {
        var res = await fetch("/data/subjects/" + encodeURIComponent(subjectId) + ".json", { cache: "no-cache" });
        if (res.ok) data = await res.json();
      } catch (_e) { /* allow custom course */ }

      var customSub = dyn.customSubjects && dyn.customSubjects[subjectId];
      if (!data) {
        if (!customSub) throw new Error("Could not load subject " + subjectId);
        data = {
          id: subjectId,
          name: customSub.name || subjectId,
          nameAr: customSub.nameAr || "",
          description: customSub.description || "",
          quizzes: [],
          sheets: [],
          lectures: [],
        };
      }

      data = Object.assign({ quizzes: [], sheets: [], lectures: [] }, data);

      // Fetch dynamic quizzes & deletions for this course from backend API
      try {
        var dynRes = await fetch("/api/catalog/dynamic?subjectId=" + encodeURIComponent(subjectId), { cache: "no-store" });
        if (dynRes.ok) {
          var dynData = await dynRes.json().catch(function () { return null; });
          if (dynData && dynData.ok) {
            var delQuizzes = new Set(Array.isArray(dynData.deletedQuizKeys) ? dynData.deletedQuizKeys : []);
            data._dynHiddenQuizKeys = Array.isArray(dynData.hiddenQuizKeys) ? dynData.hiddenQuizKeys : [];
            data.quizzes = (Array.isArray(data.quizzes) ? data.quizzes : []).filter(function (q) {
              return q && !delQuizzes.has(subjectId + "::" + q.id);
            });
            data.sheets = (Array.isArray(data.sheets) ? data.sheets : []).filter(function (q) {
              return q && !delQuizzes.has(subjectId + "::" + q.id);
            });
            var expMap = explanationsCache.get(subjectId) || {};
            (Array.isArray(dynData.subjectQuizzes) ? dynData.subjectQuizzes : []).forEach(function (cq) {
              if (!cq || !cq.id || delQuizzes.has(subjectId + "::" + cq.id)) return;
              var bucketKey = cq.kind === "sheet" ? "sheets" : cq.kind === "lecture" ? "lectures" : "quizzes";
              if (!Array.isArray(data[bucketKey])) data[bucketKey] = [];
              var idx = data[bucketKey].findIndex(function (item) { return item && item.id === cq.id; });
              if (idx >= 0) data[bucketKey][idx] = cq;
              else data[bucketKey].push(cq);
              (Array.isArray(cq.questions) ? cq.questions : []).forEach(function (q) {
                if (q && (q.explanation || q.explanationArabic || q.rule || q.whyYouMightErr || q.memoryTrick)) {
                  var rec = {
                    explanation: q.explanation || "",
                    arabicExplanation: q.explanationArabic || "",
                    explanationArabic: q.explanationArabic || "",
                    rule: q.rule || "",
                    whyYouMightErr: q.whyYouMightErr || "",
                    memoryTrick: q.memoryTrick || "",
                  };
                  if (q.internalId) expMap[q.internalId] = rec;
                  if (q.id) expMap[q.id] = rec;
                }
              });
            });
            explanationsCache.set(subjectId, expMap);
            var sqImages = dynData.subjectQuestionImages;
            if (sqImages && typeof sqImages === "object") {
              var applyImgOverlay = function (collections) {
                (Array.isArray(collections) ? collections : []).forEach(function (col) {
                  if (!col || !col.id) return;
                  var qMap = sqImages[col.id];
                  if (!qMap || typeof qMap !== "object") return;
                  var qs = Array.isArray(col.questions)
                    ? col.questions
                    : (col.generatedQuiz && Array.isArray(col.generatedQuiz.questions) ? col.generatedQuiz.questions : []);
                  qs.forEach(function (q) {
                    if (!q || !q.id || !Object.prototype.hasOwnProperty.call(qMap, q.id)) return;
                    var imgArr = qMap[q.id];
                    if (!Array.isArray(imgArr)) return;
                    if (imgArr.length === 0) {
                      delete q.image;
                      delete q.imageAlt;
                      delete q.imageCaption;
                      q.images = [];
                    } else {
                      q.image = imgArr[0].url || "";
                      if (imgArr[0].alt) q.imageAlt = imgArr[0].alt;
                      else delete q.imageAlt;
                      if (imgArr[0].caption) q.imageCaption = imgArr[0].caption;
                      else delete q.imageCaption;
                      q.images = imgArr.slice();
                    }
                  });
                });
              };
              applyImgOverlay(data.quizzes);
              applyImgOverlay(data.sheets);
              applyImgOverlay(data.lectures);
            }
          }
        }
      } catch (_err) {
        // Offline / static fallback preserves bundled subject
      }

      subjectCache.set(subjectId, data);
    }

    if (includeHidden) return data;
    var hiddenSet = getHiddenQuizSet();
    if (!overridesLoaded && Array.isArray(data._dynHiddenQuizKeys)) {
      data._dynHiddenQuizKeys.forEach(function (k) { hiddenSet.add(k); });
    }
    if (hiddenSet.size === 0) return data;
    return Object.assign({}, data, {
      quizzes: (Array.isArray(data.quizzes) ? data.quizzes : []).filter(function (q) {
        return q && !hiddenSet.has(subjectId + "::" + q.id);
      }),
      sheets: (Array.isArray(data.sheets) ? data.sheets : []).filter(function (q) {
        return q && !hiddenSet.has(subjectId + "::" + q.id);
      }),
      lectures: (Array.isArray(data.lectures) ? data.lectures : []).filter(function (l) {
        return l && !hiddenSet.has(subjectId + "::" + l.id);
      }),
    });
  }

  async function loadSubjectExplanations(subjectId) {
    if (!subjectId) return {};
    var existing = explanationsCache.get(subjectId);
    if (existing && existing._fetched) return existing;
    var merged = Object.assign({}, existing || {});
    try {
      var res = await fetch("/data/explanations/" + encodeURIComponent(subjectId) + ".json", { cache: "no-cache" });
      if (res.ok) {
        var data = await res.json();
        var map = (data && data.byInternalId) || data || {};
        merged = Object.assign({}, map, merged);
      }
    } catch (_err) {
      // Dynamic subjects may not have static explanation files
    }
    merged._fetched = true;
    explanationsCache.set(subjectId, merged);
    return merged;
  }

  function extractSubjectEntries(subjectData) {
    if (!subjectData) return [];
    var out = [];
    var pushGroup = function (kind, list) {
      (Array.isArray(list) ? list : []).forEach(function (col) {
        if (!col || !col.id) return;
        out.push({
          kind: kind,
          id: col.id,
          sourceId: subjectData.id + "::" + kind + "::" + col.id,
          title: col.title || col.id,
          questions: Array.isArray(col.questions) ? col.questions : [],
        });
      });
    };

    pushGroup("quiz", subjectData.quizzes);
    pushGroup("sheet", subjectData.sheets);

    (Array.isArray(subjectData.lectures) ? subjectData.lectures : []).forEach(function (lec) {
      if (!lec || !lec.id) return;
      var qList = Array.isArray(lec.questions)
        ? lec.questions
        : (lec.generatedQuiz && Array.isArray(lec.generatedQuiz.questions) ? lec.generatedQuiz.questions : []);
      out.push({
        kind: "lecture",
        id: lec.id,
        sourceId: subjectData.id + "::lecture::" + lec.id,
        title: lec.title || lec.id,
        questions: qList,
      });
    });

    return out;
  }

  async function loadQuestionsForSources(subjectId, sourceIds, options) {
    var subj = await loadSubject(subjectId, options);
    var wanted = new Set(Array.isArray(sourceIds) ? sourceIds : []);
    var entries = extractSubjectEntries(subj);
    var collected = [];

    entries.forEach(function (entry) {
      if (wanted.size > 0 && !wanted.has(entry.sourceId) && !wanted.has(entry.id)) return;
      (entry.questions || []).forEach(function (q, idx) {
        var qId = q.id || ("Q" + (idx + 1));
        var internalId = q.internalId || (entry.sourceId + "::" + qId);
        collected.push(Object.assign({}, q, {
          id: qId,
          internalId: internalId,
          subjectId: subjectId,
          sourceId: entry.sourceId,
          collectionId: entry.id,
          collectionTitle: entry.title,
        }));
      });
    });

    return collected;
  }

  function getSubjectName(subj) {
    if (!subj) return "";
    var override = publicOverridesCache && publicOverridesCache.subjectNames && publicOverridesCache.subjectNames[subj.id];
    var lang = root.ElgoTheme && typeof root.ElgoTheme.getLang === "function" ? root.ElgoTheme.getLang() : "en";
    if (override) return override;
    if (lang === "ar" && subj.nameAr) return subj.nameAr;
    return subj.name || subj.title || subj.id || "";
  }

  function getQuizTitle(source, subjectId) {
    if (!source) return "";
    var qNames = (publicOverridesCache && publicOverridesCache.quizNames) || {};
    var sid = subjectId || source.subjectId || "";
    var rawQuizId = source.collectionId || source.id || "";
    if (String(rawQuizId).indexOf("::") >= 0) {
      var parts = String(rawQuizId).split("::");
      sid = sid || parts[0];
      rawQuizId = parts[parts.length - 1];
    }
    var compositeKey = sid && rawQuizId ? (sid + "::" + rawQuizId) : "";
    if (compositeKey && qNames[compositeKey]) return qNames[compositeKey];
    if (qNames[source.id]) return qNames[source.id];
    return source.title || source.name || source.id || "";
  }

  function getSiteSettings() {
    return (publicOverridesCache && publicOverridesCache.siteSettings) || {};
  }

  async function loadPublicOverrides() {
    var next = {
      subjectNames: (publicOverridesCache && publicOverridesCache.subjectNames) || {},
      quizNames: (publicOverridesCache && publicOverridesCache.quizNames) || {},
      siteSettings: (publicOverridesCache && publicOverridesCache.siteSettings) || {},
      contentOverrides: (publicOverridesCache && publicOverridesCache.contentOverrides) || null,
      dynamicCatalog: (publicOverridesCache && publicOverridesCache.dynamicCatalog) || {
        customSubjects: {},
        deletedSubjectIds: [],
        customQuizzes: [],
        deletedQuizKeys: [],
        hiddenQuizKeys: [],
        questionImageCounts: {},
      },
    };

    try {
      var results = await Promise.allSettled([
        fetch("/api/subject-names", { cache: "no-store" }),
        fetch("/api/quiz-names", { cache: "no-store" }),
        fetch("/api/site-settings", { cache: "no-store" }),
        fetch("/api/content/overrides", { cache: "no-store" }),
        fetch("/api/catalog/dynamic", { cache: "no-store" }),
      ]);

      if (results[0].status === "fulfilled" && results[0].value.ok) {
        var subData = await results[0].value.json().catch(function () { return null; });
        if (subData && subData.names) next.subjectNames = subData.names;
      }
      if (results[1].status === "fulfilled" && results[1].value.ok) {
        var quizData = await results[1].value.json().catch(function () { return null; });
        if (quizData && quizData.names) next.quizNames = quizData.names;
      }
      if (results[2].status === "fulfilled" && results[2].value.ok) {
        var siteData = await results[2].value.json().catch(function () { return null; });
        if (siteData && siteData.settings) next.siteSettings = siteData.settings;
      }
      if (results[3].status === "fulfilled" && results[3].value.ok) {
        var ovData = await results[3].value.json().catch(function () { return null; });
        if (ovData && ovData.overrides) next.contentOverrides = ovData.overrides;
      }
      if (results[4].status === "fulfilled" && results[4].value.ok) {
        var dynData = await results[4].value.json().catch(function () { return null; });
        if (dynData && dynData.ok) {
          next.dynamicCatalog = {
            customSubjects: dynData.customSubjects || {},
            deletedSubjectIds: Array.isArray(dynData.deletedSubjectIds) ? dynData.deletedSubjectIds : [],
            customQuizzes: Array.isArray(dynData.customQuizzes) ? dynData.customQuizzes : [],
            deletedQuizKeys: Array.isArray(dynData.deletedQuizKeys) ? dynData.deletedQuizKeys : [],
            hiddenQuizKeys: Array.isArray(dynData.hiddenQuizKeys) ? dynData.hiddenQuizKeys : [],
            questionImageCounts: (dynData.questionImageCounts && typeof dynData.questionImageCounts === "object") ? dynData.questionImageCounts : {},
          };
        }
      }

      publicOverridesCache = next;
      overridesLoaded = true;
      if (rawCatalogCache) {
        catalogCache = mergeCatalogWithDynamic(rawCatalogCache, publicOverridesCache);
        catalogManager = null;
        contentLibrary = null;
      }
      if (next.contentOverrides) {
        var lib = getContentLibrary();
        if (lib && typeof lib.replaceOverlay === "function") {
          lib.replaceOverlay(next.contentOverrides);
        }
      }
      return next;
    } catch (_err) {
      return publicOverridesCache;
    }
  }

  async function refreshDynamicState() {
    subjectCache.clear();
    explanationsCache.clear();
    await loadPublicOverrides();
    if (!rawCatalogCache) {
      await loadCatalog(true);
    } else {
      catalogCache = mergeCatalogWithDynamic(rawCatalogCache, publicOverridesCache);
      catalogManager = null;
      contentLibrary = null;
      if (publicOverridesCache.contentOverrides) {
        var lib = getContentLibrary();
        if (lib && typeof lib.replaceOverlay === "function") {
          lib.replaceOverlay(publicOverridesCache.contentOverrides);
        }
      }
    }
    return catalogCache;
  }

  function isBookmarked(internalId) {
    if (!internalId) return false;
    var st = getState();
    return (st.bookmarks || []).some(function (b) {
      return b && (b.internalId === internalId || b.id === internalId);
    });
  }

  function toggleBookmark(question, meta) {
    if (!question) return false;
    var internalId = question.internalId || question.id;
    var st = getState();
    var list = Array.isArray(st.bookmarks) ? st.bookmarks.slice() : [];
    var delMap = Object.assign({}, st.deletedBookmarks && typeof st.deletedBookmarks === "object" ? st.deletedBookmarks : {});
    var idx = list.findIndex(function (b) {
      return b && (b.internalId === internalId || b.id === internalId);
    });

    if (idx >= 0) {
      var removed = list.splice(idx, 1)[0];
      var delIso = nextMutationIso(removed && removed.savedAt);
      if (internalId) delMap[internalId] = delIso;
      if (removed && removed.id && removed.id !== internalId) delMap[removed.id] = delIso;
      st.bookmarks = list;
      st.deletedBookmarks = trimTimestampMapClient(delMap, 500);
      st.pendingProgressSync = true;
      localMutationSeq += 1;
      saveState(st);
      scheduleCloudProgressSync();
      return false;
    }

    var savedIso = nextMutationIso(delMap[internalId], delMap[question.id]);
    if (internalId) delete delMap[internalId];
    if (question.id) delete delMap[question.id];

    var opts = Array.isArray(question.options) ? question.options : [];
    var rightOpt = opts.find(function (o) { return o && o.id === question.correctOptionId; });
    var qImgs = (root.ElgoModel && typeof root.ElgoModel.getQuestionImages === "function")
      ? root.ElgoModel.getQuestionImages(question)
      : (question.image ? [{ url: question.image }] : []);
    list.unshift({
      id: question.id || internalId,
      internalId: internalId,
      subjectId: (meta && meta.subjectId) || question.subjectId || "",
      subjectName: (meta && meta.subjectName) || "",
      quizId: (meta && meta.collectionId) || question.collectionId || "",
      sourceLabel: (meta && meta.sourceLabel) || question.collectionTitle || "",
      question: question.question || question.text || "",
      image: qImgs[0] ? qImgs[0].url : "",
      images: qImgs,
      correctOptionId: question.correctOptionId || null,
      correctAnswer: rightOpt ? (rightOpt.id + ") " + rightOpt.text) : "",
      savedAt: savedIso,
    });
    st.bookmarks = list;
    st.deletedBookmarks = trimTimestampMapClient(delMap, 500);
    st.pendingProgressSync = true;
    localMutationSeq += 1;
    saveState(st);
    scheduleCloudProgressSync();
    return true;
  }

  function toCoreMistakeStore(list) {
    var ms = getMistakesStore();
    if (!ms || typeof ms.normalizeStore !== "function") return null;
    var rawItems = (Array.isArray(list) ? list : []).map(function (m) {
      return {
        internalId: m.internalId || m.id || "",
        originalQuestionId: m.id || m.internalId || null,
        subjectId: m.subjectId || null,
        quizId: m.quizId || null,
        collectionId: m.quizId || null,
        status: m.resolved ? "resolved" : "unresolved",
        failureCount: Number(m.missCount || m.failureCount || 1),
        firstFailedAt: m.firstFailedAt || null,
        lastAttemptedAt: m.updatedAt || m.lastAttemptedAt || null,
        resolvedAt: m.resolvedAt || null,
        selectedOptionId: m.lastWrongOptionId || m.selectedOptionId || null,
        correctOptionId: m.correctOptionId || null,
        questionText: m.question || m.questionText || "",
      };
    });
    return ms.normalizeStore({ items: rawItems });
  }

  function fromCoreMistakeStore(store, prevList, extraMeta) {
    var byId = new Map();
    (Array.isArray(prevList) ? prevList : []).forEach(function (item) {
      if (item && (item.internalId || item.id)) {
        byId.set(item.internalId || item.id, item);
      }
    });
    return ((store && store.items) || []).map(function (item) {
      var prev = byId.get(item.internalId) || {};
      var subjName = prev.subjectName || ((extraMeta && item.internalId === extraMeta.internalId) ? extraMeta.subjectName : "") || "";
      var imgList = Array.isArray(prev.images) && prev.images.length
        ? prev.images
        : ((extraMeta && item.internalId === extraMeta.internalId && Array.isArray(extraMeta.images)) ? extraMeta.images : []);
      var primaryImg = prev.image || (imgList[0] ? imgList[0].url : "") || ((extraMeta && item.internalId === extraMeta.internalId && extraMeta.image) || "");
      var resolvedFlag = item.status === "resolved";
      var bestTime = parseIsoMsClient(item.resolvedAt) > parseIsoMsClient(item.lastAttemptedAt)
        ? item.resolvedAt
        : (item.lastAttemptedAt || prev.updatedAt || new Date().toISOString());
      return {
        id: item.originalQuestionId || prev.id || item.internalId,
        internalId: item.internalId,
        subjectId: item.subjectId || prev.subjectId || "",
        subjectName: subjName,
        quizId: item.quizId || item.collectionId || prev.quizId || "",
        question: item.questionText || prev.question || "",
        image: primaryImg,
        images: imgList,
        correctOptionId: item.correctOptionId || prev.correctOptionId || null,
        lastWrongOptionId: item.selectedOptionId || prev.lastWrongOptionId || null,
        missCount: Number(item.failureCount || 1),
        resolved: resolvedFlag,
        updatedAt: bestTime,
        resolvedAt: resolvedFlag ? (item.resolvedAt || prev.resolvedAt || bestTime) : null,
        firstFailedAt: item.firstFailedAt || prev.firstFailedAt || bestTime,
      };
    });
  }

  function recordMistake(question, wrongOptionId, meta) {
    if (!question) return;
    var internalId = question.internalId || question.id;
    var qImgs = (root.ElgoModel && typeof root.ElgoModel.getQuestionImages === "function")
      ? root.ElgoModel.getQuestionImages(question)
      : (question.image ? [{ url: question.image }] : []);
    var st = getState();
    var list = Array.isArray(st.mistakes) ? st.mistakes.slice() : [];
    var delMap = Object.assign({}, st.deletedMistakes && typeof st.deletedMistakes === "object" ? st.deletedMistakes : {});
    var existing = list.find(function (m) { return m && (m.internalId === internalId || m.id === internalId); });
    var mutIso = nextMutationIso(
      existing && existing.updatedAt,
      existing && existing.resolvedAt,
      delMap[internalId],
      st.mistakesClearedAt
    );
    if (internalId) delete delMap[internalId];
    if (question.id) delete delMap[question.id];
    var ms = getMistakesStore();

    if (ms && typeof ms.recordAttempt === "function") {
      var coreStore = toCoreMistakeStore(list);
      var updated = ms.recordAttempt(coreStore, {
        internalId: internalId,
        originalQuestionId: question.id || internalId,
        subjectId: (meta && meta.subjectId) || question.subjectId || "",
        quizId: (meta && meta.collectionId) || question.collectionId || "",
        collectionId: (meta && meta.collectionId) || question.collectionId || "",
        selectedOptionId: wrongOptionId || null,
        correctOptionId: question.correctOptionId || null,
        questionText: question.question || question.text || "",
        isCorrect: false,
      }, mutIso);
      st.mistakes = fromCoreMistakeStore(updated, list, {
        internalId: internalId,
        subjectName: (meta && meta.subjectName) || "",
        image: qImgs[0] ? qImgs[0].url : "",
        images: qImgs,
      }).map(function (m) {
        if (m && m.internalId === internalId) {
          return Object.assign({}, m, { resolved: false, resolvedAt: null, updatedAt: mutIso });
        }
        return m;
      });
      // Put the newly missed item first so recent mistakes stay immediately visible
      var hitIdx = st.mistakes.findIndex(function (m) { return m.internalId === internalId; });
      if (hitIdx > 0) {
        st.mistakes.unshift(st.mistakes.splice(hitIdx, 1)[0]);
      }
      st.deletedMistakes = trimTimestampMapClient(delMap, 500);
      st.pendingProgressSync = true;
      localMutationSeq += 1;
      saveState(st);
      scheduleCloudProgressSync();
      return;
    }

    var existingIdx = list.findIndex(function (m) {
      return m && (m.internalId === internalId || m.id === internalId);
    });

    if (existingIdx >= 0) {
      var prev = list[existingIdx];
      list[existingIdx] = Object.assign({}, prev, {
        missCount: Number(prev.missCount || 1) + 1,
        lastWrongOptionId: wrongOptionId || prev.lastWrongOptionId || null,
        image: qImgs[0] ? qImgs[0].url : (prev.image || ""),
        images: qImgs.length ? qImgs : (prev.images || []),
        resolved: false,
        resolvedAt: null,
        updatedAt: mutIso,
      });
    } else {
      list.unshift({
        id: question.id || internalId,
        internalId: internalId,
        subjectId: (meta && meta.subjectId) || question.subjectId || "",
        subjectName: (meta && meta.subjectName) || "",
        quizId: (meta && meta.collectionId) || question.collectionId || "",
        question: question.question || question.text || "",
        image: qImgs[0] ? qImgs[0].url : "",
        images: qImgs,
        correctOptionId: question.correctOptionId || null,
        lastWrongOptionId: wrongOptionId || null,
        missCount: 1,
        resolved: false,
        resolvedAt: null,
        firstFailedAt: mutIso,
        updatedAt: mutIso,
      });
    }

    st.mistakes = list;
    st.deletedMistakes = trimTimestampMapClient(delMap, 500);
    st.pendingProgressSync = true;
    localMutationSeq += 1;
    saveState(st);
    scheduleCloudProgressSync();
  }

  function getMistakes(subjectId, opts) {
    var st = getState();
    var status = opts && opts.status ? opts.status : "all";
    return (st.mistakes || []).filter(function (m) {
      if (!m) return false;
      if (subjectId && m.subjectId !== subjectId) return false;
      if (status === "unresolved" && m.resolved) return false;
      if (status === "resolved" && !m.resolved) return false;
      return true;
    });
  }

  function getSmartReviewDeck(subjectId, opts) {
    var st = getState();
    var ms = getMistakesStore();
    var list = st.mistakes || [];
    if (ms && typeof ms.buildSmartReviewDeck === "function") {
      var coreStore = toCoreMistakeStore(list);
      var deck = ms.buildSmartReviewDeck(coreStore, {
        subjectId: subjectId || "all",
        limit: (opts && opts.limit) || 25,
        includeResolved: Boolean(opts && opts.includeResolved),
      });
      var byId = new Map();
      list.forEach(function (m) { if (m) byId.set(m.internalId || m.id, m); });
      return deck.map(function (item) {
        return byId.get(item.internalId) || {
          id: item.originalQuestionId || item.internalId,
          internalId: item.internalId,
          subjectId: item.subjectId || "",
          quizId: item.quizId || "",
          question: item.questionText || "",
          correctOptionId: item.correctOptionId || null,
          missCount: item.failureCount || 1,
          resolved: item.status === "resolved",
        };
      });
    }
    return getMistakes(subjectId, { status: (opts && opts.includeResolved) ? "all" : "unresolved" })
      .slice()
      .sort(function (a, b) { return Number(b.missCount || 1) - Number(a.missCount || 1); })
      .slice(0, (opts && opts.limit) || 25);
  }

  function setMistakeResolved(internalId, resolved) {
    var st = getState();
    var list = Array.isArray(st.mistakes) ? st.mistakes : [];
    var target = list.find(function (m) { return m && (m.internalId === internalId || m.id === internalId); });
    var mutIso = nextMutationIso(target && target.updatedAt, target && target.resolvedAt);
    var ms = getMistakesStore();
    if (ms && typeof ms.resolveMistake === "function" && typeof ms.reopenMistake === "function") {
      var coreStore = toCoreMistakeStore(list);
      var next = resolved
        ? ms.resolveMistake(coreStore, internalId, mutIso)
        : ms.reopenMistake(coreStore, internalId, mutIso);
      st.mistakes = fromCoreMistakeStore(next, list).map(function (m) {
        if (m && (m.internalId === internalId || m.id === internalId)) {
          return Object.assign({}, m, {
            resolved: Boolean(resolved),
            resolvedAt: resolved ? mutIso : null,
            updatedAt: mutIso,
          });
        }
        return m;
      });
    } else {
      st.mistakes = list.map(function (m) {
        if (!m) return m;
        if (m.internalId === internalId || m.id === internalId) {
          return Object.assign({}, m, {
            resolved: Boolean(resolved),
            resolvedAt: resolved ? mutIso : null,
            updatedAt: mutIso,
          });
        }
        return m;
      });
    }
    st.pendingProgressSync = true;
    localMutationSeq += 1;
    saveState(st);
    scheduleCloudProgressSync();
  }

  function resolveMistake(internalId) {
    setMistakeResolved(internalId, true);
  }

  function reopenMistake(internalId) {
    setMistakeResolved(internalId, false);
  }

  function clearMistake(internalId) {
    var st = getState();
    var list = Array.isArray(st.mistakes) ? st.mistakes : [];
    var target = list.find(function (m) { return m && (m.internalId === internalId || m.id === internalId); });
    var delIso = nextMutationIso(target && target.updatedAt, target && target.resolvedAt);
    var delMap = Object.assign({}, st.deletedMistakes && typeof st.deletedMistakes === "object" ? st.deletedMistakes : {});
    if (internalId) delMap[internalId] = delIso;
    if (target && target.id && target.id !== internalId) delMap[target.id] = delIso;
    var ms = getMistakesStore();
    if (ms && typeof ms.deleteMistake === "function") {
      st.mistakes = fromCoreMistakeStore(ms.deleteMistake(toCoreMistakeStore(list), internalId), list);
    } else {
      st.mistakes = list.filter(function (m) {
        return m && m.internalId !== internalId && m.id !== internalId;
      });
    }
    st.deletedMistakes = trimTimestampMapClient(delMap, 500);
    st.pendingProgressSync = true;
    localMutationSeq += 1;
    saveState(st);
    scheduleCloudProgressSync();
  }

  function clearAllMistakes() {
    var st = getState();
    var ms = getMistakesStore();
    if (ms && typeof ms.clearMistakes === "function") {
      ms.clearMistakes();
    }
    var prevStamps = [st.mistakesClearedAt];
    (Array.isArray(st.mistakes) ? st.mistakes : []).forEach(function (m) {
      if (m) {
        if (m.updatedAt) prevStamps.push(m.updatedAt);
        if (m.resolvedAt) prevStamps.push(m.resolvedAt);
        if (m.firstFailedAt) prevStamps.push(m.firstFailedAt);
      }
    });
    if (st.deletedMistakes && typeof st.deletedMistakes === "object") {
      Object.values(st.deletedMistakes).forEach(function (v) { if (v) prevStamps.push(v); });
    }
    st.mistakes = [];
    st.deletedMistakes = {};
    st.mistakesClearedAt = nextMutationIso.apply(null, prevStamps);
    st.pendingProgressSync = true;
    localMutationSeq += 1;
    saveState(st);
    scheduleCloudProgressSync(true);
  }

  function recordCompletedAttempt(summary) {
    var st = getState();
    var hist = Array.isArray(st.attemptHistory) ? st.attemptHistory.slice() : [];
    hist.unshift(Object.assign({}, summary, { finishedAt: nextMutationIso() }));
    if (hist.length > 50) hist.length = 50;
    st.attemptHistory = hist;
    st.lastAttempt = summary;
    st.activeSession = null;
    st.pendingProgressSync = true;
    localMutationSeq += 1;
    saveState(st);
    scheduleCloudProgressSync(true);
  }

  function exportProgressBlob() {
    var payload = {
      exportedAt: new Date().toISOString(),
      version: 2,
      state: getState(),
      authProfile: getAuth() ? getAuth().profile : null,
    };
    return JSON.stringify(payload, null, 2);
  }

  function normalizeClientBookmarkItem(b) {
    if (!b || typeof b !== "object") return null;
    var internalId = String(b.internalId || b.id || b.questionId || "");
    if (!internalId) return null;
    var imgs = Array.isArray(b.images) ? b.images : (b.image ? [{ url: b.image }] : []);
    return Object.assign({}, b, {
      id: b.id || internalId,
      internalId: internalId,
      subjectId: b.subjectId || "",
      subjectName: b.subjectName || "",
      quizId: b.quizId || b.collectionId || "",
      sourceLabel: b.sourceLabel || "",
      question: b.question || b.questionText || "",
      image: b.image || (imgs[0] && imgs[0].url) || "",
      images: imgs,
      correctOptionId: b.correctOptionId || null,
      correctAnswer: b.correctAnswer || "",
      savedAt: b.savedAt || "",
    });
  }

  function normalizeClientMistakeItem(m) {
    if (!m || typeof m !== "object") return null;
    var internalId = String(m.internalId || m.id || m.questionId || "");
    if (!internalId) return null;
    var resolvedFlag = m.status === "resolved" || (m.status !== "unresolved" && Boolean(m.resolved));
    var imgs = Array.isArray(m.images) ? m.images : (m.image ? [{ url: m.image }] : []);
    var bestTime = m.updatedAt || (parseIsoMsClient(m.resolvedAt) > parseIsoMsClient(m.lastAttemptedAt) ? m.resolvedAt : m.lastAttemptedAt) || m.resolvedAt || "";
    return {
      id: m.originalQuestionId || m.id || internalId,
      internalId: internalId,
      subjectId: m.subjectId || "",
      subjectName: m.subjectName || "",
      quizId: m.quizId || m.collectionId || "",
      question: m.question || m.questionText || "",
      image: m.image || (imgs[0] && imgs[0].url) || "",
      images: imgs,
      correctOptionId: m.correctOptionId || null,
      lastWrongOptionId: m.lastWrongOptionId || m.selectedOptionId || null,
      missCount: Number(m.missCount || m.failureCount || 1),
      resolved: resolvedFlag,
      updatedAt: bestTime,
      resolvedAt: resolvedFlag ? (m.resolvedAt || bestTime || null) : null,
      firstFailedAt: m.firstFailedAt || bestTime || null,
    };
  }

  function filterExternalImageList(list, stripDataUris) {
    if (!Array.isArray(list)) return [];
    if (!stripDataUris) return list;
    return list.filter(function (img) {
      var u = typeof img === "string" ? img : (img && img.url);
      return u && String(u).indexOf("data:") !== 0;
    });
  }

  function compactCloudBookmark(b, stripHeavyText, stripDataUris) {
    var item = { id: b.id, internalId: b.internalId };
    if (b.subjectId) item.subjectId = b.subjectId;
    if (b.quizId) item.quizId = b.quizId;
    if (b.savedAt) item.savedAt = b.savedAt;
    if (!stripHeavyText) {
      if (b.subjectName) item.subjectName = b.subjectName;
      if (b.sourceLabel) item.sourceLabel = b.sourceLabel;
      if (b.question) item.question = b.question;
      if (b.image && (!stripDataUris || String(b.image).indexOf("data:") !== 0)) item.image = b.image;
      var imgs = filterExternalImageList(b.images, stripDataUris);
      if (imgs.length) item.images = imgs;
      if (b.correctOptionId) item.correctOptionId = b.correctOptionId;
      if (b.correctAnswer) item.correctAnswer = b.correctAnswer;
    }
    return item;
  }

  function compactCloudMistake(m, stripHeavyText, stripDataUris) {
    var item = {
      id: m.id,
      internalId: m.internalId,
      missCount: Number(m.missCount || 1),
      status: m.resolved ? "resolved" : "unresolved",
      resolved: Boolean(m.resolved),
    };
    if (m.subjectId) item.subjectId = m.subjectId;
    if (m.quizId) item.quizId = m.quizId;
    if (m.updatedAt) item.updatedAt = m.updatedAt;
    if (m.resolvedAt) item.resolvedAt = m.resolvedAt;
    if (m.firstFailedAt) item.firstFailedAt = m.firstFailedAt;
    if (m.correctOptionId) item.correctOptionId = m.correctOptionId;
    if (m.lastWrongOptionId) item.lastWrongOptionId = m.lastWrongOptionId;
    if (!stripHeavyText) {
      if (m.subjectName) item.subjectName = m.subjectName;
      if (m.question) item.question = m.question;
      if (m.image && (!stripDataUris || String(m.image).indexOf("data:") !== 0)) item.image = m.image;
      var imgs = filterExternalImageList(m.images, stripDataUris);
      if (imgs.length) item.images = imgs;
    }
    return item;
  }

  function compactCloudAttempt(a) {
    if (!a || typeof a !== "object") return null;
    return {
      attemptId: a.attemptId || a.id || "",
      id: a.id || a.attemptId || "",
      subjectId: a.subjectId || "",
      subjectName: a.subjectName || "",
      quizId: a.quizId || a.collectionId || "",
      quizTitle: a.quizTitle || "",
      score: Number(a.score || 0),
      total: Number(a.total || 0),
      percent: Number(a.percent || 0),
      finishedAt: a.finishedAt || "",
    };
  }

  function exportCloudProgress(opts) {
    var st = getState();
    var normBm = (Array.isArray(st.bookmarks) ? st.bookmarks : []).map(normalizeClientBookmarkItem).filter(Boolean);
    var normMk = (Array.isArray(st.mistakes) ? st.mistakes : []).map(normalizeClientMistakeItem).filter(Boolean);
    var delBm = trimTimestampMapClient(st.deletedBookmarks, 500);
    var delMk = trimTimestampMapClient(st.deletedMistakes, 500);
    var attempts = (Array.isArray(st.attemptHistory) ? st.attemptHistory : [])
      .slice(0, 50)
      .map(compactCloudAttempt)
      .filter(Boolean);

    var buildPayload = function (stripHeavy, maxAttempts, stripDataUris) {
      var out = {
        bookmarks: normBm.map(function (b) { return compactCloudBookmark(b, stripHeavy, stripDataUris); }),
        deletedBookmarks: delBm,
        mistakes: {
          schemaVersion: 2,
          items: normMk.map(function (m) { return compactCloudMistake(m, stripHeavy, stripDataUris); }),
        },
        deletedMistakes: delMk,
        attempts: attempts.slice(0, maxAttempts),
      };
      if (st.mistakesClearedAt) out.mistakesClearedAt = st.mistakesClearedAt;
      return out;
    };

    if (!(opts && opts.compact)) {
      var full = buildPayload(false, 50, false);
      if (JSON.stringify(full).length <= 340 * 1024) return full;
      var withoutDataUris = buildPayload(false, 50, true);
      if (JSON.stringify(withoutDataUris).length <= 360 * 1024) return withoutDataUris;
    }
    var stripped = buildPayload(true, 25, true);
    if (JSON.stringify(stripped).length <= 360 * 1024) return stripped;
    return buildPayload(true, 0, true);
  }

  function mergeTimestampMapsClient(a, b) {
    var combined = Object.assign({}, a && typeof a === "object" ? a : {});
    if (b && typeof b === "object") {
      Object.entries(b).forEach(function (pair) {
        var k = pair[0];
        var v = pair[1];
        if (!k || typeof v !== "string") return;
        if (!combined[k] || parseIsoMsClient(v) > parseIsoMsClient(combined[k])) combined[k] = v;
      });
    }
    return trimTimestampMapClient(combined, 500);
  }

  function applyCloudProgress(data, opts) {
    var raw = data && typeof data === "object" ? data : null;
    if (raw && raw.profile && typeof raw.profile === "object" && raw.profile.progress) raw = raw.profile.progress;
    else if (raw && raw.progress && typeof raw.progress === "object") raw = raw.progress;
    if (!raw || typeof raw !== "object") return false;

    var options = opts || {};
    var auth = getAuth();
    var targetStudentId = options.studentId || (auth && auth.profile && auth.profile.studentId) || "";
    var targetUsername = options.username || (auth && auth.profile && auth.profile.username) || "";
    var st = getState();
    var beforeSig = JSON.stringify({ b: st.bookmarks || [], m: st.mistakes || [], a: st.attemptHistory || [] });

    var replaceMode = Boolean(options.replace) || Boolean(st.ownerStudentId && targetStudentId && st.ownerStudentId !== targetStudentId);

    var cloudBookmarks = (Array.isArray(raw.bookmarks) ? raw.bookmarks : []).map(normalizeClientBookmarkItem).filter(Boolean);
    var rawCloudMistakes = Array.isArray(raw.mistakes)
      ? raw.mistakes
      : (raw.mistakes && Array.isArray(raw.mistakes.items) ? raw.mistakes.items : []);
    var cloudMistakes = rawCloudMistakes.map(normalizeClientMistakeItem).filter(Boolean);
    var cloudAttempts = Array.isArray(raw.attempts)
      ? raw.attempts
      : (Array.isArray(raw.attemptLog) ? raw.attemptLog : []);
    var cloudDelBm = trimTimestampMapClient(raw.deletedBookmarks, 500);
    var cloudDelMk = trimTimestampMapClient(raw.deletedMistakes, 500);
    var cloudCleared = typeof raw.mistakesClearedAt === "string" ? raw.mistakesClearedAt : null;
    cloudBookmarks.forEach(function (b) { if (b && b.savedAt) observeMutationIso(b.savedAt); });
    cloudMistakes.forEach(function (m) {
      if (m) {
        observeMutationIso(m.updatedAt);
        observeMutationIso(m.resolvedAt);
      }
    });
    Object.values(cloudDelBm).forEach(observeMutationIso);
    Object.values(cloudDelMk).forEach(observeMutationIso);
    if (cloudCleared) observeMutationIso(cloudCleared);

    if (replaceMode) {
      var delBmRep = cloudDelBm;
      st.bookmarks = cloudBookmarks.filter(function (b) {
        return parseIsoMsClient(delBmRep[b.internalId]) <= parseIsoMsClient(b.savedAt);
      });
      var delMkRep = cloudDelMk;
      var clearedMsRep = parseIsoMsClient(cloudCleared);
      st.mistakes = cloudMistakes.filter(function (m) {
        var delMs = Math.max(parseIsoMsClient(delMkRep[m.internalId]), clearedMsRep);
        var itemMs = Math.max(parseIsoMsClient(m.updatedAt), parseIsoMsClient(m.resolvedAt));
        return delMs <= itemMs;
      });
      st.attemptHistory = cloudAttempts.slice(0, 50);
      st.deletedBookmarks = delBmRep;
      st.deletedMistakes = delMkRep;
      st.mistakesClearedAt = cloudCleared;
    } else {
      var delBookmarks = mergeTimestampMapsClient(st.deletedBookmarks, cloudDelBm);
      var bmMap = new Map();
      (Array.isArray(st.bookmarks) ? st.bookmarks.map(normalizeClientBookmarkItem).filter(Boolean) : []).concat(cloudBookmarks).forEach(function (item) {
        var existing = bmMap.get(item.internalId);
        if (!existing) {
          bmMap.set(item.internalId, item);
          return;
        }
        var newer = parseIsoMsClient(item.savedAt) > parseIsoMsClient(existing.savedAt) ? item : existing;
        var older = newer === item ? existing : item;
        bmMap.set(item.internalId, Object.assign({}, older, newer, {
          subjectId: newer.subjectId || older.subjectId || "",
          subjectName: newer.subjectName || older.subjectName || "",
          quizId: newer.quizId || older.quizId || "",
          sourceLabel: newer.sourceLabel || older.sourceLabel || "",
          question: newer.question || older.question || "",
          image: newer.image || older.image || "",
          images: (newer.images && newer.images.length) ? newer.images : (older.images || []),
          correctOptionId: newer.correctOptionId || older.correctOptionId || null,
          correctAnswer: newer.correctAnswer || older.correctAnswer || "",
        }));
      });
      st.bookmarks = [];
      bmMap.forEach(function (item, id) {
        var savedMs = parseIsoMsClient(item.savedAt);
        var delMs = parseIsoMsClient(delBookmarks[id]);
        if (delMs > savedMs) return;
        if (savedMs > delMs && delBookmarks[id]) delete delBookmarks[id];
        st.bookmarks.push(item);
      });
      st.deletedBookmarks = delBookmarks;

      var delMistakes = mergeTimestampMapsClient(st.deletedMistakes, cloudDelMk);
      var clearedAt = parseIsoMsClient(st.mistakesClearedAt) >= parseIsoMsClient(cloudCleared)
        ? (st.mistakesClearedAt || cloudCleared)
        : cloudCleared;
      var clearedMs = parseIsoMsClient(clearedAt);
      var mkMap = new Map();
      (Array.isArray(st.mistakes) ? st.mistakes.map(normalizeClientMistakeItem).filter(Boolean) : []).concat(cloudMistakes).forEach(function (item) {
        var prev = mkMap.get(item.internalId);
        if (!prev) {
          mkMap.set(item.internalId, item);
          return;
        }
        var prevMs = Math.max(parseIsoMsClient(prev.updatedAt), parseIsoMsClient(prev.resolvedAt));
        var nextMs = Math.max(parseIsoMsClient(item.updatedAt), parseIsoMsClient(item.resolvedAt));
        var newer = nextMs > prevMs ? item : prev;
        var older = newer === item ? prev : item;
        var merged = Object.assign({}, older, newer, {
          missCount: Math.max(Number(older.missCount || 1), Number(newer.missCount || 1)),
          question: newer.question || older.question || "",
          subjectName: newer.subjectName || older.subjectName || "",
          subjectId: newer.subjectId || older.subjectId || "",
          quizId: newer.quizId || older.quizId || "",
          image: newer.image || older.image || "",
          images: (newer.images && newer.images.length) ? newer.images : (older.images || []),
          correctOptionId: newer.correctOptionId || older.correctOptionId || null,
          lastWrongOptionId: newer.lastWrongOptionId || older.lastWrongOptionId || null,
        });
        mkMap.set(item.internalId, merged);
      });
      st.mistakes = [];
      mkMap.forEach(function (item, id) {
        var itemMs = Math.max(parseIsoMsClient(item.updatedAt), parseIsoMsClient(item.resolvedAt));
        var delItemMs = parseIsoMsClient(delMistakes[id]);
        var effDelMs = Math.max(delItemMs, clearedMs);
        if (effDelMs > itemMs) return;
        if (itemMs > delItemMs && delMistakes[id]) delete delMistakes[id];
        st.mistakes.push(item);
      });
      st.deletedMistakes = delMistakes;
      st.mistakesClearedAt = clearedAt || null;

      var attList = (Array.isArray(st.attemptHistory) ? st.attemptHistory : []).concat(cloudAttempts);
      var seenAtt = new Set();
      st.attemptHistory = attList.filter(function (item) {
        if (!item || typeof item !== "object") return false;
        var id = item.attemptId || item.id || ((item.subjectId || "") + "::" + (item.quizId || item.collectionId || "") + "::" + (item.finishedAt || ""));
        if (seenAtt.has(id)) return false;
        seenAtt.add(id);
        return true;
      }).slice(0, 50);
    }

    if (targetStudentId) st.ownerStudentId = targetStudentId;
    if (targetUsername) st.ownerUsername = targetUsername;
    saveState(st);

    var afterSig = JSON.stringify({ b: st.bookmarks || [], m: st.mistakes || [], a: st.attemptHistory || [] });
    return beforeSig !== afterSig;
  }

  function scheduleCloudProgressSync(immediate) {
    var auth = getAuth();
    if (!auth || !auth.token) return;
    if (typeof fetch !== "function") return;
    if (progressSyncTimer && typeof clearTimeout === "function") {
      clearTimeout(progressSyncTimer);
      progressSyncTimer = null;
    }
    if (immediate) {
      syncProgressToCloud().catch(function () { return null; });
      return;
    }
    if (typeof setTimeout === "function") {
      progressSyncTimer = setTimeout(function () {
        progressSyncTimer = null;
        syncProgressToCloud().catch(function () { return null; });
      }, 120);
      if (progressSyncTimer && typeof progressSyncTimer.unref === "function") {
        progressSyncTimer.unref();
      }
    }
  }

  function clearSyncRetryTimer() {
    if (syncRetryTimer && typeof clearTimeout === "function") {
      clearTimeout(syncRetryTimer);
      syncRetryTimer = null;
    }
  }

  function scheduleSyncRetry() {
    var auth = getAuth();
    if (!auth || !auth.token || typeof fetch !== "function" || typeof setTimeout !== "function") return;
    if (syncRetryAttempts >= 4) return;
    clearSyncRetryTimer();
    var delayMs = Math.min(30000, 2500 * Math.pow(2, syncRetryAttempts));
    syncRetryAttempts += 1;
    syncRetryTimer = setTimeout(function () {
      syncRetryTimer = null;
      var curAuth = getAuth();
      if (!curAuth || !curAuth.token) return;
      var st = getState();
      if (!st.pendingProgressSync) return;
      syncProgressToCloud().catch(function () { return null; });
    }, delayMs);
    if (syncRetryTimer && typeof syncRetryTimer.unref === "function") {
      syncRetryTimer.unref();
    }
  }

  async function syncProgressToCloud(opts) {
    var auth = getAuth();
    if (!auth || !auth.token || typeof fetch !== "function") {
      return { ok: false, skipped: true };
    }
    if (progressSyncInFlight) {
      if (!(opts && opts.force)) {
        return progressSyncInFlight;
      }
      if (!(opts && opts.fromPageHide)) {
        await progressSyncInFlight.catch(function () { return null; });
      }
    }
    var runSync = async function () {
      var seqBefore = localMutationSeq;
      var sendPayload = async function (compactMode) {
        var payloadProgress = exportCloudProgress({ compact: Boolean(compactMode) });
        var bodyJson = JSON.stringify({ progress: payloadProgress });
        // Browsers abort fetch({ keepalive: true }) when body exceeds 64 KiB; keep normal fetches un-capped.
        var useKeepalive = Boolean(opts && opts.fromPageHide && bodyJson.length <= 60000);
        var res = await fetch("/api/auth/sync-progress", {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: bodyJson,
          keepalive: useKeepalive,
        });
        return { res: res, payloadProgress: payloadProgress };
      };

      try {
        var attempt = await sendPayload(Boolean(opts && opts.compact));
        if (attempt.res.status === 413 && !(opts && opts.compact) && !(opts && opts.fromPageHide)) {
          attempt = await sendPayload(true);
        }
        var res = attempt.res;
        var payloadProgress = attempt.payloadProgress;
        var data = await res.json().catch(function () { return null; });
        if (res.status === 401) {
          var err401 = (data && data.error) || "Session expired — please sign in again.";
          setLastSyncStatus({ ok: false, status: 401, error: err401, offline: false });
          warnSyncFailure("syncProgressToCloud", err401, 401);
          return { ok: false, unauthorized: true, status: 401, error: err401 };
        }
        if (!res.ok || !data || !data.ok) {
          var errMsg = (data && data.error) || ("Sync failed (HTTP " + res.status + ")");
          setLastSyncStatus({ ok: false, status: res.status || 0, error: errMsg, offline: false });
          warnSyncFailure("syncProgressToCloud", errMsg, res.status || 0);
          if ((res.status >= 500 || res.status === 429) && !(opts && opts.fromPageHide) && getState().pendingProgressSync) {
            scheduleSyncRetry();
          }
          return { ok: false, status: res.status || 0, error: errMsg };
        }
        clearSyncRetryTimer();
        syncRetryAttempts = 0;
        setLastSyncStatus({ ok: true, status: res.status || 200, error: "", offline: false });
        var changed = false;
        if (data.progress && typeof data.progress === "object") {
          changed = applyCloudProgress(data.progress, {
            studentId: (auth.profile && auth.profile.studentId) || "",
            username: (auth.profile && auth.profile.username) || "",
          });
        }
        var latestSt = getState();
        if (localMutationSeq === seqBefore) {
          latestSt.pendingProgressSync = false;
          if (auth.profile && auth.profile.studentId) latestSt.ownerStudentId = auth.profile.studentId;
          if (auth.profile && auth.profile.username) latestSt.ownerUsername = auth.profile.username;
          saveState(latestSt);
        } else {
          scheduleCloudProgressSync(false);
        }
        if (changed && typeof document !== "undefined" && typeof document.dispatchEvent === "function" && typeof root.CustomEvent === "function") {
          document.dispatchEvent(new root.CustomEvent("elgo:progresschange"));
        }
        return { ok: true, changed: changed, progress: data.progress || payloadProgress };
      } catch (err) {
        var netErr = (err && err.message) ? err.message : "Network error while syncing";
        setLastSyncStatus({ ok: false, status: 0, error: netErr, offline: true });
        warnSyncFailure("syncProgressToCloud", netErr, 0);
        if (!(opts && opts.fromPageHide) && getState().pendingProgressSync) {
          scheduleSyncRetry();
        }
        return { ok: false, offline: true, status: 0, error: netErr };
      }
    };
    var promise = runSync().finally(function () {
      if (progressSyncInFlight === promise) progressSyncInFlight = null;
    });
    progressSyncInFlight = promise;
    return promise;
  }

  async function pullCloudProgress(opts) {
    var auth = getAuth();
    if (!auth || !auth.token) return false;
    var throttleMs = (opts && typeof opts.throttleMs === "number") ? opts.throttleMs : 0;
    if (!refreshSessionInFlight && throttleMs > 0 && Date.now() - lastCloudPullAt < throttleMs) {
      return false;
    }
    if (cloudPullInFlight) return cloudPullInFlight;
    var beforeSig = JSON.stringify({
      b: getState().bookmarks || [],
      m: getState().mistakes || [],
      a: getState().attemptHistory || [],
    });
    cloudPullInFlight = refreshSession().then(function () {
      var after = getState();
      var afterSig = JSON.stringify({
        b: after.bookmarks || [],
        m: after.mistakes || [],
        a: after.attemptHistory || [],
      });
      return beforeSig !== afterSig;
    }).catch(function () {
      return false;
    }).finally(function () {
      cloudPullInFlight = null;
    });
    return cloudPullInFlight;
  }

  async function syncNow() {
    var auth = getAuth();
    if (!auth || !auth.token) {
      return {
        ok: false,
        skipped: true,
        unauthorized: true,
        status: 401,
        error: "Sign in to sync your account across devices.",
      };
    }
    var attemptSync = await Promise.resolve(syncPendingAttempts()).catch(function () { return null; });
    var pushRes = await syncProgressToCloud({ force: true });
    if (!pushRes || !pushRes.ok) {
      var errRes = pushRes || getSyncStatus();
      return {
        ok: false,
        unauthorized: Boolean(errRes.unauthorized || errRes.status === 401),
        offline: Boolean(errRes.offline),
        status: errRes.status || 0,
        error: errRes.error || "Failed to push progress to cloud.",
      };
    }
    var beforeSig = JSON.stringify({
      b: getState().bookmarks || [],
      m: getState().mistakes || [],
      a: getState().attemptHistory || [],
    });
    var pulled = await refreshSession();
    var syncStatus = getSyncStatus();
    if (!pulled) {
      return {
        ok: false,
        unauthorized: syncStatus.status === 401,
        offline: Boolean(syncStatus.offline),
        status: syncStatus.status || 401,
        error: syncStatus.error || "Session expired — please sign in again.",
      };
    }
    if (!syncStatus.ok) {
      return {
        ok: false,
        unauthorized: syncStatus.status === 401,
        offline: Boolean(syncStatus.offline),
        status: syncStatus.status || 0,
        error: syncStatus.error || "Failed to fetch latest cloud progress.",
      };
    }
    var st = getState();
    var afterSig = JSON.stringify({
      b: st.bookmarks || [],
      m: st.mistakes || [],
      a: st.attemptHistory || [],
    });
    return {
      ok: true,
      changed: Boolean(pushRes.changed || beforeSig !== afterSig),
      attemptsSynced: attemptSync && typeof attemptSync.synced === "number" ? attemptSync.synced : 0,
      bookmarksCount: Array.isArray(st.bookmarks) ? st.bookmarks.length : 0,
      mistakesCount: Array.isArray(st.mistakes) ? st.mistakes.length : 0,
    };
  }

  function getContentLibrary() {
    var core = root.BankQuestionCore;
    if (!core || !core.ContentLibrary || typeof core.ContentLibrary.createLibrary !== "function") {
      return null;
    }
    if (!contentLibrary) {
      var resources = (catalogCache && Array.isArray(catalogCache.resources)) ? catalogCache.resources : [];
      var libStorage = {
        getItem: function () { return readStorage("elgo_content_library_v1"); },
        setItem: function (_k, v) { writeStorage("elgo_content_library_v1", v); },
        removeItem: function () { removeStorage("elgo_content_library_v1"); },
      };
      contentLibrary = core.ContentLibrary.createLibrary({
        bundled: {
          pdfs: resources.filter(function (r) { return r && r.type === "pdf"; }),
          videos: resources.filter(function (r) { return r && r.type === "video"; }),
          images: [],
        },
        storage: libStorage,
        storageKey: "elgo_content_library_v1",
      });
      if (publicOverridesCache && publicOverridesCache.contentOverrides && typeof contentLibrary.replaceOverlay === "function") {
        contentLibrary.replaceOverlay(publicOverridesCache.contentOverrides);
      }
    }
    return contentLibrary;
  }

  function getDeletedSubjectSet() {
    var arr = (publicOverridesCache && publicOverridesCache.dynamicCatalog && publicOverridesCache.dynamicCatalog.deletedSubjectIds) || [];
    return new Set(Array.isArray(arr) ? arr : []);
  }

  function getPdfs(subjectId) {
    var deletedSubs = getDeletedSubjectSet();
    if (subjectId && deletedSubs.has(subjectId)) return [];
    var lib = getContentLibrary();
    if (lib && typeof lib.getPdfs === "function") {
      return lib.getPdfs(subjectId).filter(function (r) { return r && !deletedSubs.has(r.subjectId); });
    }
    var cat = catalogCache;
    if (!cat || !Array.isArray(cat.resources)) return [];
    return cat.resources.filter(function (r) {
      return r && r.type === "pdf" && r.active !== false && !deletedSubs.has(r.subjectId) && (!subjectId || r.subjectId === subjectId);
    });
  }

  function getVideos(subjectId) {
    var deletedSubs = getDeletedSubjectSet();
    if (subjectId && deletedSubs.has(subjectId)) return [];
    var lib = getContentLibrary();
    if (lib && typeof lib.getVideos === "function") {
      return lib.getVideos(subjectId).filter(function (r) { return r && !deletedSubs.has(r.subjectId); });
    }
    var cat = catalogCache;
    if (!cat || !Array.isArray(cat.resources)) return [];
    return cat.resources.filter(function (r) {
      return r && r.type === "video" && r.active !== false && !deletedSubs.has(r.subjectId) && (!subjectId || r.subjectId === subjectId);
    });
  }

  function getOnlineClient() {
    var core = root.BankQuestionCore;
    if (!core || !core.OnlineClient || typeof core.OnlineClient.createOnlineClient !== "function") {
      return null;
    }
    if (!onlineClient) {
      var mapKey = function (k) {
        return "elgo_online_" + String(k || "data").replace(/^mcq_bank_/, "");
      };
      var clientStorage = {
        getItem: function (k) { return readStorage(mapKey(k)); },
        setItem: function (k, v) { writeStorage(mapKey(k), v); },
        removeItem: function (k) { removeStorage(mapKey(k)); },
      };
      onlineClient = core.OnlineClient.createOnlineClient({
        storage: clientStorage,
        getAuthToken: function () {
          var a = getAuth();
          return (a && a.token) || "";
        },
      });
    }
    return onlineClient;
  }

  function getMistakesStore() {
    return root.BankQuestionCore && root.BankQuestionCore.MistakesStore ? root.BankQuestionCore.MistakesStore : null;
  }

  async function syncPendingAttempts() {
    var client = getOnlineClient();
    if (client && typeof client.syncPendingAttempts === "function") {
      return client.syncPendingAttempts();
    }
    return { synced: 0 };
  }

  root.ElgoState = {
    STATE_KEY: STATE_KEY,
    AUTH_KEY: AUTH_KEY,
    loadCatalog: loadCatalog,
    loadSubject: loadSubject,
    loadSubjectExplanations: loadSubjectExplanations,
    loadQuestionsForSources: loadQuestionsForSources,
    extractSubjectEntries: extractSubjectEntries,
    getCatalog: getCatalog,
    getCatalogManager: getCatalogManager,
    getState: getState,
    saveState: saveState,
    getSelectedSources: getSelectedSources,
    setSelectedSources: setSelectedSources,
    getAuth: getAuth,
    setAuth: setAuth,
    authHeaders: authHeaders,
    refreshSession: refreshSession,
    getSubjectName: getSubjectName,
    getQuizTitle: getQuizTitle,
    getSiteSettings: getSiteSettings,
    isBookmarked: isBookmarked,
    toggleBookmark: toggleBookmark,
    recordMistake: recordMistake,
    getMistakes: getMistakes,
    getSmartReviewDeck: getSmartReviewDeck,
    resolveMistake: resolveMistake,
    reopenMistake: reopenMistake,
    clearMistake: clearMistake,
    clearAllMistakes: clearAllMistakes,
    recordCompletedAttempt: recordCompletedAttempt,
    exportProgressBlob: exportProgressBlob,
    exportCloudProgress: exportCloudProgress,
    applyCloudProgress: applyCloudProgress,
    syncProgressToCloud: syncProgressToCloud,
    scheduleCloudProgressSync: scheduleCloudProgressSync,
    pullCloudProgress: pullCloudProgress,
    syncNow: syncNow,
    getSyncStatus: getSyncStatus,
    loadPublicOverrides: loadPublicOverrides,
    refreshDynamicState: refreshDynamicState,
    getDynamicCatalog: function () { return (publicOverridesCache && publicOverridesCache.dynamicCatalog) || {}; },
    getHiddenQuizKeys: function () { return Array.from(getHiddenQuizSet()); },
    getPdfs: getPdfs,
    getVideos: getVideos,
    getContentLibrary: getContentLibrary,
    getOnlineClient: getOnlineClient,
    getMistakesStore: getMistakesStore,
    syncPendingAttempts: syncPendingAttempts,
    t: t,
  };
})(typeof window !== "undefined" ? window : globalThis);
