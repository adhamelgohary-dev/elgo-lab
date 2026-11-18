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
      clearLocalBtn: "Remove study data from this device",
      accountModalHeading: "elgo lab. account",
      authTabGuest: "Name Only (No Password)",
      authTabLogin: "Sign In",
      authTabRegister: "Create Account",
      authTabUpgrade: "Set Password",
      authGuestNotice: "This name works only on this browser. Add a password anytime to use it on other devices.",
      authUsernameLabel: "Username / Display name",
      authUsernamePlaceholder: "e.g. adham_ai",
      authUpgradeRenameHint: "To rename, use Settings",
      authPasswordLabel: "Password",
      authPasswordNewPlaceholder: "At least 8 characters",
      authPasswordNewHint: "At least 8 characters",
      authPasswordLoginPlaceholder: "Enter your password",
      authSubmitGuest: "Join with Name (No Password)",
      authSubmitLogin: "Sign In",
      authSubmitRegister: "Create Account",
      authSubmitUpgrade: "Keep Progress Across Devices",
      authBrowseLocally: "Browse locally without saving online",
      authCloseAria: "Close",
      authWelcomePrefix: "Welcome, ",
      authFailedFallback: "Authentication failed",
      authNetworkError: "Could not reach server. Try again when online.",
      protectNudgeText: "Protect your progress — add a password (30 seconds)",
      protectNudgeAction: "Protect account",
      protectNudgeDismiss: "Dismiss",
      authGuestSwitchTitle: "Abandon unprotected guest account?",
      authGuestSwitchProtectFirst: "Protect account first",
      authGuestSwitchProceed: "Abandon guest & switch",
      authGuestSwitchCancel: "Cancel",
      authGuestSwitchTypeLabel: "Type your current guest username to confirm leaving it:",
      deselectBtn: "Deselect",
      removeSelectedBtn: "Remove selected",
      removeAllInViewBtn: "Remove all in this view",
      savedListScopeNote: "The questions stay in the course; only your Saved list changes.",
      mistakesHelpLine: "Resolve = you've learned it (kept under Resolved). Delete = remove it from your list.",
      mistakesClearScopeNote: "This clears your revision list only. Your scores, attempts and leaderboard results are kept.",
      resolveSelectedBtn: "Resolve selected",
      deleteSelectedBtn: "Delete selected",
      undoLabel: "Undo",
      restoredNotice: "Restored.",
      undoUnavailableNotice: "Undo is no longer available for this account.",
      sessionInvalidatedUnsynced: "Your previous session ended, so active local data was cleared from this screen. Sign back into that account on this browser within 7 days to recover unsynced or unresolved changes. Note: this local browser recovery copy is unencrypted and anyone using this browser profile could inspect storage — remove device data in Settings if on a shared computer.",
      sessionInvalidatedRecoveryFailed: "Your previous session ended, and saving the local recovery backup failed. Your unsynced work remains kept locally for that account (unencrypted and hidden from other accounts) — sign back into that account on this browser to recover it, or clear device data in Settings.",
      sessionInvalidatedAuthClearFailed: "Your session ended on the server, but browser storage prevented clearing or verifying removal of your local session record. Some local session or study data may remain in this browser.",
      recoveredUnresolvedNotice: "Recovered unresolved local changes from your local 7-day browser recovery backup — review them in Settings.",
      recoveryRestoreFailedNotice: "Could not restore saved local recovery changes because browser storage is full or recovery data is corrupted. Your recovery backup was kept intact; free storage or review Settings.",
      syncConflictBannerTitle: "Unresolved offline / sync changes",
      syncConflictRefreshPrompt: "This tab is using an outdated sync format. Refresh the page to update before syncing clears or deletions.",
      syncConflictReviewPrompt: "Some local changes conflicted with newer cloud updates or need your review before syncing.",
      syncConflictDestructiveHint: "Clears and deletions are never auto-replayed after a conflict — choose Apply or Discard below.",
      syncConflictApplyBtn: "Apply",
      syncConflictDiscardBtn: "Discard",
      syncConflictApplyAllBtn: "Apply All",
      syncConflictDiscardAllBtn: "Discard All",
      syncConflictRefreshBtn: "Refresh App",
      syncConflictSavedKind: "Saved item",
      syncConflictClearKind: "Clear list",
      syncConflictDeleteKind: "Remove item",
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
      clearLocalBtn: "امسح بيانات المذاكرة من الجهاز ده",
      accountModalHeading: "حساب elgo lab.",
      authTabGuest: "بالاسم بس (من غير كلمة سر)",
      authTabLogin: "تسجيل الدخول",
      authTabRegister: "حساب جديد",
      authTabUpgrade: "إضافة كلمة سر",
      authGuestNotice: "الاسم ده بيشتغل على المتصفح ده بس. ضيف كلمة سر في أي وقت علشان تستخدمه على أي جهاز.",
      authUsernameLabel: "اسم المستخدم / الاسم الظاهر",
      authUsernamePlaceholder: "مثال: adham_ai",
      authUpgradeRenameHint: "لتغيير الاسم، استخدم الإعدادات",
      authPasswordLabel: "كلمة السر",
      authPasswordNewPlaceholder: "٨ حروف على الأقل",
      authPasswordNewHint: "٨ حروف على الأقل",
      authPasswordLoginPlaceholder: "اكتب كلمة السر",
      authSubmitGuest: "ادخل بالاسم (من غير كلمة سر)",
      authSubmitLogin: "تسجيل الدخول",
      authSubmitRegister: "إنشاء الحساب",
      authSubmitUpgrade: "احفظ تقدمك بين الأجهزة",
      authBrowseLocally: "تصفح محلياً من غير حفظ أونلاين",
      authCloseAria: "إغلاق",
      authWelcomePrefix: "أهلاً، ",
      authFailedFallback: "فشل تسجيل الدخول",
      authNetworkError: "تعذر الاتصال بالسيرفر. جرب تاني لما تتصل بالإنترنت.",
      protectNudgeText: "احمي تقدمك — ضيف كلمة سر في ٣٠ ثانية",
      protectNudgeAction: "حماية الحساب",
      protectNudgeDismiss: "إخفاء",
      authGuestSwitchTitle: "هتسيب حساب الزائر من غير حماية؟",
      authGuestSwitchProtectFirst: "احمي الحساب الأول",
      authGuestSwitchProceed: "ترك الحساب والتبديل",
      authGuestSwitchCancel: "إلغاء",
      authGuestSwitchTypeLabel: "اكتب اسم الزائر الحالي للتأكيد قبل ما تسيبه:",
      deselectBtn: "إلغاء التحديد",
      removeSelectedBtn: "حذف المحدد",
      removeAllInViewBtn: "مسح الكل في العرض ده",
      savedListScopeNote: "الأسئلة بتفضل في المادة زي ما هي؛ قائمة المحفوظ بس هي اللي بتتغير.",
      mistakesHelpLine: "حلّيتها = اتعلمتها (بتفضل في المحلولة). مسح = إزالة من قائمتك.",
      mistakesClearScopeNote: "ده بيمسح قائمة المراجعة بس. درجاتك ومحاولاتك وترتيبك محفوظين.",
      resolveSelectedBtn: "تحديد المحدد كمحلول",
      deleteSelectedBtn: "مسح المحدد",
      undoLabel: "تراجع",
      restoredNotice: "تم الاسترجاع.",
      undoUnavailableNotice: "التراجع لم يعد متاحًا لهذا الحساب.",
      sessionInvalidatedUnsynced: "جلستك السابقة انتهت، واتمسحت البيانات النشطة من الشاشة. سجل دخول تاني بنفس الحساب على المتصفح ده خلال ٧ أيام علشان تسترجع التغييرات غير المتزامنة أو المعلقة. تنبيه: نسخة الاسترداد المحلية دي غير مشفرة وأي حد يستخدم نفس المتصفح يقدر يوصل لبيانات التخزين — امسح بيانات الجهاز من الإعدادات لو على جهاز مشترك.",
      sessionInvalidatedRecoveryFailed: "جلستك السابقة انتهت، وتعذر حفظ نسخة الاسترداد الاحتياطية. تغييراتك غير المتزامنة لسه محفوظة محلياً للحساب ده (غير مشفرة ومخفية عن الحسابات التانية) — سجل دخول بنفس الحساب علشان تسترجعها، أو امسح البيانات من الإعدادات.",
      sessionInvalidatedAuthClearFailed: "انتهت جلستك على السيرفر، لكن تخزين المتصفح منع مسح بيانات الجلسة المحلية أو التحقق من إزالتها. قد تبقى بعض بيانات الجلسة أو المذاكرة في المتصفح ده.",
      recoveredUnresolvedNotice: "تم استرجاع تغييرات محلية غير متزامنة من نسخة الاسترداد المحلية على المتصفح ده — راجعها من الإعدادات.",
      recoveryRestoreFailedNotice: "تعذر استرجاع التغييرات المحفوظة لأن مساحة التخزين ممتلئة أو بيانات الاسترداد تالفة. تم الحفاظ على نسخة الاسترداد؛ فرّغ مساحة أو راجع الإعدادات.",
      syncConflictBannerTitle: "تغييرات محلية غير متزامنة تحتاج مراجعة",
      syncConflictRefreshPrompt: "التبويب ده بيستخدم صيغة مزامنة قديمة. حدّث الصفحة قبل مزامنة عمليات المسح أو الحذف.",
      syncConflictReviewPrompt: "بعض التغييرات المحلية اتعارضت مع تحديثات أحدث على السحابة أو محتاجة مراجعتك قبل المزامنة.",
      syncConflictDestructiveHint: "عمليات المسح والحذف مش بتتنفذ تلقائياً بعد التعارض — اختار تطبيق أو تجاهل تحت.",
      syncConflictApplyBtn: "تطبيق",
      syncConflictDiscardBtn: "تجاهل",
      syncConflictApplyAllBtn: "تطبيق الكل",
      syncConflictDiscardAllBtn: "تجاهل الكل",
      syncConflictRefreshBtn: "تحديث الصفحة",
      syncConflictSavedKind: "عنصر محفوظ",
      syncConflictClearKind: "مسح القائمة",
      syncConflictDeleteKind: "حذف عنصر",
    },
  };

  function getStorageStrict() {
    try {
      if (typeof localStorage !== "undefined" && localStorage) {
        return { ok: true, storage: localStorage };
      }
    } catch (err) {
      return {
        ok: false,
        code: classifyStorageError(err) === "STORAGE_DENIED" ? "STORAGE_DENIED" : "STORAGE_UNAVAILABLE",
        storage: null,
        error: (err && err.message) ? err.message : "Browser storage access was denied.",
      };
    }
    try {
      if (root && root.localStorage) {
        return { ok: true, storage: root.localStorage };
      }
    } catch (err2) {
      return {
        ok: false,
        code: classifyStorageError(err2) === "STORAGE_DENIED" ? "STORAGE_DENIED" : "STORAGE_UNAVAILABLE",
        storage: null,
        error: (err2 && err2.message) ? err2.message : "Browser storage access was denied.",
      };
    }
    return {
      ok: false,
      code: "STORAGE_UNAVAILABLE",
      storage: null,
      error: "Browser storage is unavailable.",
    };
  }

  function getStorage() {
    var res = getStorageStrict();
    return res && res.ok ? res.storage : null;
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
      // Ignore quota or storage lock errors for non-critical writes
    }
  }

  function classifyStorageError(err) {
    if (!err) return "STORAGE_WRITE_FAILED";
    var name = String(err.name || "");
    var msg = String(err.message || "");
    var code = Number(err.code);
    if (
      name === "QuotaExceededError" ||
      name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      code === 22 ||
      code === 1014 ||
      /quota/i.test(msg)
    ) {
      return "QUOTA_EXCEEDED";
    }
    if (
      name === "SecurityError" ||
      name === "AccessDeniedError" ||
      name === "NotAllowedError" ||
      code === 18 ||
      /denied|permission|security/i.test(msg)
    ) {
      return "STORAGE_DENIED";
    }
    return "STORAGE_WRITE_FAILED";
  }

  function readStorageStrict(key) {
    var stRes = getStorageStrict();
    if (!stRes.ok) {
      return { ok: false, code: stRes.code, value: null, error: stRes.error };
    }
    try {
      return { ok: true, value: stRes.storage.getItem(key) };
    } catch (err) {
      return {
        ok: false,
        code: classifyStorageError(err) === "STORAGE_DENIED" ? "STORAGE_DENIED" : "STORAGE_READ_FAILED",
        value: null,
        error: (err && err.message) ? err.message : "Failed to read browser storage.",
      };
    }
  }

  function writeStorageStrict(key, value) {
    var stRes = getStorageStrict();
    if (!stRes.ok) {
      return { ok: false, code: stRes.code, error: stRes.error };
    }
    var st = stRes.storage;
    var str = String(value);
    try {
      st.setItem(key, str);
    } catch (err) {
      return {
        ok: false,
        code: classifyStorageError(err),
        error: (err && err.message) ? err.message : "Failed to write to browser storage.",
      };
    }
    try {
      var verified = st.getItem(key);
      if (verified !== str) {
        return {
          ok: false,
          code: "STORAGE_VERIFY_FAILED",
          error: "Written recovery data failed read-back verification.",
        };
      }
    } catch (err2) {
      return {
        ok: false,
        code: "STORAGE_VERIFY_FAILED",
        error: (err2 && err2.message) ? err2.message : "Failed to verify written browser storage.",
      };
    }
    return { ok: true };
  }

  function removeStorageStrict(key) {
    var stRes = getStorageStrict();
    if (!stRes.ok) {
      return { ok: false, code: stRes.code, error: stRes.error };
    }
    var st = stRes.storage;
    try {
      st.removeItem(key);
    } catch (err) {
      return {
        ok: false,
        code: classifyStorageError(err),
        error: (err && err.message) ? err.message : "Failed to remove browser storage item.",
      };
    }
    try {
      var after = st.getItem(key);
      if (after !== null && after !== undefined) {
        return { ok: false, code: "STORAGE_VERIFY_FAILED", error: "Storage entry still exists after removal." };
      }
    } catch (err2) {
      return {
        ok: false,
        code: "STORAGE_VERIFY_FAILED",
        error: (err2 && err2.message) ? err2.message : "Failed to verify storage removal.",
      };
    }
    return { ok: true };
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
  var authGeneration = 1;
  var serverClockOffsetMs = null;
  var lastRecordedServerMs = 0;
  var progressSyncTimer = null;
  var progressSyncInFlight = null;
  var syncRetryTimer = null;
  var syncRetryAttempts = 0;
  var refreshSessionInFlight = null;
  var lastCloudPullAt = 0;
  var cloudPullInFlight = null;
  var legacySeedMergedThisLoad = false;
  var lastInvalidationNotice = null;
  var lastRecoveredNotice = null;
  var lastRecoveryError = null;
  var lastRecoveryPurgeWarning = null;
  var lastAuthClearResult = null;
  var lastClearDeviceResult = null;
  var lastCloudSyncStatus = { ok: true, at: 0, status: 0, error: "", offline: false };

  var RECOVERY_VAULT_KEY = "elgo_recovery_v1";
  var RECOVERY_VAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  var MAX_RECOVERY_VAULT_ACCOUNTS = 8;
  var MAX_RECOVERY_VAULT_ENTRY_BYTES = 512 * 1024;
  var MAX_RECOVERY_VAULT_TOTAL_BYTES = 2 * 1024 * 1024;
  var TAB_SYNC_KEY = "elgo_tab_sync_v1";
  var SYNC_PROTOCOL_VERSION = 3;
  var MAX_CLIENT_GEN = 0xFFFFFFFF;
  var MAX_CLIENT_SEQ = 0xFFFFFFFF;
  var MAX_PROGRESS_BYTES = 400 * 1024;
  var UTF8_ENCODER = typeof TextEncoder === "function" ? new TextEncoder() : null;
  var memTabSession = { tabTag: "", tabSeq: 0 };
  var tabInstanceId = "ti_" + Math.random().toString(36).slice(2, 10);
  var tabBroadcastChannel = null;

  function utf8ByteLength(value) {
    var str = typeof value === "string" ? value : String(value == null ? "" : value);
    if (UTF8_ENCODER) return UTF8_ENCODER.encode(str).length;
    var bytes = 0;
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xD800 && code <= 0xDBFF) {
        var next = str.charCodeAt(i + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) { bytes += 4; i += 1; }
        else bytes += 3;
      } else {
        bytes += 3;
      }
    }
    return bytes;
  }

  function encodeUtf8Bytes(str) {
    if (UTF8_ENCODER) return UTF8_ENCODER.encode(str);
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
      else if (c >= 0xD800 && c <= 0xDBFF) {
        var c2 = str.charCodeAt(i + 1);
        if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
          var cp = 0x10000 + (((c & 0x3FF) << 10) | (c2 & 0x3FF));
          out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
          i += 1;
        } else {
          out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
        }
      } else {
        out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
      }
    }
    return out;
  }

  function fnv1a32Bytes(str, seed) {
    var bytes = encodeUtf8Bytes(str);
    var h = seed >>> 0;
    for (var j = 0; j < bytes.length; j += 1) {
      h ^= bytes[j];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  }

  function opScopeSignature(actionCode, scopeKey) {
    var raw = String(actionCode || "") + "\x00" + String(scopeKey == null ? "" : scopeKey);
    return String(actionCode || "") + "_" + fnv1a32Bytes(raw, 0x811c9dc5) + fnv1a32Bytes(raw, 0x050c5d1f);
  }

  var SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  var SHA256_INIT = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

  function toByteArray(input) {
    if (typeof input === "string") return Array.from(encodeUtf8Bytes(input));
    if (Array.isArray(input)) return input;
    if (input && typeof input.length === "number") {
      var out = new Array(input.length);
      for (var i = 0; i < input.length; i++) out[i] = input[i] & 0xff;
      return out;
    }
    return [];
  }

  function sha256Bytes(input) {
    var msg = toByteArray(input).slice();
    var bitLen = msg.length * 8;
    msg.push(0x80);
    while ((msg.length % 64) !== 56) msg.push(0);
    var hi = Math.floor(bitLen / 0x100000000);
    var lo = bitLen >>> 0;
    msg.push((hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff);
    msg.push((lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff);

    var h = SHA256_INIT.slice();
    var w = new Array(64);
    var rotr = function (n, x) { return (x >>> n) | (x << (32 - n)); };
    for (var offset = 0; offset < msg.length; offset += 64) {
      for (var i = 0; i < 16; i++) {
        var idx = offset + i * 4;
        w[i] = ((msg[idx] << 24) | (msg[idx + 1] << 16) | (msg[idx + 2] << 8) | msg[idx + 3]) >>> 0;
      }
      for (var j = 16; j < 64; j++) {
        var s0 = rotr(7, w[j - 15]) ^ rotr(18, w[j - 15]) ^ (w[j - 15] >>> 3);
        var s1 = rotr(17, w[j - 2]) ^ rotr(19, w[j - 2]) ^ (w[j - 2] >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (var r = 0; r < 64; r++) {
        var S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
        var ch = (e & f) ^ ((~e) & g);
        var temp1 = (hh + S1 + ch + SHA256_K[r] + w[r]) >>> 0;
        var S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var temp2 = (S0 + maj) >>> 0;
        hh = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
    }
    var out = new Array(32);
    for (var k = 0; k < 8; k++) {
      out[k * 4] = (h[k] >>> 24) & 0xff;
      out[k * 4 + 1] = (h[k] >>> 16) & 0xff;
      out[k * 4 + 2] = (h[k] >>> 8) & 0xff;
      out[k * 4 + 3] = h[k] & 0xff;
    }
    return out;
  }

  function bytesToHexStr(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += (bytes[i] & 0xff).toString(16).padStart(2, "0");
    return s;
  }

  function getSessionStorageSafe() {
    try {
      if (typeof sessionStorage !== "undefined" && sessionStorage) return sessionStorage;
    } catch (_e) { /* ignore */ }
    try {
      if (root && root.sessionStorage) return root.sessionStorage;
    } catch (_e2) { /* ignore */ }
    return null;
  }

  function isValidTabTag(val) {
    return typeof val === "string" &&
      val.length >= 2 &&
      val.length <= 16 &&
      /^[A-Za-z0-9_-]+$/.test(val) &&
      val !== "__proto__" &&
      val !== "constructor" &&
      val !== "prototype";
  }

  function writeTabSession(rec) {
    memTabSession = { tabTag: rec.tabTag, tabSeq: rec.tabSeq };
    var ss = getSessionStorageSafe();
    if (ss) {
      try { ss.setItem(TAB_SYNC_KEY, JSON.stringify(memTabSession)); } catch (_e) { /* ignore */ }
    }
  }

  function ensureTabSession(forceRotate) {
    var ss = getSessionStorageSafe();
    var raw = null;
    if (!forceRotate && ss) {
      try { raw = safeJsonParse(ss.getItem(TAB_SYNC_KEY), null); } catch (_e) { raw = null; }
    }
    var src = (!forceRotate && raw && typeof raw === "object") ? raw : (!forceRotate ? memTabSession : null);
    var tabTag = src && isValidTabTag(src.tabTag) ? src.tabTag : ("t" + generateRandomHexClient(4));
    var rawSeq = src ? Number(src.tabSeq) : 0;
    var tabSeq = Number.isSafeInteger(rawSeq) && rawSeq >= 0 && rawSeq <= MAX_CLIENT_SEQ ? rawSeq : 0;
    if (forceRotate) {
      tabTag = "t" + generateRandomHexClient(4);
      tabSeq = 0;
    }
    var rec = { tabTag: tabTag, tabSeq: tabSeq };
    writeTabSession(rec);
    return rec;
  }

  function initCrossTabListeners() {
    if (typeof document === "undefined" || !root || typeof root.addEventListener !== "function") return;
    if (!tabBroadcastChannel && typeof root.BroadcastChannel === "function") {
      try {
        tabBroadcastChannel = new root.BroadcastChannel("elgo_sync_tab_v1");
        var myTab = ensureTabSession(false);
        tabBroadcastChannel.onmessage = function (ev) {
          var msg = ev && ev.data;
          if (!msg || typeof msg !== "object" || msg.sender === tabInstanceId) return;
          var cur = ensureTabSession(false);
          if (msg.type === "tab_hello" && msg.tabTag === cur.tabTag) {
            tabBroadcastChannel.postMessage({ type: "tab_collision", tabTag: cur.tabTag, target: msg.sender, sender: tabInstanceId });
          } else if (msg.type === "tab_collision" && msg.target === tabInstanceId && msg.tabTag === cur.tabTag) {
            ensureTabSession(true);
          }
        };
        tabBroadcastChannel.postMessage({ type: "tab_hello", tabTag: myTab.tabTag, sender: tabInstanceId });
        if (typeof tabBroadcastChannel.unref === "function") tabBroadcastChannel.unref();
      } catch (_e) { /* ignore */ }
    }
    try {
      if (!root.__elgoAuthStorageBound) {
        root.__elgoAuthStorageBound = true;
        root.addEventListener("storage", function (ev) {
          if (!ev || (ev.key !== AUTH_KEY && ev.key !== LEGACY_AUTH_KEY && ev.key !== null)) return;
          authGeneration += 1;
          refreshSessionInFlight = null;
          progressSyncInFlight = null;
          cloudPullInFlight = null;
          clearSyncRetryTimer();
          if (progressSyncTimer && typeof clearTimeout === "function") {
            clearTimeout(progressSyncTimer);
            progressSyncTimer = null;
          }
          if (typeof document !== "undefined" && typeof document.dispatchEvent === "function" && typeof root.CustomEvent === "function") {
            document.dispatchEvent(new root.CustomEvent("elgo:authchange", { detail: { auth: getAuth() } }));
          }
        });
      }
    } catch (_e2) { /* ignore */ }
  }

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

  function generateRandomHexClient(byteLen) {
    var hex = "";
    try {
      if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
        var arr = new Uint8Array(byteLen || 6);
        crypto.getRandomValues(arr);
        for (var i = 0; i < arr.length; i++) hex += arr[i].toString(16).padStart(2, "0");
      }
    } catch (_e) { /* fallback */ }
    if (!hex) {
      while (hex.length < (byteLen || 6) * 2) {
        hex += Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
      }
    }
    return hex.slice(0, (byteLen || 6) * 2);
  }

  function isValidSyncClientId(val) {
    return typeof val === "string" &&
      val.length >= 6 &&
      val.length <= 40 &&
      /^[A-Za-z0-9_-]+$/.test(val) &&
      val !== "__proto__" &&
      val !== "constructor" &&
      val !== "prototype";
  }

  function ensureSyncClientIdentity(st) {
    if (!st || typeof st !== "object") return "c_" + generateRandomHexClient(6);
    if (!isValidSyncClientId(st.syncClientId)) {
      st.syncClientId = "c_" + generateRandomHexClient(6);
    }
    if (!Number.isSafeInteger(st.syncClientGen) || st.syncClientGen < 0 || st.syncClientGen > MAX_CLIENT_GEN) {
      st.syncClientGen = 0;
    }
    if (!Number.isSafeInteger(st.syncClientSeq) || st.syncClientSeq < 0 || st.syncClientSeq > MAX_CLIENT_SEQ) {
      st.syncClientSeq = 0;
    }
    if (!Number.isSafeInteger(st.syncEpoch) || st.syncEpoch < 0) {
      st.syncEpoch = 0;
    }
    if (!Number.isSafeInteger(st.syncBaselineEpoch) || st.syncBaselineEpoch < 0) {
      st.syncBaselineEpoch = 0;
    }
    return st.syncClientId;
  }

  function hydrateClockCalFromStorage() {
    if (serverClockOffsetMs !== null) return;
    var parsed = safeJsonParse(readStorage(STATE_KEY), null);
    if (parsed && typeof parsed === "object" && parsed.serverClockCal && typeof parsed.serverClockCal === "object") {
      var off = Number(parsed.serverClockCal.offsetMs);
      var srv = Number(parsed.serverClockCal.serverMs);
      if (Number.isFinite(off)) {
        serverClockOffsetMs = off;
        if (Number.isFinite(srv) && srv > 0) lastRecordedServerMs = srv;
      }
    }
  }

  function getEffectiveNowMs() {
    hydrateClockCalFromStorage();
    if (serverClockOffsetMs !== null) {
      var est = Date.now() + serverClockOffsetMs;
      return lastRecordedServerMs > 0 ? Math.max(est, lastRecordedServerMs) : est;
    }
    return Date.now();
  }

  function recordServerTime(serverTimeMs, persistToStorage) {
    var srv = Number(serverTimeMs);
    if (!Number.isFinite(srv) || srv <= 0) return;
    if (lastRecordedServerMs > 0 && srv < lastRecordedServerMs) {
      return;
    }
    var offset = srv - Date.now();
    serverClockOffsetMs = offset;
    lastRecordedServerMs = srv;
    if (persistToStorage !== false) {
      var raw = readStorage(STATE_KEY);
      var parsed = safeJsonParse(raw, null);
      if (parsed && typeof parsed === "object") {
        parsed.serverClockCal = { offsetMs: offset, recordedAtMs: Date.now(), serverMs: srv };
        saveState(parsed);
      }
    }
  }

  function makeSyncOpId(stObj, actionCode, scopeId) {
    var target = stObj && typeof stObj === "object" ? stObj : getState();
    var clientId = ensureSyncClientIdentity(target);
    var gen = Number.isSafeInteger(target.syncClientGen) && target.syncClientGen >= 1 && target.syncClientGen <= MAX_CLIENT_GEN
      ? target.syncClientGen
      : 0;
    if (gen < 1 || !actionCode) {
      return "";
    }
    var tab = ensureTabSession(false);
    if (tab.tabSeq >= MAX_CLIENT_SEQ) {
      tab = ensureTabSession(true);
    }
    tab.tabSeq += 1;
    writeTabSession(tab);
    target.syncClientSeq = tab.tabSeq;
    if (!stObj) saveState(target);
    var provenance = opScopeSignature(actionCode, scopeId || "");
    return "v3." + clientId + "." + gen.toString(36) + "." + tab.tabTag + "." + tab.tabSeq.toString(36) + "." + provenance + "." + generateRandomHexClient(4);
  }

  function emptyClearOps() {
    return {
      bookmarksGlobal: null,
      bookmarksBySubject: {},
      deletedBookmarks: {},
      mistakesGlobal: null,
      mistakesBySubject: {},
      deletedMistakes: {},
    };
  }

  function normalizeClientClearOps(raw) {
    var src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    var normEntry = function (entry) {
      if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || !entry.id) return null;
      return { id: entry.id, clientAt: typeof entry.clientAt === "string" ? entry.clientAt : "" };
    };
    var normMap = function (mapSrc, maxEntries, maxKeyLen) {
      var out = {};
      if (!mapSrc || typeof mapSrc !== "object" || Array.isArray(mapSrc)) return out;
      var keys = Object.keys(mapSrc);
      for (var i = 0; i < keys.length && Object.keys(out).length < maxEntries; i++) {
        var k = keys[i];
        if (!k || k.length > maxKeyLen || k === "__proto__" || k === "constructor" || k === "prototype") continue;
        var norm = normEntry(mapSrc[k]);
        if (norm) out[k] = norm;
      }
      return out;
    };
    return {
      bookmarksGlobal: normEntry(src.bookmarksGlobal),
      bookmarksBySubject: normMap(src.bookmarksBySubject, 200, 160),
      deletedBookmarks: normMap(src.deletedBookmarks, 500, 500),
      mistakesGlobal: normEntry(src.mistakesGlobal),
      mistakesBySubject: normMap(src.mistakesBySubject, 200, 160),
      deletedMistakes: normMap(src.deletedMistakes, 500, 500),
    };
  }

  function getExtremeFutureCutoffMs() {
    hydrateClockCalFromStorage();
    var ref = getEffectiveNowMs();
    return ref + (serverClockOffsetMs !== null ? 365 : 10 * 365) * 24 * 60 * 60 * 1000;
  }

  function parseReasonableIsoMsClient(val) {
    hydrateClockCalFromStorage();
    var ms = parseIsoMsClient(val);
    if (!ms || ms > getExtremeFutureCutoffMs()) return 0;
    if (serverClockOffsetMs !== null) {
      var effNow = getEffectiveNowMs();
      return ms <= effNow + 300000 ? ms : effNow;
    }
    return ms;
  }

  function nextMutationIso() {
    var now = getEffectiveNowMs();
    var extremeCutoff = getExtremeFutureCutoffMs();
    var minMs = 0;
    for (var i = 0; i < arguments.length; i++) {
      var candidate = parseIsoMsClient(arguments[i]);
      if (!candidate || candidate > extremeCutoff) continue;
      if (candidate > minMs) minMs = candidate;
    }
    var next = Math.max(now, lastMutationMs + 1, minMs + 1);
    lastMutationMs = next;
    return new Date(next).toISOString();
  }

  function trimTimestampMapClient(src, maxEntries, maxKeyLength) {
    if (!src || typeof src !== "object" || Array.isArray(src)) return {};
    var limit = maxEntries || 500;
    var maxKeyLen = maxKeyLength || 500;
    var extremeCutoff = getExtremeFutureCutoffMs();
    var entries = Object.entries(src).filter(function (pair) {
      var ms = parseIsoMsClient(pair[1]);
      return pair[0] && pair[0].length <= maxKeyLen &&
        pair[0] !== "__proto__" && pair[0] !== "constructor" && pair[0] !== "prototype" &&
        typeof pair[1] === "string" && ms > 0 && ms <= extremeCutoff;
    });
    if (entries.length > limit) {
      entries.sort(function (a, b) { return parseIsoMsClient(b[1]) - parseIsoMsClient(a[1]); });
      entries.length = limit;
    }
    var out = {};
    entries.forEach(function (pair) {
      out[pair[0]] = pair[1];
    });
    return out;
  }

  function resolveItemSubjectId(item) {
    if (!item || typeof item !== "object") return "";
    if (typeof item.subjectId === "string" && item.subjectId.trim()) return item.subjectId.trim();
    var raw = String(item.internalId || item.id || item.questionId || "");
    var sep = raw.indexOf("::");
    return sep > 0 ? raw.slice(0, sep).trim() : "";
  }

  function emptyUnresolvedMutations(ownerId) {
    return {
      ownerStudentId: typeof ownerId === "string" ? ownerId : "",
      reason: "",
      actionRequired: "",
      error: "",
      createdAt: 0,
      items: [],
    };
  }

  function normalizeUnresolvedMutations(raw, expectedOwnerId) {
    var expected = typeof expectedOwnerId === "string" ? expectedOwnerId : "";
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return emptyUnresolvedMutations(expected);
    }
    var recOwner = typeof raw.ownerStudentId === "string" ? raw.ownerStudentId : "";
    if (expected && recOwner && recOwner !== expected) {
      return emptyUnresolvedMutations(expected);
    }
    var resolvedOwner = expected || recOwner;
    var items = Array.isArray(raw.items) ? raw.items.filter(function (entry) {
      if (!entry || typeof entry !== "object") return false;
      if (resolvedOwner && entry.ownerStudentId && entry.ownerStudentId !== resolvedOwner) return false;
      return typeof entry.kind === "string" && entry.kind.length > 0;
    }) : [];
    return {
      ownerStudentId: resolvedOwner,
      reason: typeof raw.reason === "string" ? raw.reason : "",
      actionRequired: typeof raw.actionRequired === "string" ? raw.actionRequired : "",
      error: typeof raw.error === "string" ? raw.error : "",
      createdAt: Number(raw.createdAt) || 0,
      items: items,
    };
  }

  function buildAcknowledgedSnapshot(cloudRaw, cloudBookmarks, cloudMistakes, delBm, bmCleared, bmSubj, delMk, mkCleared, mkSubj, cloudAttempts, cloudEpoch, ownerStudentId) {
    return {
      ownerStudentId: ownerStudentId || "",
      syncEpoch: Number(cloudEpoch) || 0,
      bookmarks: Array.isArray(cloudBookmarks) ? cloudBookmarks.slice() : [],
      mistakes: Array.isArray(cloudMistakes) ? cloudMistakes.slice() : [],
      deletedBookmarks: Object.assign({}, delBm || {}),
      bookmarksClearedAt: bmCleared || null,
      bookmarksClearedAtBySubject: Object.assign({}, bmSubj || {}),
      deletedMistakes: Object.assign({}, delMk || {}),
      mistakesClearedAt: mkCleared || null,
      mistakesClearedAtBySubject: Object.assign({}, mkSubj || {}),
      attempts: Array.isArray(cloudAttempts) ? cloudAttempts.slice(0, 50) : [],
      syncMeta: (cloudRaw && cloudRaw.syncMeta && typeof cloudRaw.syncMeta === "object") ? cloudRaw.syncMeta : null,
    };
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
        bookmarksClearedAt: null,
        bookmarksClearedAtBySubject: {},
        mistakes: legacy.mistakes,
        deletedMistakes: {},
        mistakesClearedAt: null,
        mistakesClearedAtBySubject: {},
        clearOps: emptyClearOps(),
        syncClientId: "",
        syncClientGen: 0,
        syncClientSeq: 0,
        syncEpoch: 0,
        syncBaselineEpoch: 0,
        serverClockCal: null,
        acknowledgedCloudProgress: null,
        unresolvedMutations: emptyUnresolvedMutations(""),
        needsSyncRegistration: false,
        localMutRev: 0,
        localMutToken: "",
        attemptHistory: legacy.attempts,
        activeSession: null,
        lastAttempt: null,
        quizModes: {},
        ownerStudentId: "",
        ownerUsername: "",
        pendingProgressSync: legacy.bookmarks.length > 0 || legacy.mistakes.length > 0,
        guestProtectNudgeShown: false,
        legacyMerged: true,
      };
    }
    var stateObj = Object.assign({
      selectedSourcesBySubject: {},
      bookmarks: [],
      deletedBookmarks: {},
      bookmarksClearedAt: null,
      bookmarksClearedAtBySubject: {},
      mistakes: [],
      deletedMistakes: {},
      mistakesClearedAt: null,
      mistakesClearedAtBySubject: {},
      clearOps: emptyClearOps(),
      syncClientId: "",
      syncClientGen: 0,
      syncClientSeq: 0,
      syncEpoch: 0,
      syncBaselineEpoch: 0,
      serverClockCal: null,
      acknowledgedCloudProgress: null,
      unresolvedMutations: emptyUnresolvedMutations(""),
      needsSyncRegistration: false,
      localMutRev: 0,
      localMutToken: "",
      attemptHistory: [],
      activeSession: null,
      lastAttempt: null,
      quizModes: {},
      ownerStudentId: "",
      ownerUsername: "",
      pendingProgressSync: false,
      guestProtectNudgeShown: false,
    }, parsed);
    stateObj.clearOps = normalizeClientClearOps(stateObj.clearOps);
    stateObj.syncClientGen = Number.isSafeInteger(Number(stateObj.syncClientGen)) && Number(stateObj.syncClientGen) > 0
      ? Number(stateObj.syncClientGen)
      : 0;
    stateObj.syncBaselineEpoch = Number.isSafeInteger(Number(stateObj.syncBaselineEpoch)) && Number(stateObj.syncBaselineEpoch) > 0
      ? Number(stateObj.syncBaselineEpoch)
      : 0;
    stateObj.unresolvedMutations = normalizeUnresolvedMutations(stateObj.unresolvedMutations, stateObj.ownerStudentId || "");

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

  function saveStateStrict(next) {
    var serialized = "";
    try {
      serialized = JSON.stringify(next || {});
    } catch (err) {
      return {
        ok: false,
        code: "SERIALIZATION_ERROR",
        error: (err && err.message) ? err.message : "Failed to serialize local state.",
      };
    }
    return writeStorageStrict(STATE_KEY, serialized);
  }

  function markLocalMutation(st) {
    if (st && typeof st === "object") {
      st.pendingProgressSync = true;
      st.localMutRev = (Number(st.localMutRev) || 0) + 1;
      st.localMutToken = generateRandomHexClient(6);
    }
    localMutationSeq += 1;
  }

  function makeVaultSlotId(studentId) {
    return bytesToHexStr(sha256Bytes("elgo-vault-id-v1:" + String(studentId || ""))).slice(0, 24);
  }

  // SHA-256 integrity digest over recovery metadata and payload; used strictly
  // to detect accidental storage corruption/truncation (NOT tamper resistance or confidentiality).
  function computeRecoveryIntegrityHash(slotId, expiresAt, payloadJson) {
    return bytesToHexStr(sha256Bytes("elgo-recovery-integrity-v2|" + String(slotId) + "|" + String(expiresAt) + "|" + String(payloadJson)));
  }

  function sanitizeRecoveryEntry(entry, slotId) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    if (typeof entry.kind !== "string" || !entry.kind) return null;
    var clean = {};
    var keys = Object.keys(entry);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      if (
        k === "ownerStudentId" ||
        k === "ownerUsername" ||
        k === "username" ||
        k === "token" ||
        k === "sessionToken" ||
        k === "password" ||
        k === "passwordHash" ||
        k === "auth"
      ) {
        continue;
      }
      clean[k] = entry[k];
    }
    if (clean.item && typeof clean.item === "object" && !Array.isArray(clean.item)) {
      var cleanItem = Object.assign({}, clean.item);
      delete cleanItem.ownerStudentId;
      delete cleanItem.ownerUsername;
      delete cleanItem.username;
      delete cleanItem.token;
      delete cleanItem.sessionToken;
      delete cleanItem.password;
      delete cleanItem.passwordHash;
      delete cleanItem.auth;
      clean.item = cleanItem;
    }
    clean.ownerSlotId = slotId;
    return clean;
  }

  function restoreEntriesForOwner(entries, sid, expectedSlotId) {
    var out = [];
    var list = Array.isArray(entries) ? entries : [];
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e || typeof e !== "object" || Array.isArray(e) || typeof e.kind !== "string" || !e.kind) {
        return null;
      }
      if (e.ownerSlotId && e.ownerSlotId !== expectedSlotId) return null;
      if (e.ownerStudentId && e.ownerStudentId !== sid) return null;
      var restoredEntry = Object.assign({}, e, { ownerStudentId: sid });
      delete restoredEntry.ownerSlotId;
      out.push(restoredEntry);
    }
    return out;
  }

  function parseRecoveryVaultStoreRaw(raw, nowMs) {
    var now = Number(nowMs) || Date.now();
    if (raw === null || raw === undefined || raw === "") {
      return {
        ok: true,
        empty: true,
        validSlots: {},
        corruptSlots: {},
        corruptSlotIds: [],
        expiredSlotIds: [],
      };
    }
    if (typeof raw !== "string") {
      return { ok: false, code: "RECOVERY_STORE_CORRUPT", error: "Local recovery storage format is invalid." };
    }
    var parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (_err) {
      return { ok: false, code: "RECOVERY_STORE_CORRUPT", error: "Local recovery storage contains corrupted JSON." };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.v !== 2 || !parsed.slots || typeof parsed.slots !== "object" || Array.isArray(parsed.slots)) {
      return { ok: false, code: "RECOVERY_STORE_CORRUPT", error: "Local recovery storage schema is invalid or corrupted." };
    }

    var validSlots = {};
    var corruptSlots = {};
    var corruptSlotIds = [];
    var expiredSlotIds = [];
    var entries = Object.entries(parsed.slots);
    for (var i = 0; i < entries.length; i++) {
      var k = entries[i][0];
      var slot = entries[i][1];
      if (k === "__proto__" || k === "constructor" || k === "prototype") {
        return { ok: false, code: "RECOVERY_STORE_CORRUPT", error: "Local recovery storage schema is invalid or corrupted." };
      }
      if (!k || k.length > 40 || !/^[0-9a-f]+$/i.test(k) || !slot || typeof slot !== "object" || Array.isArray(slot)) {
        corruptSlots[k] = slot;
        corruptSlotIds.push(k);
        continue;
      }
      var exp = Number(slot.expiresAt);
      var upd = Number(slot.updatedAt);
      if (
        slot.v !== 2 ||
        !Number.isFinite(exp) ||
        exp <= 0 ||
        !Number.isFinite(upd) ||
        upd < 0 ||
        typeof slot.integrity !== "string" ||
        !slot.payload ||
        typeof slot.payload !== "object" ||
        Array.isArray(slot.payload) ||
        slot.payload.ownerSlotId !== k ||
        !Array.isArray(slot.payload.items)
      ) {
        corruptSlots[k] = slot;
        corruptSlotIds.push(k);
        continue;
      }
      var payloadJson = "";
      try {
        payloadJson = JSON.stringify(slot.payload);
      } catch (_serErr) {
        corruptSlots[k] = slot;
        corruptSlotIds.push(k);
        continue;
      }
      var expectedIntegrity = computeRecoveryIntegrityHash(k, exp, payloadJson);
      if (slot.integrity !== expectedIntegrity) {
        corruptSlots[k] = slot;
        corruptSlotIds.push(k);
        continue;
      }
      if (exp <= now) {
        expiredSlotIds.push(k);
        continue;
      }
      validSlots[k] = slot;
    }
    return {
      ok: true,
      empty: false,
      validSlots: validSlots,
      corruptSlots: corruptSlots,
      corruptSlotIds: corruptSlotIds,
      expiredSlotIds: expiredSlotIds,
    };
  }

  function commitRecoveryVaultUpdate(mutateFn, nowMs) {
    var now = Number(nowMs) || Date.now();
    var MAX_VAULT_CAS_ATTEMPTS = 5;
    for (var attempt = 0; attempt < MAX_VAULT_CAS_ATTEMPTS; attempt++) {
      var readRes = readStorageStrict(RECOVERY_VAULT_KEY);
      if (!readRes.ok) {
        return { ok: false, code: readRes.code, error: readRes.error, count: 0 };
      }
      var rawBefore = readRes.value;
      var parsedRes = parseRecoveryVaultStoreRaw(rawBefore, now);
      if (!parsedRes.ok) {
        return { ok: false, code: parsedRes.code, error: parsedRes.error, count: 0 };
      }
      var decision = mutateFn(parsedRes);
      if (!decision || decision.abort) {
        return (decision && decision.result) || { ok: false, code: "RECOVERY_ABORTED", error: "Recovery update aborted.", count: 0 };
      }
      if (decision.noOp) {
        return Object.assign({ ok: true }, decision.resultMeta || {});
      }

      var midRes = readStorageStrict(RECOVERY_VAULT_KEY);
      if (!midRes.ok) {
        return { ok: false, code: midRes.code, error: midRes.error, count: 0 };
      }
      if (midRes.value !== rawBefore) {
        continue;
      }

      var nextSlots = decision.nextSlots || {};
      var nextKeys = Object.keys(nextSlots);
      if (nextKeys.length === 0) {
        var remRes = removeStorageStrict(RECOVERY_VAULT_KEY);
        if (!remRes.ok) {
          var afterRemRead = readStorageStrict(RECOVERY_VAULT_KEY);
          if (
            afterRemRead.ok &&
            afterRemRead.value &&
            afterRemRead.value !== rawBefore &&
            parseRecoveryVaultStoreRaw(afterRemRead.value, now).ok
          ) {
            continue;
          }
          return { ok: false, code: remRes.code, error: remRes.error, count: 0 };
        }
        return Object.assign({ ok: true }, decision.resultMeta || {});
      }

      var serializedStore = "";
      try {
        serializedStore = JSON.stringify({ v: 2, slots: nextSlots });
      } catch (serErr) {
        return {
          ok: false,
          code: "RECOVERY_SERIALIZE_ERROR",
          error: (serErr && serErr.message) ? serErr.message : "Failed to serialize recovery storage.",
          count: 0,
        };
      }
      if (utf8ByteLength(serializedStore) > MAX_RECOVERY_VAULT_TOTAL_BYTES) {
        return {
          ok: false,
          code: "RECOVERY_CAPACITY_EXCEEDED",
          error: "Total browser recovery storage capacity exceeded.",
          count: 0,
        };
      }

      var writeRes = writeStorageStrict(RECOVERY_VAULT_KEY, serializedStore);
      if (writeRes.ok) {
        return Object.assign({ ok: true }, decision.resultMeta || {});
      }
      if (writeRes.code === "STORAGE_VERIFY_FAILED") {
        var actualAfter = readStorageStrict(RECOVERY_VAULT_KEY);
        if (actualAfter.ok && actualAfter.value && actualAfter.value !== rawBefore && actualAfter.value !== serializedStore) {
          var parsedConcurrent = parseRecoveryVaultStoreRaw(actualAfter.value, now);
          if (parsedConcurrent.ok) {
            continue;
          }
        }
      }
      return { ok: false, code: writeRes.code, error: writeRes.error, count: 0 };
    }
    return {
      ok: false,
      code: "RECOVERY_CONTENTION",
      error: "Concurrent browser tabs prevented verifying recovery storage write.",
      count: 0,
    };
  }

  function verifyRecoverySlotAbsent(slotId) {
    var verifyRead = readStorageStrict(RECOVERY_VAULT_KEY);
    if (!verifyRead.ok) {
      return {
        ok: false,
        code: verifyRead.code || "STORAGE_VERIFY_FAILED",
        error: verifyRead.error || "Failed to verify local recovery removal.",
      };
    }
    if (verifyRead.value === null || verifyRead.value === undefined || verifyRead.value === "") {
      return { ok: true, storeEmpty: true };
    }
    var parsedVerify = parseRecoveryVaultStoreRaw(verifyRead.value, Date.now());
    if (!parsedVerify.ok) {
      return {
        ok: false,
        code: parsedVerify.code || "RECOVERY_STORE_CORRUPT",
        error: parsedVerify.error || "Local recovery storage is corrupted.",
      };
    }
    if (
      Object.prototype.hasOwnProperty.call(parsedVerify.validSlots, slotId) ||
      Object.prototype.hasOwnProperty.call(parsedVerify.corruptSlots, slotId) ||
      parsedVerify.expiredSlotIds.indexOf(slotId) !== -1
    ) {
      return {
        ok: false,
        code: "STORAGE_VERIFY_FAILED",
        error: "Targeted recovery entry still exists in browser storage after removal.",
      };
    }
    return { ok: true, storeEmpty: false };
  }

  function purgeRecoveryVaultForAccount(studentId) {
    var sid = typeof studentId === "string" ? studentId.trim() : "";
    if (!sid) return { ok: true, removed: false, verified: true };
    var slotId = makeVaultSlotId(sid);
    var updateRes = commitRecoveryVaultUpdate(function (parsedRes) {
      var hasValid = Object.prototype.hasOwnProperty.call(parsedRes.validSlots, slotId);
      var hasCorrupt = Object.prototype.hasOwnProperty.call(parsedRes.corruptSlots, slotId);
      var hasExpired = parsedRes.expiredSlotIds.indexOf(slotId) !== -1;
      if (!hasValid && !hasCorrupt && !hasExpired) {
        return { noOp: true, resultMeta: { removed: false } };
      }
      var nextSlots = Object.assign({}, parsedRes.corruptSlots, parsedRes.validSlots);
      delete nextSlots[slotId];
      return { nextSlots: nextSlots, resultMeta: { removed: true } };
    });
    if (!updateRes || !updateRes.ok) {
      return Object.assign({ ok: false, removed: false, verified: false }, updateRes || {});
    }
    var verifyRes = verifyRecoverySlotAbsent(slotId);
    if (!verifyRes.ok) {
      return {
        ok: false,
        removed: false,
        verified: false,
        code: verifyRes.code,
        error: verifyRes.error,
      };
    }
    return Object.assign({}, updateRes, { ok: true, verified: true });
  }

  function purgeAllRecoveryVault() {
    var readBefore = readStorageStrict(RECOVERY_VAULT_KEY);
    if (!readBefore.ok) {
      return { ok: false, removed: false, verified: false, code: readBefore.code, error: readBefore.error };
    }
    var hadData = readBefore.value !== null && readBefore.value !== undefined && readBefore.value !== "";
    if (!hadData) {
      return { ok: true, removed: false, verified: true };
    }
    var remRes = removeStorageStrict(RECOVERY_VAULT_KEY);
    if (!remRes.ok) {
      return { ok: false, removed: false, verified: false, code: remRes.code, error: remRes.error };
    }
    var verifyRead = readStorageStrict(RECOVERY_VAULT_KEY);
    if (!verifyRead.ok) {
      return {
        ok: false,
        removed: false,
        verified: false,
        code: verifyRead.code || "STORAGE_VERIFY_FAILED",
        error: verifyRead.error || "Failed to verify recovery removal.",
      };
    }
    if (verifyRead.value !== null && verifyRead.value !== undefined && verifyRead.value !== "") {
      return {
        ok: false,
        removed: false,
        verified: false,
        code: "STORAGE_VERIFY_FAILED",
        error: "Recovery storage still exists after removal.",
      };
    }
    return { ok: true, removed: true, verified: true };
  }

  function collectRecoverableUnresolvedItems(stObj, studentId) {
    var sid = typeof studentId === "string" ? studentId.trim() : "";
    if (!stObj || typeof stObj !== "object" || !sid) {
      return emptyUnresolvedMutations(sid);
    }
    var existing = normalizeUnresolvedMutations(stObj.unresolvedMutations, sid);
    var extraItems = [];
    if (stObj.pendingProgressSync) {
      var ack = stObj.acknowledgedCloudProgress && typeof stObj.acknowledgedCloudProgress === "object"
        ? stObj.acknowledgedCloudProgress
        : null;
      if (!ack || !ack.ownerStudentId || ack.ownerStudentId === sid) {
        var nowIso = new Date(getEffectiveNowMs()).toISOString();
        var ackBmMap = {};
        if (ack && Array.isArray(ack.bookmarks)) {
          ack.bookmarks.forEach(function (b) {
            var k = b && (b.internalId || b.id || b.questionId || "");
            if (k) ackBmMap[k] = parseIsoMsClient(b.savedAt);
          });
        }
        (Array.isArray(stObj.bookmarks) ? stObj.bookmarks : []).forEach(function (rawBm) {
          var lb = normalizeClientBookmarkItem(rawBm);
          if (!lb) return;
          var ackMs = ackBmMap[lb.internalId];
          var lbMs = parseIsoMsClient(lb.savedAt);
          if (ackMs === undefined || lbMs > ackMs) {
            extraItems.push({
              id: "um_bs_" + lb.internalId,
              ownerStudentId: sid,
              kind: "bookmark_save",
              scopeId: lb.internalId,
              subjectId: resolveItemSubjectId(lb),
              destructive: false,
              label: lb.question || lb.sourceLabel || lb.id || lb.internalId,
              item: Object.assign({}, lb, { syncOpId: "" }),
              reason: "PENDING_OFFLINE_RECOVERY",
              createdAt: lb.savedAt || nowIso,
            });
          }
        });
        var ackMkMap = {};
        if (ack && Array.isArray(ack.mistakes)) {
          ack.mistakes.forEach(function (m) {
            var k = m && (m.internalId || m.id || m.questionId || "");
            if (k) ackMkMap[k] = Math.max(parseIsoMsClient(m.updatedAt), parseIsoMsClient(m.resolvedAt));
          });
        }
        (Array.isArray(stObj.mistakes) ? stObj.mistakes : []).forEach(function (rawMk) {
          var lm = normalizeClientMistakeItem(rawMk);
          if (!lm) return;
          var ackMs = ackMkMap[lm.internalId];
          var lmMs = Math.max(parseIsoMsClient(lm.updatedAt), parseIsoMsClient(lm.resolvedAt));
          if (ackMs === undefined || lmMs > ackMs) {
            extraItems.push({
              id: "um_ms_" + lm.internalId,
              ownerStudentId: sid,
              kind: "mistake_save",
              scopeId: lm.internalId,
              subjectId: resolveItemSubjectId(lm),
              destructive: false,
              label: lm.question || lm.id || lm.internalId,
              item: Object.assign({}, lm, { syncOpId: "" }),
              reason: "PENDING_OFFLINE_RECOVERY",
              createdAt: lm.updatedAt || lm.resolvedAt || nowIso,
            });
          }
        });
        var ackDelBm = (ack && ack.deletedBookmarks) || {};
        Object.keys(stObj.deletedBookmarks || {}).forEach(function (bid) {
          if (parseIsoMsClient(stObj.deletedBookmarks[bid]) > parseIsoMsClient(ackDelBm[bid])) {
            extraItems.push({
              id: "um_bd_" + bid,
              ownerStudentId: sid,
              kind: "bookmark_delete",
              scopeId: bid,
              destructive: true,
              label: bid,
              reason: "PENDING_OFFLINE_RECOVERY",
              createdAt: stObj.deletedBookmarks[bid] || nowIso,
            });
          }
        });
        var ackDelMk = (ack && ack.deletedMistakes) || {};
        Object.keys(stObj.deletedMistakes || {}).forEach(function (mid) {
          if (parseIsoMsClient(stObj.deletedMistakes[mid]) > parseIsoMsClient(ackDelMk[mid])) {
            extraItems.push({
              id: "um_md_" + mid,
              ownerStudentId: sid,
              kind: "mistake_delete",
              scopeId: mid,
              destructive: true,
              label: mid,
              reason: "PENDING_OFFLINE_RECOVERY",
              createdAt: stObj.deletedMistakes[mid] || nowIso,
            });
          }
        });
        if (stObj.bookmarksClearedAt && parseIsoMsClient(stObj.bookmarksClearedAt) > parseIsoMsClient(ack && ack.bookmarksClearedAt)) {
          extraItems.push({
            id: "um_bg_all",
            ownerStudentId: sid,
            kind: "bookmarks_clear",
            scopeId: "",
            subjectId: "",
            destructive: true,
            label: "All Saved",
            reason: "PENDING_OFFLINE_RECOVERY",
            createdAt: stObj.bookmarksClearedAt,
          });
        }
        var ackBmSubj = (ack && ack.bookmarksClearedAtBySubject) || {};
        Object.keys(stObj.bookmarksClearedAtBySubject || {}).forEach(function (subId) {
          if (parseIsoMsClient(stObj.bookmarksClearedAtBySubject[subId]) > parseIsoMsClient(ackBmSubj[subId])) {
            extraItems.push({
              id: "um_bsj_" + subId,
              ownerStudentId: sid,
              kind: "bookmarks_clear",
              scopeId: subId,
              subjectId: subId,
              destructive: true,
              label: subId,
              reason: "PENDING_OFFLINE_RECOVERY",
              createdAt: stObj.bookmarksClearedAtBySubject[subId],
            });
          }
        });
        if (stObj.mistakesClearedAt && parseIsoMsClient(stObj.mistakesClearedAt) > parseIsoMsClient(ack && ack.mistakesClearedAt)) {
          extraItems.push({
            id: "um_mg_all",
            ownerStudentId: sid,
            kind: "mistakes_clear",
            scopeId: "",
            subjectId: "",
            destructive: true,
            label: "All Mistakes",
            reason: "PENDING_OFFLINE_RECOVERY",
            createdAt: stObj.mistakesClearedAt,
          });
        }
        var ackMkSubj = (ack && ack.mistakesClearedAtBySubject) || {};
        Object.keys(stObj.mistakesClearedAtBySubject || {}).forEach(function (subId) {
          if (parseIsoMsClient(stObj.mistakesClearedAtBySubject[subId]) > parseIsoMsClient(ackMkSubj[subId])) {
            extraItems.push({
              id: "um_msj_" + subId,
              ownerStudentId: sid,
              kind: "mistakes_clear",
              scopeId: subId,
              subjectId: subId,
              destructive: true,
              label: subId,
              reason: "PENDING_OFFLINE_RECOVERY",
              createdAt: stObj.mistakesClearedAtBySubject[subId],
            });
          }
        });
      }
    }
    var combined = mergeUnresolvedItemLists(existing.items, extraItems, sid);
    if (!combined.length) return emptyUnresolvedMutations(sid);
    return {
      ownerStudentId: sid,
      reason: existing.reason || (extraItems[0] && extraItems[0].reason) || "SYNC_RESYNC_REQUIRED",
      actionRequired: existing.actionRequired || "RECONCILE_AND_REVIEW",
      error: existing.error || "",
      createdAt: existing.createdAt || Date.now(),
      items: combined,
    };
  }

  function stashUnresolvedForAccount(studentId, stObj) {
    var sid = typeof studentId === "string" ? studentId.trim() : "";
    if (!sid) return { ok: true, count: 0, stashed: 0 };
    var collected = collectRecoverableUnresolvedItems(stObj || getState(), sid);
    if (!collected.items.length) return { ok: true, count: 0, stashed: 0 };

    var now = Date.now();
    var slotId = makeVaultSlotId(sid);
    var res = commitRecoveryVaultUpdate(function (parsedRes) {
      if (Object.prototype.hasOwnProperty.call(parsedRes.corruptSlots, slotId)) {
        return {
          abort: true,
          result: {
            ok: false,
            code: "RECOVERY_SLOT_CORRUPT",
            error: "Existing local recovery data for this account is corrupted.",
            count: 0,
          },
        };
      }

      var hasExistingSlot = Object.prototype.hasOwnProperty.call(parsedRes.validSlots, slotId);
      var existingCount = Object.keys(parsedRes.validSlots).length + Object.keys(parsedRes.corruptSlots).length;
      if (!hasExistingSlot && existingCount >= MAX_RECOVERY_VAULT_ACCOUNTS) {
        return {
          abort: true,
          result: {
            ok: false,
            code: "RECOVERY_VAULT_FULL",
            error: "Local recovery storage already holds the maximum of " + MAX_RECOVERY_VAULT_ACCOUNTS + " accounts.",
            count: 0,
          },
        };
      }

      var mergedItems = collected.items.slice();
      var reason = collected.reason || "";
      var actionRequired = collected.actionRequired || "";
      var errText = collected.error || "";
      var createdAt = collected.createdAt || now;
      if (hasExistingSlot) {
        var existingSlot = parsedRes.validSlots[slotId];
        var existingRestored = restoreEntriesForOwner(existingSlot.payload.items, sid, slotId);
        if (!existingRestored) {
          return {
            abort: true,
            result: {
              ok: false,
              code: "RECOVERY_SLOT_CORRUPT",
              error: "Existing local recovery slot failed integrity validation.",
              count: 0,
            },
          };
        }
        mergedItems = mergeUnresolvedItemLists(existingRestored, collected.items, sid);
        reason = reason || existingSlot.payload.reason || "";
        actionRequired = actionRequired || existingSlot.payload.actionRequired || "";
        errText = errText || existingSlot.payload.error || "";
        createdAt = existingSlot.payload.createdAt || createdAt;
      }

      var sanitizedItems = [];
      for (var i = 0; i < mergedItems.length; i++) {
        var sEntry = sanitizeRecoveryEntry(mergedItems[i], slotId);
        if (!sEntry) {
          return {
            abort: true,
            result: {
              ok: false,
              code: "RECOVERY_SERIALIZE_ERROR",
              error: "An unresolved item could not be serialized for recovery.",
              count: 0,
            },
          };
        }
        sanitizedItems.push(sEntry);
      }

      var payloadObj = {
        ownerSlotId: slotId,
        reason: reason,
        actionRequired: actionRequired,
        error: errText,
        createdAt: createdAt,
        items: sanitizedItems,
      };
      var payloadJson = "";
      try {
        payloadJson = JSON.stringify(payloadObj);
      } catch (serErr) {
        return {
          abort: true,
          result: {
            ok: false,
            code: "RECOVERY_SERIALIZE_ERROR",
            error: (serErr && serErr.message) ? serErr.message : "Failed to serialize recovery entry.",
            count: 0,
          },
        };
      }

      var expiresAt = now + RECOVERY_VAULT_TTL_MS;
      var slotObj = {
        v: 2,
        updatedAt: now,
        expiresAt: expiresAt,
        integrity: computeRecoveryIntegrityHash(slotId, expiresAt, payloadJson),
        payload: payloadObj,
      };
      var slotJson = "";
      try {
        slotJson = JSON.stringify(slotObj);
      } catch (slotSerErr) {
        return {
          abort: true,
          result: {
            ok: false,
            code: "RECOVERY_SERIALIZE_ERROR",
            error: (slotSerErr && slotSerErr.message) ? slotSerErr.message : "Failed to serialize recovery slot.",
            count: 0,
          },
        };
      }
      if (utf8ByteLength(slotJson) > MAX_RECOVERY_VAULT_ENTRY_BYTES) {
        return {
          abort: true,
          result: {
            ok: false,
            code: "RECOVERY_ENTRY_TOO_LARGE",
            error: "Unresolved recovery items exceed the " + Math.round(MAX_RECOVERY_VAULT_ENTRY_BYTES / 1024) + " KiB local recovery entry limit.",
            count: 0,
          },
        };
      }

      var nextSlots = Object.assign({}, parsedRes.corruptSlots, parsedRes.validSlots);
      nextSlots[slotId] = slotObj;
      return {
        nextSlots: nextSlots,
        resultMeta: { count: sanitizedItems.length, stashed: sanitizedItems.length },
      };
    }, now);

    return res;
  }

  function restoreRecoveryVaultForAccount(studentId) {
    var sid = typeof studentId === "string" ? studentId.trim() : "";
    if (!sid) return { ok: true, count: 0, restored: 0 };
    var now = Date.now();
    var readRes = readStorageStrict(RECOVERY_VAULT_KEY);
    if (!readRes.ok) {
      return { ok: false, code: readRes.code, error: readRes.error, count: 0 };
    }
    var parsedRes = parseRecoveryVaultStoreRaw(readRes.value, now);
    if (!parsedRes.ok) {
      return { ok: false, code: parsedRes.code, error: parsedRes.error, count: 0 };
    }

    var slotId = makeVaultSlotId(sid);
    if (Object.prototype.hasOwnProperty.call(parsedRes.corruptSlots, slotId)) {
      return {
        ok: false,
        code: "RECOVERY_SLOT_CORRUPT",
        error: "Saved local recovery data for this account is corrupted and cannot be restored.",
        count: 0,
      };
    }

    var slot = parsedRes.validSlots[slotId];
    if (!slot) {
      return { ok: true, count: 0, restored: 0, expired: parsedRes.expiredSlotIds.indexOf(slotId) !== -1 };
    }

    var restoredEntries = restoreEntriesForOwner(slot.payload.items, sid, slotId);
    if (!restoredEntries || restoredEntries.length !== slot.payload.items.length) {
      return {
        ok: false,
        code: "RECOVERY_SLOT_CORRUPT",
        error: "Saved local recovery entries failed owner validation.",
        count: 0,
      };
    }
    if (!restoredEntries.length) {
      return { ok: true, count: 0, restored: 0 };
    }

    var st = getState();
    var curUnres = normalizeUnresolvedMutations(st.unresolvedMutations, sid);
    var mergedItems = mergeUnresolvedItemLists(restoredEntries, curUnres.items, sid);
    if (mergedItems.length < restoredEntries.length) {
      return {
        ok: false,
        code: "RECOVERY_RESTORE_INCOMPLETE",
        error: "Refused incomplete restoration of unresolved recovery items.",
        count: 0,
      };
    }

    var nextState = Object.assign({}, st, {
      ownerStudentId: st.ownerStudentId || sid,
      unresolvedMutations: {
        ownerStudentId: sid,
        reason: curUnres.reason || slot.payload.reason || "SYNC_RESYNC_REQUIRED",
        actionRequired: curUnres.actionRequired || slot.payload.actionRequired || "RECONCILE_AND_REVIEW",
        error: curUnres.error || slot.payload.error || "",
        createdAt: curUnres.createdAt || slot.payload.createdAt || now,
        items: mergedItems,
      },
    });

    // Save restored destination state BEFORE removing source recovery slot.
    var saveDestRes = saveStateStrict(nextState);
    if (!saveDestRes.ok) {
      return {
        ok: false,
        code: saveDestRes.code || "RESTORE_WRITE_FAILED",
        error: saveDestRes.error || "Failed to save restored unresolved mutations.",
        count: 0,
      };
    }

    // Track exact restored item fingerprints so concurrent-tab additions to the same slot are not removed.
    var restoredFingerprints = new Map();
    for (var rIdx = 0; rIdx < restoredEntries.length; rIdx++) {
      var rEntry = restoredEntries[rIdx];
      var rFp = "";
      try { rFp = JSON.stringify(Object.assign({}, rEntry, { ownerStudentId: undefined, ownerSlotId: undefined })); } catch (_e) { rFp = ""; }
      restoredFingerprints.set(rEntry.id, rFp);
    }

    commitRecoveryVaultUpdate(function (latestParsed) {
      var latestSlot = latestParsed.validSlots[slotId];
      var nextSlots = Object.assign({}, latestParsed.corruptSlots, latestParsed.validSlots);
      if (!latestSlot) {
        return { nextSlots: nextSlots, resultMeta: { cleaned: true } };
      }
      var remainingForSlot = [];
      var latestItems = Array.isArray(latestSlot.payload && latestSlot.payload.items) ? latestSlot.payload.items : [];
      for (var li = 0; li < latestItems.length; li++) {
        var curItem = latestItems[li];
        var fp = "";
        try { fp = JSON.stringify(Object.assign({}, curItem, { ownerStudentId: undefined, ownerSlotId: undefined })); } catch (_e2) { fp = ""; }
        if (!restoredFingerprints.has(curItem.id) || restoredFingerprints.get(curItem.id) !== fp) {
          remainingForSlot.push(curItem);
        }
      }
      if (remainingForSlot.length === 0) {
        delete nextSlots[slotId];
      } else {
        var updatedPayload = Object.assign({}, latestSlot.payload, { items: remainingForSlot });
        var updatedPayloadJson = JSON.stringify(updatedPayload);
        var updatedExp = latestSlot.expiresAt;
        nextSlots[slotId] = {
          v: 2,
          updatedAt: Date.now(),
          expiresAt: updatedExp,
          integrity: computeRecoveryIntegrityHash(slotId, updatedExp, updatedPayloadJson),
          payload: updatedPayload,
        };
      }
      return { nextSlots: nextSlots, resultMeta: { cleaned: true } };
    }, now);

    lastRecoveredNotice = {
      ok: true,
      count: restoredEntries.length,
      studentId: sid,
      hasDestructive: restoredEntries.some(function (u) { return Boolean(u && u.destructive); }),
      message: t("recoveredUnresolvedNotice"),
    };
    return { ok: true, count: restoredEntries.length, restored: restoredEntries.length };
  }

  function consumeRecoveredUnresolvedNotice() {
    if (!lastRecoveredNotice) return null;
    var out = lastRecoveredNotice;
    lastRecoveredNotice = null;
    return out;
  }

  function getLastRecoveryError() {
    return lastRecoveryError ? Object.assign({}, lastRecoveryError) : null;
  }

  function consumeRecoveryError() {
    if (!lastRecoveryError) return null;
    var out = lastRecoveryError;
    lastRecoveryError = null;
    return out;
  }

  function consumeRecoveryPurgeWarning() {
    if (!lastRecoveryPurgeWarning) return null;
    var out = lastRecoveryPurgeWarning;
    lastRecoveryPurgeWarning = null;
    return out;
  }

  function isIsolatedSignedOutState() {
    var a = getAuth();
    if (a && a.token) return false;
    var st = getState();
    return Boolean(st && st.ownerStudentId);
  }

  function hasPendingOrUnresolvedWork() {
    var st = getState();
    var unres = getUnresolvedMutations();
    if (isIsolatedSignedOutState()) return false;
    return Boolean((st && st.pendingProgressSync) || (unres && Array.isArray(unres.items) && unres.items.length > 0));
  }

  function clearPersonalDataFromDevice(opts) {
    var o = opts || {};
    var recoveryPurge = { ok: true, skipped: true, removed: false, verified: true };
    if (o.purgeAllRecovery) {
      recoveryPurge = purgeAllRecoveryVault();
    } else if (o.purgeRecoveryForOwner) {
      recoveryPurge = purgeRecoveryVaultForAccount(o.purgeRecoveryForOwner);
    }
    if (!o.keepGeneration) authGeneration += 1;
    if (progressSyncTimer && typeof clearTimeout === "function") {
      clearTimeout(progressSyncTimer);
      progressSyncTimer = null;
    }
    clearSyncRetryTimer();
    progressSyncInFlight = null;
    refreshSessionInFlight = null;
    cloudPullInFlight = null;
    syncRetryAttempts = 0;
    lastMutationMs = 0;
    serverClockOffsetMs = null;
    lastRecordedServerMs = 0;
    localMutationSeq += 1;
    ensureTabSession(true);
    if (root.ElgoShell && typeof root.ElgoShell.dismissToast === "function") {
      root.ElgoShell.dismissToast();
    }

    var clean = {
      selectedSourcesBySubject: {},
      bookmarks: [],
      deletedBookmarks: {},
      bookmarksClearedAt: null,
      bookmarksClearedAtBySubject: {},
      mistakes: [],
      deletedMistakes: {},
      mistakesClearedAt: null,
      mistakesClearedAtBySubject: {},
      clearOps: emptyClearOps(),
      syncClientId: "",
      syncClientGen: 0,
      syncClientSeq: 0,
      syncEpoch: 0,
      syncBaselineEpoch: 0,
      serverClockCal: null,
      acknowledgedCloudProgress: null,
      unresolvedMutations: emptyUnresolvedMutations(""),
      needsSyncRegistration: false,
      localMutRev: 0,
      localMutToken: "",
      attemptHistory: [],
      activeSession: null,
      lastAttempt: null,
      quizModes: {},
      ownerStudentId: "",
      ownerUsername: "",
      pendingProgressSync: false,
      guestProtectNudgeShown: false,
      legacyMerged: true,
    };
    var stateSaveRes = saveStateStrict(clean);
    if (!stateSaveRes.ok && stateSaveRes.code === "QUOTA_EXCEEDED") {
      var remStateRes = removeStorageStrict(STATE_KEY);
      if (remStateRes.ok) {
        stateSaveRes = { ok: true, clearedByRemove: true };
      }
    }
    onlineClient = null;
    var failedKeys = [];
    [
      "elgo_online_pending_attempts_v1",
      "mcq_bank_pending_attempts_v1",
      "elgo_online_local_leaderboard_v1",
      "mcq_bank_local_leaderboard_v1",
      "elgo_online_student_profile_v1",
      "mcq_bank_student_profile_v1",
      "elgo_online_player_id_v1",
      "mcq_bank_player_id_v1",
      "elgo_online_username_prompt_dismissed_v1",
      "mcq_bank_username_prompt_dismissed_v1",
      LEGACY_AUTH_KEY,
      LEGACY_BOOKMARKS_KEY,
      LEGACY_MISTAKES_KEY,
      LEGACY_ATTEMPT_KEY,
    ].forEach(function (k) {
      if (!k) return;
      var readKeyRes = readStorageStrict(k);
      if (!readKeyRes.ok) {
        failedKeys.push({ key: k, code: readKeyRes.code, error: readKeyRes.error });
        return;
      }
      if (readKeyRes.value !== null && readKeyRes.value !== undefined) {
        var remKeyRes = removeStorageStrict(k);
        if (!remKeyRes.ok) {
          failedKeys.push({ key: k, code: remKeyRes.code, error: remKeyRes.error });
        }
      }
    });
    if (!o.skipPlayerClear && root.ElgoPlayer && typeof root.ElgoPlayer.clearActiveSession === "function") {
      root.ElgoPlayer.clearActiveSession();
    }
    if (typeof document !== "undefined" && typeof document.dispatchEvent === "function" && typeof root.CustomEvent === "function") {
      document.dispatchEvent(new root.CustomEvent("elgo:progresschange"));
    }
    var overallOk = Boolean(recoveryPurge && recoveryPurge.ok) && Boolean(stateSaveRes && stateSaveRes.ok) && failedKeys.length === 0;
    var firstFailure = !recoveryPurge.ok
      ? recoveryPurge
      : (!stateSaveRes.ok ? stateSaveRes : (failedKeys.length ? failedKeys[0] : null));
    var clearOut = {
      ok: overallOk,
      code: firstFailure ? (firstFailure.code || "STORAGE_WRITE_FAILED") : "",
      error: firstFailure ? (firstFailure.error || "Failed to remove all local study data.") : "",
      recoveryPurge: recoveryPurge,
      stateCleared: Boolean(stateSaveRes && stateSaveRes.ok),
      stateClear: stateSaveRes,
      failedKeys: failedKeys,
      state: clean,
    };
    lastClearDeviceResult = clearOut;
    return clearOut;
  }

  function getAuthGeneration() {
    return authGeneration;
  }

  function captureAuthContext(explicitAuth) {
    var a = explicitAuth !== undefined ? explicitAuth : getAuth();
    return {
      authGeneration: authGeneration,
      token: (a && a.token) ? String(a.token) : "",
      studentId: (a && a.profile && a.profile.studentId) ? String(a.profile.studentId) : "",
      username: (a && a.profile && a.profile.username) ? String(a.profile.username) : "",
      auth: a || null,
    };
  }

  function isAuthContextCurrent(ctx) {
    if (!ctx) return false;
    if (ctx.authGeneration !== undefined && ctx.authGeneration !== null && ctx.authGeneration !== authGeneration) return false;
    var cur = getAuth();
    var curToken = (cur && cur.token) ? String(cur.token) : "";
    var curStudentId = (cur && cur.profile && cur.profile.studentId) ? String(cur.profile.studentId) : "";
    if (!ctx.token || curToken !== ctx.token) return false;
    if (ctx.studentId && curStudentId && curStudentId !== ctx.studentId) return false;
    return true;
  }

  function handleConfirmedSessionInvalidation(source, message, expectedCtx) {
    if (expectedCtx && !isAuthContextCurrent(expectedCtx)) {
      return false;
    }
    var errMsg = message || "Session expired — please sign in again.";
    var curSt = getState();
    var ownerSid = (curSt && curSt.ownerStudentId) || (expectedCtx && expectedCtx.studentId) || "";
    var rawPending = safeJsonParse(readStorage("elgo_online_pending_attempts_v1"), []);
    var hadPendingAttempts = Array.isArray(rawPending) && rawPending.length > 0;
    var recoverable = ownerSid && curSt ? collectRecoverableUnresolvedItems(curSt, ownerSid) : emptyUnresolvedMutations(ownerSid);
    var hasRecoverable = Boolean(recoverable.items && recoverable.items.length > 0);
    var stashOk = true;
    var stashOutcome = null;
    if (hasRecoverable) {
      stashOutcome = stashUnresolvedForAccount(ownerSid, curSt);
      stashOk = Boolean(stashOutcome && stashOutcome.ok);
    }
    if (hasRecoverable || hadPendingAttempts) {
      if (stashOk) {
        lastInvalidationNotice = { hadUnsynced: true, stashed: true, message: t("sessionInvalidatedUnsynced") };
      } else {
        lastInvalidationNotice = {
          hadUnsynced: true,
          stashed: false,
          code: (stashOutcome && stashOutcome.code) || "RECOVERY_FAILED",
          error: (stashOutcome && stashOutcome.error) || "",
          message: t("sessionInvalidatedRecoveryFailed") + (stashOutcome && stashOutcome.error ? (" (" + stashOutcome.error + ")") : ""),
        };
      }
    }
    if (!stashOk) {
      lastRecoveryError = Object.assign({
        ok: false,
        stage: "session_invalidation",
        ownerStudentId: ownerSid,
      }, stashOutcome || { code: "RECOVERY_FAILED", error: "Failed to persist local recovery copy." });
      setLastSyncStatus({
        ok: false,
        status: 401,
        error: errMsg,
        offline: false,
        recoveryFailed: true,
        recoveryCode: lastRecoveryError.code || "",
        recoveryError: lastRecoveryError.error || "",
      });
      warnSyncFailure(source || "session", errMsg + " [recovery failed: " + (lastRecoveryError.code || "") + "]", 401);
      if (progressSyncTimer && typeof clearTimeout === "function") {
        clearTimeout(progressSyncTimer);
        progressSyncTimer = null;
      }
      clearSyncRetryTimer();
      progressSyncInFlight = null;
      refreshSessionInFlight = null;
      cloudPullInFlight = null;
      if (curSt && !curSt.ownerStudentId && ownerSid) {
        curSt.ownerStudentId = ownerSid;
        saveStateStrict(curSt);
      }
      var invAuthFailRes = setAuth(null, { suppressEvent: true });
      if (invAuthFailRes && invAuthFailRes.ok === false && lastInvalidationNotice) {
        lastInvalidationNotice.authCleanupFailed = true;
        lastInvalidationNotice.authClearResult = invAuthFailRes;
        lastInvalidationNotice.message = String(lastInvalidationNotice.message || "") + " " + t("sessionInvalidatedAuthClearFailed");
      }
      dispatchAuthChangeEvent(null, invAuthFailRes);
      return true;
    }
    setLastSyncStatus({ ok: false, status: 401, error: errMsg, offline: false });
    warnSyncFailure(source || "session", errMsg, 401);
    var invClearRes = clearPersonalDataFromDevice();
    var invAuthRes = setAuth(null, { suppressEvent: true });
    if ((invAuthRes && invAuthRes.ok === false) || (invClearRes && invClearRes.ok === false)) {
      var invAuthFailed = Boolean(invAuthRes && invAuthRes.ok === false);
      if (lastInvalidationNotice) {
        lastInvalidationNotice.authCleanupFailed = invAuthFailed;
        lastInvalidationNotice.clearFailed = Boolean(invClearRes && invClearRes.ok === false);
        lastInvalidationNotice.authClearResult = invAuthRes;
        lastInvalidationNotice.message = String(lastInvalidationNotice.message || "") + " " + t("sessionInvalidatedAuthClearFailed");
      } else {
        lastInvalidationNotice = {
          hadUnsynced: false,
          authCleanupFailed: invAuthFailed,
          clearFailed: Boolean(invClearRes && invClearRes.ok === false),
          authClearResult: invAuthRes,
          message: t("sessionInvalidatedAuthClearFailed"),
        };
      }
    }
    dispatchAuthChangeEvent(null, invAuthRes);
    return true;
  }

  function consumeSessionInvalidationNotice() {
    if (!lastInvalidationNotice) return null;
    var out = typeof lastInvalidationNotice === "object"
      ? Object.assign({}, lastInvalidationNotice)
      : { hadUnsynced: true, message: t("sessionInvalidatedUnsynced") };
    lastInvalidationNotice = null;
    return out;
  }

  function getAnonymousLocalSummary() {
    var st = getState();
    var savedCount = Array.isArray(st.bookmarks) ? st.bookmarks.length : 0;
    var mistakesCount = Array.isArray(st.mistakes) ? st.mistakes.length : 0;
    var attemptsCount = Array.isArray(st.attemptHistory) ? st.attemptHistory.length : 0;
    var hasOwner = Boolean(st.ownerStudentId);
    return {
      hasOwner: hasOwner,
      savedCount: savedCount,
      mistakesCount: mistakesCount,
      attemptsCount: attemptsCount,
      hasData: !hasOwner && (savedCount > 0 || mistakesCount > 0),
    };
  }

  function buildAuthPayload(opts) {
    var o = opts || {};
    var mode = o.mode || "guest";
    var username = String(o.username || "").trim();
    var password = typeof o.password === "string" ? o.password : "";
    var payload = mode === "guest" ? { username: username } : { username: username, password: password };
    var st = getState();
    var tab = ensureTabSession(false);

    if (mode === "guest" || mode === "register") {
      if (!st.ownerStudentId) {
        payload.syncClientId = ensureSyncClientIdentity(st);
        payload.syncTabTag = tab.tabTag;
        if (st.syncClientGen >= 1) payload.syncClientGen = st.syncClientGen;
        saveState(st);
      }
      if (!st.ownerStudentId && o.includeLocalProgress !== false) {
        payload.progress = exportCloudProgress();
      }
      return payload;
    }

    if (mode === "upgrade") {
      var curId = o.currentStudentId || (getAuth() && getAuth().profile && getAuth().profile.studentId) || "";
      if (!st.ownerStudentId || (curId && st.ownerStudentId === curId)) {
        payload.syncClientId = ensureSyncClientIdentity(st);
        payload.syncTabTag = tab.tabTag;
        if (st.syncClientGen >= 1) payload.syncClientGen = st.syncClientGen;
        saveState(st);
        payload.progress = exportCloudProgress();
      }
      return payload;
    }

    if (mode === "login") {
      var canMergeLocalOnLogin = !st
        || !st.ownerStudentId
        || (Boolean(st.ownerUsername) && String(st.ownerUsername).toLowerCase() === username.toLowerCase());
      if (canMergeLocalOnLogin) {
        payload.syncClientId = ensureSyncClientIdentity(st);
        payload.syncTabTag = tab.tabTag;
        if (st.syncClientGen >= 1) payload.syncClientGen = st.syncClientGen;
        saveState(st);
        payload.progress = exportCloudProgress();
      } else {
        var freshTab = ensureTabSession(true);
        payload.syncClientId = "c_" + generateRandomHexClient(6);
        payload.syncTabTag = freshTab.tabTag;
      }
      return payload;
    }

    return payload;
  }

  function shouldShowGuestProtectNudge() {
    var auth = getAuth();
    if (!auth || !auth.profile || !auth.profile.guest) return false;
    var st = getState();
    if (st.guestProtectNudgeShown) return false;
    var savedCount = Array.isArray(st.bookmarks) ? st.bookmarks.length : 0;
    var attemptCount = Array.isArray(st.attemptHistory) ? st.attemptHistory.length : 0;
    return savedCount >= 1 || attemptCount >= 1;
  }

  function dismissGuestProtectNudge() {
    var st = getState();
    if (st.guestProtectNudgeShown) return;
    st.guestProtectNudgeShown = true;
    saveState(st);
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

  function applyClientRegistrationFromServer(reg) {
    if (!reg || typeof reg !== "object" || !isValidSyncClientId(reg.clientId)) return false;
    var gen = Number(reg.gen);
    if (!Number.isSafeInteger(gen) || gen < 1 || gen > MAX_CLIENT_GEN) return false;
    var st = getState();
    var prevGen = Number(st.syncClientGen) || 0;
    st.syncClientId = reg.clientId;
    st.syncClientGen = gen;
    if (Number.isSafeInteger(Number(reg.baselineEpoch)) && Number(reg.baselineEpoch) > 0) {
      st.syncBaselineEpoch = Number(reg.baselineEpoch);
    }
    if (Number.isSafeInteger(Number(reg.syncEpoch)) && Number(reg.syncEpoch) > (Number(st.syncEpoch) || 0)) {
      st.syncEpoch = Number(reg.syncEpoch);
    }
    var curTab = ensureTabSession(false);
    if (reg.tabTag && isValidTabTag(reg.tabTag) && reg.tabTag !== curTab.tabTag) {
      curTab = { tabTag: reg.tabTag, tabSeq: Number.isSafeInteger(Number(reg.seq)) && Number(reg.seq) >= 0 ? Number(reg.seq) : 0 };
      writeTabSession(curTab);
    } else if (gen !== prevGen) {
      curTab.tabSeq = Number.isSafeInteger(Number(reg.seq)) && Number(reg.seq) >= 0 ? Number(reg.seq) : 0;
      writeTabSession(curTab);
    } else if (Number.isSafeInteger(Number(reg.seq)) && Number(reg.seq) > curTab.tabSeq) {
      curTab.tabSeq = Number(reg.seq);
      writeTabSession(curTab);
    }
    st.syncClientSeq = curTab.tabSeq;
    st.needsSyncRegistration = false;
    saveState(st);
    return true;
  }

  function getAuthStorageStatus() {
    var primaryRead = readStorageStrict(AUTH_KEY);
    if (!primaryRead.ok) {
      return {
        ok: false,
        readable: false,
        present: true,
        code: primaryRead.code || "STORAGE_READ_FAILED",
        error: primaryRead.error || "Failed to read browser authentication storage.",
        failedKeys: [{
          key: AUTH_KEY,
          code: primaryRead.code || "STORAGE_READ_FAILED",
          error: primaryRead.error || "Failed to read browser authentication storage.",
        }],
      };
    }
    var legacyRead = readStorageStrict(LEGACY_AUTH_KEY);
    if (!legacyRead.ok) {
      return {
        ok: false,
        readable: false,
        present: true,
        code: legacyRead.code || "STORAGE_READ_FAILED",
        error: legacyRead.error || "Failed to read legacy browser authentication storage.",
        failedKeys: [{
          key: LEGACY_AUTH_KEY,
          code: legacyRead.code || "STORAGE_READ_FAILED",
          error: legacyRead.error || "Failed to read legacy browser authentication storage.",
        }],
      };
    }
    var hasPrimary = primaryRead.value !== null && primaryRead.value !== undefined;
    var hasLegacy = legacyRead.value !== null && legacyRead.value !== undefined;
    return {
      ok: true,
      readable: true,
      present: hasPrimary || hasLegacy,
      primaryPresent: hasPrimary,
      legacyPresent: hasLegacy,
      code: "",
      error: "",
      failedKeys: [],
    };
  }

  function getCleanupAuthOwnership(token, studentId, allowMissing) {
    var primary = readStorageStrict(AUTH_KEY);
    var legacy = readStorageStrict(LEGACY_AUTH_KEY);
    if (!primary.ok || !legacy.ok) return "unverified";
    var records = [primary.value, legacy.value].filter(function (raw) { return raw != null; });
    if (!records.length) return allowMissing ? "absent" : "changed";
    for (var i = 0; i < records.length; i++) {
      var auth = safeJsonParse(records[i], null);
      if (!auth || !auth.token || !auth.profile || !auth.profile.studentId) return "unverified";
      if (String(auth.token) !== token || String(auth.profile.studentId) !== studentId) return "changed";
    }
    return "current";
  }

  function getCleanupStudySnapshot(studentId) {
    var snapshot = readStorageStrict(STATE_KEY);
    if (!snapshot.ok || snapshot.value == null) return snapshot;
    var record = safeJsonParse(snapshot.value, null);
    if (!record || typeof record !== "object" || Array.isArray(record)) return { ok: false };
    if (record.ownerStudentId && String(record.ownerStudentId) !== studentId) return { ok: false };
    snapshot.ownerVerified = Boolean(record.ownerStudentId);
    return snapshot;
  }

  function withAccountStorageLock(action, requireLock) {
    var locks = root.navigator && root.navigator.locks;
    if (locks && typeof locks.request === "function") {
      return locks.request("elgo-account-storage", action);
    }
    return requireLock ? Promise.resolve(null) : Promise.resolve(action());
  }

  function completeAuthTransitionWithLock(data, opts) {
    return withAccountStorageLock(function () { return completeAuthTransition(data, opts); });
  }

  function clearAuthStorageStrict() {
    var authRemRes = removeStorageStrict(AUTH_KEY);
    var legacyRemRes = removeStorageStrict(LEGACY_AUTH_KEY);
    var failedKeys = [];
    if (!authRemRes.ok) {
      failedKeys.push({
        key: AUTH_KEY,
        code: authRemRes.code || "STORAGE_WRITE_FAILED",
        error: authRemRes.error || "Failed to remove session data from browser storage.",
      });
    }
    if (!legacyRemRes.ok) {
      failedKeys.push({
        key: LEGACY_AUTH_KEY,
        code: legacyRemRes.code || "STORAGE_WRITE_FAILED",
        error: legacyRemRes.error || "Failed to remove legacy session data from browser storage.",
      });
    }
    var firstFailure = !authRemRes.ok ? authRemRes : (!legacyRemRes.ok ? legacyRemRes : null);
    var res = {
      ok: failedKeys.length === 0,
      removed: failedKeys.length === 0,
      verified: failedKeys.length === 0,
      authCleanupFailed: failedKeys.length > 0,
      code: firstFailure ? (firstFailure.code || "STORAGE_WRITE_FAILED") : "",
      error: firstFailure ? (firstFailure.error || "Failed to verify removal of authentication storage.") : "",
      failedKeys: failedKeys,
      auth: null,
    };
    lastAuthClearResult = res;
    return res;
  }

  function getLastAuthClearResult() {
    return lastAuthClearResult ? Object.assign({}, lastAuthClearResult) : null;
  }

  function getLastClearDeviceResult() {
    return lastClearDeviceResult ? Object.assign({}, lastClearDeviceResult) : null;
  }

  function dispatchAuthChangeEvent(authPayload, clearResult) {
    if (typeof document !== "undefined" && typeof document.dispatchEvent === "function" && typeof root.CustomEvent === "function") {
      var detail = clearResult !== undefined ? { auth: authPayload, clearResult: clearResult } : { auth: authPayload };
      document.dispatchEvent(new root.CustomEvent("elgo:authchange", { detail: detail }));
    }
  }

  function setAuth(authObj, opts) {
    initCrossTabListeners();
    var cur = getAuth();
    var curId = (cur && cur.profile && cur.profile.studentId) ? String(cur.profile.studentId) : "";
    var curToken = (cur && cur.token) ? String(cur.token) : "";
    if (!authObj || !authObj.token) {
      var preAuthStatus = getAuthStorageStatus();
      if (curToken || !preAuthStatus.ok || preAuthStatus.present) {
        authGeneration += 1;
        refreshSessionInFlight = null;
        progressSyncInFlight = null;
        cloudPullInFlight = null;
        clearSyncRetryTimer();
        if (progressSyncTimer && typeof clearTimeout === "function") {
          clearTimeout(progressSyncTimer);
          progressSyncTimer = null;
        }
      }
      var clearRes = clearAuthStorageStrict();
      if (!(opts && opts.suppressEvent)) {
        dispatchAuthChangeEvent(null, clearRes);
      }
      return clearRes;
    }
    var nextId = (authObj.profile && authObj.profile.studentId) ? String(authObj.profile.studentId) : "";
    if (cur && cur.token && cur.profile && cur.profile.guest) {
      if (nextId && nextId !== curId && !(opts && opts.confirmGuestSwitch)) {
        warnSyncFailure("setAuth", "Refused silent replacement of unprotected guest identity.", 409);
        return cur;
      }
    }
    var nextToken = String(authObj.token || "");
    if (nextToken !== curToken || (curId && nextId && nextId !== curId)) {
      authGeneration += 1;
      refreshSessionInFlight = null;
      progressSyncInFlight = null;
      cloudPullInFlight = null;
      clearSyncRetryTimer();
      if (progressSyncTimer && typeof clearTimeout === "function") {
        clearTimeout(progressSyncTimer);
        progressSyncTimer = null;
      }
    }
    lastAuthClearResult = null;
    writeStorage(AUTH_KEY, JSON.stringify(authObj));
    if (typeof document !== "undefined" && typeof document.dispatchEvent === "function" && typeof root.CustomEvent === "function") {
      document.dispatchEvent(new root.CustomEvent("elgo:authchange", { detail: { auth: authObj } }));
    }
    return authObj;
  }

  function completeAuthTransition(data, opts) {
    if (!data || !data.token || !data.profile) return null;
    var o = opts || {};
    if (o.expectedAuthGeneration != null && o.expectedAuthGeneration !== authGeneration) {
      return null;
    }
    lastRecoveryError = null;
    lastRecoveryPurgeWarning = null;
    if (data.serverTime) recordServerTime(data.serverTime, false);
    var prevAuth = getAuth();
    var prevId = prevAuth && prevAuth.profile ? String(prevAuth.profile.studentId || "") : "";
    var nextId = String(data.profile.studentId || "");
    if (prevId && nextId && prevId !== nextId && prevAuth.profile && prevAuth.profile.guest && !o.confirmGuestSwitch) {
      return null;
    }
    var stBefore = getState();
    var prevOwnerId = stBefore.ownerStudentId || prevId;
    var switchingOwner = Boolean(prevOwnerId && nextId && prevOwnerId !== nextId);
    if (switchingOwner) {
      var isAbandoningGuest = Boolean(prevAuth && prevAuth.profile && prevAuth.profile.guest && o.confirmGuestSwitch);
      if (o.discardUnresolved || isAbandoningGuest) {
        var purgePrevRes = purgeRecoveryVaultForAccount(prevOwnerId);
        if (purgePrevRes && !purgePrevRes.ok) {
          lastRecoveryPurgeWarning = Object.assign({
            ok: false,
            stage: "account_switch_purge",
            studentId: prevOwnerId,
          }, purgePrevRes);
        }
      } else {
        var recoverableBefore = collectRecoverableUnresolvedItems(stBefore, prevOwnerId);
        if (recoverableBefore.items.length > 0) {
          var stashRes = stashUnresolvedForAccount(prevOwnerId, stBefore);
          if (!stashRes || !stashRes.ok) {
            lastRecoveryError = Object.assign({
              ok: false,
              stage: "account_switch",
              prevOwnerId: prevOwnerId,
              unresolvedCount: recoverableBefore.items.length,
            }, stashRes || { code: "RECOVERY_FAILED", error: "Failed to save local recovery copy." });
            return null;
          }
        }
      }
    }
    var authObj = setAuth(
      { token: data.token, expiresAt: data.expiresAt, profile: data.profile },
      { confirmGuestSwitch: Boolean(o.confirmGuestSwitch) }
    );
    if (switchingOwner) {
      var clearSwRes = clearPersonalDataFromDevice({ keepAuth: true, keepGeneration: true, skipPlayerClear: Boolean(o.skipPlayerClear) });
      if (clearSwRes && !clearSwRes.ok && !lastRecoveryPurgeWarning) {
        lastRecoveryPurgeWarning = {
          ok: false,
          stage: "account_switch_clear",
          studentId: prevOwnerId,
          code: clearSwRes.code || "STORAGE_WRITE_FAILED",
          error: clearSwRes.error || "Failed to clear previous account's active local data.",
        };
      }
    }
    if (data.syncRegistration && data.syncRegistration.clientId) {
      applyClientRegistrationFromServer(data.syncRegistration);
    }
    var st = getState();
    if (data.profile && data.profile.progress) {
      applyCloudProgress(data.profile.progress, {
        studentId: nextId,
        username: data.profile.username || "",
        replace: true,
        preserveOwnUnresolved: !switchingOwner && Boolean(prevOwnerId && nextId && prevOwnerId === nextId),
        serverTime: data.serverTime,
        fromSyncResync: Boolean(data.syncResyncRequired),
        resyncReason: data.syncResyncReason || "",
        actionRequired: data.syncResyncActionRequired || "",
        preLoginLocalState: switchingOwner ? null : stBefore,
      });
    } else if (nextId) {
      st.ownerStudentId = nextId;
      st.ownerUsername = data.profile.username || "";
      saveState(st);
    }
    if (nextId) {
      var restoreRes = restoreRecoveryVaultForAccount(nextId);
      if (restoreRes && !restoreRes.ok) {
        lastRecoveryError = Object.assign({
          ok: false,
          stage: "restore",
          studentId: nextId,
        }, restoreRes);
        lastRecoveredNotice = {
          ok: false,
          code: restoreRes.code || "RESTORE_FAILED",
          error: restoreRes.error || "",
          count: 0,
          studentId: nextId,
          message: t("recoveryRestoreFailedNotice") + (restoreRes.error ? (" (" + restoreRes.error + ")") : ""),
        };
      }
    }
    return authObj;
  }

  function authHeaders(extra, explicitToken) {
    var headers = Object.assign({}, extra || {});
    var tok = explicitToken !== undefined ? String(explicitToken || "") : ((getAuth() && getAuth().token) || "");
    if (tok) {
      headers.Authorization = "Bearer " + tok;
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
    var localBmClearedBySubj = st.bookmarksClearedAtBySubject && typeof st.bookmarksClearedAtBySubject === "object" ? Object.keys(st.bookmarksClearedAtBySubject) : [];
    var localMkClearedBySubj = st.mistakesClearedAtBySubject && typeof st.mistakesClearedAtBySubject === "object" ? Object.keys(st.mistakesClearedAtBySubject) : [];
    if (!localBm.length && !localMk.length && !localAtt.length && !localDelBm.length && !localDelMk.length && !st.mistakesClearedAt && !st.bookmarksClearedAt && !localBmClearedBySubj.length && !localMkClearedBySubj.length) {
      return false;
    }
    if (!cloudProg || typeof cloudProg !== "object") return true;
    var cloudAckOps = (cloudProg.syncMeta && cloudProg.syncMeta.ops && typeof cloudProg.syncMeta.ops === "object") ? cloudProg.syncMeta.ops : {};
    var clearOps = normalizeClientClearOps(st.clearOps);
    var resolveLocalMs = function (isoVal, opIdOrRec) {
      var opId = typeof opIdOrRec === "string" ? opIdOrRec : (opIdOrRec && opIdOrRec.id ? opIdOrRec.id : "");
      if (opId && Object.prototype.hasOwnProperty.call(cloudAckOps, opId)) {
        return Number(cloudAckOps[opId]) || 0;
      }
      return parseIsoMsClient(isoVal);
    };
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
      if (resolveLocalMs(lb.savedAt, lb.syncOpId) > parseIsoMsClient(cb.savedAt)) return true;
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
      var lmTime = (lm.syncOpId && Object.prototype.hasOwnProperty.call(cloudAckOps, lm.syncOpId))
        ? (Number(cloudAckOps[lm.syncOpId]) || 0)
        : Math.max(parseIsoMsClient(lm.updatedAt), parseIsoMsClient(lm.resolvedAt));
      var cmTime = Math.max(parseIsoMsClient(cm.updatedAt), parseIsoMsClient(cm.lastAttemptedAt), parseIsoMsClient(cm.resolvedAt));
      if (lmTime > cmTime) return true;
    }
    var cloudDelBm = cloudProg.deletedBookmarks && typeof cloudProg.deletedBookmarks === "object" ? cloudProg.deletedBookmarks : {};
    for (var d1 = 0; d1 < localDelBm.length; d1++) {
      var dk1 = localDelBm[d1];
      if (resolveLocalMs(st.deletedBookmarks[dk1], clearOps.deletedBookmarks[dk1]) > parseIsoMsClient(cloudDelBm[dk1])) return true;
    }
    var cloudDelMk = cloudProg.deletedMistakes && typeof cloudProg.deletedMistakes === "object" ? cloudProg.deletedMistakes : {};
    for (var d2 = 0; d2 < localDelMk.length; d2++) {
      var dk2 = localDelMk[d2];
      if (resolveLocalMs(st.deletedMistakes[dk2], clearOps.deletedMistakes[dk2]) > parseIsoMsClient(cloudDelMk[dk2])) return true;
    }
    if (resolveLocalMs(st.mistakesClearedAt, clearOps.mistakesGlobal) > parseIsoMsClient(cloudProg.mistakesClearedAt)) return true;
    if (resolveLocalMs(st.bookmarksClearedAt, clearOps.bookmarksGlobal) > parseIsoMsClient(cloudProg.bookmarksClearedAt)) return true;
    var cloudBmSubj = cloudProg.bookmarksClearedAtBySubject && typeof cloudProg.bookmarksClearedAtBySubject === "object" ? cloudProg.bookmarksClearedAtBySubject : {};
    for (var bs = 0; bs < localBmClearedBySubj.length; bs++) {
      var bsid = localBmClearedBySubj[bs];
      if (resolveLocalMs(st.bookmarksClearedAtBySubject[bsid], clearOps.bookmarksBySubject[bsid]) > parseIsoMsClient(cloudBmSubj[bsid])) return true;
    }
    var cloudMkSubj = cloudProg.mistakesClearedAtBySubject && typeof cloudProg.mistakesClearedAtBySubject === "object" ? cloudProg.mistakesClearedAtBySubject : {};
    for (var ms = 0; ms < localMkClearedBySubj.length; ms++) {
      var msid = localMkClearedBySubj[ms];
      if (resolveLocalMs(st.mistakesClearedAtBySubject[msid], clearOps.mistakesBySubject[msid]) > parseIsoMsClient(cloudMkSubj[msid])) return true;
    }
    return false;
  }

  function getAcknowledgedCloudProgress() {
    var st = getState();
    return st.acknowledgedCloudProgress ? Object.assign({}, st.acknowledgedCloudProgress) : null;
  }

  function getUnresolvedMutations() {
    var st = getState();
    var auth = getAuth();
    var authSid = (auth && auth.profile && auth.profile.studentId) || "";
    if (!authSid) {
      if (st.ownerStudentId) return emptyUnresolvedMutations("");
      return normalizeUnresolvedMutations(st.unresolvedMutations, "");
    }
    if (st.ownerStudentId && st.ownerStudentId !== authSid) {
      return emptyUnresolvedMutations(authSid);
    }
    return normalizeUnresolvedMutations(st.unresolvedMutations, authSid);
  }

  function restampPendingNonDestructiveItems(st, cloudAckOps) {
    if (!st || !Number.isSafeInteger(st.syncClientGen) || st.syncClientGen < 1) return false;
    var gen36 = st.syncClientGen.toString(36);
    var clientId = ensureSyncClientIdentity(st);
    var ackOps = cloudAckOps && typeof cloudAckOps === "object" ? cloudAckOps : {};
    var maxReasonableNow = getEffectiveNowMs() + 300000;
    var changed = false;

    if (Array.isArray(st.bookmarks)) {
      st.bookmarks = st.bookmarks.map(function (b) {
        if (!b || typeof b !== "object") return b;
        var op = typeof b.syncOpId === "string" ? b.syncOpId : "";
        if (op && Object.prototype.hasOwnProperty.call(ackOps, op)) return b;
        var okPrefix = "v3." + clientId + "." + gen36 + ".";
        if (op.indexOf(okPrefix) === 0) return b;
        var ms = parseIsoMsClient(b.savedAt);
        if (!ms || ms > maxReasonableNow) return b;
        var sid = b.internalId || b.id || b.questionId || "";
        var freshOp = makeSyncOpId(st, "bi", sid);
        if (!freshOp) return b;
        changed = true;
        return Object.assign({}, b, { syncOpId: freshOp });
      });
    }
    if (Array.isArray(st.mistakes)) {
      st.mistakes = st.mistakes.map(function (m) {
        if (!m || typeof m !== "object") return m;
        var op = typeof m.syncOpId === "string" ? m.syncOpId : "";
        if (op && Object.prototype.hasOwnProperty.call(ackOps, op)) return m;
        var okPrefix = "v3." + clientId + "." + gen36 + ".";
        if (op.indexOf(okPrefix) === 0) return m;
        var ms = Math.max(parseIsoMsClient(m.updatedAt), parseIsoMsClient(m.resolvedAt));
        if (!ms || ms > maxReasonableNow) return m;
        var mid = m.internalId || m.questionId || m.id || "";
        var freshOp = makeSyncOpId(st, "mi", mid);
        if (!freshOp) return m;
        changed = true;
        return Object.assign({}, m, { syncOpId: freshOp });
      });
    }
    if (changed) saveState(st);
    return changed;
  }

  async function reconcileClientRegistration(explicitCtx) {
    var ctx = explicitCtx || captureAuthContext();
    if (!ctx.token || typeof fetch !== "function") {
      return { ok: false, skipped: true };
    }
    var curSt = getState();
    var cid = ensureSyncClientIdentity(curSt);
    var tab = ensureTabSession(false);
    saveState(curSt);

    try {
      var initRes = await fetch("/api/auth/sync-progress", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }, ctx.token),
        body: JSON.stringify({
          action: "reconcile_init",
          syncClientId: cid,
          syncTabTag: tab.tabTag,
        }),
      });
      if (!isAuthContextCurrent(ctx)) return { ok: false, stale: true };
      if (initRes.status === 401) {
        handleConfirmedSessionInvalidation("reconcileClientRegistration", "Session expired — please sign in again.", ctx);
        return { ok: false, unauthorized: true, status: 401 };
      }
      var initData = await initRes.json().catch(function () { return null; });
      if (!isAuthContextCurrent(ctx)) return { ok: false, stale: true };
      if (!initRes.ok || !initData || !initData.ok || !initData.registration) {
        return { ok: false, status: initRes.status || 0, error: (initData && initData.error) || "Reconciliation init failed." };
      }
      if (initData.serverTime) recordServerTime(initData.serverTime);
      if (initData.progress && typeof initData.progress === "object") {
        applyCloudProgress(initData.progress, {
          studentId: ctx.studentId,
          username: ctx.username,
          serverTime: initData.serverTime,
          fromSyncResync: true,
          resyncReason: "CLIENT_RECONCILED",
          actionRequired: "RECONCILE_AND_REVIEW",
        });
      }

      var reg = initData.registration;
      if (reg.tabTag && reg.tabTag !== tab.tabTag) {
        return { ok: false, status: 409, error: "Reconciliation tab mismatch." };
      }
      var ackRes = await fetch("/api/auth/sync-progress", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }, ctx.token),
        body: JSON.stringify({
          action: "reconcile_ack",
          syncClientId: reg.clientId || cid,
          syncTabTag: tab.tabTag,
          syncClientGen: reg.gen,
          challenge: reg.challenge,
          baselineEpoch: reg.baselineEpoch,
        }),
      });
      if (!isAuthContextCurrent(ctx)) return { ok: false, stale: true };
      if (ackRes.status === 401) {
        handleConfirmedSessionInvalidation("reconcileClientRegistration", "Session expired — please sign in again.", ctx);
        return { ok: false, unauthorized: true, status: 401 };
      }
      var ackData = await ackRes.json().catch(function () { return null; });
      if (!isAuthContextCurrent(ctx)) return { ok: false, stale: true };
      if (!ackRes.ok || !ackData || !ackData.ok || !ackData.registration) {
        var afterAckSt = getState();
        if (ackRes.status === 409 && afterAckSt.syncClientGen > reg.gen && isAuthContextCurrent(ctx)) {
          var verifyMe = await fetch(
            "/api/auth/me?syncClientId=" + encodeURIComponent(cid) + "&syncTabTag=" + encodeURIComponent(tab.tabTag) + "&syncClientGen=" + encodeURIComponent(String(afterAckSt.syncClientGen)),
            { headers: authHeaders({}, ctx.token), cache: "no-store" }
          ).catch(function () { return null; });
          if (!isAuthContextCurrent(ctx)) return { ok: false, stale: true };
          if (verifyMe && verifyMe.ok) {
            var verifyData = await verifyMe.json().catch(function () { return null; });
            if (!isAuthContextCurrent(ctx)) return { ok: false, stale: true };
            if (verifyData && verifyData.ok && verifyData.clientRegistration && verifyData.clientRegistration.status === "active") {
              applyClientRegistrationFromServer(verifyData.clientRegistration);
              var vOps = (verifyData.profile && verifyData.profile.progress && verifyData.profile.progress.syncMeta && verifyData.profile.progress.syncMeta.ops) || {};
              restampPendingNonDestructiveItems(getState(), vOps);
              return { ok: true, registration: verifyData.clientRegistration, progress: verifyData.profile ? verifyData.profile.progress : null };
            }
          }
        }
        return { ok: false, status: ackRes.status || 0, error: (ackData && ackData.error) || "Reconciliation ack failed." };
      }
      if (ackData.serverTime) recordServerTime(ackData.serverTime);
      applyClientRegistrationFromServer(ackData.registration);
      var latestSt = getState();
      var cloudMetaOps = (ackData.progress && ackData.progress.syncMeta && ackData.progress.syncMeta.ops) || {};
      restampPendingNonDestructiveItems(latestSt, cloudMetaOps);
      return { ok: true, registration: ackData.registration, progress: ackData.progress || null };
    } catch (err) {
      return { ok: false, offline: true, error: (err && err.message) || "Network error during reconciliation." };
    }
  }

  async function resolveUnresolvedMutations(action, entryId) {
    var st = getState();
    var auth = getAuth();
    var activeSid = (auth && auth.profile && auth.profile.studentId) || st.ownerStudentId || "";
    var cur = normalizeUnresolvedMutations(st.unresolvedMutations, activeSid);
    if (!cur.items.length && action !== "discard_all") return { ok: true, changed: false };

    if (action === "discard_all") {
      var remaining = [];
      st.unresolvedMutations = Object.assign({}, emptyUnresolvedMutations(activeSid), { items: remaining });
      if (st.acknowledgedCloudProgress && Array.isArray(st.acknowledgedCloudProgress.bookmarks)) {
        // Drop any non-acked temporary local bookmarks that were only in unresolvedMutations
        var ackBmIds = new Set(st.acknowledgedCloudProgress.bookmarks.map(function (b) { return b && (b.internalId || b.id); }).filter(Boolean));
        st.bookmarks = (st.bookmarks || []).filter(function (b) { return b && ackBmIds.has(b.internalId || b.id); });
      }
      st.pendingProgressSync = false;
      saveState(st);
      if (typeof document !== "undefined" && typeof document.dispatchEvent === "function" && typeof root.CustomEvent === "function") {
        document.dispatchEvent(new root.CustomEvent("elgo:progresschange"));
      }
      return { ok: true, changed: true };
    }

    if (action === "discard_one" && entryId) {
      var targetDiscard = cur.items.find(function (x) { return x.id === entryId; });
      cur.items = cur.items.filter(function (x) { return x.id !== entryId; });
      if (targetDiscard && !targetDiscard.destructive && targetDiscard.kind === "bookmark_save") {
        st.bookmarks = (st.bookmarks || []).filter(function (b) { return b && (b.internalId || b.id) !== targetDiscard.scopeId; });
      }
      if (!cur.items.length) {
        cur = emptyUnresolvedMutations(activeSid);
        st.pendingProgressSync = false;
      }
      st.unresolvedMutations = cur;
      saveState(st);
      if (typeof document !== "undefined" && typeof document.dispatchEvent === "function" && typeof root.CustomEvent === "function") {
        document.dispatchEvent(new root.CustomEvent("elgo:progresschange"));
      }
      return { ok: true, changed: true };
    }

    if (action === "apply_one" || action === "apply_all" || action === "apply_saves") {
      var resolveCtx = captureAuthContext(auth);
      if (auth && auth.token && (!st.syncClientGen || st.needsSyncRegistration)) {
        var rec = await reconcileClientRegistration(resolveCtx);
        if (!rec || !rec.ok) return rec || { ok: false, error: "Reconcile before applying failed." };
        if (!isAuthContextCurrent(resolveCtx)) return { ok: false, stale: true };
      }
      var targets = action === "apply_one"
        ? cur.items.filter(function (x) { return x.id === entryId; })
        : (action === "apply_saves" ? cur.items.filter(function (x) { return !x.destructive; }) : cur.items.slice());
      if (!targets.length) return { ok: true, changed: false };

      var appliedIds = new Set();
      targets.forEach(function (entry) {
        var latest = getState();
        var clearOpsNow = normalizeClientClearOps(latest.clearOps);
        if (entry.kind === "bookmark_save" && entry.item) {
          var bm = entry.item;
          var bId = bm.internalId || bm.id || entry.scopeId;
          var delBm = Object.assign({}, latest.deletedBookmarks || {});
          var bSid = resolveItemSubjectId(bm);
          var subjClr = bSid && latest.bookmarksClearedAtBySubject && latest.bookmarksClearedAtBySubject[bSid];
          var iso = nextMutationIso(bm.savedAt, delBm[bId], latest.bookmarksClearedAt, subjClr);
          if (bId) { delete delBm[bId]; delete clearOpsNow.deletedBookmarks[bId]; }
          var stampedBm = Object.assign({}, bm, { savedAt: iso, syncOpId: makeSyncOpId(latest, "bi", bId || "") });
          var listBm = Array.isArray(latest.bookmarks) ? latest.bookmarks.filter(function (x) { return x && (x.internalId || x.id) !== bId; }) : [];
          listBm.unshift(stampedBm);
          latest.bookmarks = listBm;
          latest.deletedBookmarks = delBm;
          latest.clearOps = clearOpsNow;
          markLocalMutation(latest);
          saveState(latest);
          appliedIds.add(entry.id);
        } else if (entry.kind === "mistake_save" && entry.item) {
          var mk = entry.item;
          var mId = mk.internalId || mk.questionId || mk.id || entry.scopeId;
          var delMk = Object.assign({}, latest.deletedMistakes || {});
          var mSid = resolveItemSubjectId(mk);
          var mkSubjClr = mSid && latest.mistakesClearedAtBySubject && latest.mistakesClearedAtBySubject[mSid];
          var mkIso = nextMutationIso(mk.updatedAt, mk.resolvedAt, delMk[mId], latest.mistakesClearedAt, mkSubjClr);
          if (mId) { delete delMk[mId]; delete clearOpsNow.deletedMistakes[mId]; }
          var stampedMk = Object.assign({}, mk, {
            updatedAt: mkIso,
            resolvedAt: mk.resolved ? mkIso : null,
            syncOpId: makeSyncOpId(latest, "mi", mId || ""),
          });
          var listMk = Array.isArray(latest.mistakes) ? latest.mistakes.filter(function (x) { return x && (x.internalId || x.id) !== mId; }) : [];
          listMk.unshift(stampedMk);
          latest.mistakes = listMk;
          latest.deletedMistakes = delMk;
          latest.clearOps = clearOpsNow;
          markLocalMutation(latest);
          saveState(latest);
          appliedIds.add(entry.id);
        } else if (entry.kind === "bookmark_delete" && entry.scopeId) {
          removeBookmarks([entry.scopeId], { deferSync: true });
          appliedIds.add(entry.id);
        } else if (entry.kind === "mistake_delete" && entry.scopeId) {
          clearMistake(entry.scopeId, { deferSync: true });
          appliedIds.add(entry.id);
        } else if (entry.kind === "bookmarks_clear") {
          clearBookmarks({ subjectId: entry.subjectId || "", deferSync: true });
          appliedIds.add(entry.id);
        } else if (entry.kind === "mistakes_clear") {
          clearMistakes({ subjectId: entry.subjectId || "", deferSync: true });
          appliedIds.add(entry.id);
        }
      });

      var post = getState();
      var nextUnres = normalizeUnresolvedMutations(post.unresolvedMutations, activeSid);
      nextUnres.items = nextUnres.items.filter(function (x) { return !appliedIds.has(x.id); });
      if (!nextUnres.items.length) nextUnres = emptyUnresolvedMutations(activeSid);
      post.unresolvedMutations = nextUnres;
      saveState(post);
      if (typeof document !== "undefined" && typeof document.dispatchEvent === "function" && typeof root.CustomEvent === "function") {
        document.dispatchEvent(new root.CustomEvent("elgo:progresschange"));
      }
      if (auth && auth.token) {
        return syncProgressToCloud({ force: true });
      }
      return { ok: true, changed: true };
    }
    return { ok: false, error: "Unknown action" };
  }

  async function refreshSession() {
    var auth = getAuth();
    if (!auth || !auth.token) return null;
    if (refreshSessionInFlight) return refreshSessionInFlight;
    var ctx = captureAuthContext(auth);
    refreshSessionInFlight = (async function () {
      try {
        lastCloudPullAt = Date.now();
        var stPre = getState();
        var cid = ensureSyncClientIdentity(stPre);
        var tab = ensureTabSession(false);
        var q = "?syncClientId=" + encodeURIComponent(cid) + "&syncTabTag=" + encodeURIComponent(tab.tabTag) +
          (stPre.syncClientGen >= 1 ? ("&syncClientGen=" + encodeURIComponent(String(stPre.syncClientGen))) : "");
        var res = await fetch("/api/auth/me" + q, {
          headers: authHeaders({}, ctx.token),
          cache: "no-store",
        });
        if (!isAuthContextCurrent(ctx)) return null;
        if (res.status === 401) {
          handleConfirmedSessionInvalidation("refreshSession", "Session expired — please sign in again.", ctx);
          return null;
        }
        var data = await res.json().catch(function () { return null; });
        if (!isAuthContextCurrent(ctx)) return null;
        if (res.ok && data && data.ok && data.profile) {
          var next = Object.assign({}, auth, { profile: data.profile });
          var cloudProg = data.profile.progress && typeof data.profile.progress === "object" ? data.profile.progress : null;
          var prevSt = getState();
          var differentOwner = Boolean(prevSt.ownerStudentId && data.profile.studentId && prevSt.ownerStudentId !== data.profile.studentId);
          var meEpoch = Number((data && data.syncEpoch) || (cloudProg && cloudProg.syncMeta && cloudProg.syncMeta.epoch) || 0);
          var preEpoch = Number(prevSt.syncEpoch) || 0;
          if (!differentOwner && Number.isSafeInteger(meEpoch) && meEpoch > 0 && preEpoch > meEpoch) {
            return isAuthContextCurrent(ctx) ? getAuth() : null;
          }
          if (data.serverTime) recordServerTime(data.serverTime);
          var hasUnsynced = !differentOwner && (Boolean(prevSt.pendingProgressSync) || hasLocalUnsyncedItems(prevSt, cloudProg));
          var needRegistration = !differentOwner && (
            Boolean(prevSt.needsSyncRegistration) ||
            (data.clientRegistration && data.clientRegistration.status === "reconcile_required")
          );
          var progressChanged = false;
          if (data.clientRegistration && data.clientRegistration.status === "active") {
            applyClientRegistrationFromServer(data.clientRegistration);
          }
          if (cloudProg) {
            progressChanged = applyCloudProgress(cloudProg, {
              studentId: data.profile.studentId || "",
              username: data.profile.username || "",
              replace: differentOwner,
              serverTime: data.serverTime,
            });
          }
          if (data.profile.studentId) {
            var refRestoreRes = restoreRecoveryVaultForAccount(data.profile.studentId);
            if (refRestoreRes && refRestoreRes.ok && refRestoreRes.count > 0) {
              progressChanged = true;
            } else if (refRestoreRes && !refRestoreRes.ok) {
              lastRecoveryError = Object.assign({
                ok: false,
                stage: "restore",
                studentId: data.profile.studentId,
              }, refRestoreRes);
              lastRecoveredNotice = {
                ok: false,
                code: refRestoreRes.code || "RESTORE_FAILED",
                error: refRestoreRes.error || "",
                count: 0,
                studentId: data.profile.studentId,
                message: t("recoveryRestoreFailedNotice") + (refRestoreRes.error ? (" (" + refRestoreRes.error + ")") : ""),
              };
            }
          }
          if (!isAuthContextCurrent(ctx)) return null;
          setAuth(next);
          if (data.clientRegistration && data.clientRegistration.status === "reconcile_required") {
            var recOut = await reconcileClientRegistration(ctx);
            if (!isAuthContextCurrent(ctx)) return null;
            if (recOut && recOut.ok) {
              var latestAfterRec = getState();
              hasUnsynced = Boolean(latestAfterRec.pendingProgressSync);
              if (recOut.progress) progressChanged = true;
            }
          }
          var needPush = hasUnsynced || (!data.clientRegistration && needRegistration);
          if (needPush && isAuthContextCurrent(ctx)) {
            restampPendingNonDestructiveItems(getState(), (cloudProg && cloudProg.syncMeta && cloudProg.syncMeta.ops) || {});
            var pushRes = await syncProgressToCloud({ force: true, handshake: !hasUnsynced && needRegistration }).catch(function () { return null; });
            if (!isAuthContextCurrent(ctx)) return null;
            if (pushRes && pushRes.changed) progressChanged = true;
          } else {
            setLastSyncStatus({ ok: true, status: res.status || 200, error: "", offline: false });
          }
          if (progressChanged && isAuthContextCurrent(ctx) && typeof document !== "undefined" && typeof document.dispatchEvent === "function" && typeof root.CustomEvent === "function") {
            document.dispatchEvent(new root.CustomEvent("elgo:progresschange"));
          }
          return next;
        }
        var pullErr = (data && data.error) || ("Failed to load cloud session (HTTP " + res.status + ")");
        if (isAuthContextCurrent(ctx)) {
          setLastSyncStatus({ ok: false, status: res.status || 0, error: pullErr, offline: false });
        }
        warnSyncFailure("refreshSession", pullErr, res.status || 0);
      } catch (err) {
        var netErr = (err && err.message) ? err.message : "Network error while loading cloud progress";
        if (isAuthContextCurrent(ctx)) {
          setLastSyncStatus({ ok: false, status: 0, error: netErr, offline: true });
        }
        warnSyncFailure("refreshSession", netErr, 0);
      }
      return isAuthContextCurrent(ctx) ? getAuth() : null;
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

  function isQuestionInActiveTest(stObj, internalId) {
    if (!stObj || !stObj.activeSession) return false;
    var active = stObj.activeSession;
    if (active.mode !== "test" || active.completed) return false;
    if (!internalId) return false;
    var target = String(internalId);
    var qs = Array.isArray(active.questions) ? active.questions : [];
    return qs.some(function (q) {
      return q && (String(q.internalId || "") === target || String(q.id || "") === target);
    });
  }

  function isBookmarkAnswerHidden(bookmarkItem) {
    if (!bookmarkItem || typeof bookmarkItem !== "object") return false;
    var st = getState();
    var active = st && st.activeSession;
    if (!active || active.mode !== "test" || active.completed) return false;
    if (bookmarkItem.hiddenDuringTest) return true;
    return isQuestionInActiveTest(st, bookmarkItem.internalId || bookmarkItem.id);
  }

  function revealBookmarksForCompletedTest(questions, attemptId) {
    var st = getState();
    var list = Array.isArray(st.bookmarks) ? st.bookmarks : [];
    if (!list.length) return false;
    var qMap = new Map();
    (Array.isArray(questions) ? questions : []).forEach(function (q) {
      if (!q) return;
      if (q.internalId) qMap.set(String(q.internalId), q);
      if (q.id) qMap.set(String(q.id), q);
    });
    var changed = false;
    st.bookmarks = list.map(function (b) {
      if (!b || typeof b !== "object") return b;
      var idKey = String(b.internalId || b.id || "");
      var matchedQ = qMap.get(idKey) || (b.id ? qMap.get(String(b.id)) : null);
      var matchesAttempt = attemptId && b.testAttemptId && b.testAttemptId === attemptId;
      if (!b.hiddenDuringTest && !matchesAttempt && !matchedQ) return b;
      var next = Object.assign({}, b);
      if (next.hiddenDuringTest) {
        delete next.hiddenDuringTest;
        changed = true;
      }
      if (next.testAttemptId) {
        delete next.testAttemptId;
        changed = true;
      }
      if (matchedQ) {
        if (matchedQ.correctOptionId && !next.correctOptionId) {
          next.correctOptionId = matchedQ.correctOptionId;
          changed = true;
        }
        if (!next.correctAnswer && Array.isArray(matchedQ.options)) {
          var cid = next.correctOptionId || matchedQ.correctOptionId;
          var rightOpt = matchedQ.options.find(function (o) { return o && o.id === cid; });
          if (rightOpt) {
            next.correctAnswer = rightOpt.id + ") " + rightOpt.text;
            changed = true;
          }
        }
      }
      return next;
    });
    if (!changed) return false;
    markLocalMutation(st);
    saveState(st);
    scheduleCloudProgressSync();
    return true;
  }

  function isBookmarked(internalId) {
    if (!internalId || isIsolatedSignedOutState()) return false;
    var st = getState();
    return (st.bookmarks || []).some(function (b) {
      return b && (b.internalId === internalId || b.id === internalId);
    });
  }

  function bindOwnerOnLocalMutation(st) {
    var a = getAuth();
    if (a && a.profile && a.profile.studentId && !st.ownerStudentId) {
      st.ownerStudentId = a.profile.studentId;
      if (a.profile.username) st.ownerUsername = a.profile.username;
    }
  }

  function toggleBookmark(question, meta) {
    if (!question || isIsolatedSignedOutState()) return false;
    var internalId = question.internalId || question.id;
    var st = getState();
    bindOwnerOnLocalMutation(st);
    var clearOps = normalizeClientClearOps(st.clearOps);
    var list = Array.isArray(st.bookmarks) ? st.bookmarks.slice() : [];
    var delMap = Object.assign({}, st.deletedBookmarks && typeof st.deletedBookmarks === "object" ? st.deletedBookmarks : {});
    var idx = list.findIndex(function (b) {
      return b && (b.internalId === internalId || b.id === internalId);
    });

    if (idx >= 0) {
      var removed = list.splice(idx, 1)[0];
      var delIso = nextMutationIso(removed && removed.savedAt);
      if (internalId) {
        delMap[internalId] = delIso;
        var delOpId = makeSyncOpId(st, "bd", internalId);
        if (delOpId) clearOps.deletedBookmarks[internalId] = { id: delOpId, clientAt: delIso };
        else clearOps.deletedBookmarks[internalId] = { id: "", clientAt: delIso };
      }
      if (removed && removed.id && removed.id !== internalId) {
        delMap[removed.id] = delIso;
        var altDelOpId = makeSyncOpId(st, "bd", removed.id);
        if (altDelOpId) clearOps.deletedBookmarks[removed.id] = { id: altDelOpId, clientAt: delIso };
        else clearOps.deletedBookmarks[removed.id] = { id: "", clientAt: delIso };
      }
      st.bookmarks = list;
      st.deletedBookmarks = trimTimestampMapClient(delMap, 500);
      st.clearOps = clearOps;
      markLocalMutation(st);
      saveState(st);
      if (!(meta && meta.deferSync)) scheduleCloudProgressSync();
      return false;
    }

    var bmSid = (meta && meta.subjectId) || resolveItemSubjectId(question);
    var bmSubjClear = bmSid && st.bookmarksClearedAtBySubject && st.bookmarksClearedAtBySubject[bmSid];
    var savedIso = nextMutationIso(delMap[internalId], delMap[question.id], st.bookmarksClearedAt, bmSubjClear);
    var saveOpId = makeSyncOpId(st, "bi", internalId || question.id || "");
    if (internalId) {
      delete delMap[internalId];
      delete clearOps.deletedBookmarks[internalId];
    }
    if (question.id) {
      delete delMap[question.id];
      delete clearOps.deletedBookmarks[question.id];
    }

    var hideAnswer = Boolean((meta && meta.hideAnswer === true) || isQuestionInActiveTest(st, internalId));
    var opts = Array.isArray(question.options) ? question.options : [];
    var rightOpt = hideAnswer ? null : opts.find(function (o) { return o && o.id === question.correctOptionId; });
    var qImgs = (root.ElgoModel && typeof root.ElgoModel.getQuestionImages === "function")
      ? root.ElgoModel.getQuestionImages(question)
      : (question.image ? [{ url: question.image }] : []);
    var entry = {
      id: question.id || internalId,
      internalId: internalId,
      subjectId: (meta && meta.subjectId) || question.subjectId || "",
      subjectName: (meta && meta.subjectName) || "",
      quizId: (meta && meta.collectionId) || question.collectionId || "",
      sourceLabel: (meta && meta.sourceLabel) || question.collectionTitle || "",
      question: question.question || question.text || "",
      image: qImgs[0] ? qImgs[0].url : "",
      images: qImgs,
      correctOptionId: hideAnswer ? null : (question.correctOptionId || null),
      correctAnswer: (!hideAnswer && rightOpt) ? (rightOpt.id + ") " + rightOpt.text) : "",
      savedAt: savedIso,
      syncOpId: saveOpId,
    };
    if (hideAnswer) {
      entry.hiddenDuringTest = true;
      var activeAttemptId = (meta && meta.attemptId) || (st.activeSession && st.activeSession.attemptId) || "";
      if (activeAttemptId) entry.testAttemptId = activeAttemptId;
    }
    list.unshift(entry);
    st.bookmarks = list;
    st.deletedBookmarks = trimTimestampMapClient(delMap, 500);
    st.clearOps = clearOps;
    markLocalMutation(st);
    saveState(st);
    if (!(meta && meta.deferSync)) scheduleCloudProgressSync();
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
      var out = {
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
      if (prev.syncOpId) out.syncOpId = prev.syncOpId;
      return out;
    });
  }

  function recordMistake(question, wrongOptionId, meta) {
    if (!question || isIsolatedSignedOutState()) return;
    var internalId = question.internalId || question.id;
    var qImgs = (root.ElgoModel && typeof root.ElgoModel.getQuestionImages === "function")
      ? root.ElgoModel.getQuestionImages(question)
      : (question.image ? [{ url: question.image }] : []);
    var st = getState();
    bindOwnerOnLocalMutation(st);
    var clearOps = normalizeClientClearOps(st.clearOps);
    var list = Array.isArray(st.mistakes) ? st.mistakes.slice() : [];
    var delMap = Object.assign({}, st.deletedMistakes && typeof st.deletedMistakes === "object" ? st.deletedMistakes : {});
    var existing = list.find(function (m) { return m && (m.internalId === internalId || m.id === internalId); });
    var mkSid = (meta && meta.subjectId) || resolveItemSubjectId(question);
    var mkSubjClear = mkSid && st.mistakesClearedAtBySubject && st.mistakesClearedAtBySubject[mkSid];
    var mutIso = nextMutationIso(
      existing && existing.updatedAt,
      existing && existing.resolvedAt,
      delMap[internalId],
      st.mistakesClearedAt,
      mkSubjClear
    );
    var mutOpId = makeSyncOpId(st, "mi", internalId || question.id || "");
    if (internalId) {
      delete delMap[internalId];
      delete clearOps.deletedMistakes[internalId];
    }
    if (question.id) {
      delete delMap[question.id];
      delete clearOps.deletedMistakes[question.id];
    }
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
          return Object.assign({}, m, { resolved: false, resolvedAt: null, updatedAt: mutIso, syncOpId: mutOpId });
        }
        return m;
      });
      // Put the newly missed item first so recent mistakes stay immediately visible
      var hitIdx = st.mistakes.findIndex(function (m) { return m.internalId === internalId; });
      if (hitIdx > 0) {
        st.mistakes.unshift(st.mistakes.splice(hitIdx, 1)[0]);
      }
      st.deletedMistakes = trimTimestampMapClient(delMap, 500);
      st.clearOps = clearOps;
      markLocalMutation(st);
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
        syncOpId: mutOpId,
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
        syncOpId: mutOpId,
      });
    }

    st.mistakes = list;
    st.deletedMistakes = trimTimestampMapClient(delMap, 500);
    st.clearOps = clearOps;
    markLocalMutation(st);
    saveState(st);
    scheduleCloudProgressSync();
  }

  function getMistakes(subjectId, opts) {
    if (isIsolatedSignedOutState()) return [];
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
    if (isIsolatedSignedOutState()) return [];
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
    if (isIsolatedSignedOutState()) return;
    var st = getState();
    bindOwnerOnLocalMutation(st);
    var list = Array.isArray(st.mistakes) ? st.mistakes : [];
    var target = list.find(function (m) { return m && (m.internalId === internalId || m.id === internalId); });
    var mutIso = nextMutationIso(target && target.updatedAt, target && target.resolvedAt);
    var mkScopeId = (target && (target.internalId || target.questionId || target.id)) || internalId || "";
    var mutOpId = makeSyncOpId(st, "mi", mkScopeId);
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
            syncOpId: mutOpId,
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
            syncOpId: mutOpId,
          });
        }
        return m;
      });
    }
    markLocalMutation(st);
    saveState(st);
    scheduleCloudProgressSync();
  }

  function resolveMistake(internalId) {
    setMistakeResolved(internalId, true);
  }

  function reopenMistake(internalId) {
    setMistakeResolved(internalId, false);
  }

  function getProgressSnapshot() {
    if (isIsolatedSignedOutState()) {
      return {
        ownerStudentId: "",
        ownerToken: "",
        bookmarks: [],
        deletedBookmarks: {},
        bookmarksClearedAt: null,
        bookmarksClearedAtBySubject: {},
        mistakes: [],
        deletedMistakes: {},
        mistakesClearedAt: null,
        mistakesClearedAtBySubject: {},
      };
    }
    var st = getState();
    var auth = getAuth();
    return JSON.parse(JSON.stringify({
      ownerStudentId: auth && auth.profile ? String(auth.profile.studentId || "") : "",
      ownerToken: auth && auth.token ? String(auth.token) : "",
      bookmarks: Array.isArray(st.bookmarks) ? st.bookmarks : [],
      deletedBookmarks: st.deletedBookmarks && typeof st.deletedBookmarks === "object" ? st.deletedBookmarks : {},
      bookmarksClearedAt: st.bookmarksClearedAt || null,
      bookmarksClearedAtBySubject: st.bookmarksClearedAtBySubject && typeof st.bookmarksClearedAtBySubject === "object" ? st.bookmarksClearedAtBySubject : {},
      mistakes: Array.isArray(st.mistakes) ? st.mistakes : [],
      deletedMistakes: st.deletedMistakes && typeof st.deletedMistakes === "object" ? st.deletedMistakes : {},
      mistakesClearedAt: st.mistakesClearedAt || null,
      mistakesClearedAtBySubject: st.mistakesClearedAtBySubject && typeof st.mistakesClearedAtBySubject === "object" ? st.mistakesClearedAtBySubject : {},
    }));
  }

  function flushDeferredProgressSync() {
    var st = getState();
    if (st && st.pendingProgressSync) {
      scheduleCloudProgressSync();
    }
  }

  function restoreProgressSnapshot(snapshot, opts) {
    if (!snapshot || typeof snapshot !== "object") return false;
    var auth = getAuth();
    var currentStudentId = auth && auth.profile ? String(auth.profile.studentId || "") : "";
    var snapshotStudentId = String(snapshot.ownerStudentId || "");
    if (!auth || !snapshotStudentId || currentStudentId !== snapshotStudentId) return false;
    if (snapshot.ownerToken && (!auth.token || auth.token !== snapshot.ownerToken)) return false;
    var o = opts || {};
    var st = getState();
    var targetScope = o.scope || "all";

    var clearOps = normalizeClientClearOps(st.clearOps);

    if (targetScope === "bookmarks" || targetScope === "all") {
      var prevDelBm = Object.assign({}, st.deletedBookmarks && typeof st.deletedBookmarks === "object" ? st.deletedBookmarks : {});
      var globalBmMs = parseIsoMsClient(st.bookmarksClearedAt);
      var subjBmMap = st.bookmarksClearedAtBySubject && typeof st.bookmarksClearedAtBySubject === "object" ? st.bookmarksClearedAtBySubject : {};
      var currentBmMap = new Map();
      (Array.isArray(st.bookmarks) ? st.bookmarks : []).forEach(function (b) {
        if (b && (b.internalId || b.id)) currentBmMap.set(b.internalId || b.id, b);
      });
      var snapBm = Array.isArray(snapshot.bookmarks) ? snapshot.bookmarks : [];
      var restoredBmList = snapBm.map(function (item) {
        if (!item || typeof item !== "object") return item;
        var id = item.internalId || item.id;
        var sid = resolveItemSubjectId(item);
        var minWatermarkMs = Math.max(
          parseIsoMsClient(item.savedAt),
          parseIsoMsClient(prevDelBm[id]),
          parseIsoMsClient(prevDelBm[item.id]),
          globalBmMs,
          sid ? parseIsoMsClient(subjBmMap[sid]) : 0
        );
        var existing = currentBmMap.get(id);
        if (existing && parseIsoMsClient(existing.savedAt) > minWatermarkMs) {
          return existing;
        }
        if (id) { delete prevDelBm[id]; delete clearOps.deletedBookmarks[id]; }
        if (item.id) { delete prevDelBm[item.id]; delete clearOps.deletedBookmarks[item.id]; }
        var nextIso = nextMutationIso(minWatermarkMs ? new Date(minWatermarkMs).toISOString() : null);
        return Object.assign({}, item, { savedAt: nextIso, syncOpId: makeSyncOpId(st, "bi", id || item.id || item.questionId || "") });
      });
      st.bookmarks = restoredBmList;
      st.deletedBookmarks = trimTimestampMapClient(prevDelBm, 500);
    }

    if (targetScope === "mistakes" || targetScope === "all") {
      var prevDelMk = Object.assign({}, st.deletedMistakes && typeof st.deletedMistakes === "object" ? st.deletedMistakes : {});
      var globalMkMs = parseIsoMsClient(st.mistakesClearedAt);
      var subjMkMap = st.mistakesClearedAtBySubject && typeof st.mistakesClearedAtBySubject === "object" ? st.mistakesClearedAtBySubject : {};
      var currentMkMap = new Map();
      (Array.isArray(st.mistakes) ? st.mistakes : []).forEach(function (m) {
        if (m && (m.internalId || m.id)) currentMkMap.set(m.internalId || m.id, m);
      });
      var snapMk = Array.isArray(snapshot.mistakes) ? snapshot.mistakes : [];
      var restoredMkList = snapMk.map(function (item) {
        if (!item || typeof item !== "object") return item;
        var id = item.internalId || item.id;
        var sid = resolveItemSubjectId(item);
        var minWatermarkMs = Math.max(
          parseIsoMsClient(item.updatedAt),
          parseIsoMsClient(item.resolvedAt),
          parseIsoMsClient(prevDelMk[id]),
          parseIsoMsClient(prevDelMk[item.id]),
          globalMkMs,
          sid ? parseIsoMsClient(subjMkMap[sid]) : 0
        );
        var existing = currentMkMap.get(id);
        if (existing && Math.max(parseIsoMsClient(existing.updatedAt), parseIsoMsClient(existing.resolvedAt)) > minWatermarkMs) {
          return existing;
        }
        if (id) { delete prevDelMk[id]; delete clearOps.deletedMistakes[id]; }
        if (item.id) { delete prevDelMk[item.id]; delete clearOps.deletedMistakes[item.id]; }
        var freshIso = nextMutationIso(minWatermarkMs ? new Date(minWatermarkMs).toISOString() : null);
        return Object.assign({}, item, {
          updatedAt: freshIso,
          resolvedAt: item.resolved ? (parseIsoMsClient(item.resolvedAt) > minWatermarkMs ? item.resolvedAt : freshIso) : null,
          syncOpId: makeSyncOpId(st, "mi", item.internalId || item.questionId || item.id || ""),
        });
      });
      st.mistakes = restoredMkList;
      st.deletedMistakes = trimTimestampMapClient(prevDelMk, 500);
    }

    st.clearOps = clearOps;
    markLocalMutation(st);
    saveState(st);
    if (!o.deferSync) {
      scheduleCloudProgressSync();
    }
    if (typeof document !== "undefined" && typeof document.dispatchEvent === "function" && typeof root.CustomEvent === "function") {
      document.dispatchEvent(new root.CustomEvent("elgo:progresschange"));
    }
    return true;
  }

  function removeBookmarks(ids, opts) {
    var o = opts || {};
    var idSet = new Set(Array.isArray(ids) ? ids.filter(Boolean).map(String) : []);
    if (!idSet.size || isIsolatedSignedOutState()) return 0;
    var st = getState();
    bindOwnerOnLocalMutation(st);
    var clearOps = normalizeClientClearOps(st.clearOps);
    var list = Array.isArray(st.bookmarks) ? st.bookmarks : [];
    var delMap = Object.assign({}, st.deletedBookmarks && typeof st.deletedBookmarks === "object" ? st.deletedBookmarks : {});
    var kept = [];
    var removedCount = 0;
    list.forEach(function (b) {
      if (!b) return;
      var key = String(b.internalId || b.id || "");
      var alt = String(b.id || "");
      if (idSet.has(key) || (alt && idSet.has(alt))) {
        var delIso = nextMutationIso(b.savedAt);
        if (key) { delMap[key] = delIso; clearOps.deletedBookmarks[key] = { id: makeSyncOpId(st, "bd", key), clientAt: delIso }; }
        if (alt && alt !== key) { delMap[alt] = delIso; clearOps.deletedBookmarks[alt] = { id: makeSyncOpId(st, "bd", alt), clientAt: delIso }; }
        removedCount += 1;
      } else {
        kept.push(b);
      }
    });
    if (!removedCount) return 0;
    st.bookmarks = kept;
    st.deletedBookmarks = trimTimestampMapClient(delMap, 500);
    st.clearOps = clearOps;
    markLocalMutation(st);
    saveState(st);
    if (!o.deferSync) scheduleCloudProgressSync();
    if (typeof document !== "undefined" && typeof document.dispatchEvent === "function" && typeof root.CustomEvent === "function") {
      document.dispatchEvent(new root.CustomEvent("elgo:progresschange"));
    }
    return removedCount;
  }

  function clearBookmarks(opts) {
    if (isIsolatedSignedOutState()) return 0;
    var o = opts || {};
    var subjectId = (o.subjectId && o.subjectId !== "all") ? String(o.subjectId).trim() : "";
    var st = getState();
    bindOwnerOnLocalMutation(st);
    var clearOps = normalizeClientClearOps(st.clearOps);
    var list = Array.isArray(st.bookmarks) ? st.bookmarks : [];
    var prevStamps = [st.bookmarksClearedAt];
    if (st.bookmarksClearedAtBySubject && typeof st.bookmarksClearedAtBySubject === "object") {
      Object.values(st.bookmarksClearedAtBySubject).forEach(function (v) { if (v) prevStamps.push(v); });
    }
    var removedCount = 0;
    if (!subjectId) {
      list.forEach(function (b) {
        if (b && b.savedAt) prevStamps.push(b.savedAt);
        removedCount += 1;
      });
      if (st.deletedBookmarks && typeof st.deletedBookmarks === "object") {
        Object.values(st.deletedBookmarks).forEach(function (v) { if (v) prevStamps.push(v); });
      }
      var globalClearIso = nextMutationIso.apply(null, prevStamps);
      st.bookmarks = [];
      st.deletedBookmarks = {};
      st.bookmarksClearedAtBySubject = {};
      st.bookmarksClearedAt = globalClearIso;
      clearOps.deletedBookmarks = {};
      clearOps.bookmarksBySubject = {};
      clearOps.bookmarksGlobal = { id: makeSyncOpId(st, "bg", ""), clientAt: globalClearIso };
    } else {
      var delMap = Object.assign({}, st.deletedBookmarks && typeof st.deletedBookmarks === "object" ? st.deletedBookmarks : {});
      var kept = [];
      list.forEach(function (b) {
        if (!b) return;
        if (resolveItemSubjectId(b) === subjectId) {
          if (b.savedAt) prevStamps.push(b.savedAt);
          if (b.internalId && delMap[b.internalId]) { prevStamps.push(delMap[b.internalId]); delete delMap[b.internalId]; delete clearOps.deletedBookmarks[b.internalId]; }
          if (b.id && delMap[b.id]) { prevStamps.push(delMap[b.id]); delete delMap[b.id]; delete clearOps.deletedBookmarks[b.id]; }
          removedCount += 1;
        } else {
          kept.push(b);
        }
      });
      var clearIso = nextMutationIso.apply(null, prevStamps);
      var subjMap = trimTimestampMapClient(st.bookmarksClearedAtBySubject, 200, 160);
      subjMap[subjectId] = clearIso;
      st.bookmarks = kept;
      st.deletedBookmarks = trimTimestampMapClient(delMap, 500);
      st.bookmarksClearedAtBySubject = trimTimestampMapClient(subjMap, 200, 160);
      clearOps.bookmarksBySubject[subjectId] = { id: makeSyncOpId(st, "bs", subjectId), clientAt: clearIso };
    }
    st.clearOps = clearOps;
    markLocalMutation(st);
    saveState(st);
    if (!o.deferSync) scheduleCloudProgressSync(true);
    if (typeof document !== "undefined" && typeof document.dispatchEvent === "function" && typeof root.CustomEvent === "function") {
      document.dispatchEvent(new root.CustomEvent("elgo:progresschange"));
    }
    return removedCount;
  }

  function clearMistake(internalId, opts) {
    if (isIsolatedSignedOutState()) return;
    var o = opts || {};
    var st = getState();
    bindOwnerOnLocalMutation(st);
    var clearOps = normalizeClientClearOps(st.clearOps);
    var list = Array.isArray(st.mistakes) ? st.mistakes : [];
    var target = list.find(function (m) { return m && (m.internalId === internalId || m.id === internalId); });
    var delIso = nextMutationIso(target && target.updatedAt, target && target.resolvedAt);
    var delMap = Object.assign({}, st.deletedMistakes && typeof st.deletedMistakes === "object" ? st.deletedMistakes : {});
    if (internalId) { delMap[internalId] = delIso; clearOps.deletedMistakes[internalId] = { id: makeSyncOpId(st, "md", internalId), clientAt: delIso }; }
    if (target && target.id && target.id !== internalId) { delMap[target.id] = delIso; clearOps.deletedMistakes[target.id] = { id: makeSyncOpId(st, "md", target.id), clientAt: delIso }; }
    var ms = getMistakesStore();
    if (ms && typeof ms.deleteMistake === "function") {
      st.mistakes = fromCoreMistakeStore(ms.deleteMistake(toCoreMistakeStore(list), internalId), list);
    } else {
      st.mistakes = list.filter(function (m) {
        return m && m.internalId !== internalId && m.id !== internalId;
      });
    }
    st.deletedMistakes = trimTimestampMapClient(delMap, 500);
    st.clearOps = clearOps;
    markLocalMutation(st);
    saveState(st);
    if (!o.deferSync) scheduleCloudProgressSync();
    if (typeof document !== "undefined" && typeof document.dispatchEvent === "function" && typeof root.CustomEvent === "function") {
      document.dispatchEvent(new root.CustomEvent("elgo:progresschange"));
    }
  }

  function clearMistakeIds(ids, opts) {
    var o = opts || {};
    var idSet = new Set(Array.isArray(ids) ? ids.filter(Boolean).map(String) : []);
    if (!idSet.size || isIsolatedSignedOutState()) return 0;
    var st = getState();
    bindOwnerOnLocalMutation(st);
    var clearOps = normalizeClientClearOps(st.clearOps);
    var list = Array.isArray(st.mistakes) ? st.mistakes : [];
    var delMap = Object.assign({}, st.deletedMistakes && typeof st.deletedMistakes === "object" ? st.deletedMistakes : {});
    var kept = [];
    var removedCount = 0;
    list.forEach(function (m) {
      if (!m) return;
      var key = String(m.internalId || m.id || "");
      var alt = String(m.id || "");
      if (idSet.has(key) || (alt && idSet.has(alt))) {
        var delIso = nextMutationIso(m.updatedAt, m.resolvedAt);
        if (key) { delMap[key] = delIso; clearOps.deletedMistakes[key] = { id: makeSyncOpId(st, "md", key), clientAt: delIso }; }
        if (alt && alt !== key) { delMap[alt] = delIso; clearOps.deletedMistakes[alt] = { id: makeSyncOpId(st, "md", alt), clientAt: delIso }; }
        removedCount += 1;
      } else {
        kept.push(m);
      }
    });
    if (!removedCount) return 0;
    st.mistakes = kept;
    st.deletedMistakes = trimTimestampMapClient(delMap, 500);
    st.clearOps = clearOps;
    markLocalMutation(st);
    saveState(st);
    if (!o.deferSync) scheduleCloudProgressSync();
    if (typeof document !== "undefined" && typeof document.dispatchEvent === "function" && typeof root.CustomEvent === "function") {
      document.dispatchEvent(new root.CustomEvent("elgo:progresschange"));
    }
    return removedCount;
  }

  function setMistakesResolved(ids, resolved, opts) {
    var o = opts || {};
    var idSet = new Set(Array.isArray(ids) ? ids.filter(Boolean).map(String) : []);
    if (!idSet.size || isIsolatedSignedOutState()) return 0;
    var st = getState();
    bindOwnerOnLocalMutation(st);
    var list = Array.isArray(st.mistakes) ? st.mistakes : [];
    var updatedCount = 0;
    st.mistakes = list.map(function (m) {
      if (!m) return m;
      var key = String(m.internalId || m.id || "");
      var alt = String(m.id || "");
      if (!idSet.has(key) && !(alt && idSet.has(alt))) return m;
      var mutIso = nextMutationIso(m.updatedAt, m.resolvedAt);
      updatedCount += 1;
      return Object.assign({}, m, {
        resolved: Boolean(resolved),
        resolvedAt: resolved ? mutIso : null,
        updatedAt: mutIso,
        syncOpId: makeSyncOpId(st, "mi", m.internalId || m.questionId || m.id || ""),
      });
    });
    if (!updatedCount) return 0;
    markLocalMutation(st);
    saveState(st);
    if (!o.deferSync) scheduleCloudProgressSync();
    if (typeof document !== "undefined" && typeof document.dispatchEvent === "function" && typeof root.CustomEvent === "function") {
      document.dispatchEvent(new root.CustomEvent("elgo:progresschange"));
    }
    return updatedCount;
  }

  function clearMistakes(opts) {
    if (isIsolatedSignedOutState()) return 0;
    var o = opts || {};
    var subjectId = (o.subjectId && o.subjectId !== "all") ? String(o.subjectId).trim() : "";
    var status = (o.status && o.status !== "all") ? String(o.status) : "all";
    var st = getState();
    bindOwnerOnLocalMutation(st);
    var clearOps = normalizeClientClearOps(st.clearOps);
    var list = Array.isArray(st.mistakes) ? st.mistakes : [];

    if (status === "unresolved" || status === "resolved") {
      var targetIds = list.filter(function (m) {
        if (!m) return false;
        if (subjectId && resolveItemSubjectId(m) !== subjectId) return false;
        return status === "resolved" ? Boolean(m.resolved) : !m.resolved;
      }).map(function (m) { return m.internalId || m.id; }).filter(Boolean);
      return clearMistakeIds(targetIds, o);
    }

    var ms = getMistakesStore();
    if (!subjectId && ms && typeof ms.clearMistakes === "function") {
      ms.clearMistakes();
    }
    var prevStamps = [st.mistakesClearedAt];
    if (st.mistakesClearedAtBySubject && typeof st.mistakesClearedAtBySubject === "object") {
      Object.values(st.mistakesClearedAtBySubject).forEach(function (v) { if (v) prevStamps.push(v); });
    }
    var removedCount = 0;

    if (!subjectId) {
      list.forEach(function (m) {
        if (m) {
          if (m.updatedAt) prevStamps.push(m.updatedAt);
          if (m.resolvedAt) prevStamps.push(m.resolvedAt);
          if (m.firstFailedAt) prevStamps.push(m.firstFailedAt);
          removedCount += 1;
        }
      });
      if (st.deletedMistakes && typeof st.deletedMistakes === "object") {
        Object.values(st.deletedMistakes).forEach(function (v) { if (v) prevStamps.push(v); });
      }
      var globalClearIso = nextMutationIso.apply(null, prevStamps);
      st.mistakes = [];
      st.deletedMistakes = {};
      st.mistakesClearedAtBySubject = {};
      st.mistakesClearedAt = globalClearIso;
      clearOps.deletedMistakes = {};
      clearOps.mistakesBySubject = {};
      clearOps.mistakesGlobal = { id: makeSyncOpId(st, "mg", ""), clientAt: globalClearIso };
    } else {
      var delMap = Object.assign({}, st.deletedMistakes && typeof st.deletedMistakes === "object" ? st.deletedMistakes : {});
      var kept = [];
      list.forEach(function (m) {
        if (!m) return;
        if (resolveItemSubjectId(m) === subjectId) {
          if (m.updatedAt) prevStamps.push(m.updatedAt);
          if (m.resolvedAt) prevStamps.push(m.resolvedAt);
          if (m.firstFailedAt) prevStamps.push(m.firstFailedAt);
          if (m.internalId && delMap[m.internalId]) { prevStamps.push(delMap[m.internalId]); delete delMap[m.internalId]; delete clearOps.deletedMistakes[m.internalId]; }
          if (m.id && delMap[m.id]) { prevStamps.push(delMap[m.id]); delete delMap[m.id]; delete clearOps.deletedMistakes[m.id]; }
          removedCount += 1;
        } else {
          kept.push(m);
        }
      });
      var clearIso = nextMutationIso.apply(null, prevStamps);
      var subjMap = trimTimestampMapClient(st.mistakesClearedAtBySubject, 200, 160);
      subjMap[subjectId] = clearIso;
      st.mistakes = kept;
      st.deletedMistakes = trimTimestampMapClient(delMap, 500);
      st.mistakesClearedAtBySubject = trimTimestampMapClient(subjMap, 200, 160);
      clearOps.mistakesBySubject[subjectId] = { id: makeSyncOpId(st, "ms", subjectId), clientAt: clearIso };
    }
    st.clearOps = clearOps;
    markLocalMutation(st);
    saveState(st);
    if (!o.deferSync) scheduleCloudProgressSync(true);
    if (typeof document !== "undefined" && typeof document.dispatchEvent === "function" && typeof root.CustomEvent === "function") {
      document.dispatchEvent(new root.CustomEvent("elgo:progresschange"));
    }
    return removedCount;
  }

  function clearAllMistakes() {
    return clearMistakes({ subjectId: "", status: "all" });
  }

  function recordCompletedAttempt(summary) {
    if (isIsolatedSignedOutState()) return;
    var st = getState();
    var hist = Array.isArray(st.attemptHistory) ? st.attemptHistory.slice() : [];
    hist.unshift(Object.assign({}, summary, { finishedAt: nextMutationIso() }));
    if (hist.length > 50) hist.length = 50;
    st.attemptHistory = hist;
    st.lastAttempt = summary;
    st.activeSession = null;
    markLocalMutation(st);
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
    var out = {
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
    if (m.syncOpId) out.syncOpId = m.syncOpId;
    return out;
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
    if (b.syncOpId) item.syncOpId = b.syncOpId;
    if (!stripHeavyText) {
      if (b.subjectName) item.subjectName = b.subjectName;
      if (b.sourceLabel) item.sourceLabel = b.sourceLabel;
      if (b.question) item.question = b.question;
      if (b.image && (!stripDataUris || String(b.image).indexOf("data:") !== 0)) item.image = b.image;
      var imgs = filterExternalImageList(b.images, stripDataUris);
      if (imgs.length) item.images = imgs;
      if (!isBookmarkAnswerHidden(b)) {
        if (b.correctOptionId) item.correctOptionId = b.correctOptionId;
        if (b.correctAnswer) item.correctAnswer = b.correctAnswer;
      }
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
    if (m.syncOpId) item.syncOpId = m.syncOpId;
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

  function buildClientSyncSlots(st, delBm, bmBySubj, delMk, mkBySubj) {
    var clearOps = normalizeClientClearOps(st.clearOps);
    var slots = {};
    if (st.bookmarksClearedAt && clearOps.bookmarksGlobal && clearOps.bookmarksGlobal.id) {
      slots.bmGlobal = clearOps.bookmarksGlobal.id;
    }
    if (st.mistakesClearedAt && clearOps.mistakesGlobal && clearOps.mistakesGlobal.id) {
      slots.mkGlobal = clearOps.mistakesGlobal.id;
    }
    var pickMap = function (targetKeys, opMap) {
      var out = {};
      Object.keys(targetKeys || {}).forEach(function (k) {
        if (opMap[k] && opMap[k].id) out[k] = opMap[k].id;
      });
      return out;
    };
    var bmSubjSlots = pickMap(bmBySubj, clearOps.bookmarksBySubject);
    var mkSubjSlots = pickMap(mkBySubj, clearOps.mistakesBySubject);
    var bmDelSlots = pickMap(delBm, clearOps.deletedBookmarks);
    var mkDelSlots = pickMap(delMk, clearOps.deletedMistakes);
    if (Object.keys(bmSubjSlots).length) slots.bmSubj = bmSubjSlots;
    if (Object.keys(mkSubjSlots).length) slots.mkSubj = mkSubjSlots;
    if (Object.keys(bmDelSlots).length) slots.bmDel = bmDelSlots;
    if (Object.keys(mkDelSlots).length) slots.mkDel = mkDelSlots;
    return slots;
  }

  function exportCloudProgress(opts) {
    var st = getState();
    var prevCid = st.syncClientId;
    var clientId = ensureSyncClientIdentity(st);
    var tab = ensureTabSession(false);
    if (prevCid !== clientId && readStorage(STATE_KEY)) {
      saveState(st);
    }
    var normBm = (Array.isArray(st.bookmarks) ? st.bookmarks : []).map(normalizeClientBookmarkItem).filter(Boolean);
    var normMk = (Array.isArray(st.mistakes) ? st.mistakes : []).map(normalizeClientMistakeItem).filter(Boolean);
    var delBm = trimTimestampMapClient(st.deletedBookmarks, 500);
    var delMk = trimTimestampMapClient(st.deletedMistakes, 500);
    var attempts = (Array.isArray(st.attemptHistory) ? st.attemptHistory : [])
      .slice(0, 50)
      .map(compactCloudAttempt)
      .filter(Boolean);

    var buildPayload = function (stripHeavy, maxAttempts, stripDataUris) {
      var bmBySubj = trimTimestampMapClient(st.bookmarksClearedAtBySubject, 200, 160);
      var mkBySubj = trimTimestampMapClient(st.mistakesClearedAtBySubject, 200, 160);
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
      if (st.bookmarksClearedAt && parseIsoMsClient(st.bookmarksClearedAt)) out.bookmarksClearedAt = st.bookmarksClearedAt;
      if (Object.keys(bmBySubj).length) out.bookmarksClearedAtBySubject = bmBySubj;
      if (st.mistakesClearedAt && parseIsoMsClient(st.mistakesClearedAt)) out.mistakesClearedAt = st.mistakesClearedAt;
      if (Object.keys(mkBySubj).length) out.mistakesClearedAtBySubject = mkBySubj;
      var syncSlots = buildClientSyncSlots(st, delBm, bmBySubj, delMk, mkBySubj);
      var hasGen = Number.isSafeInteger(st.syncClientGen) && st.syncClientGen >= 1;
      var metaOut = hasGen
        ? { v: SYNC_PROTOCOL_VERSION, clientId: clientId, tabTag: tab.tabTag, clientGen: st.syncClientGen, clientSeq: tab.tabSeq }
        : { v: 1, clientId: clientId, clientSeq: Number(st.syncClientSeq) || 0 };
      if (Object.keys(syncSlots).length) metaOut.slots = syncSlots;
      out.syncMeta = metaOut;
      return out;
    };

    if (!(opts && opts.compact)) {
      var full = buildPayload(false, 50, false);
      if (utf8ByteLength(JSON.stringify(full)) <= 340 * 1024) return full;
      var withoutDataUris = buildPayload(false, 50, true);
      if (utf8ByteLength(JSON.stringify(withoutDataUris)) <= 360 * 1024) return withoutDataUris;
    }
    var stripped = buildPayload(true, 25, true);
    if (utf8ByteLength(JSON.stringify(stripped)) <= 360 * 1024) return stripped;
    return buildPayload(true, 0, true);
  }

  function resolveScalarWatermarkClient(localIso, localOpRec, cloudIso, cloudSlotOpId, cloudAckOps) {
    var localOpId = localOpRec && localOpRec.id ? String(localOpRec.id) : "";
    var localAcked = Boolean(localOpId && cloudAckOps && Object.prototype.hasOwnProperty.call(cloudAckOps, localOpId));
    var localMs = localAcked ? (Number(cloudAckOps[localOpId]) || 0) : parseIsoMsClient(localIso);
    if (localMs > getExtremeFutureCutoffMs()) localMs = 0;
    var cloudMs = parseReasonableIsoMsClient(cloudIso);
    if (cloudMs >= localMs) {
      if (!cloudMs) return { iso: null, ms: 0, opRec: null };
      var chosenId = (cloudMs === localMs && !cloudSlotOpId && localOpId) ? localOpId : (cloudSlotOpId || "");
      return { iso: cloudIso, ms: cloudMs, opRec: chosenId ? { id: chosenId, clientAt: cloudIso } : null };
    }
    var effIso = localAcked ? new Date(localMs).toISOString() : localIso;
    return { iso: effIso, ms: localMs, opRec: localOpId ? { id: localOpId, clientAt: effIso } : null };
  }

  function resolveMapWatermarksClient(localMap, localOpMap, cloudMap, cloudSlotMap, cloudAckOps, maxEntries, maxKeyLen) {
    var keys = new Set();
    if (localMap && typeof localMap === "object") Object.keys(localMap).forEach(function (k) { keys.add(k); });
    if (cloudMap && typeof cloudMap === "object") Object.keys(cloudMap).forEach(function (k) { keys.add(k); });
    var out = {};
    var outOps = {};
    keys.forEach(function (k) {
      if (!k || k.length > (maxKeyLen || 500) || k === "__proto__" || k === "constructor" || k === "prototype") return;
      var cIso = cloudMap && typeof cloudMap[k] === "string" ? cloudMap[k] : null;
      var lIso = localMap && typeof localMap[k] === "string" ? localMap[k] : null;
      var res = resolveScalarWatermarkClient(
        lIso,
        localOpMap && localOpMap[k],
        cIso,
        cloudSlotMap && cloudSlotMap[k],
        cloudAckOps
      );
      if (res.ms > 0 && res.iso) {
        out[k] = res.iso;
        if (res.opRec) outOps[k] = res.opRec;
      }
    });
    var trimmed = trimTimestampMapClient(out, maxEntries, maxKeyLen);
    var trimmedOps = {};
    Object.keys(trimmed).forEach(function (k) { if (outOps[k]) trimmedOps[k] = outOps[k]; });
    return { map: trimmed, ops: trimmedOps };
  }

  function realignLastMutationMsFromState(st) {
    var cutoff = getExtremeFutureCutoffMs();
    var maxTs = 0;
    var check = function (iso) {
      var ms = parseIsoMsClient(iso);
      if (ms > maxTs && ms <= cutoff) maxTs = ms;
    };
    check(st.bookmarksClearedAt);
    check(st.mistakesClearedAt);
    Object.values(st.bookmarksClearedAtBySubject || {}).forEach(check);
    Object.values(st.mistakesClearedAtBySubject || {}).forEach(check);
    Object.values(st.deletedBookmarks || {}).forEach(check);
    Object.values(st.deletedMistakes || {}).forEach(check);
    (st.bookmarks || []).forEach(function (b) { if (b) check(b.savedAt); });
    (st.mistakes || []).forEach(function (m) {
      if (m) { check(m.updatedAt); check(m.resolvedAt); }
    });
    if (serverClockOffsetMs !== null) {
      lastMutationMs = Math.max(getEffectiveNowMs(), maxTs);
    } else if (maxTs > lastMutationMs) {
      lastMutationMs = maxTs;
    }
  }

  function mergeUnresolvedItemLists(existingItems, addedItems, ownerId) {
    var byId = new Map();
    var addOne = function (entry) {
      if (!entry || typeof entry !== "object" || !entry.id) return;
      if (ownerId && entry.ownerStudentId && entry.ownerStudentId !== ownerId) return;
      byId.set(entry.id, Object.assign({}, entry, ownerId ? { ownerStudentId: ownerId } : {}));
    };
    (existingItems || []).forEach(addOne);
    (addedItems || []).forEach(addOne);
    return Array.from(byId.values());
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
    ensureSyncClientIdentity(st);
    var clearOps = normalizeClientClearOps(st.clearOps);
    var beforeSig = JSON.stringify({ b: st.bookmarks || [], m: st.mistakes || [], a: st.attemptHistory || [] });

    var replaceMode = Boolean(options.replace) || Boolean(st.ownerStudentId && targetStudentId && st.ownerStudentId !== targetStudentId);
    var cloudSyncMeta = raw.syncMeta && typeof raw.syncMeta === "object" && !Array.isArray(raw.syncMeta) ? raw.syncMeta : {};
    var cloudEpoch = Number(cloudSyncMeta.epoch);
    if (!replaceMode && Number.isSafeInteger(cloudEpoch) && cloudEpoch > 0 && (Number(st.syncEpoch) || 0) > cloudEpoch) {
      // Reject delayed response carrying a strictly older server epoch than already observed
      return false;
    }

    if (data && data.serverTime) recordServerTime(data.serverTime, false);
    if (opts && opts.serverTime) recordServerTime(opts.serverTime, false);

    var hasAuthoritativeLists = Array.isArray(raw.bookmarks) && (Array.isArray(raw.mistakes) || (raw.mistakes && Array.isArray(raw.mistakes.items)));
    var fromSyncAck = Boolean(options.fromSyncAck) && hasAuthoritativeLists;
    var fromSyncResync = Boolean(options.fromSyncResync) && hasAuthoritativeLists;

    var cloudAckOps = cloudSyncMeta.ops && typeof cloudSyncMeta.ops === "object" && !Array.isArray(cloudSyncMeta.ops) ? cloudSyncMeta.ops : {};
    var cloudSlots = cloudSyncMeta.slots && typeof cloudSyncMeta.slots === "object" && !Array.isArray(cloudSyncMeta.slots) ? cloudSyncMeta.slots : {};
    if (Number.isSafeInteger(cloudEpoch) && cloudEpoch > (Number(st.syncEpoch) || 0)) {
      st.syncEpoch = cloudEpoch;
    }

    var extremeCutoff = getExtremeFutureCutoffMs();
    var fallbackPastIso = new Date(Math.max(1, getEffectiveNowMs() - 5000)).toISOString();
    var cloudBookmarks = (Array.isArray(raw.bookmarks) ? raw.bookmarks : []).map(normalizeClientBookmarkItem).filter(Boolean).map(function (b) {
      var ms = parseIsoMsClient(b.savedAt);
      if (ms > extremeCutoff) return Object.assign({}, b, { savedAt: fallbackPastIso });
      return b;
    });
    var rawCloudMistakes = Array.isArray(raw.mistakes)
      ? raw.mistakes
      : (raw.mistakes && Array.isArray(raw.mistakes.items) ? raw.mistakes.items : []);
    var cloudMistakes = rawCloudMistakes.map(normalizeClientMistakeItem).filter(Boolean).map(function (m) {
      var ms = Math.max(parseIsoMsClient(m.updatedAt), parseIsoMsClient(m.resolvedAt));
      if (ms > extremeCutoff) {
        return Object.assign({}, m, {
          updatedAt: fallbackPastIso,
          resolvedAt: m.resolved ? fallbackPastIso : null,
          firstFailedAt: (m.firstFailedAt && parseIsoMsClient(m.firstFailedAt) > extremeCutoff) ? fallbackPastIso : m.firstFailedAt,
        });
      }
      return m;
    });
    var cloudAttempts = Array.isArray(raw.attempts)
      ? raw.attempts
      : (Array.isArray(raw.attemptLog) ? raw.attemptLog : []);
    var cloudDelBm = trimTimestampMapClient(raw.deletedBookmarks, 500);
    var cloudDelMk = trimTimestampMapClient(raw.deletedMistakes, 500);
    var cloudBmCleared = typeof raw.bookmarksClearedAt === "string" && parseReasonableIsoMsClient(raw.bookmarksClearedAt) ? raw.bookmarksClearedAt : null;
    var cloudBmClearedBySubj = trimTimestampMapClient(raw.bookmarksClearedAtBySubject, 200, 160);
    var cloudCleared = typeof raw.mistakesClearedAt === "string" && parseReasonableIsoMsClient(raw.mistakesClearedAt) ? raw.mistakesClearedAt : null;
    var cloudMkClearedBySubj = trimTimestampMapClient(raw.mistakesClearedAtBySubject, 200, 160);

    st.acknowledgedCloudProgress = buildAcknowledgedSnapshot(
      raw,
      cloudBookmarks,
      cloudMistakes,
      cloudDelBm,
      cloudBmCleared,
      cloudBmClearedBySubj,
      cloudDelMk,
      cloudCleared,
      cloudMkClearedBySubj,
      cloudAttempts,
      Number.isSafeInteger(cloudEpoch) ? cloudEpoch : (Number(st.syncEpoch) || 0),
      targetStudentId || st.ownerStudentId || ""
    );

    var buildAckSlotMap = function (isoMap, slotOpMap) {
      var out = {};
      Object.keys(isoMap || {}).forEach(function (k) {
        if (slotOpMap && slotOpMap[k]) out[k] = { id: slotOpMap[k], clientAt: isoMap[k] };
      });
      return out;
    };

    var switchingAccounts = Boolean(st.ownerStudentId && targetStudentId && st.ownerStudentId !== targetStudentId);
    if (switchingAccounts) {
      st.unresolvedMutations = emptyUnresolvedMutations(targetStudentId);
      st.syncClientGen = 0;
      st.syncBaselineEpoch = 0;
    }

    if (fromSyncResync) {
      var maxReasonableNow = getEffectiveNowMs() + 300000;
      var srcLocal = (options.preLoginLocalState && typeof options.preLoginLocalState === "object")
        ? options.preLoginLocalState
        : (switchingAccounts ? {} : Object.assign({}, st, {
            bookmarks: Array.isArray(st.bookmarks) ? st.bookmarks.slice() : [],
            mistakes: Array.isArray(st.mistakes) ? st.mistakes.slice() : [],
            deletedBookmarks: Object.assign({}, st.deletedBookmarks || {}),
            bookmarksClearedAtBySubject: Object.assign({}, st.bookmarksClearedAtBySubject || {}),
            deletedMistakes: Object.assign({}, st.deletedMistakes || {}),
            mistakesClearedAtBySubject: Object.assign({}, st.mistakesClearedAtBySubject || {}),
            clearOps: Object.assign({}, clearOps),
          }));
      var ownerForUnresolved = targetStudentId || st.ownerStudentId || "";
      var prevUnres = switchingAccounts
        ? emptyUnresolvedMutations(ownerForUnresolved)
        : normalizeUnresolvedMutations(st.unresolvedMutations, ownerForUnresolved);
      var newUnresolved = [];
      var delBmResync = cloudDelBm;
      var bmClearedMsResync = parseReasonableIsoMsClient(cloudBmCleared);
      var preservedNormalSaves = false;
      var resyncBmMap = new Map();
      cloudBookmarks.forEach(function (b) {
        var sid = resolveItemSubjectId(b);
        var subjDelMs = sid ? parseIsoMsClient(cloudBmClearedBySubj[sid]) : 0;
        var effDelMs = Math.max(parseIsoMsClient(delBmResync[b.internalId]), bmClearedMsResync, subjDelMs);
        var itemMs = parseIsoMsClient(b.savedAt);
        if (!(effDelMs > 0 && itemMs <= effDelMs)) {
          resyncBmMap.set(b.internalId, b);
        }
      });
      var isRegistrationReason = options.resyncReason === "CLIENT_HISTORY_EVICTED" ||
        options.resyncReason === "CLIENT_HISTORY_EVICTED_ITEM" ||
        options.resyncReason === "CLIENT_RECONCILE_REQUIRED" ||
        options.resyncReason === "CLIENT_GENERATION_MISMATCH" ||
        options.resyncReason === "TAB_HISTORY_EVICTED" ||
        options.resyncReason === "CLIENT_RECONCILED";
      (Array.isArray(srcLocal.bookmarks) ? srcLocal.bookmarks.map(normalizeClientBookmarkItem).filter(Boolean) : []).forEach(function (lb) {
        var itemMs = parseIsoMsClient(lb.savedAt);
        var sid = resolveItemSubjectId(lb);
        var subjDelMs = sid ? parseIsoMsClient(cloudBmClearedBySubj[sid]) : 0;
        var effDelMs = Math.max(parseIsoMsClient(delBmResync[lb.internalId]), bmClearedMsResync, subjDelMs);
        var existingCb = resyncBmMap.get(lb.internalId);
        var existingCbMs = existingCb ? parseIsoMsClient(existingCb.savedAt) : 0;
        if (!itemMs || itemMs > maxReasonableNow) {
          // Preserve skewed/rejected bookmark in account-bound unresolvedMutations instead of dropping it
          if (!existingCb) {
            newUnresolved.push({
              id: "um_bs_" + lb.internalId,
              ownerStudentId: ownerForUnresolved,
              kind: "bookmark_save",
              scopeId: lb.internalId,
              subjectId: sid,
              destructive: false,
              label: lb.question || lb.sourceLabel || lb.id || lb.internalId,
              item: Object.assign({}, lb, { syncOpId: "" }),
              reason: options.resyncReason || "SYNC_RESYNC_REQUIRED",
              createdAt: fallbackPastIso,
            });
          }
          return;
        }
        if (effDelMs > 0 && itemMs <= effDelMs) return;
        if (!existingCb || itemMs > existingCbMs) {
          var preservedBm = isRegistrationReason ? Object.assign({}, lb, { syncOpId: "" }) : lb;
          resyncBmMap.set(lb.internalId, existingCb ? Object.assign({}, existingCb, preservedBm) : preservedBm);
          preservedNormalSaves = true;
          newUnresolved.push({
            id: "um_bs_" + lb.internalId,
            ownerStudentId: ownerForUnresolved,
            kind: "bookmark_save",
            scopeId: lb.internalId,
            subjectId: sid,
            destructive: false,
            label: lb.question || lb.sourceLabel || lb.id || lb.internalId,
            item: preservedBm,
            reason: options.resyncReason || "SYNC_RESYNC_REQUIRED",
            createdAt: lb.savedAt,
          });
        }
      });
      st.bookmarks = Array.from(resyncBmMap.values());
      st.deletedBookmarks = delBmResync;
      st.bookmarksClearedAt = cloudBmCleared || null;
      st.bookmarksClearedAtBySubject = cloudBmClearedBySubj;

      var delMkResync = cloudDelMk;
      var clearedMsResync = parseReasonableIsoMsClient(cloudCleared);
      var resyncMkMap = new Map();
      cloudMistakes.forEach(function (m) {
        var sid = resolveItemSubjectId(m);
        var subjDelMs = sid ? parseIsoMsClient(cloudMkClearedBySubj[sid]) : 0;
        var effDelMs = Math.max(parseIsoMsClient(delMkResync[m.internalId]), clearedMsResync, subjDelMs);
        var itemMs = Math.max(parseIsoMsClient(m.updatedAt), parseIsoMsClient(m.resolvedAt));
        if (!(effDelMs > 0 && itemMs <= effDelMs)) {
          resyncMkMap.set(m.internalId, m);
        }
      });
      (Array.isArray(srcLocal.mistakes) ? srcLocal.mistakes.map(normalizeClientMistakeItem).filter(Boolean) : []).forEach(function (lm) {
        var itemMs = Math.max(parseIsoMsClient(lm.updatedAt), parseIsoMsClient(lm.resolvedAt));
        var sid = resolveItemSubjectId(lm);
        var subjDelMs = sid ? parseIsoMsClient(cloudMkClearedBySubj[sid]) : 0;
        var effDelMs = Math.max(parseIsoMsClient(delMkResync[lm.internalId]), clearedMsResync, subjDelMs);
        var existingCm = resyncMkMap.get(lm.internalId);
        var existingMs = existingCm ? Math.max(parseIsoMsClient(existingCm.updatedAt), parseIsoMsClient(existingCm.resolvedAt)) : 0;
        if (!itemMs || itemMs > maxReasonableNow) {
          if (!existingCm) {
            newUnresolved.push({
              id: "um_ms_" + lm.internalId,
              ownerStudentId: ownerForUnresolved,
              kind: "mistake_save",
              scopeId: lm.internalId,
              subjectId: sid,
              destructive: false,
              label: lm.question || lm.id || lm.internalId,
              item: Object.assign({}, lm, { syncOpId: "" }),
              reason: options.resyncReason || "SYNC_RESYNC_REQUIRED",
              createdAt: fallbackPastIso,
            });
          }
          return;
        }
        if (effDelMs > 0 && itemMs <= effDelMs) return;
        if (!existingCm || itemMs > existingMs) {
          var preservedMk = isRegistrationReason ? Object.assign({}, lm, { syncOpId: "" }) : lm;
          resyncMkMap.set(lm.internalId, existingCm ? Object.assign({}, existingCm, preservedMk) : preservedMk);
          preservedNormalSaves = true;
          newUnresolved.push({
            id: "um_ms_" + lm.internalId,
            ownerStudentId: ownerForUnresolved,
            kind: "mistake_save",
            scopeId: lm.internalId,
            subjectId: sid,
            destructive: false,
            label: lm.question || lm.id || lm.internalId,
            item: preservedMk,
            reason: options.resyncReason || "SYNC_RESYNC_REQUIRED",
            createdAt: lm.updatedAt || lm.resolvedAt || fallbackPastIso,
          });
        }
      });
      st.mistakes = Array.from(resyncMkMap.values());
      st.deletedMistakes = delMkResync;
      st.mistakesClearedAt = cloudCleared || null;
      st.mistakesClearedAtBySubject = cloudMkClearedBySubj;

      // Capture rejected/uncommitted destructive clears & deletions for manual review (never auto-replay)
      var srcDelBm = (srcLocal.deletedBookmarks && typeof srcLocal.deletedBookmarks === "object") ? srcLocal.deletedBookmarks : {};
      Object.keys(srcDelBm).forEach(function (bid) {
        var lMs = parseIsoMsClient(srcDelBm[bid]);
        var cMs = parseIsoMsClient(delBmResync[bid]);
        var hasInCloud = resyncBmMap.has(bid);
        if (lMs > cMs || hasInCloud) {
          newUnresolved.push({
            id: "um_bd_" + bid,
            ownerStudentId: ownerForUnresolved,
            kind: "bookmark_delete",
            scopeId: bid,
            destructive: true,
            label: bid,
            reason: options.resyncReason || "SYNC_RESYNC_REQUIRED",
            createdAt: srcDelBm[bid] || fallbackPastIso,
          });
        }
      });
      var srcDelMk = (srcLocal.deletedMistakes && typeof srcLocal.deletedMistakes === "object") ? srcLocal.deletedMistakes : {};
      Object.keys(srcDelMk).forEach(function (mid) {
        var lMs = parseIsoMsClient(srcDelMk[mid]);
        var cMs = parseIsoMsClient(delMkResync[mid]);
        var hasInCloud = resyncMkMap.has(mid);
        if (lMs > cMs || hasInCloud) {
          newUnresolved.push({
            id: "um_md_" + mid,
            ownerStudentId: ownerForUnresolved,
            kind: "mistake_delete",
            scopeId: mid,
            destructive: true,
            label: mid,
            reason: options.resyncReason || "SYNC_RESYNC_REQUIRED",
            createdAt: srcDelMk[mid] || fallbackPastIso,
          });
        }
      });
      if (srcLocal.bookmarksClearedAt && parseIsoMsClient(srcLocal.bookmarksClearedAt) > bmClearedMsResync &&
        !(cloudSlots.bmGlobal && srcLocal.clearOps && srcLocal.clearOps.bookmarksGlobal && cloudSlots.bmGlobal === srcLocal.clearOps.bookmarksGlobal.id)) {
        newUnresolved.push({
          id: "um_bg_all",
          ownerStudentId: ownerForUnresolved,
          kind: "bookmarks_clear",
          scopeId: "",
          subjectId: "",
          destructive: true,
          label: "All Saved",
          reason: options.resyncReason || "SYNC_RESYNC_REQUIRED",
          createdAt: srcLocal.bookmarksClearedAt,
        });
      }
      var srcBmSubj = (srcLocal.bookmarksClearedAtBySubject && typeof srcLocal.bookmarksClearedAtBySubject === "object") ? srcLocal.bookmarksClearedAtBySubject : {};
      Object.keys(srcBmSubj).forEach(function (sid) {
        if (parseIsoMsClient(srcBmSubj[sid]) > parseIsoMsClient(cloudBmClearedBySubj[sid])) {
          newUnresolved.push({
            id: "um_bsj_" + sid,
            ownerStudentId: ownerForUnresolved,
            kind: "bookmarks_clear",
            scopeId: sid,
            subjectId: sid,
            destructive: true,
            label: sid,
            reason: options.resyncReason || "SYNC_RESYNC_REQUIRED",
            createdAt: srcBmSubj[sid],
          });
        }
      });
      if (srcLocal.mistakesClearedAt && parseIsoMsClient(srcLocal.mistakesClearedAt) > clearedMsResync &&
        !(cloudSlots.mkGlobal && srcLocal.clearOps && srcLocal.clearOps.mistakesGlobal && cloudSlots.mkGlobal === srcLocal.clearOps.mistakesGlobal.id)) {
        newUnresolved.push({
          id: "um_mg_all",
          ownerStudentId: ownerForUnresolved,
          kind: "mistakes_clear",
          scopeId: "",
          subjectId: "",
          destructive: true,
          label: "All Mistakes",
          reason: options.resyncReason || "SYNC_RESYNC_REQUIRED",
          createdAt: srcLocal.mistakesClearedAt,
        });
      }
      var srcMkSubj = (srcLocal.mistakesClearedAtBySubject && typeof srcLocal.mistakesClearedAtBySubject === "object") ? srcLocal.mistakesClearedAtBySubject : {};
      Object.keys(srcMkSubj).forEach(function (sid) {
        if (parseIsoMsClient(srcMkSubj[sid]) > parseIsoMsClient(cloudMkClearedBySubj[sid])) {
          newUnresolved.push({
            id: "um_msj_" + sid,
            ownerStudentId: ownerForUnresolved,
            kind: "mistakes_clear",
            scopeId: sid,
            subjectId: sid,
            destructive: true,
            label: sid,
            reason: options.resyncReason || "SYNC_RESYNC_REQUIRED",
            createdAt: srcMkSubj[sid],
          });
        }
      });

      var combinedUnresolved = mergeUnresolvedItemLists(prevUnres.items, newUnresolved, ownerForUnresolved);
      if (combinedUnresolved.length > 0) {
        st.unresolvedMutations = {
          ownerStudentId: ownerForUnresolved,
          reason: (prevUnres.actionRequired === "REFRESH_APP" ? prevUnres.reason : "") || options.resyncReason || prevUnres.reason || "SYNC_RESYNC_REQUIRED",
          actionRequired: (prevUnres.actionRequired === "REFRESH_APP" ? "REFRESH_APP" : "") || options.actionRequired || prevUnres.actionRequired || "",
          error: options.resyncError || prevUnres.error || "",
          createdAt: Date.now(),
          items: combinedUnresolved,
        };
      } else {
        st.unresolvedMutations = emptyUnresolvedMutations(ownerForUnresolved);
      }

      clearOps = emptyClearOps();
      clearOps.bookmarksGlobal = (cloudBmCleared && cloudSlots.bmGlobal) ? { id: cloudSlots.bmGlobal, clientAt: cloudBmCleared } : null;
      clearOps.mistakesGlobal = (cloudCleared && cloudSlots.mkGlobal) ? { id: cloudSlots.mkGlobal, clientAt: cloudCleared } : null;
      clearOps.bookmarksBySubject = buildAckSlotMap(cloudBmClearedBySubj, cloudSlots.bmSubj);
      clearOps.mistakesBySubject = buildAckSlotMap(cloudMkClearedBySubj, cloudSlots.mkSubj);
      clearOps.deletedBookmarks = buildAckSlotMap(delBmResync, cloudSlots.bmDel);
      clearOps.deletedMistakes = buildAckSlotMap(delMkResync, cloudSlots.mkDel);
      st.clearOps = clearOps;
      st.pendingProgressSync = preservedNormalSaves;
      st.needsSyncRegistration = isRegistrationReason || !st.syncClientGen;
      localMutationSeq += 1;

      var attListResync = (Array.isArray(st.attemptHistory) ? st.attemptHistory : []).concat(cloudAttempts);
      var seenAttResync = new Set();
      st.attemptHistory = attListResync.filter(function (item) {
        if (!item || typeof item !== "object") return false;
        var id = item.attemptId || item.id || ((item.subjectId || "") + "::" + (item.quizId || item.collectionId || "") + "::" + (item.finishedAt || ""));
        if (seenAttResync.has(id)) return false;
        seenAttResync.add(id);
        return true;
      }).slice(0, 50);
    } else if (replaceMode) {
      var delBmRep = cloudDelBm;
      var bmClearedMsRep = parseReasonableIsoMsClient(cloudBmCleared);
      st.bookmarks = cloudBookmarks.filter(function (b) {
        var sid = resolveItemSubjectId(b);
        var subjDelMs = sid ? parseIsoMsClient(cloudBmClearedBySubj[sid]) : 0;
        var effDelMs = Math.max(parseIsoMsClient(delBmRep[b.internalId]), bmClearedMsRep, subjDelMs);
        var itemMs = parseIsoMsClient(b.savedAt);
        return !(effDelMs > 0 && itemMs <= effDelMs);
      });
      var delMkRep = cloudDelMk;
      var clearedMsRep = parseReasonableIsoMsClient(cloudCleared);
      st.mistakes = cloudMistakes.filter(function (m) {
        var sid = resolveItemSubjectId(m);
        var subjDelMs = sid ? parseIsoMsClient(cloudMkClearedBySubj[sid]) : 0;
        var effDelMs = Math.max(parseIsoMsClient(delMkRep[m.internalId]), clearedMsRep, subjDelMs);
        var itemMs = Math.max(parseIsoMsClient(m.updatedAt), parseIsoMsClient(m.resolvedAt));
        return !(effDelMs > 0 && itemMs <= effDelMs);
      });
      st.attemptHistory = cloudAttempts.slice(0, 50);
      st.deletedBookmarks = delBmRep;
      st.bookmarksClearedAt = cloudBmCleared;
      st.bookmarksClearedAtBySubject = cloudBmClearedBySubj;
      st.deletedMistakes = delMkRep;
      st.mistakesClearedAt = cloudCleared;
      st.mistakesClearedAtBySubject = cloudMkClearedBySubj;
      clearOps = emptyClearOps();
      clearOps.bookmarksGlobal = (cloudBmCleared && cloudSlots.bmGlobal) ? { id: cloudSlots.bmGlobal, clientAt: cloudBmCleared } : null;
      clearOps.mistakesGlobal = (cloudCleared && cloudSlots.mkGlobal) ? { id: cloudSlots.mkGlobal, clientAt: cloudCleared } : null;
      clearOps.bookmarksBySubject = buildAckSlotMap(cloudBmClearedBySubj, cloudSlots.bmSubj);
      clearOps.mistakesBySubject = buildAckSlotMap(cloudMkClearedBySubj, cloudSlots.mkSubj);
      clearOps.deletedBookmarks = buildAckSlotMap(delBmRep, cloudSlots.bmDel);
      clearOps.deletedMistakes = buildAckSlotMap(delMkRep, cloudSlots.mkDel);
      st.clearOps = clearOps;
      st.needsSyncRegistration = false;
      if (options.preserveOwnUnresolved) {
        var existingOwnUnres = normalizeUnresolvedMutations(st.unresolvedMutations, targetStudentId || "");
        var preOwnItems = [];
        if (options.preLoginLocalState && options.preLoginLocalState.pendingProgressSync && targetStudentId) {
          preOwnItems = collectRecoverableUnresolvedItems(options.preLoginLocalState, targetStudentId).items || [];
        }
        var combinedOwnItems = mergeUnresolvedItemLists(existingOwnUnres.items, preOwnItems, targetStudentId || "");
        var repBmById = new Map();
        (st.bookmarks || []).forEach(function (b) { if (b && b.internalId) repBmById.set(b.internalId, b); });
        var repMkById = new Map();
        (st.mistakes || []).forEach(function (m) { if (m && m.internalId) repMkById.set(m.internalId, m); });
        var keptOwnUnres = combinedOwnItems.filter(function (u) {
          if (u.destructive) return true;
          if (u.kind === "bookmark_save") {
            var cb = repBmById.get(u.scopeId);
            var localBmIso = (u.item && u.item.savedAt) || u.createdAt || u.clientAt;
            return !cb || parseIsoMsClient(cb.savedAt) < parseIsoMsClient(localBmIso);
          }
          if (u.kind === "mistake_save") {
            var cm = repMkById.get(u.scopeId);
            var localMkIso = (u.item && (u.item.updatedAt || u.item.resolvedAt)) || u.createdAt || u.clientAt;
            return !cm || Math.max(parseIsoMsClient(cm.updatedAt), parseIsoMsClient(cm.resolvedAt)) < parseIsoMsClient(localMkIso);
          }
          return true;
        });
        st.unresolvedMutations = keptOwnUnres.length
          ? Object.assign({}, existingOwnUnres, { ownerStudentId: String(targetStudentId || ""), items: keptOwnUnres })
          : emptyUnresolvedMutations(targetStudentId || "");
      } else {
        st.unresolvedMutations = emptyUnresolvedMutations(targetStudentId || "");
      }
    } else if (fromSyncAck) {
      // Server just merged our exact un-modified local payload with cloud: adopt authoritative server-normalized state
      // while retaining rich local text/images for items that survived server filtering.
      var existingBmById = new Map();
      (Array.isArray(st.bookmarks) ? st.bookmarks.map(normalizeClientBookmarkItem).filter(Boolean) : []).forEach(function (b) {
        existingBmById.set(b.internalId, b);
      });
      st.bookmarks = cloudBookmarks.map(function (cb) {
        var lb = existingBmById.get(cb.internalId);
        if (!lb) return cb;
        var hideAns = isBookmarkAnswerHidden(cb);
        return Object.assign({}, lb, cb, {
          subjectId: cb.subjectId || lb.subjectId || "",
          subjectName: cb.subjectName || lb.subjectName || "",
          quizId: cb.quizId || lb.quizId || "",
          sourceLabel: cb.sourceLabel || lb.sourceLabel || "",
          question: cb.question || lb.question || "",
          image: cb.image || lb.image || "",
          images: (cb.images && cb.images.length) ? cb.images : (lb.images || []),
          correctOptionId: hideAns ? null : (cb.correctOptionId || lb.correctOptionId || null),
          correctAnswer: hideAns ? "" : (cb.correctAnswer || lb.correctAnswer || ""),
        });
      });
      st.deletedBookmarks = cloudDelBm;
      st.bookmarksClearedAt = cloudBmCleared || null;
      st.bookmarksClearedAtBySubject = cloudBmClearedBySubj;

      var existingMkById = new Map();
      (Array.isArray(st.mistakes) ? st.mistakes.map(normalizeClientMistakeItem).filter(Boolean) : []).forEach(function (m) {
        existingMkById.set(m.internalId, m);
      });
      st.mistakes = cloudMistakes.map(function (cm) {
        var lm = existingMkById.get(cm.internalId);
        if (!lm) return cm;
        return Object.assign({}, lm, cm, {
          subjectId: cm.subjectId || lm.subjectId || "",
          subjectName: cm.subjectName || lm.subjectName || "",
          quizId: cm.quizId || lm.quizId || "",
          question: cm.question || lm.question || "",
          image: cm.image || lm.image || "",
          images: (cm.images && cm.images.length) ? cm.images : (lm.images || []),
          correctOptionId: cm.correctOptionId || lm.correctOptionId || null,
          lastWrongOptionId: cm.lastWrongOptionId || lm.lastWrongOptionId || null,
        });
      });
      st.deletedMistakes = cloudDelMk;
      st.mistakesClearedAt = cloudCleared || null;
      st.mistakesClearedAtBySubject = cloudMkClearedBySubj;

      clearOps.bookmarksGlobal = (cloudBmCleared && cloudSlots.bmGlobal) ? { id: cloudSlots.bmGlobal, clientAt: cloudBmCleared } : null;
      clearOps.mistakesGlobal = (cloudCleared && cloudSlots.mkGlobal) ? { id: cloudSlots.mkGlobal, clientAt: cloudCleared } : null;
      clearOps.bookmarksBySubject = buildAckSlotMap(cloudBmClearedBySubj, cloudSlots.bmSubj);
      clearOps.mistakesBySubject = buildAckSlotMap(cloudMkClearedBySubj, cloudSlots.mkSubj);
      clearOps.deletedBookmarks = buildAckSlotMap(cloudDelBm, cloudSlots.bmDel);
      clearOps.deletedMistakes = buildAckSlotMap(cloudDelMk, cloudSlots.mkDel);
      st.clearOps = clearOps;
      st.needsSyncRegistration = false;

      // Clear resolved non-destructive items from unresolvedMutations while keeping any un-applied destructive ops
      var curUnresAck = normalizeUnresolvedMutations(st.unresolvedMutations, targetStudentId || st.ownerStudentId || "");
      if (curUnresAck.items.length) {
        var remainingUnres = curUnresAck.items.filter(function (u) {
          if (u.destructive) return true;
          if (u.kind === "bookmark_save") return !existingBmById.has(u.scopeId);
          if (u.kind === "mistake_save") return !existingMkById.has(u.scopeId);
          return true;
        });
        st.unresolvedMutations = remainingUnres.length
          ? Object.assign({}, curUnresAck, { items: remainingUnres })
          : emptyUnresolvedMutations(targetStudentId || st.ownerStudentId || "");
      }

      var attListAck = (Array.isArray(st.attemptHistory) ? st.attemptHistory : []).concat(cloudAttempts);
      var seenAttAck = new Set();
      st.attemptHistory = attListAck.filter(function (item) {
        if (!item || typeof item !== "object") return false;
        var id = item.attemptId || item.id || ((item.subjectId || "") + "::" + (item.quizId || item.collectionId || "") + "::" + (item.finishedAt || ""));
        if (seenAttAck.has(id)) return false;
        seenAttAck.add(id);
        return true;
      }).slice(0, 50);
    } else {
      var bmGlobalResolved = resolveScalarWatermarkClient(
        st.bookmarksClearedAt, clearOps.bookmarksGlobal, cloudBmCleared, cloudSlots.bmGlobal, cloudAckOps
      );
      var bmSubjResolved = resolveMapWatermarksClient(
        st.bookmarksClearedAtBySubject, clearOps.bookmarksBySubject, cloudBmClearedBySubj, cloudSlots.bmSubj, cloudAckOps, 200, 160
      );
      var bmDelResolved = resolveMapWatermarksClient(
        st.deletedBookmarks, clearOps.deletedBookmarks, cloudDelBm, cloudSlots.bmDel, cloudAckOps, 500, 500
      );
      var delBookmarks = bmDelResolved.map;
      var bmClearedMs = bmGlobalResolved.ms;
      var bmClearedBySubj = bmSubjResolved.map;

      var resolvedLocalBookmarks = (Array.isArray(st.bookmarks) ? st.bookmarks.map(normalizeClientBookmarkItem).filter(Boolean) : []).map(function (b) {
        if (b.syncOpId && Object.prototype.hasOwnProperty.call(cloudAckOps, b.syncOpId)) {
          var ackMs = Number(cloudAckOps[b.syncOpId]) || 0;
          return Object.assign({}, b, { savedAt: ackMs ? new Date(ackMs).toISOString() : "" });
        }
        return b;
      });
      var bmMap = new Map();
      resolvedLocalBookmarks.concat(cloudBookmarks).forEach(function (item) {
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
        var sid = resolveItemSubjectId(item);
        var subjDelMs = sid ? parseIsoMsClient(bmClearedBySubj[sid]) : 0;
        var effDelMs = Math.max(delMs, bmClearedMs, subjDelMs);
        if (effDelMs > 0 && savedMs <= effDelMs) return;
        if (savedMs > delMs && delBookmarks[id]) {
          delete delBookmarks[id];
          delete bmDelResolved.ops[id];
        }
        st.bookmarks.push(item);
      });
      st.deletedBookmarks = delBookmarks;
      st.bookmarksClearedAt = bmGlobalResolved.iso || null;
      st.bookmarksClearedAtBySubject = bmClearedBySubj;
      clearOps.bookmarksGlobal = bmGlobalResolved.opRec;
      clearOps.bookmarksBySubject = bmSubjResolved.ops;
      clearOps.deletedBookmarks = bmDelResolved.ops;

      var mkGlobalResolved = resolveScalarWatermarkClient(
        st.mistakesClearedAt, clearOps.mistakesGlobal, cloudCleared, cloudSlots.mkGlobal, cloudAckOps
      );
      var mkSubjResolved = resolveMapWatermarksClient(
        st.mistakesClearedAtBySubject, clearOps.mistakesBySubject, cloudMkClearedBySubj, cloudSlots.mkSubj, cloudAckOps, 200, 160
      );
      var mkDelResolved = resolveMapWatermarksClient(
        st.deletedMistakes, clearOps.deletedMistakes, cloudDelMk, cloudSlots.mkDel, cloudAckOps, 500, 500
      );
      var delMistakes = mkDelResolved.map;
      var clearedMs = mkGlobalResolved.ms;
      var mkClearedBySubj = mkSubjResolved.map;

      var resolvedLocalMistakes = (Array.isArray(st.mistakes) ? st.mistakes.map(normalizeClientMistakeItem).filter(Boolean) : []).map(function (m) {
        if (m.syncOpId && Object.prototype.hasOwnProperty.call(cloudAckOps, m.syncOpId)) {
          var ackMs = Number(cloudAckOps[m.syncOpId]) || 0;
          var ackIso = ackMs ? new Date(ackMs).toISOString() : m.updatedAt;
          return Object.assign({}, m, {
            updatedAt: ackIso,
            resolvedAt: m.resolved ? (parseIsoMsClient(m.resolvedAt) > ackMs ? ackIso : m.resolvedAt) : null,
            firstFailedAt: (m.firstFailedAt && parseIsoMsClient(m.firstFailedAt) > ackMs) ? ackIso : m.firstFailedAt,
          });
        }
        return m;
      });
      var mkMap = new Map();
      resolvedLocalMistakes.concat(cloudMistakes).forEach(function (item) {
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
        var sid = resolveItemSubjectId(item);
        var subjDelMs = sid ? parseIsoMsClient(mkClearedBySubj[sid]) : 0;
        var effDelMs = Math.max(delItemMs, clearedMs, subjDelMs);
        if (effDelMs > 0 && itemMs <= effDelMs) return;
        if (itemMs > delItemMs && delMistakes[id]) {
          delete delMistakes[id];
          delete mkDelResolved.ops[id];
        }
        st.mistakes.push(item);
      });
      st.deletedMistakes = delMistakes;
      st.mistakesClearedAt = mkGlobalResolved.iso || null;
      st.mistakesClearedAtBySubject = mkClearedBySubj;
      clearOps.mistakesGlobal = mkGlobalResolved.opRec;
      clearOps.mistakesBySubject = mkSubjResolved.ops;
      clearOps.deletedMistakes = mkDelResolved.ops;
      st.clearOps = clearOps;

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

    realignLastMutationMsFromState(st);
    if (serverClockOffsetMs !== null) {
      st.serverClockCal = {
        offsetMs: serverClockOffsetMs,
        recordedAtMs: Date.now(),
        serverMs: lastRecordedServerMs || Math.round(Date.now() + serverClockOffsetMs),
      };
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
      var schedGen = authGeneration;
      progressSyncTimer = setTimeout(function () {
        progressSyncTimer = null;
        if (schedGen !== authGeneration) return;
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
    var scheduledGen = authGeneration;
    var delayMs = Math.min(30000, 2500 * Math.pow(2, syncRetryAttempts));
    syncRetryAttempts += 1;
    syncRetryTimer = setTimeout(function () {
      syncRetryTimer = null;
      if (scheduledGen !== authGeneration) return;
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
    var ctx = captureAuthContext(auth);
    if (progressSyncInFlight) {
      if (!(opts && opts.force)) {
        return progressSyncInFlight;
      }
      if (!(opts && opts.fromPageHide)) {
        await progressSyncInFlight.catch(function () { return null; });
        if (!isAuthContextCurrent(ctx)) {
          return { ok: false, stale: true, skipped: true };
        }
      }
    }
    if (progressSyncTimer && typeof clearTimeout === "function") {
      clearTimeout(progressSyncTimer);
      progressSyncTimer = null;
    }
    var runSync = async function () {
      var seqBefore = localMutationSeq;
      var isHandshakeOnly = Boolean(opts && opts.handshake);
      var sendPayload = async function (compactMode) {
        if (!isAuthContextCurrent(ctx)) return { stale: true };
        var curSt = getState();
        var cid = ensureSyncClientIdentity(curSt);
        var tab = ensureTabSession(false);
        var gen = Number.isSafeInteger(curSt.syncClientGen) && curSt.syncClientGen >= 1 ? curSt.syncClientGen : 0;
        var sentMutRev = Number(curSt.localMutRev) || 0;
        var sentMutToken = String(curSt.localMutToken || "");
        var payloadProgress = isHandshakeOnly
          ? { syncMeta: gen >= 1 ? { v: SYNC_PROTOCOL_VERSION, clientId: cid, tabTag: tab.tabTag, clientGen: gen, clientSeq: tab.tabSeq } : { v: 1, clientId: cid, clientSeq: Number(curSt.syncClientSeq) || 0 } }
          : exportCloudProgress({ compact: Boolean(compactMode) });
        var reqBody = { progress: payloadProgress, syncClientId: cid, syncTabTag: tab.tabTag };
        if (gen >= 1) reqBody.syncClientGen = gen;
        var bodyJson = JSON.stringify(reqBody);
        // Browsers abort fetch({ keepalive: true }) when body exceeds 64 KiB; keep normal fetches un-capped.
        var useKeepalive = Boolean(opts && opts.fromPageHide && utf8ByteLength(bodyJson) <= 60000);
        var res = await fetch("/api/auth/sync-progress", {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }, ctx.token),
          body: bodyJson,
          keepalive: useKeepalive,
        });
        return { res: res, payloadProgress: payloadProgress, sentMutRev: sentMutRev, sentMutToken: sentMutToken };
      };

      try {
        var attempt = await sendPayload(Boolean(opts && opts.compact));
        if (attempt.stale || !isAuthContextCurrent(ctx)) {
          return { ok: false, stale: true, skipped: true };
        }
        if (attempt.res.status === 413 && !(opts && opts.compact) && !(opts && opts.fromPageHide) && !isHandshakeOnly) {
          attempt = await sendPayload(true);
          if (attempt.stale || !isAuthContextCurrent(ctx)) {
            return { ok: false, stale: true, skipped: true };
          }
        }
        var res = attempt.res;
        var payloadProgress = attempt.payloadProgress;
        var sentMutRev = attempt.sentMutRev;
        var sentMutToken = attempt.sentMutToken;
        var data = await res.json().catch(function () { return null; });
        if (!isAuthContextCurrent(ctx)) {
          return { ok: false, stale: true, skipped: true };
        }
        if (res.status === 401) {
          var err401 = (data && data.error) || "Session expired — please sign in again.";
          handleConfirmedSessionInvalidation("syncProgressToCloud", err401, ctx);
          return { ok: false, unauthorized: true, status: 401, error: err401 };
        }
        var curPreEpoch = Number(getState().syncEpoch) || 0;
        var respEpoch = Number((data && data.progress && data.progress.syncMeta && data.progress.syncMeta.epoch) || (data && data.syncEpoch) || 0);
        if (Number.isSafeInteger(respEpoch) && respEpoch > 0 && curPreEpoch > respEpoch) {
          return { ok: false, stale: true, skipped: true };
        }
        if (res.status === 409 && data && (data.code === "SYNC_RESYNC_REQUIRED" || data.code === "UNSUPPORTED_SYNC_VERSION")) {
          var err409 = data.error || "Sync resynchronization required.";
          if (data.serverTime) recordServerTime(data.serverTime);
          clearSyncRetryTimer();
          syncRetryAttempts = 0;
          var resyncChanged = false;
          if (data.progress && typeof data.progress === "object") {
            resyncChanged = applyCloudProgress(data.progress, {
              studentId: ctx.studentId,
              username: ctx.username,
              serverTime: data.serverTime,
              fromSyncResync: true,
              resyncReason: data.reason || data.code,
              actionRequired: data.actionRequired || "",
              resyncError: err409,
            });
          }
          setLastSyncStatus({
            ok: false,
            status: 409,
            code: data.code,
            reason: data.reason || data.code,
            actionRequired: data.actionRequired || "",
            resyncRequired: true,
            refreshRecommended: data.actionRequired === "REFRESH_APP",
            error: err409,
            offline: false,
          });
          warnSyncFailure("syncProgressToCloud", err409, 409);
          if (typeof document !== "undefined" && typeof document.dispatchEvent === "function" && typeof root.CustomEvent === "function") {
            document.dispatchEvent(new root.CustomEvent("elgo:progresschange"));
          }
          return {
            ok: false,
            status: 409,
            code: data.code,
            reason: data.reason || data.code,
            actionRequired: data.actionRequired || "",
            upgradeRecommended: Boolean(data.upgradeRecommended || data.actionRequired === "REFRESH_APP"),
            resyncRequired: true,
            changed: resyncChanged,
            error: err409,
            progress: data.progress || null,
          };
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
        if (data.serverTime) recordServerTime(data.serverTime, false);
        clearSyncRetryTimer();
        syncRetryAttempts = 0;
        setLastSyncStatus({ ok: true, status: res.status || 200, error: "", offline: false });
        var latestPreApply = getState();
        var unmutatedBeforeApply = (localMutationSeq === seqBefore) &&
          ((Number(latestPreApply.localMutRev) || 0) === sentMutRev) &&
          (String(latestPreApply.localMutToken || "") === sentMutToken);
        var changed = false;
        if (data.progress && typeof data.progress === "object") {
          changed = applyCloudProgress(data.progress, {
            studentId: ctx.studentId,
            username: ctx.username,
            serverTime: data.serverTime,
            fromSyncAck: unmutatedBeforeApply && !isHandshakeOnly,
          });
        }
        var latestSt = getState();
        var stillUnmutated = (localMutationSeq === seqBefore) &&
          ((Number(latestSt.localMutRev) || 0) === sentMutRev) &&
          (String(latestSt.localMutToken || "") === sentMutToken);
        if (stillUnmutated) {
          if (!isHandshakeOnly) latestSt.pendingProgressSync = false;
          latestSt.needsSyncRegistration = false;
          if (ctx.studentId) latestSt.ownerStudentId = ctx.studentId;
          if (ctx.username) latestSt.ownerUsername = ctx.username;
          saveState(latestSt);
        } else {
          if (!latestSt.pendingProgressSync) {
            latestSt.pendingProgressSync = true;
            saveState(latestSt);
          }
          scheduleCloudProgressSync(false);
        }
        if (changed && typeof document !== "undefined" && typeof document.dispatchEvent === "function" && typeof root.CustomEvent === "function") {
          document.dispatchEvent(new root.CustomEvent("elgo:progresschange"));
        }
        return { ok: true, changed: changed, progress: data.progress || payloadProgress };
      } catch (err) {
        if (!isAuthContextCurrent(ctx)) {
          return { ok: false, stale: true, skipped: true };
        }
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
    var ctx = captureAuthContext(auth);
    var attemptSync = await Promise.resolve(syncPendingAttempts()).catch(function () { return null; });
    if (attemptSync && attemptSync.unauthorized) {
      return {
        ok: false,
        unauthorized: true,
        status: 401,
        error: "Session expired — please sign in again.",
      };
    }
    if (!isAuthContextCurrent(ctx)) {
      return { ok: false, stale: true, skipped: true };
    }
    var pushRes = await syncProgressToCloud({ force: true });
    if (pushRes && pushRes.unauthorized) {
      return {
        ok: false,
        unauthorized: true,
        status: 401,
        error: pushRes.error || "Session expired — please sign in again.",
      };
    }
    if (!isAuthContextCurrent(ctx)) {
      return { ok: false, stale: true, skipped: true };
    }
    if (!pushRes || !pushRes.ok) {
      var errRes = pushRes || getSyncStatus();
      return {
        ok: false,
        unauthorized: Boolean(errRes.unauthorized || errRes.status === 401),
        offline: Boolean(errRes.offline),
        resyncRequired: Boolean(errRes.resyncRequired || errRes.code === "SYNC_RESYNC_REQUIRED"),
        code: errRes.code || "",
        reason: errRes.reason || "",
        actionRequired: errRes.actionRequired || "",
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
    if (!isAuthContextCurrent(ctx)) {
      return { ok: false, stale: true, skipped: true };
    }
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
        getStudentId: function () {
          var a = getAuth();
          return (a && a.profile && a.profile.studentId) || getState().ownerStudentId || "";
        },
        getAuthGeneration: function () {
          return authGeneration;
        },
        onUnauthorized: function (info) {
          handleConfirmedSessionInvalidation("syncPendingAttempts", "Session expired — please sign in again.", info);
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

  try {
    initCrossTabListeners();
  } catch (_e) { /* ignore non-browser init */ }

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
    clearPersonalDataFromDevice: clearPersonalDataFromDevice,
    getAnonymousLocalSummary: getAnonymousLocalSummary,
    buildAuthPayload: buildAuthPayload,
    shouldShowGuestProtectNudge: shouldShowGuestProtectNudge,
    dismissGuestProtectNudge: dismissGuestProtectNudge,
    getSelectedSources: getSelectedSources,
    setSelectedSources: setSelectedSources,
    getAuth: getAuth,
    setAuth: setAuth,
    getAuthGeneration: getAuthGeneration,
    completeAuthTransition: completeAuthTransition,
    reconcileClientRegistration: reconcileClientRegistration,
    getAcknowledgedCloudProgress: getAcknowledgedCloudProgress,
    getUnresolvedMutations: getUnresolvedMutations,
    resolveUnresolvedMutations: resolveUnresolvedMutations,
    utf8ByteLength: utf8ByteLength,
    opScopeSignature: opScopeSignature,
    authHeaders: authHeaders,
    refreshSession: refreshSession,
    getSubjectName: getSubjectName,
    getQuizTitle: getQuizTitle,
    getSiteSettings: getSiteSettings,
    isQuestionInActiveTest: function (internalId) { return isQuestionInActiveTest(getState(), internalId); },
    isBookmarkAnswerHidden: isBookmarkAnswerHidden,
    revealBookmarksForCompletedTest: revealBookmarksForCompletedTest,
    resolveItemSubjectId: resolveItemSubjectId,
    isBookmarked: isBookmarked,
    toggleBookmark: toggleBookmark,
    removeBookmarks: removeBookmarks,
    clearBookmarks: clearBookmarks,
    recordMistake: recordMistake,
    getMistakes: getMistakes,
    getSmartReviewDeck: getSmartReviewDeck,
    resolveMistake: resolveMistake,
    reopenMistake: reopenMistake,
    setMistakesResolved: setMistakesResolved,
    clearMistake: clearMistake,
    clearMistakeIds: clearMistakeIds,
    clearMistakes: clearMistakes,
    clearAllMistakes: clearAllMistakes,
    getProgressSnapshot: getProgressSnapshot,
    restoreProgressSnapshot: restoreProgressSnapshot,
    flushDeferredProgressSync: flushDeferredProgressSync,
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
    consumeSessionInvalidationNotice: consumeSessionInvalidationNotice,
    stashUnresolvedForAccount: stashUnresolvedForAccount,
    restoreRecoveryVaultForAccount: restoreRecoveryVaultForAccount,
    purgeRecoveryVaultForAccount: purgeRecoveryVaultForAccount,
    purgeAllRecoveryVault: purgeAllRecoveryVault,
    hasPendingOrUnresolvedWork: hasPendingOrUnresolvedWork,
    isIsolatedSignedOutState: isIsolatedSignedOutState,
    consumeRecoveredUnresolvedNotice: consumeRecoveredUnresolvedNotice,
    getLastRecoveryError: getLastRecoveryError,
    consumeRecoveryError: consumeRecoveryError,
    consumeRecoveryPurgeWarning: consumeRecoveryPurgeWarning,
    getAuthStorageStatus: getAuthStorageStatus,
    getCleanupAuthOwnership: getCleanupAuthOwnership,
    getCleanupStudySnapshot: getCleanupStudySnapshot,
    withAccountStorageLock: withAccountStorageLock,
    completeAuthTransitionWithLock: completeAuthTransitionWithLock,
    getLastAuthClearResult: getLastAuthClearResult,
    getLastClearDeviceResult: getLastClearDeviceResult,
    RECOVERY_LIMITS: {
      maxAccounts: MAX_RECOVERY_VAULT_ACCOUNTS,
      maxEntryBytes: MAX_RECOVERY_VAULT_ENTRY_BYTES,
      maxTotalBytes: MAX_RECOVERY_VAULT_TOTAL_BYTES,
      ttlMs: RECOVERY_VAULT_TTL_MS,
    },
    t: t,
  };
})(typeof window !== "undefined" ? window : globalThis);
