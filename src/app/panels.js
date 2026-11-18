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

  function enCountPhrase(count, singular, plural) {
    var n = Math.max(0, Math.floor(Number(count) || 0));
    return n + " " + (n === 1 ? singular : plural);
  }

  function arCountPhrase(count, forms) {
    var n = Math.max(0, Math.floor(Number(count) || 0));
    if (n === 0) return forms.zero;
    if (n === 1) return forms.one;
    if (n === 2) return forms.two;
    var mod100 = n % 100;
    if (mod100 >= 3 && mod100 <= 10) return n + " " + forms.few;
    if (mod100 >= 11) return n + " " + forms.many;
    return n + " " + forms.other;
  }

  var AR_SAVED_QUESTION = {
    zero: "0 أسئلة",
    one: "سؤال واحد",
    two: "سؤالين",
    few: "أسئلة",
    many: "سؤالاً",
    other: "سؤال",
  };
  var AR_SAVED_QUESTION_MOD = {
    zero: "0 أسئلة محفوظة",
    one: "سؤال واحد محفوظ",
    two: "سؤالين محفوظين",
    few: "أسئلة محفوظة",
    many: "سؤالاً محفوظاً",
    other: "سؤال محفوظ",
  };
  var AR_MISTAKE = {
    zero: "0 أخطاء",
    one: "خطأ واحد",
    two: "خطأين",
    few: "أخطاء",
    many: "خطأً",
    other: "خطأ",
  };
  var AR_MISTAKE_SEL = {
    zero: "0 أخطاء محددة",
    one: "خطأ واحد محدد",
    two: "خطأين محددين",
    few: "أخطاء محددة",
    many: "خطأً محدداً",
    other: "خطأ محدد",
  };

  var lastCleanupAlert = null;

  function showToast(msg, opts) {
    if (root.ElgoShell && typeof root.ElgoShell.showToast === "function") {
      root.ElgoShell.showToast(msg, opts);
    }
  }

  function describeCleanupFailureReason(res) {
    var code = res && res.code ? String(res.code) : "";
    var authFailed = Boolean(res && res.authCleanupFailed);
    if (code === "RECOVERY_STORE_CORRUPT" || code === "RECOVERY_SLOT_CORRUPT") {
      return txt(
        "local recovery storage is corrupted and could not be safely cleared per account",
        "بيانات الاسترداد المحلية تالفة وتعذر مسحها بأمان لهذا الحساب"
      );
    }
    if (code === "QUOTA_EXCEEDED") {
      return authFailed
        ? txt(
            "browser storage quota prevented clearing or verifying session storage",
            "امتلاء سعة تخزين المتصفح منع مسح بيانات الجلسة أو التحقق من إزالتها"
          )
        : txt(
            "browser storage quota prevented updating recovery storage",
            "امتلاء سعة تخزين المتصفح منع تحديث أو مسح بيانات الاسترداد"
          );
    }
    if (code === "RECOVERY_CONTENTION") {
      return txt(
        "another tab modified recovery storage at the same time",
        "تبويب آخر عدّل بيانات الاسترداد في نفس الوقت"
      );
    }
    if (
      code === "STORAGE_DENIED" ||
      code === "STORAGE_UNAVAILABLE" ||
      code === "STORAGE_READ_FAILED" ||
      code === "STORAGE_WRITE_FAILED" ||
      code === "STORAGE_VERIFY_FAILED"
    ) {
      return authFailed
        ? txt(
            "browser storage denied clearing or failed to verify removal of session data",
            "متصفحك رفض مسح بيانات الجلسة أو تعذر التحقق من إزالتها"
          )
        : txt(
            "browser storage denied or failed to verify removal",
            "متصفحك رفض الوصول للتخزين أو تعذر التحقق من إتمام المسح"
          );
    }
    return authFailed
      ? txt(
          "browser storage failed to remove or verify local session data",
          "تعذر مسح بيانات الجلسة المحلية أو التحقق من إزالتها من المتصفح"
        )
      : txt(
          "browser storage failed to remove local recovery data",
          "تعذر مسح بيانات الاسترداد المحلية من تخزين المتصفح"
        );
  }

  function formatCleanupFailureMessage(actionKind, res) {
    var reason = describeCleanupFailureReason(res);
    var authFailed = Boolean(res && res.authCleanupFailed);
    var serverUnconfirmed = Boolean(res && res.serverAttempted && res.serverRevoked === false);
    if (actionKind === "leave_browser") {
      if (serverUnconfirmed) {
        return txt(
          "Could not confirm leaving this account on the server, and local cleanup failed (" + reason + "). Your local session or data may remain in this browser.",
          "تعذر تأكيد إنهاء جلسة الحساب على السيرفر، كما تعذر إتمام المسح المحلي (" + reason + "). قد تبقى بيانات الجلسة أو البيانات المحلية في المتصفح ده."
        );
      }
      return txt(
        "Left this account on the server, but local cleanup failed (" + reason + "). " + (authFailed ? "Your local session record or recovery copies may remain in this browser." : "Some local data or recovery copies may remain in this browser."),
        "تم إنهاء جلسة الحساب على السيرفر، لكن تعذر إتمام المسح المحلي (" + reason + "). " + (authFailed ? "قد تبقى بيانات الجلسة المحلية أو نسخ الاسترداد في المتصفح ده." : "قد تبقى بعض البيانات المحلية أو نسخ الاسترداد في المتصفح ده.")
      );
    }
    if (actionKind === "sign_out") {
      if (serverUnconfirmed) {
        return txt(
          "Could not confirm server sign-out, and local cleanup failed (" + reason + "). Your local session or data may remain in this browser.",
          "تعذر تأكيد تسجيل الخروج من السيرفر، كما تعذر مسح البيانات المحلية (" + reason + "). قد تبقى بيانات الجلسة أو البيانات المحلية في المتصفح ده."
        );
      }
      return txt(
        "Signed out on the server, but local cleanup failed (" + reason + "). " + (authFailed ? "Your local session record or recovery copies may remain in this browser." : "Some local data or recovery copies may remain in this browser."),
        "تم تسجيل الخروج من السيرفر، لكن تعذر مسح البيانات المحلية بالكامل (" + reason + "). " + (authFailed ? "قد تبقى بيانات الجلسة المحلية أو نسخ الاسترداد في المتصفح ده." : "قد تبقى بعض البيانات المحلية أو نسخ الاسترداد في المتصفح ده.")
      );
    }
    if (actionKind === "delete_account") {
      return txt(
        "Your account was deleted on the server, but local cleanup failed (" + reason + "). " + (authFailed ? "Your local session record or recovery copies may remain on this device." : "Some local data or recovery copies may remain on this device."),
        "تم حذف حسابك من السيرفر، لكن تعذر إتمام مسح البيانات المحلية (" + reason + "). " + (authFailed ? "قد تبقى بيانات الجلسة المحلية أو نسخ الاسترداد على الجهاز ده." : "قد تبقى بعض البيانات المحلية أو نسخ الاسترداد على الجهاز ده.")
      );
    }
    return txt(
      "Could not remove all local study data (" + reason + "). " + (authFailed ? "Local session or study data could not be verified cleared and may remain on this device." : "Some local data or recovery copies may remain on this device."),
      "تعذر مسح كل بيانات المذاكرة المحلية (" + reason + "). " + (authFailed ? "تعذر التحقق من مسح بيانات الجلسة أو البيانات المحلية وقد تبقى على الجهاز ده." : "قد تبقى بعض البيانات المحلية أو نسخ الاسترداد على الجهاز ده.")
    );
  }

  async function confirmPanelAction(opts) {
    if (root.ElgoShell && typeof root.ElgoShell.confirmAction === "function") {
      return root.ElgoShell.confirmAction(opts);
    }
    return true;
  }

  function triggerUndoToast(msg, snapshot, state, onRestore) {
    var owner = snapshot && snapshot.ownerStudentId
      ? snapshot.ownerStudentId
      : "";
    var ownerToken = snapshot && snapshot.ownerToken
      ? snapshot.ownerToken
      : "";
    showToast(msg, {
      actionLabel: state.t("undoLabel"),
      durationMs: 8000,
      onAction: function () {
        var auth = typeof state.getAuth === "function" ? state.getAuth() : null;
        var currentStudentId = auth && auth.profile ? auth.profile.studentId : "";
        var currentToken = auth && auth.token ? auth.token : "";
        if (!auth || !owner || currentStudentId !== owner || (ownerToken && currentToken !== ownerToken)) {
          showToast(state.t("undoUnavailableNotice") || "Undo is no longer available.");
          return;
        }
        if (typeof state.restoreProgressSnapshot === "function") {
          var restored = state.restoreProgressSnapshot(snapshot);
          if (!restored) return;
        }
        if (typeof onRestore === "function") onRestore();
        showToast(state.t("restoredNotice"));
      },
      onDismiss: function () {
        if (typeof state.flushDeferredProgressSync === "function") {
          state.flushDeferredProgressSync();
        }
      },
    });
  }

  function navigateTo(url) {
    if (root.ElgoRouter && typeof root.ElgoRouter.navigate === "function") {
      root.ElgoRouter.navigate(url);
    } else {
      window.location.assign(url);
    }
  }

  function bindPanelSyncLifecycle(container, sentinelSelector, kind, catalog, paint) {
    var state = root.ElgoState;
    var isActive = function () {
      return container && container.isConnected !== false && Boolean(container.querySelector(sentinelSelector));
    };
    if (typeof document !== "undefined" && container) {
      if (container._elgoProgressHandler) {
        document.removeEventListener("elgo:progresschange", container._elgoProgressHandler);
      }
      var handler = function () {
        if (!isActive()) {
          document.removeEventListener("elgo:progresschange", handler);
          if (container._elgoProgressHandler === handler) container._elgoProgressHandler = null;
          return;
        }
        paint();
        hydrateIncompleteItems(kind, catalog).then(function (enriched) {
          if (enriched && isActive()) paint();
        }).catch(function () {});
      };
      container._elgoProgressHandler = handler;
      document.addEventListener("elgo:progresschange", handler);
    }
    hydrateIncompleteItems(kind, catalog).then(function (enriched) {
      if (enriched && isActive()) paint();
    }).catch(function () {});
    if (state.getAuth() && typeof state.pullCloudProgress === "function") {
      state.pullCloudProgress({ throttleMs: 1000 }).then(function (changed) {
        if (changed && isActive()) {
          if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
          paint();
          hydrateIncompleteItems(kind, catalog).then(function (enriched) {
            if (enriched && isActive()) paint();
          }).catch(function () {});
        }
      }).catch(function () {});
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

  async function hydrateIncompleteItems(kind, catalog) {
    var state = root.ElgoState;
    var st = state.getState();
    var list = kind === "bookmarks" ? (st.bookmarks || []) : (st.mistakes || []);
    if (!list.length) return false;

    var subjectsById = new Map();
    (catalog && catalog.subjects || []).forEach(function (s) {
      if (s && s.id) subjectsById.set(s.id, s);
    });

    var missingSubjects = new Set();
    var needsAny = false;
    list.forEach(function (it) {
      if (!it || typeof it !== "object") return;
      var sid = it.subjectId || (String(it.internalId || "").indexOf("::") >= 0 ? String(it.internalId).split("::")[0] : "");
      var hiddenAnswer = kind === "bookmarks" && typeof state.isBookmarkAnswerHidden === "function" && state.isBookmarkAnswerHidden(it);
      var missingAnswer = kind === "bookmarks" && !hiddenAnswer && (!it.correctAnswer || it.hiddenDuringTest);
      var missingText = !it.question || !it.subjectName || (kind === "bookmarks" && (!it.sourceLabel || missingAnswer));
      if (missingText) {
        needsAny = true;
        if (sid) missingSubjects.add(sid);
      }
    });
    if (!needsAny || !missingSubjects.size) return false;

    var qByKey = new Map();
    for (var sid of missingSubjects) {
      try {
        var qs = await state.loadQuestionsForSources(sid, []);
        (qs || []).forEach(function (q) {
          if (!q) return;
          if (q.internalId) qByKey.set(q.internalId, q);
          if (q.id) qByKey.set(sid + "::" + q.id, q);
        });
      } catch (_err) {
        // Ignore single subject load failure offline
      }
    }

    var changed = false;
    var latest = state.getState();
    var latestList = kind === "bookmarks" ? (latest.bookmarks || []) : (latest.mistakes || []);
    var enriched = latestList.map(function (it) {
      if (!it || typeof it !== "object") return it;
      var sid = it.subjectId || (String(it.internalId || "").indexOf("::") >= 0 ? String(it.internalId).split("::")[0] : "");
      var q = qByKey.get(it.internalId) || (sid && it.id ? qByKey.get(sid + "::" + it.id) : null);
      var subj = subjectsById.get(sid);
      var subjName = subj ? state.getSubjectName(subj) : (it.subjectName || "");
      var next = Object.assign({}, it);
      var itemChanged = false;
      var answerHidden = kind === "bookmarks" && typeof state.isBookmarkAnswerHidden === "function" && state.isBookmarkAnswerHidden(it);
      if (kind === "bookmarks" && !answerHidden && (next.hiddenDuringTest || next.testAttemptId)) {
        delete next.hiddenDuringTest;
        delete next.testAttemptId;
        itemChanged = true;
      }
      if (sid && !next.subjectId) { next.subjectId = sid; itemChanged = true; }
      if (subjName && !next.subjectName) { next.subjectName = subjName; itemChanged = true; }
      if (q) {
        var qText = q.question || q.text || "";
        if (qText && !next.question) { next.question = qText; itemChanged = true; }
        if (q.collectionTitle && !next.sourceLabel) { next.sourceLabel = q.collectionTitle; itemChanged = true; }
        if (q.collectionId && !next.quizId) { next.quizId = q.collectionId; itemChanged = true; }
        if (!answerHidden) {
          if (q.correctOptionId && !next.correctOptionId) { next.correctOptionId = q.correctOptionId; itemChanged = true; }
          if (kind === "bookmarks" && !next.correctAnswer && Array.isArray(q.options)) {
            var rightOpt = q.options.find(function (o) { return o && o.id === (next.correctOptionId || q.correctOptionId); });
            if (rightOpt) {
              next.correctAnswer = rightOpt.id + ") " + rightOpt.text;
              itemChanged = true;
            }
          }
        }
        if ((!next.images || !next.images.length) && root.ElgoModel && typeof root.ElgoModel.getQuestionImages === "function") {
          var qImgs = root.ElgoModel.getQuestionImages(q);
          if (qImgs && qImgs.length) {
            next.images = qImgs;
            if (!next.image && qImgs[0] && qImgs[0].url) next.image = qImgs[0].url;
            itemChanged = true;
          }
        }
      }
      if (itemChanged) changed = true;
      return next;
    });

    if (!changed) return false;
    var fresh = state.getState();
    if (kind === "bookmarks") fresh.bookmarks = enriched;
    else fresh.mistakes = enriched;
    state.saveState(fresh);
    return true;
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
      var isolated = typeof state.isIsolatedSignedOutState === "function" && state.isIsolatedSignedOutState();
      bookmarks = isolated ? [] : (state.getState().bookmarks || []);
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

      var coursePillsHtml = (catalog.subjects || []).filter(function (s) { return (countByCourse[s.id] || 0) > 0; }).map(function (s) {
        return '<button type="button" class="filter-pill' + (filterCourse === s.id ? " is-active" : "") + '" data-saved-course-pill="' + esc(s.id) + '">' + esc(state.getSubjectName(s)) + ' (' + countByCourse[s.id] + ')</button>';
      }).join("");

      var currentCourseObj = (catalog.subjects || []).find(function (s) { return s.id === filterCourse; });
      var viewLabel = currentCourseObj ? state.getSubjectName(currentCourseObj) : txt("All Saved", "كل المحفوظين");
      var isSignedIn = Boolean(state.getAuth());
      var savedSubtitle = isolated
        ? txt(
            "Unsynced study data from the previous signed-in account is isolated while signed out. Sign back into that account to access it.",
            "البيانات اللي لسه متزامنتش من الحساب اللي فات محجوزة ومخفية وإنت مسجل خروج. سجل دخول بنفس الحساب علشان ترجع لها."
          )
        : txt("Retake all saved questions in any course or pick specific ones freely.", "عيد كل الأسئلة المحفوظة للمادة أو اختار شوية منهم براحتك.");

      container.innerHTML = [
        '<section class="hub-panel">',
        '  <div class="breadcrumbs">',
        '    <button type="button" id="savedBackHub">' + esc(state.t("backCourses")) + '</button>',
        '    <span>/</span>',
        '    <span>' + esc(state.t("saved")) + '</span>',
        '  </div>',
        '  <div class="dialog-head panel-header-bar">',
        '    <div class="panel-title-wrap">',
        '      <div class="panel-title-row">',
        '        <h1 style="margin:0;font-size:1.3rem;">★ ' + esc(state.t("saved")) + ' (' + bookmarks.length + ')</h1>',
                 isSignedIn ? '<button type="button" class="secondary panel-chip-btn" id="savedSyncBtn" title="' + esc(txt("Sync now", "مزامنة الآن")) + '">⟳ ' + esc(txt("Sync", "مزامنة")) + '</button>' : '',
        '      </div>',
        '      <p class="question-meta panel-subtitle" style="margin:4px 0 0;">' + esc(savedSubtitle) + '</p>',
        '    </div>',
        '    <div class="panel-actions-bar">',
               visible.length ? '<button type="button" class="primary" id="practiceSavedBtn">' + esc(txt("▶ Retake (" + visible.length + ")", "▶ إعادة (" + visible.length + ")")) + '</button>' : '',
               visible.length ? '<button type="button" class="secondary" id="practiceSelectedSavedBtn"' + (visibleSelected.length === 0 ? " disabled" : "") + '>' + esc(txt("▶ Selected (" + visibleSelected.length + ")", "▶ المختار (" + visibleSelected.length + ")")) + '</button>' : '',
               visible.length ? '<button type="button" class="secondary" id="removeSelectedSavedBtn"' + (visibleSelected.length === 0 ? " disabled" : "") + '>' + esc(state.t("removeSelectedBtn") + " (" + visibleSelected.length + ")") + '</button>' : '',
               visible.length ? '<button type="button" class="secondary" id="clearSavedBtn">' + esc(state.t("removeAllInViewBtn") + " (" + visible.length + ")") + '</button>' : '',
        '    </div>',
        '  </div>',
           bookmarks.length ? [
             '<div class="filter-bar is-mobile-scroll" aria-label="Saved Courses">',
             '  <button type="button" class="filter-pill' + (filterCourse === "all" ? " is-active" : "") + '" data-saved-course-pill="all">' + esc(txt("All", "الكل")) + ' (' + bookmarks.length + ')</button>',
                coursePillsHtml,
             '</div>'
           ].join("\n") : '',
           visible.length ? [
             '<div class="panel-tools saved-tools-bar">',
             '  <div class="saved-controls-row">',
             '    <select id="savedModeSelect" aria-label="Retake Mode">',
             '      <option value="practice"' + (savedMode === "practice" ? " selected" : "") + '>' + esc(txt("Practice · Instant", "تدريب · فوري")) + '</option>',
             '      <option value="study"' + (savedMode === "study" ? " selected" : "") + '>' + esc(txt("Study · Answers", "مذاكرة · بالإجابات")) + '</option>',
             '      <option value="test"' + (savedMode === "test" ? " selected" : "") + '>' + esc(txt("Self-Exam · End Score", "اختبار · في الآخر")) + '</option>',
             '    </select>',
             '    <label class="compact-check">',
             '      <input type="checkbox" id="savedShuffleCheck"' + (savedShuffle ? " checked" : "") + '>',
             '      <span>' + esc(txt("Shuffle", "عشوائي")) + '</span>',
             '    </label>',
             '    <div class="saved-sel-btns">',
             '      <button type="button" class="quiet panel-chip-btn" id="savedSelectAllBtn">' + esc(txt("All (" + visible.length + ")", "الكل (" + visible.length + ")")) + '</button>',
             '      <button type="button" class="quiet panel-chip-btn" id="savedClearSelBtn"' + (visibleSelected.length === 0 ? " disabled" : "") + '>' + esc(state.t("deselectBtn")) + '</button>',
             '    </div>',
             '  </div>',
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
               var answerHidden = typeof state.isBookmarkAnswerHidden === "function" && state.isBookmarkAnswerHidden(b);
               return [
                 '<article class="panel-item hub-review" data-bookmark-idx="' + idx + '">',
                 '  <div class="panel-item-head">',
                 '    <label class="panel-item-meta-label">',
                 '      <input type="checkbox" class="saved-select-cb" data-select-saved-id="' + esc(key) + '"' + (checked ? " checked" : "") + '>',
                 '      <span class="question-meta panel-item-source">' + esc(b.subjectName || b.subjectId) + (b.sourceLabel || b.quizId ? (' · ' + esc(b.sourceLabel || b.quizId)) : '') + '</span>',
                 '    </label>',
                 '    <button type="button" class="quiet panel-chip-btn" data-remove-id="' + esc(key) + '">' + esc(txt("Remove ★", "إزالة ★")) + '</button>',
                 '  </div>',
                 '  <strong class="panel-item-q">' + esc(b.question || b.id) + '</strong>',
                    renderPanelQuestionImages(b),
                    answerHidden
                      ? ('<div style="font-size:0.82rem;color:var(--muted);">' + esc(txt("Answer hidden while your active Test is in progress.", "الإجابة مخفية أثناء استمرار الاختبار الحالي.")) + '</div>')
                      : (b.correctAnswer ? ('<div style="font-size:0.84rem;color:var(--accent-text);">' + esc(txt("Answer:", "الإجابة:")) + ' <strong>' + esc(b.correctAnswer) + '</strong></div>') : ''),
                 '</article>'
               ].join("\n");
             }).join("\n"),
             '</div>'
           ].join("\n"),
        '</section>'
      ].join("\n");

      container.querySelector("#savedBackHub").addEventListener("click", function () { navigateTo("/?flow=hub"); });
      var savedSyncBtn = container.querySelector("#savedSyncBtn");
      if (savedSyncBtn) {
        savedSyncBtn.addEventListener("click", async function () {
          savedSyncBtn.disabled = true;
          try {
            var syncRes = typeof state.syncNow === "function"
              ? await state.syncNow()
              : await state.syncProgressToCloud({ force: true });
            if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
            paint();
            if (syncRes && syncRes.ok) {
              await hydrateIncompleteItems("bookmarks", catalog).then(function (enriched) {
                if (enriched && container.isConnected !== false) paint();
              }).catch(function () {});
              showToast(txt("Saved items synced (" + (state.getState().bookmarks || []).length + ").", "تمت المزامنة (" + (state.getState().bookmarks || []).length + ")."));
            } else {
              showToast((syncRes && syncRes.error) || txt("Could not sync right now — check your connection or sign in again.", "تعذرت المزامنة الآن — تأكد من الاتصال أو سجل دخول تاني."));
            }
          } finally {
            if (savedSyncBtn.isConnected !== false) savedSyncBtn.disabled = false;
          }
        });
      }
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
        var unlockedItems = typeof state.isBookmarkAnswerHidden === "function"
          ? targetItems.filter(function (b) { return !state.isBookmarkAnswerHidden(b); })
          : targetItems;
        if (!unlockedItems.length) {
          showToast(txt(
            "Finish or discard your active Test before retaking questions from it.",
            "أنهي أو الغي الاختبار الحالي قبل ما تعيد أسئلته من المحفوظات."
          ));
          return;
        }
        if (triggerBtn) triggerBtn.disabled = true;
        try {
          var hydrated = await hydrateQuestionsFromSubjects(unlockedItems, catalog);
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

      var removeSelectedSavedBtn = container.querySelector("#removeSelectedSavedBtn");
      if (removeSelectedSavedBtn) {
        removeSelectedSavedBtn.addEventListener("click", async function () {
          if (!visibleSelected.length) {
            showToast(txt("Select at least 1 saved question first.", "اختار سؤال واحد على الأقل الأول."));
            return;
          }
          var targetIds = visibleSelected.map(function (b) { return b.internalId || b.id; });
          var ok = await confirmPanelAction({
            title: state.t("removeSelectedBtn") + " (" + targetIds.length + ")",
            message: txt(
              "Remove " + enCountPhrase(targetIds.length, "selected saved question", "selected saved questions") + " from \"" + viewLabel + "\"?\n" + state.t("savedListScopeNote"),
              "هل تريد حذف " + arCountPhrase(targetIds.length, AR_SAVED_QUESTION) + " من المحفوظات في \"" + viewLabel + "\"؟\n" + state.t("savedListScopeNote")
            ),
            confirmLabel: txt("Remove (" + targetIds.length + ")", "حذف (" + targetIds.length + ")"),
            cancelLabel: state.t("authGuestSwitchCancel"),
            danger: true,
          });
          if (!ok) return;
          var snapshot = typeof state.getProgressSnapshot === "function" ? state.getProgressSnapshot() : null;
          var removedCount = typeof state.removeBookmarks === "function"
            ? state.removeBookmarks(targetIds, { deferSync: true })
            : targetIds.length;
          targetIds.forEach(function (id) { selectedIds.delete(id); });
          bookmarks = state.getState().bookmarks || [];
          if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
          paint();
          var msg = txt(
            "Removed " + enCountPhrase(removedCount, "saved question", "saved questions") + ".",
            "تم حذف " + arCountPhrase(removedCount, AR_SAVED_QUESTION) + " من المحفوظات."
          );
          if (snapshot) {
            triggerUndoToast(msg, snapshot, state, function () {
              bookmarks = state.getState().bookmarks || [];
              if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
              paint();
            });
          } else {
            showToast(msg);
          }
        });
      }

      var clearSavedBtn = container.querySelector("#clearSavedBtn");
      if (clearSavedBtn) {
        clearSavedBtn.addEventListener("click", async function () {
          if (!visible.length) return;
          var scopeCourse = filterCourse === "all" ? "" : filterCourse;
          var ok = await confirmPanelAction({
            title: state.t("removeAllInViewBtn") + " — " + viewLabel,
            message: txt(
              "Remove all " + enCountPhrase(visible.length, "saved question", "saved questions") + " in \"" + viewLabel + "\"?\n" + state.t("savedListScopeNote"),
              "هل تريد مسح كل الأسئلة المحفوظة (" + visible.length + ") في \"" + viewLabel + "\"؟\n" + state.t("savedListScopeNote")
            ),
            confirmLabel: txt("Remove All (" + visible.length + ")", "مسح الكل (" + visible.length + ")"),
            cancelLabel: state.t("authGuestSwitchCancel"),
            danger: true,
          });
          if (!ok) return;
          var snapshot = typeof state.getProgressSnapshot === "function" ? state.getProgressSnapshot() : null;
          var clearedCount = typeof state.clearBookmarks === "function"
            ? state.clearBookmarks({ subjectId: scopeCourse, deferSync: true })
            : visible.length;
          visible.forEach(function (b) { selectedIds.delete(b.internalId || b.id); });
          bookmarks = state.getState().bookmarks || [];
          if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
          paint();
          var msg = txt(
            "Removed " + enCountPhrase(clearedCount, "saved question", "saved questions") + " from \"" + viewLabel + "\".",
            "تم مسح " + arCountPhrase(clearedCount, AR_SAVED_QUESTION_MOD) + " من \"" + viewLabel + "\"."
          );
          if (snapshot) {
            triggerUndoToast(msg, snapshot, state, function () {
              bookmarks = state.getState().bookmarks || [];
              if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
              paint();
            });
          } else {
            showToast(msg);
          }
        });
      }

      container.querySelectorAll("[data-remove-id]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.getAttribute("data-remove-id");
          var snapshot = typeof state.getProgressSnapshot === "function" ? state.getProgressSnapshot() : null;
          selectedIds.delete(id);
          state.toggleBookmark({ internalId: id, id: id }, { deferSync: true });
          bookmarks = state.getState().bookmarks || [];
          if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
          paint();
          var msg = txt("Removed from Saved.", "تمت الإزالة من المحفوظات.");
          if (snapshot) {
            triggerUndoToast(msg, snapshot, state, function () {
              bookmarks = state.getState().bookmarks || [];
              if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
              paint();
            });
          } else {
            showToast(msg);
          }
        });
      });
    }

    paint();
    bindPanelSyncLifecycle(container, "#savedBackHub", "bookmarks", catalog, paint);
  }

  /* ---------------------------------------------------------------------- */
  /* MISTAKES NOTEBOOK PANEL (Smart Review Deck + Resolve / Reopen)         */
  /* ---------------------------------------------------------------------- */
  async function renderMistakesPanel(container) {
    var state = root.ElgoState;
    var catalog = await state.loadCatalog();
    var filterCourse = "all";
    var statusFilter = state.getMistakes("", { status: "unresolved" }).length > 0 ? "unresolved" : "all";
    var selectedIds = new Set();

    function paint() {
      var sid = filterCourse === "all" ? "" : filterCourse;
      var unresolvedList = state.getMistakes(sid, { status: "unresolved" });
      var resolvedList = state.getMistakes(sid, { status: "resolved" });
      var mistakes = state.getMistakes(sid, { status: statusFilter });
      var allMistakes = state.getMistakes("", { status: "all" });
      var activeKeys = new Set();
      allMistakes.forEach(function (m) { activeKeys.add(m.internalId || m.id); });
      Array.from(selectedIds).forEach(function (id) {
        if (!activeKeys.has(id)) selectedIds.delete(id);
      });
      var visibleSelected = mistakes.filter(function (m) { return selectedIds.has(m.internalId || m.id); });

      var currentCourseObj = filterCourse === "all"
        ? null
        : (catalog.subjects || []).find(function (s) { return s.id === filterCourse; });
      var viewCourseLabel = currentCourseObj ? state.getSubjectName(currentCourseObj) : state.t("allCourses");
      var statusLabel = statusFilter === "unresolved"
        ? state.t("unresolvedLabel")
        : (statusFilter === "resolved" ? state.t("resolvedLabel") : state.t("allLabel"));
      var clearScopeLabel = (filterCourse === "all" && statusFilter === "all")
        ? txt("Clear All Mistakes (" + mistakes.length + ")", "مسح كل الأخطاء (" + mistakes.length + ")")
        : txt(
            "Clear " + viewCourseLabel + (statusFilter !== "all" ? (" · " + statusLabel) : "") + " (" + mistakes.length + ")",
            "مسح " + viewCourseLabel + (statusFilter !== "all" ? (" · " + statusLabel) : "") + " (" + mistakes.length + ")"
          );

      var courseOptions = (catalog.subjects || [])
        .map(function (s) { return '<option value="' + esc(s.id) + '"' + (filterCourse === s.id ? " selected" : "") + '>' + esc(state.getSubjectName(s)) + '</option>'; })
        .join("");

      var isSignedInMistakes = Boolean(state.getAuth());
      container.innerHTML = [
        '<section class="hub-panel">',
        '  <div class="breadcrumbs">',
        '    <button type="button" id="mistakesBackHub">' + esc(state.t("backCourses")) + '</button>',
        '    <span>/</span>',
        '    <span>' + esc(state.t("mistakes")) + '</span>',
        '  </div>',
        '  <div class="dialog-head panel-header-bar">',
        '    <div class="panel-title-wrap">',
        '      <div class="panel-title-row">',
        '        <h1 style="margin:0;font-size:1.3rem;">↺ ' + esc(state.t("mistakes")) + ' (' + mistakes.length + ')</h1>',
                 isSignedInMistakes ? '<button type="button" class="secondary panel-chip-btn" id="mistakesSyncBtn" title="' + esc(txt("Sync now", "مزامنة الآن")) + '">⟳ ' + esc(txt("Sync", "مزامنة")) + '</button>' : '',
        '      </div>',
        '      <p class="question-meta panel-subtitle" style="margin:4px 0 0;">' + esc(state.t("smartReviewDesc")) + '</p>',
        '      <p class="mistakes-help-line">' + esc(state.t("mistakesHelpLine")) + '</p>',
        '    </div>',
        '    <div class="panel-actions-bar">',
               unresolvedList.length ? '<button type="button" class="primary" id="practiceMistakesBtn">' + esc(txt("Smart Review", "مراجعة ذكية")) + ' (' + Math.min(unresolvedList.length, 25) + ') →</button>' : '',
               mistakes.length ? '<button type="button" class="secondary" id="resolveSelectedMistakesBtn"' + (visibleSelected.length === 0 ? " disabled" : "") + '>' + esc(state.t("resolveSelectedBtn") + " (" + visibleSelected.length + ")") + '</button>' : '',
               mistakes.length ? '<button type="button" class="secondary" id="deleteSelectedMistakesBtn"' + (visibleSelected.length === 0 ? " disabled" : "") + '>' + esc(state.t("deleteSelectedBtn") + " (" + visibleSelected.length + ")") + '</button>' : '',
               mistakes.length ? '<button type="button" class="secondary" id="clearMistakesBtn">' + esc(clearScopeLabel) + '</button>' : '',
        '    </div>',
        '  </div>',
        '  <div class="panel-tools mistakes-tools-bar">',
        '    <div class="filter-bar is-mobile-scroll">',
        '      <button type="button" class="filter-pill' + (statusFilter === "unresolved" ? " is-active" : "") + '" data-m-status="unresolved">' + esc(state.t("unresolvedLabel")) + ' (' + unresolvedList.length + ')</button>',
        '      <button type="button" class="filter-pill' + (statusFilter === "resolved" ? " is-active" : "") + '" data-m-status="resolved">' + esc(state.t("resolvedLabel")) + ' (' + resolvedList.length + ')</button>',
        '      <button type="button" class="filter-pill' + (statusFilter === "all" ? " is-active" : "") + '" data-m-status="all">' + esc(state.t("allLabel")) + ' (' + (unresolvedList.length + resolvedList.length) + ')</button>',
        '    </div>',
             mistakes.length ? [
               '<div class="saved-sel-btns">',
               '  <button type="button" class="quiet panel-chip-btn" id="mistakesSelectAllBtn">' + esc(txt("All (" + mistakes.length + ")", "الكل (" + mistakes.length + ")")) + '</button>',
               '  <button type="button" class="quiet panel-chip-btn" id="mistakesDeselectBtn"' + (visibleSelected.length === 0 ? " disabled" : "") + '>' + esc(state.t("deselectBtn")) + '</button>',
               '</div>'
             ].join("\n") : '',
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
               var checked = selectedIds.has(id);
               return [
                 '<article class="panel-item hub-review">',
                 '  <div class="panel-item-head">',
                 '    <label class="panel-item-meta-label">',
                 '      <input type="checkbox" class="mistakes-select-cb" data-select-mistake-id="' + esc(id) + '"' + (checked ? " checked" : "") + '>',
                 '      <span class="question-meta panel-item-source">' + esc(m.subjectName || m.subjectId) + ' · ' + esc(txt("Missed", "أخطأت")) + ' ' + Number(m.missCount || 1) + '×' + (m.resolved ? (" · ✓ " + esc(state.t("resolvedLabel"))) : "") + '</span>',
                 '    </label>',
                 '    <div class="inline" style="flex-shrink:0;gap:5px;">',
                 m.resolved
                   ? '<button type="button" class="quiet panel-chip-btn" data-reopen-id="' + esc(id) + '">' + esc(state.t("reopenLabel")) + '</button>'
                   : '<button type="button" class="quiet panel-chip-btn" data-resolve-id="' + esc(id) + '">' + esc(state.t("resolveLabel")) + '</button>',
                 '      <button type="button" class="quiet panel-chip-btn" data-clear-id="' + esc(id) + '">' + esc(state.t("deleteLabel")) + '</button>',
                 '    </div>',
                 '  </div>',
                 '  <strong class="panel-item-q">' + esc(m.question || m.id) + '</strong>',
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
      var mistakesSyncBtn = container.querySelector("#mistakesSyncBtn");
      if (mistakesSyncBtn) {
        mistakesSyncBtn.addEventListener("click", async function () {
          mistakesSyncBtn.disabled = true;
          try {
            var syncRes = typeof state.syncNow === "function"
              ? await state.syncNow()
              : await state.syncProgressToCloud({ force: true });
            if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
            paint();
            if (syncRes && syncRes.ok) {
              await hydrateIncompleteItems("mistakes", catalog).then(function (enriched) {
                if (enriched && container.isConnected !== false) paint();
              }).catch(function () {});
              showToast(txt("Mistakes synced (" + state.getMistakes("", { status: "all" }).length + ").", "تمت مزامنة الأخطاء (" + state.getMistakes("", { status: "all" }).length + ")."));
            } else {
              showToast((syncRes && syncRes.error) || txt("Could not sync right now — check your connection or sign in again.", "تعذرت المزامنة الآن — تأكد من الاتصال أو سجل دخول تاني."));
            }
          } finally {
            if (mistakesSyncBtn.isConnected !== false) mistakesSyncBtn.disabled = false;
          }
        });
      }
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

      var mSelectAllBtn = container.querySelector("#mistakesSelectAllBtn");
      if (mSelectAllBtn) {
        mSelectAllBtn.addEventListener("click", function () {
          mistakes.forEach(function (m) { selectedIds.add(m.internalId || m.id); });
          paint();
        });
      }
      var mDeselectBtn = container.querySelector("#mistakesDeselectBtn");
      if (mDeselectBtn) {
        mDeselectBtn.addEventListener("click", function () {
          mistakes.forEach(function (m) { selectedIds.delete(m.internalId || m.id); });
          paint();
        });
      }
      container.querySelectorAll("[data-select-mistake-id]").forEach(function (cb) {
        cb.addEventListener("change", function () {
          var id = cb.getAttribute("data-select-mistake-id");
          if (cb.checked) selectedIds.add(id);
          else selectedIds.delete(id);
          paint();
        });
      });

      var resolveSelBtn = container.querySelector("#resolveSelectedMistakesBtn");
      if (resolveSelBtn) {
        resolveSelBtn.addEventListener("click", function () {
          if (!visibleSelected.length) return;
          var ids = visibleSelected.map(function (m) { return m.internalId || m.id; });
          if (typeof state.setMistakesResolved === "function") {
            state.setMistakesResolved(ids, true);
          } else {
            ids.forEach(function (id) { state.resolveMistake(id); });
          }
          ids.forEach(function (id) { selectedIds.delete(id); });
          if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
          showToast(txt(
            "Marked " + enCountPhrase(ids.length, "mistake", "mistakes") + " as resolved.",
            "تم تعليم " + arCountPhrase(ids.length, AR_MISTAKE) + " كمحلول."
          ));
          paint();
        });
      }

      var deleteSelBtn = container.querySelector("#deleteSelectedMistakesBtn");
      if (deleteSelBtn) {
        deleteSelBtn.addEventListener("click", async function () {
          if (!visibleSelected.length) return;
          var ids = visibleSelected.map(function (m) { return m.internalId || m.id; });
          var scopeSummary = statusFilter !== "all" ? (viewCourseLabel + " · " + statusLabel) : viewCourseLabel;
          var ok = await confirmPanelAction({
            title: state.t("deleteSelectedBtn") + " (" + ids.length + ")",
            message: txt(
              "Delete " + enCountPhrase(ids.length, "selected mistake", "selected mistakes") + " from \"" + scopeSummary + "\"?\n" + state.t("mistakesClearScopeNote"),
              "هل تريد مسح " + arCountPhrase(ids.length, AR_MISTAKE_SEL) + " من \"" + scopeSummary + "\"؟\n" + state.t("mistakesClearScopeNote")
            ),
            confirmLabel: txt("Delete (" + ids.length + ")", "مسح (" + ids.length + ")"),
            cancelLabel: state.t("authGuestSwitchCancel"),
            danger: true,
          });
          if (!ok) return;
          var snapshot = typeof state.getProgressSnapshot === "function" ? state.getProgressSnapshot() : null;
          var removed = typeof state.clearMistakeIds === "function"
            ? state.clearMistakeIds(ids, { deferSync: true })
            : ids.length;
          ids.forEach(function (id) { selectedIds.delete(id); });
          if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
          paint();
          var msg = txt(
            "Deleted " + enCountPhrase(removed, "selected mistake", "selected mistakes") + ".",
            "تم مسح " + arCountPhrase(removed, AR_MISTAKE_SEL) + "."
          );
          if (snapshot) {
            triggerUndoToast(msg, snapshot, state, function () {
              if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
              paint();
            });
          } else {
            showToast(msg);
          }
        });
      }

      var clearAll = container.querySelector("#clearMistakesBtn");
      if (clearAll) {
        clearAll.addEventListener("click", async function () {
          if (!mistakes.length) return;
          var scopeSummary = statusFilter !== "all" ? (viewCourseLabel + " · " + statusLabel) : viewCourseLabel;
          var ok = await confirmPanelAction({
            title: clearScopeLabel,
            message: txt(
              "Clear " + enCountPhrase(mistakes.length, "mistake", "mistakes") + " in \"" + scopeSummary + "\"?\n" + state.t("mistakesClearScopeNote"),
              "هل تريد مسح " + arCountPhrase(mistakes.length, AR_MISTAKE) + " في \"" + scopeSummary + "\"؟\n" + state.t("mistakesClearScopeNote")
            ),
            confirmLabel: clearScopeLabel,
            cancelLabel: state.t("authGuestSwitchCancel"),
            danger: true,
          });
          if (!ok) return;
          var snapshot = typeof state.getProgressSnapshot === "function" ? state.getProgressSnapshot() : null;
          var removedCount = typeof state.clearMistakes === "function"
            ? state.clearMistakes({ subjectId: sid, status: statusFilter, deferSync: true })
            : mistakes.length;
          mistakes.forEach(function (m) { selectedIds.delete(m.internalId || m.id); });
          if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
          paint();
          var msg = txt(
            "Cleared " + enCountPhrase(removedCount, "mistake", "mistakes") + " from \"" + scopeSummary + "\".",
            "تم مسح " + arCountPhrase(removedCount, AR_MISTAKE) + " من \"" + scopeSummary + "\"."
          );
          if (snapshot) {
            triggerUndoToast(msg, snapshot, state, function () {
              if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
              paint();
            });
          } else {
            showToast(msg);
          }
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
          var id = btn.getAttribute("data-clear-id");
          var snapshot = typeof state.getProgressSnapshot === "function" ? state.getProgressSnapshot() : null;
          selectedIds.delete(id);
          state.clearMistake(id, { deferSync: true });
          if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
          paint();
          var msg = txt("Mistake removed.", "تم مسح الخطأ.");
          if (snapshot) {
            triggerUndoToast(msg, snapshot, state, function () {
              if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
              paint();
            });
          } else {
            showToast(msg);
          }
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
    bindPanelSyncLifecycle(container, "#mistakesBackHub", "mistakes", catalog, paint);
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
          var curAuthLB = state.getAuth();
          if (curAuthLB && curAuthLB.profile && curAuthLB.profile.guest) {
            if (root.ElgoShell) root.ElgoShell.openAuthModal("upgrade");
            return;
          }
          if (btn) btn.disabled = true;
          try {
            var qGen = typeof state.getAuthGeneration === "function" ? state.getAuthGeneration() : null;
            var stBeforeQuick = typeof state.getState === "function" ? state.getState() : null;
            var guestPayload = typeof state.buildAuthPayload === "function"
              ? state.buildAuthPayload({ mode: "guest", username: uname, includeLocalProgress: true })
              : { username: uname };
            var res = await fetch("/api/auth/guest", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(guestPayload),
            });
            var data = await res.json().catch(function () { return null; });
            if (!res.ok || !data || !data.ok || !data.token) {
              if (root.ElgoShell) root.ElgoShell.showToast((data && data.error) || txt("Could not join with that name.", "الاسم ده غير متاح أو غير صالح."));
              return;
            }
            if (typeof state.completeAuthTransition === "function") {
              var transitionedQuick = await state.completeAuthTransitionWithLock(data, { expectedAuthGeneration: qGen });
              if (!transitionedQuick) return;
            } else {
              state.setAuth(data);
              var cloudProg = (data.profile && data.profile.progress) || data.progress;
              if (cloudProg && typeof state.applyCloudProgress === "function") {
                state.applyCloudProgress(cloudProg, {
                  studentId: data.profile && data.profile.studentId,
                  username: data.profile && data.profile.username,
                  replace: Boolean(stBeforeQuick && stBeforeQuick.ownerStudentId),
                  serverTime: data.serverTime,
                });
              }
            }
            if (typeof state.syncProgressToCloud === "function") {
              await state.syncProgressToCloud().catch(function () {});
            }
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

    function cleanupRetryStatus(pending) {
      if (pending.stale || pending.generation !== state.getAuthGeneration()) return "changed";
      if (!pending.token || !pending.ownerSid) return "unverified";
      var ownership = state.getCleanupAuthOwnership(pending.token, pending.ownerSid, pending.clearAuth);
      if (ownership === "changed" || ownership === "unverified") return ownership;
      if (pending.retryStudyData) {
        var snapshot = state.getCleanupStudySnapshot(pending.ownerSid);
        if (!snapshot.ok) return "unverified";
        if (pending.studySnapshot.ok) {
          if (snapshot.value !== pending.studySnapshot.value) return "changed";
        } else if (ownership !== "current" || (snapshot.value != null && !snapshot.ownerVerified)) {
          return "unverified";
        }
      }
      return ownership;
    }

    function cleanupRetryWarning(status) {
      if (status === "no_lock") {
        return txt("This browser cannot safely coordinate cleanup across tabs. No data was removed.", "لا يستطيع هذا المتصفح تنسيق المسح بأمان بين علامات التبويب. لم تُحذف أي بيانات.");
      }
      return status === "changed"
        ? txt("This cleanup belongs to an earlier session or local data has changed. No data was removed by this retry.", "ترتبط محاولة المسح بجلسة سابقة أو تغيّرت البيانات المحلية. لم تُحذف أي بيانات في هذه المحاولة.")
        : txt("Could not verify which session owns the browser data. No data was removed. Restore browser storage access and try again.", "تعذّر التحقق من الجلسة المالكة لبيانات المتصفح. لم تُحذف أي بيانات. أعد السماح بالوصول إلى مساحة تخزين المتصفح وحاول مرة أخرى.");
    }

    function paint() {
      var auth = state.getAuth();
      var renderedAuth = auth;
      var renderedGen = typeof state.getAuthGeneration === "function" ? state.getAuthGeneration() : null;
      var profile = auth && auth.profile;
      var curTheme = theme.getTheme();
      var curLang = theme.getLang();
      var paused = theme.isMotionPaused();
      var catalogMgr = state.getCatalogManager();
      var viewScope = catalogMgr && typeof catalogMgr.getActiveScope === "function"
        ? catalogMgr.getActiveScope()
        : { facultyId: "faculty-ai", levelId: "level-2", termId: "term-1" };

      var isIsolatedSignedOut = typeof state.isIsolatedSignedOutState === "function" && state.isIsolatedSignedOutState();
      var attemptCount = isIsolatedSignedOut ? 0 : (state.getState().attemptHistory || []).length;

      var xpVal = profile
        ? Number((profile.stats && profile.stats.xp !== undefined ? profile.stats.xp : (profile.xp !== undefined ? profile.xp : profile.points)) || 0)
        : 0;
      var streakVal = profile
        ? Number((profile.stats && profile.stats.streakDays !== undefined ? profile.stats.streakDays : (profile.streakDays !== undefined ? profile.streakDays : profile.streak)) || 0)
        : 0;
      var syncStatus = typeof state.getSyncStatus === "function" ? state.getSyncStatus() : null;
      var syncStObj = state.getState();
      var savedTotal = isIsolatedSignedOut ? 0 : (syncStObj.bookmarks || []).length;
      var mistakesTotal = isIsolatedSignedOut ? 0 : (syncStObj.mistakes || []).length;
      var unresolvedObj = typeof state.getUnresolvedMutations === "function" ? state.getUnresolvedMutations() : { items: [] };
      var unresolvedItems = Array.isArray(unresolvedObj.items) ? unresolvedObj.items : [];
      var refreshRecommended = Boolean((syncStatus && syncStatus.refreshRecommended) || unresolvedObj.actionRequired === "REFRESH_APP");
      var hasDestructiveUnresolved = unresolvedItems.some(function (u) { return u && u.destructive; });
      var hasSyncErr = Boolean(syncStatus && !syncStatus.ok && syncStatus.error);
      var syncSummaryText = isIsolatedSignedOut
        ? txt(
            "Signed out · Unsynced changes from the previous session remain isolated on this device because a separate local recovery copy could not be saved. Sign back into that account to resume syncing, or use Clear Local Data below.",
            "مسجل خروج · في تغييرات متزامنتش من الجلسة اللي فاتت ومحجوزة هنا على الجهاز علشان تعذر حفظ نسخة استرداد منفصلة. سجل دخول بنفس الحساب علشان تكمل المزامنة، أو امسح البيانات المحلية من تحت."
          )
        : !auth
          ? txt("Guest/local mode · Sign in to sync across devices.", "وضع محلي · سجل دخول علشان تزامن بين أجهزتك.")
          : hasSyncErr
            ? txt("Sync issue: " + syncStatus.error, "مشكلة في المزامنة: " + syncStatus.error)
            : syncStObj.pendingProgressSync
              ? txt("Pending changes waiting to sync · " + savedTotal + " saved · " + mistakesTotal + " mistakes", "تغييرات محلية في انتظار المزامنة · " + savedTotal + " محفوظ · " + mistakesTotal + " أخطاء")
              : txt("Cloud synced · " + savedTotal + " saved · " + mistakesTotal + " mistakes", "تمت المزامنة مع السحابة · " + savedTotal + " محفوظ · " + mistakesTotal + " أخطاء");

      var renderUnresolvedCard = function () {
        if (!unresolvedItems.length && !refreshRecommended) return "";
        var leadMsg = refreshRecommended ? state.t("syncConflictRefreshPrompt") : state.t("syncConflictReviewPrompt");
        var hintMsg = hasDestructiveUnresolved ? ('<p class="question-meta" style="margin:4px 0 8px;">' + esc(state.t("syncConflictDestructiveHint")) + '</p>') : "";
        var rowsHtml = unresolvedItems.slice(0, 12).map(function (entry) {
          var kindLabel = entry.kind === "bookmarks_clear" || entry.kind === "mistakes_clear"
            ? state.t("syncConflictClearKind")
            : (entry.kind === "bookmark_delete" || entry.kind === "mistake_delete"
                ? state.t("syncConflictDeleteKind")
                : state.t("syncConflictSavedKind"));
          return [
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-top:1px solid var(--line, rgba(255,255,255,0.08));flex-wrap:wrap;">',
            '  <div style="min-width:0;flex:1;">',
            '    <span class="hub-badge-pill">' + esc(kindLabel) + '</span> ',
            '    <span style="font-size:0.86rem;">' + esc(String(entry.label || entry.scopeId || "").slice(0, 90)) + '</span>',
            '  </div>',
            '  <div class="inline">',
                 refreshRecommended ? "" : ('<button type="button" class="secondary" data-unres-apply="' + esc(entry.id) + '">' + esc(state.t("syncConflictApplyBtn")) + '</button>'),
            '    <button type="button" class="secondary" data-unres-discard="' + esc(entry.id) + '">' + esc(state.t("syncConflictDiscardBtn")) + '</button>',
            '  </div>',
            '</div>'
          ].join("");
        }).join("");
        return [
          '<div id="settingsConflictBox" style="margin:8px 0 10px;padding:10px 12px;border:1px solid var(--danger-border, #c43);border-radius:10px;background:rgba(200,60,50,0.06);">',
          '  <strong style="font-size:0.92rem;color:var(--danger, #c43);">' + esc(state.t("syncConflictBannerTitle")) + (unresolvedItems.length ? (" (" + unresolvedItems.length + ")") : "") + '</strong>',
          '  <p class="question-meta" style="margin:4px 0;">' + esc(leadMsg) + '</p>',
          hintMsg,
          rowsHtml,
          '  <div class="inline" style="margin-top:8px;">',
               refreshRecommended ? '<button type="button" class="primary" id="refreshAppSyncBtn">' + esc(state.t("syncConflictRefreshBtn")) + '</button>' : "",
               (!refreshRecommended && unresolvedItems.length > 0) ? '<button type="button" class="primary" id="applyAllUnresolvedBtn">' + esc(state.t("syncConflictApplyAllBtn")) + '</button>' : "",
               unresolvedItems.length > 0 ? '<button type="button" class="secondary" id="discardAllUnresolvedBtn">' + esc(state.t("syncConflictDiscardAllBtn")) + '</button>' : "",
          '  </div>',
          '</div>'
        ].join("\n");
      };

      var renderedCleanup = lastCleanupAlert;
      if (renderedCleanup && cleanupRetryStatus(renderedCleanup) === "changed") renderedCleanup.stale = true;
      var alertBannerHtml = renderedCleanup
        ? [
            '<div id="settingsCleanupAlert" class="dialog-error" role="alert" style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;">',
            '  <span>' + esc(renderedCleanup.stale ? cleanupRetryWarning("changed") : formatCleanupFailureMessage(renderedCleanup.actionKind, renderedCleanup.res)) + '</span>',
            renderedCleanup.stale ? "" : ('  <button type="button" class="secondary" id="retryCleanupBtn">' + esc(txt("Retry local cleanup", "إعادة محاولة المسح المحلي")) + '</button>'),
            '</div>',
          ].join("")
        : "";

      container.innerHTML = [
        '<section class="hub-panel">',
        '  <div class="breadcrumbs">',
        '    <button type="button" id="setBackHub">' + esc(state.t("backCourses")) + '</button>',
        '    <span>/</span>',
        '    <span>' + esc(state.t("settingsProfile")) + '</span>',
        '  </div>',
        '  <h1 style="margin:0;font-size:1.35rem;">' + esc(state.t("settingsProfile")) + '</h1>',
           alertBannerHtml,
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
                 profile.guest ? [
                   '<button type="button" class="primary" id="upgradeAccBtn">' + esc(state.t("protectNudgeAction")) + '</button>',
                   '<button type="button" class="secondary" id="leaveBrowserBtn">' + esc(txt("Leave this browser", "الخروج من المتصفح ده")) + '</button>'
                 ].join("\n") : '<button type="button" class="secondary" id="signOutBtn">' + esc(txt("Sign Out", "تسجيل الخروج")) + '</button>',
               '</div>',
               '<form id="renameForm" class="inline" style="margin-top:6px;">',
               '  <input type="text" id="renameInput" value="' + esc(profile.username) + '" minlength="3" maxlength="24" placeholder="' + esc(txt("New username", "الاسم الجديد")) + '">',
               '  <button type="submit" class="secondary">' + esc(txt("Save Username", "حفظ الاسم")) + '</button>',
               '</form>',
               '<details style="margin-top:6px;">',
               '  <summary style="cursor:pointer;color:var(--danger);font-size:0.86rem;">' + esc(txt("Danger Zone: Delete Account", "منطقة الخطر: حذف الحساب")) + '</summary>',
               '  <form id="deleteAccForm" class="inline" style="margin-top:8px;">',
                    profile.guest
                      ? '<input type="text" id="delAccUsername" required autocomplete="off" placeholder="' + esc(txt("Type username: " + profile.username, "اكتب اسمك للتأكيد: " + profile.username)) + '">'
                      : '<input type="password" id="delAccPass" required placeholder="' + esc(txt("Confirm password", "أكّد كلمة السر")) + '">',
               '    <button type="submit" class="secondary" style="color:var(--danger);border-color:var(--danger-border);">' + esc(txt("Delete Permanently", "حذف نهائي")) + '</button>',
               '  </form>',
               '</details>'
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
        '    <p class="question-meta" id="settingsSyncStatus" style="margin:2px 0 8px;' + (hasSyncErr ? "color:var(--danger, #c43);" : "") + '">' + esc(syncSummaryText) + '</p>',
             renderUnresolvedCard(),
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

      function renderedOwnership(allowMissing, afterInvalidation) {
        if (!afterInvalidation && renderedGen !== state.getAuthGeneration()) return "changed";
        return state.getCleanupAuthOwnership(
          (renderedAuth && renderedAuth.token) || "",
          (renderedAuth && renderedAuth.profile && renderedAuth.profile.studentId) || "",
          allowMissing
        );
      }

      function rejectChangedSession(allowMissing, afterInvalidation) {
        if (renderedOwnership(allowMissing, afterInvalidation) !== "changed") return false;
        showToast(cleanupRetryWarning("changed"), { durationMs: 7000 });
        return true;
      }

      function clearRenderedSession(clearOpts, afterInvalidation) {
        var ownership = renderedOwnership(afterInvalidation, afterInvalidation);
        if (ownership === "changed") {
          showToast(cleanupRetryWarning(ownership), { durationMs: 7000 });
          return null;
        }
        if (ownership === "unverified") {
          return {
            study: { ok: false },
            auth: Object.assign({ ok: false, verified: false, authCleanupFailed: true }, state.getAuthStorageStatus(), { ok: false }),
          };
        }
        return {
          study: state.clearPersonalDataFromDevice(clearOpts),
          auth: ownership === "current" ? state.setAuth(null) : { ok: true, verified: true },
        };
      }

      function verifyAuthClearedResult(authRes) {
        if (authRes && typeof authRes === "object" && "ok" in authRes) {
          return authRes;
        }
        var status = typeof state.getAuthStorageStatus === "function" ? state.getAuthStorageStatus() : null;
        if (status && status.ok && !status.present) {
          return { ok: true, removed: true, verified: true, authCleanupFailed: false, code: "", error: "", failedKeys: [] };
        }
        return {
          ok: false,
          removed: false,
          verified: false,
          authCleanupFailed: true,
          code: (status && status.code) || "STORAGE_VERIFY_FAILED",
          error: (status && status.error) || "Authentication storage could not be verified cleared.",
          failedKeys: (status && status.failedKeys) || [],
        };
      }

      function finishCleanupOutcome(actionKind, clearRes, authRes, successEn, successAr, meta) {
        var m = meta || {};
        var authExpectedCleared = actionKind === "sign_out" || actionKind === "leave_browser" || actionKind === "delete_account" || Boolean(m.clearAuth);
        var normalizedAuthRes = authExpectedCleared
          ? verifyAuthClearedResult(authRes)
          : (authRes && typeof authRes === "object" ? authRes : { ok: true, skipped: true, verified: true });
        var clearFailed = Boolean(clearRes && clearRes.ok === false);
        var authFailed = Boolean(normalizedAuthRes && normalizedAuthRes.ok === false) ||
          (authExpectedCleared && normalizedAuthRes.verified === false);
        if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
        if (clearFailed || authFailed) {
          var errSource = clearFailed ? clearRes : normalizedAuthRes;
          var combinedFailedKeys = []
            .concat((clearRes && Array.isArray(clearRes.failedKeys)) ? clearRes.failedKeys : [])
            .concat((normalizedAuthRes && Array.isArray(normalizedAuthRes.failedKeys)) ? normalizedAuthRes.failedKeys : []);
          var errRes = {
            ok: false,
            code: (errSource && errSource.code) || (authFailed ? "STORAGE_VERIFY_FAILED" : "STORAGE_WRITE_FAILED"),
            error: (errSource && errSource.error) || "Local browser data remained or could not be verified cleared.",
            authCleanupFailed: authFailed,
            recoveryCleanupFailed: Boolean(clearRes && clearRes.recoveryPurge && clearRes.recoveryPurge.ok === false),
            stateCleanupFailed: Boolean(clearRes && clearRes.stateCleared === false),
            failedKeys: combinedFailedKeys,
            serverRevoked: m.serverRevoked !== undefined ? Boolean(m.serverRevoked) : undefined,
            serverAttempted: m.serverAttempted !== undefined ? Boolean(m.serverAttempted) : undefined,
          };
          lastCleanupAlert = {
            actionKind: actionKind,
            res: errRes,
            clearOpts: m.clearOpts && m.clearOpts.purgeRecoveryForOwner === m.ownerSid && m.ownerSid
              ? { purgeRecoveryForOwner: m.ownerSid } : undefined,
            clearAuth: authExpectedCleared,
            ownerSid: m.ownerSid || "",
            token: m.token || (renderedAuth && renderedAuth.token) || "",
            generation: state.getAuthGeneration(),
            retryStudyData: clearFailed,
            studySnapshot: clearFailed ? state.getCleanupStudySnapshot(m.ownerSid) : null,
            serverRevoked: Boolean(m.serverRevoked),
            serverAttempted: Boolean(m.serverAttempted),
            successEn: successEn,
            successAr: successAr,
          };
          showToast(formatCleanupFailureMessage(actionKind, errRes), { durationMs: 7000 });
          paint();
          return false;
        }
        lastCleanupAlert = null;
        showToast(txt(successEn, successAr));
        paint();
        return true;
      }

      var retryCleanupBtn = container.querySelector("#retryCleanupBtn");
      async function retryCleanup() {
        var started = false;
        try {
          await state.withAccountStorageLock(function () {
            started = true;
            retryCleanupUnderLock();
          }, true);
        } catch (error) {
          if (started) throw error;
        }
        if (!started) showToast(cleanupRetryWarning("no_lock"), { durationMs: 7000 });
      }

      function retryCleanupUnderLock() {
        var pending = renderedCleanup;
        var status = pending === lastCleanupAlert && pending &&
          retryCleanupBtn === container.querySelector("#retryCleanupBtn")
          ? cleanupRetryStatus(pending) : "changed";
        if (status === "changed" || status === "unverified") {
          showToast(cleanupRetryWarning(status), { durationMs: 7000 });
          if (status === "changed" && pending && pending === lastCleanupAlert && !pending.stale &&
              retryCleanupBtn === container.querySelector("#retryCleanupBtn")) {
            pending.stale = true;
            paint();
          }
          return;
        }
        var retryClearRes = pending.retryStudyData
          ? state.clearPersonalDataFromDevice(pending.clearOpts) : { ok: true };
        var retryAuthRes = pending.clearAuth && status === "current"
          ? state.setAuth(null) : { ok: true, verified: true };
        finishCleanupOutcome(pending.actionKind, retryClearRes, retryAuthRes, pending.successEn, pending.successAr, pending);
      }

      if (retryCleanupBtn && renderedCleanup && !renderedCleanup.stale) {
        retryCleanupBtn.addEventListener("click", retryCleanup);
      }

      var leaveBrowserBtn = container.querySelector("#leaveBrowserBtn");
      if (leaveBrowserBtn && profile && profile.guest) {
        leaveBrowserBtn.addEventListener("click", async function () {
          if (renderedCleanup && !renderedCleanup.stale && renderedCleanup.actionKind === "leave_browser") {
            await retryCleanup();
            return;
          }
          var okLeave = root.ElgoShell && typeof root.ElgoShell.confirmAction === "function"
            ? await root.ElgoShell.confirmAction({
                title: txt("Leave this browser?", "الخروج من المتصفح ده؟"),
                message: txt(
                  "Without a password, \"" + profile.username + "\" and its saved progress cannot be opened again from any browser, the username stays reserved, and any unsynced changes on this device will be lost. Type your exact username below to leave this browser.",
                  "من غير كلمة سر، مش هتقدر تفتح «" + profile.username + "» أو تقدمه تاني من أي متصفح، والاسم هيفضل محجوز، وأي تغييرات لسه متزامنتش على الجهاز ده هتضيع. اكتب اسمك بالظبط تحت علشان تأكد الخروج."
                ),
                requireTypedMatch: profile.username,
                typedLabel: txt("Type your username to confirm:", "اكتب اسم المستخدم للتأكيد:"),
                typedPlaceholder: profile.username,
                confirmLabel: txt("Leave this browser", "الخروج من المتصفح ده"),
                cancelLabel: txt("Cancel", "إلغاء"),
                danger: true,
              })
            : false;
          if (!okLeave) return;
          leaveBrowserBtn.disabled = true;
          try {
            if (rejectChangedSession()) return;
            var leaveAuth = renderedAuth;
            var leaveToken = leaveAuth && leaveAuth.token ? leaveAuth.token : "";
            var leaveSid = (leaveAuth && leaveAuth.profile && leaveAuth.profile.studentId)
              || state.getState().ownerStudentId
              || "";
            var leaveClearOpts = leaveSid ? { purgeRecoveryForOwner: leaveSid } : undefined;
            var leaveServerAttempted = Boolean(leaveToken);
            var leaveServerRevoked = false;
            if (typeof state.syncProgressToCloud === "function") {
              var syncBeforeLeave = await state.syncProgressToCloud({ force: true }).catch(function () { return null; });
              if (syncBeforeLeave && syncBeforeLeave.unauthorized) {
                if (rejectChangedSession(true, true)) return;
                if (typeof state.consumeSessionInvalidationNotice === "function") state.consumeSessionInvalidationNotice();
                var cleanup = clearRenderedSession(leaveClearOpts, true);
                if (!cleanup) return;
                finishCleanupOutcome("leave_browser", cleanup.study, cleanup.auth, "Left this browser.", "تم الخروج من المتصفح.", {
                  clearOpts: leaveClearOpts,
                  ownerSid: leaveSid,
                  serverRevoked: true,
                  serverAttempted: true,
                });
                return;
              }
            }
            if (leaveToken) {
              var leaveLogoutRes = await fetch("/api/auth/logout", { method: "POST", headers: state.authHeaders({}, leaveToken) }).catch(function () { return null; });
              leaveServerRevoked = Boolean(leaveLogoutRes && (leaveLogoutRes.ok || leaveLogoutRes.status === 401));
            }
            var cleanup = clearRenderedSession(leaveClearOpts);
            if (!cleanup) return;
            finishCleanupOutcome("leave_browser", cleanup.study, cleanup.auth, "Left this browser.", "تم الخروج من المتصفح.", {
              clearOpts: leaveClearOpts,
              ownerSid: leaveSid,
              serverRevoked: leaveServerRevoked,
              serverAttempted: leaveServerAttempted,
            });
          } finally {
            if (leaveBrowserBtn.isConnected !== false) leaveBrowserBtn.disabled = false;
          }
        });
      }

      var signOutBtn = container.querySelector("#signOutBtn");
      if (signOutBtn) {
        signOutBtn.addEventListener("click", async function () {
          signOutBtn.disabled = true;
          try {
            if (renderedCleanup && !renderedCleanup.stale && renderedCleanup.actionKind === "sign_out") {
              await retryCleanup();
              return;
            }
            if (rejectChangedSession()) return;
            var outAuth = renderedAuth;
            var outToken = outAuth && outAuth.token ? outAuth.token : "";
            var outOwnerSid = (outAuth && outAuth.profile && outAuth.profile.studentId)
              || state.getState().ownerStudentId
              || "";
            if (typeof state.syncProgressToCloud === "function") {
              var syncBeforeOut = await state.syncProgressToCloud({ force: true }).catch(function () { return null; });
              if (syncBeforeOut && syncBeforeOut.unauthorized) {
                if (rejectChangedSession(true, true)) return;
                var invNotice = typeof state.consumeSessionInvalidationNotice === "function" ? state.consumeSessionInvalidationNotice() : null;
                var invClearRes = typeof state.getLastClearDeviceResult === "function" ? state.getLastClearDeviceResult() : null;
                var invAuthRes = typeof state.getLastAuthClearResult === "function" ? state.getLastAuthClearResult() : null;
                if (invNotice && invNotice.stashed === false) {
                  var recErr = typeof state.consumeRecoveryError === "function" ? state.consumeRecoveryError() : null;
                  invClearRes = Object.assign({ ok: false, code: (recErr && recErr.code) || "RECOVERY_FAILED", error: invNotice.message }, recErr || {});
                }
                finishCleanupOutcome("sign_out", invClearRes || { ok: true }, invAuthRes, "Signed out.", "تم تسجيل الخروج.", {
                  ownerSid: outOwnerSid,
                  serverRevoked: true,
                  serverAttempted: true,
                });
                return;
              }
            }
            if (rejectChangedSession()) return;
            var outClearOpts;
            if (renderedOwnership() === "current") {
              var outSt = state.getState();
              var outUnres = typeof state.getUnresolvedMutations === "function" ? state.getUnresolvedMutations() : { items: [] };
              var outUnresCount = (outUnres && Array.isArray(outUnres.items)) ? outUnres.items.length : 0;
              var outPending = Boolean(outSt && outSt.pendingProgressSync);
              var hasWorkToSave = outPending || outUnresCount > 0;
              var keepRecoveryOnSignOut = true;
              if (hasWorkToSave) {
                var signOutConfirmOpts = {
                  title: txt("Unsynced changes on this device", "تغييرات لسه متزامنتش على الجهاز ده"),
                  message: outUnresCount > 0 && !outPending
                    ? txt(
                        "You have " + outUnresCount + " unresolved conflict or offline change(s) on this device. Signing out hides this work from other accounts. A 7-day local recovery copy can be stored in this browser (unencrypted and accessible to anyone using this browser profile).",
                        "عندك " + outUnresCount + " تغيير متعارض أو لسه ماتحلش على الجهاز ده. تسجيل الخروج بيخفي الشغل ده عن الحسابات التانية. ممكن تحفظ نسخة استرداد محلية لمدة ٧ أيام في المتصفح ده (غير مشفرة ويقدر يقرأها أي حد بيستخدم نفس البروفايل)."
                      )
                    : txt(
                        "Your latest changes could not sync to the cloud right now. Signing out clears active study data from view. A 7-day local recovery copy can be stored in this browser (unencrypted and accessible to anyone using this browser profile).",
                        "آخر تغييراتك مقدرتش تتزامن مع السحابة دلوقتي. تسجيل الخروج بيشيل البيانات النشطة من العرض. ممكن تحفظ نسخة استرداد محلية لمدة ٧ أيام في المتصفح ده (غير مشفرة ويقدر يقرأها أي حد بيستخدم نفس البروفايل)."
                      ),
                  checkboxLabel: txt(
                    "Keep 7-day local recovery copy in this browser (unencrypted; uncheck on shared computers)",
                    "احتفظ بنسخة استرداد محلية لمدة ٧ أيام في المتصفح ده (غير مشفرة؛ الغي الاختيار على الأجهزة المشتركة)"
                  ),
                  checkboxDefaultChecked: true,
                  confirmLabel: txt("Sign Out", "تسجيل الخروج"),
                  cancelLabel: txt("Cancel", "إلغاء"),
                  danger: true,
                };
                var okSignOut = root.ElgoShell && typeof root.ElgoShell.confirmAction === "function"
                  ? await root.ElgoShell.confirmAction(signOutConfirmOpts)
                  : false;
                if (!okSignOut) return;
                if (signOutConfirmOpts.checkboxChecked === false) {
                  keepRecoveryOnSignOut = false;
                }
              }
              if (rejectChangedSession()) return;
              var stashRes = null;
              if (hasWorkToSave && keepRecoveryOnSignOut && renderedOwnership() === "current") {
                if (!outOwnerSid || typeof state.stashUnresolvedForAccount !== "function") {
                  stashRes = { ok: false, error: txt("Local recovery storage is unavailable.", "تخزين الاسترداد المحلي غير متاح.") };
                } else {
                  stashRes = state.stashUnresolvedForAccount(outOwnerSid, state.getState());
                }
                if (!stashRes || !stashRes.ok) {
                  var okDiscardOnSignOut = root.ElgoShell && typeof root.ElgoShell.confirmAction === "function"
                    ? await root.ElgoShell.confirmAction({
                        title: txt("Could not save local recovery copy", "تعذر حفظ نسخة الاسترداد المحلية"),
                        message: txt(
                          "Failed to save a separate recovery copy (" + ((stashRes && stashRes.error) || "storage failure") + "). If you sign out now, these unsynced changes on this device will be permanently discarded. Stay signed in to protect them or export your data first.",
                          "تعذر حفظ نسخة استرداد منفصلة (" + ((stashRes && stashRes.error) || "خطأ في التخزين") + "). لو سجلت خروج دلوقتي التغييرات اللي متزامنتش على الجهاز ده هتتمسح نهائياً. خليك مسجل دخول علشان تحافظ عليها أو صدّر بياناتك الأول."
                        ),
                        confirmLabel: txt("Discard unsynced changes & Sign Out", "مسح التغييرات غير المتزامنة وتسجيل الخروج"),
                        cancelLabel: txt("Stay signed in", "الرجوع والبقاء مسجلاً"),
                        danger: true,
                      })
                    : false;
                  if (!okDiscardOnSignOut) return;
                  if (rejectChangedSession()) return;
                }
              }
              outClearOpts = keepRecoveryOnSignOut
                ? undefined
                : (outOwnerSid ? { purgeRecoveryForOwner: outOwnerSid } : undefined);
            }
            var logoutServerAttempted = Boolean(outToken);
            var logoutServerRevoked = false;
            if (outToken) {
              var logoutRes = await fetch("/api/auth/logout", { method: "POST", headers: state.authHeaders({}, outToken) }).catch(function () { return null; });
              logoutServerRevoked = Boolean(logoutRes && (logoutRes.ok || logoutRes.status === 401));
            }
            var cleanup = clearRenderedSession(outClearOpts);
            if (!cleanup) return;
            finishCleanupOutcome("sign_out", cleanup.study, cleanup.auth, "Signed out.", "تم تسجيل الخروج.", {
              clearOpts: outClearOpts,
              ownerSid: outOwnerSid,
              serverRevoked: logoutServerRevoked,
              serverAttempted: logoutServerAttempted,
            });
          } finally {
            if (signOutBtn.isConnected !== false) signOutBtn.disabled = false;
          }
        });
      }

      var renameForm = container.querySelector("#renameForm");
      if (renameForm) {
        renameForm.addEventListener("submit", async function (e) {
          e.preventDefault();
          var rAuth = state.getAuth();
          var rToken = rAuth && rAuth.token ? rAuth.token : "";
          var rGen = typeof state.getAuthGeneration === "function" ? state.getAuthGeneration() : null;
          var nextName = container.querySelector("#renameInput").value.trim();
          var res = await fetch("/api/user/profile", {
            method: "POST",
            headers: state.authHeaders({ "Content-Type": "application/json" }, rToken),
            body: JSON.stringify({ username: nextName }),
          });
          var data = await res.json().catch(function () { return null; });
          if (rGen != null && typeof state.getAuthGeneration === "function" && state.getAuthGeneration() !== rGen) return;
          if (res.ok && data && data.ok && data.profile) {
            var cur = state.getAuth();
            if (!cur || cur.token !== rToken) return;
            state.setAuth(Object.assign({}, cur, { profile: Object.assign({}, cur && cur.profile, data.profile) }));
            var stRename = state.getState();
            if (stRename && stRename.ownerStudentId && data.profile.username) {
              stRename.ownerUsername = data.profile.username;
              state.saveState(stRename);
            }
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
          if (rejectChangedSession()) return;
          var dAuth = renderedAuth;
          var dToken = dAuth && dAuth.token ? dAuth.token : "";
          var dSid = (dAuth && dAuth.profile && dAuth.profile.studentId) || state.getState().ownerStudentId || "";
          var passInput = container.querySelector("#delAccPass");
          var unameInput = container.querySelector("#delAccUsername");
          var bodyPayload = passInput
            ? { password: passInput.value }
            : { confirmUsername: unameInput ? unameInput.value.trim() : "" };
          var res = await fetch("/api/user/profile", {
            method: "DELETE",
            headers: state.authHeaders({ "Content-Type": "application/json" }, dToken),
            body: JSON.stringify(bodyPayload),
          });
          var data = await res.json().catch(function () { return null; });
          if (res.ok && data && data.ok) {
            var delClearOpts = dSid ? { purgeRecoveryForOwner: dSid } : undefined;
            var cleanup = clearRenderedSession(delClearOpts);
            if (!cleanup) return;
            finishCleanupOutcome("delete_account", cleanup.study, cleanup.auth, "Account deleted.", "تم حذف الحساب.", {
              clearOpts: delClearOpts,
              ownerSid: dSid,
              serverRevoked: true,
              serverAttempted: true,
            });
          } else {
            showToast((data && data.error) || txt(passInput ? "Incorrect password." : "Username did not match.", passInput ? "كلمة السر غير صحيحة." : "اسم المستخدم غير مطابق."));
          }
        });
      }

      var refreshAppBtn = container.querySelector("#refreshAppSyncBtn");
      if (refreshAppBtn) {
        refreshAppBtn.addEventListener("click", async function () {
          refreshAppBtn.disabled = true;
          try {
            if (typeof navigator !== "undefined" && navigator.serviceWorker && typeof navigator.serviceWorker.getRegistration === "function") {
              var reg = await navigator.serviceWorker.getRegistration().catch(function () { return null; });
              if (reg && typeof reg.update === "function") await reg.update().catch(function () {});
              if (reg && reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
            }
          } finally {
            if (typeof window !== "undefined" && window.location && typeof window.location.reload === "function") {
              window.location.reload();
            }
          }
        });
      }
      var applyAllBtn = container.querySelector("#applyAllUnresolvedBtn");
      if (applyAllBtn && typeof state.resolveUnresolvedMutations === "function") {
        applyAllBtn.addEventListener("click", async function () {
          applyAllBtn.disabled = true;
          try {
            var r = await state.resolveUnresolvedMutations("apply_all");
            if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
            paint();
            if (r && !r.ok && r.error) showToast(r.error);
          } finally {
            if (applyAllBtn.isConnected !== false) applyAllBtn.disabled = false;
          }
        });
      }
      var discardAllBtn = container.querySelector("#discardAllUnresolvedBtn");
      if (discardAllBtn && typeof state.resolveUnresolvedMutations === "function") {
        discardAllBtn.addEventListener("click", async function () {
          discardAllBtn.disabled = true;
          try {
            await state.resolveUnresolvedMutations("discard_all");
            if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
            paint();
          } finally {
            if (discardAllBtn.isConnected !== false) discardAllBtn.disabled = false;
          }
        });
      }
      container.querySelectorAll("[data-unres-apply]").forEach(function (btn) {
        btn.addEventListener("click", async function () {
          btn.disabled = true;
          var eid = btn.getAttribute("data-unres-apply");
          try {
            var r = typeof state.resolveUnresolvedMutations === "function" ? await state.resolveUnresolvedMutations("apply_one", eid) : null;
            if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
            paint();
            if (r && !r.ok && r.error) showToast(r.error);
          } finally {
            if (btn.isConnected !== false) btn.disabled = false;
          }
        });
      });
      container.querySelectorAll("[data-unres-discard]").forEach(function (btn) {
        btn.addEventListener("click", async function () {
          btn.disabled = true;
          var eid = btn.getAttribute("data-unres-discard");
          try {
            if (typeof state.resolveUnresolvedMutations === "function") {
              await state.resolveUnresolvedMutations("discard_one", eid);
            }
            if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
            paint();
          } finally {
            if (btn.isConnected !== false) btn.disabled = false;
          }
        });
      });

      container.querySelector("#syncPendingBtn").addEventListener("click", async function () {
        var btn = container.querySelector("#syncPendingBtn");
        if (btn) btn.disabled = true;
        try {
          if (state.getAuth() && typeof state.syncNow === "function") {
            var syncRes = await state.syncNow();
            if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
            paint();
            if (!syncRes || !syncRes.ok) {
              showToast((syncRes && syncRes.error) || txt("Could not sync bookmarks & mistakes.", "تعذرت مزامنة المحفوظات والأخطاء."));
              return;
            }
            showToast(txt(
              "Synced " + (syncRes.attemptsSynced || 0) + " attempt(s) · " + (syncRes.bookmarksCount || 0) + " saved · " + (syncRes.mistakesCount || 0) + " mistakes.",
              "تمت المزامنة: " + (syncRes.attemptsSynced || 0) + " محاولة · " + (syncRes.bookmarksCount || 0) + " محفوظ · " + (syncRes.mistakesCount || 0) + " أخطاء."
            ));
            return;
          }
          var out = await state.syncPendingAttempts();
          if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
          paint();
          showToast(txt("Synced " + (out.synced || 0) + " pending attempt(s).", "تمت مزامنة " + (out.synced || 0) + " محاولة معلقة."));
        } finally {
          if (btn && btn.isConnected !== false) btn.disabled = false;
        }
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

      container.querySelector("#resetLocalBtn").addEventListener("click", async function () {
        if (renderedCleanup && !renderedCleanup.stale && renderedCleanup.clearAuth) {
          await retryCleanup();
          return;
        }
        var resetAuth = renderedAuth;
        var signedInNow = Boolean(resetAuth);
        var resetSid = (resetAuth && resetAuth.profile && resetAuth.profile.studentId)
          || state.getState().ownerStudentId || "";
        var hasUnsyncedLocal = typeof state.hasPendingOrUnresolvedWork === "function"
          ? state.hasPendingOrUnresolvedWork()
          : Boolean(state.getState().pendingProgressSync);
        var resetMsg = signedInNow
          ? (hasUnsyncedLocal
              ? txt(
                  "You have unsynced or unresolved changes on this device that are not saved to the cloud yet. Removing device data will permanently delete those unsynced changes and any saved local recovery copies from this browser. Your account stays signed in and your previously synced cloud copy is kept.",
                  "عندك تغييرات غير متزامنة أو غير محلولة على الجهاز ده ولسه ماتحفظتش على السحابة. مسح البيانات من الجهاز هيمسح التغييرات دي وأي نسخ استرداد محلية نهائياً من المتصفح ده. حسابك هيفضل مسجل ونسختك السحابية المتزامنة محفوظة."
                )
              : txt(
                  "This removes saved questions, mistakes, unresolved conflicts, and saved local recovery copies from this browser. Your account stays signed in and your cloud copy is kept.",
                  "ده هيمسح الأسئلة المحفوظة والأخطاء والتعارضات غير المحلولة ونسخ الاسترداد المحلية من المتصفح ده. حسابك هيفضل مسجل ونسختك السحابية هتفضل محفوظة."
                ))
          : txt(
              "This permanently removes all saved questions, mistakes, quiz history, and any saved local recovery copies from this device. There is no cloud backup.",
              "ده هيمسح كل الأسئلة المحفوظة والأخطاء وسجل الحل وأي نسخ استرداد محلية نهائياً من الجهاز ده، ومفيش نسخة سحابية."
            );
        var okClear = root.ElgoShell && typeof root.ElgoShell.confirmAction === "function"
          ? await root.ElgoShell.confirmAction({
              title: state.t("clearLocalBtn"),
              message: resetMsg,
              confirmLabel: state.t("clearLocalBtn"),
              cancelLabel: txt("Cancel", "إلغاء"),
              danger: true,
            })
          : false;
        if (!okClear) return;
        var ownership = renderedOwnership(!resetAuth);
        if (ownership === "changed" || (!resetAuth && ownership !== "absent")) {
          showToast(cleanupRetryWarning(ownership === "absent" ? "changed" : ownership), { durationMs: 7000 });
          return;
        }
        var clearOpts = resetSid ? { purgeRecoveryForOwner: resetSid } : { purgeAllRecovery: true };
        var resetClearRes = ownership === "unverified" ? { ok: false } : state.clearPersonalDataFromDevice(clearOpts);
        var resetAuthRes = ownership === "unverified"
          ? Object.assign({}, state.getAuthStorageStatus(), { ok: false, authCleanupFailed: true })
          : { ok: true, verified: true };
        finishCleanupOutcome(
          "clear_local", resetClearRes, resetAuthRes,
          signedInNow ? "Study data removed from this device. Your cloud copy is kept." : "Local study data removed from this device.",
          signedInNow ? "اتمسحت بيانات المذاكرة من الجهاز ده. نسختك على السحابة محفوظة." : "اتمسحت بيانات المذاكرة المحلية من الجهاز ده.",
          { clearOpts: clearOpts, ownerSid: resetSid }
        );
      });
    }

    paint();
  }

  async function render(arg1, arg2, params) {
    var panelName = typeof arg1 === "string" ? arg1 : arg2;
    var container = typeof arg1 === "string" ? arg2 : arg1;
    if (!container) return;
    if (panelName !== "settings") lastCleanupAlert = null;
    if (panelName === "saved") return renderSavedPanel(container);
    if (panelName === "mistakes") return renderMistakesPanel(container);
    if (panelName === "leaderboard") return renderLeaderboardPanel(container, params);
    if (panelName === "settings") return renderSettingsPanel(container);
  }

  root.ElgoPanels = {
    render: render,
    arCountPhrase: arCountPhrase,
    enCountPhrase: enCountPhrase,
  };
})(typeof window !== "undefined" ? window : globalThis);
