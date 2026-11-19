(function (root) {
  "use strict";

  var activeSession = null;
  var timerHandle = null;
  var reportDialog = null;
  var finishDialog = null;
  var imageLightbox = null;
  var shortcutsBound = false;
  var reviewState = new WeakMap();

  function getQuestionImages(q) {
    var Model = root.ElgoModel;
    if (Model && typeof Model.getQuestionImages === "function") {
      return Model.getQuestionImages(q);
    }
    return q && q.image ? [{ url: String(q.image) }] : [];
  }

  function renderQuestionImagesHtml(q, opts) {
    var imgs = getQuestionImages(q);
    if (!imgs.length) return "";
    var o = opts || {};
    var gridCls = "question-images-grid" +
      (imgs.length === 1 && !o.compact ? " is-single" : "") +
      (o.compact ? " is-compact" : "");
    var itemsHtml = imgs.map(function (img, idx) {
      var alt = img.alt || ("Question diagram " + (idx + 1));
      var cap = img.caption ? ('<figcaption class="question-image-caption">' + esc(img.caption) + '</figcaption>') : "";
      return [
        '<figure class="question-image-wrap">',
        '  <button type="button" class="question-image-btn" data-zoom-img="' + esc(img.url) + '" data-zoom-alt="' + esc(alt) + '" data-zoom-cap="' + esc(img.caption || "") + '" title="' + esc(txt("Click to enlarge image", "اضغط لتكبير الصورة")) + '">',
        '    <img src="' + esc(img.url) + '" alt="' + esc(alt) + '" loading="lazy">',
        '  </button>',
             cap,
        '</figure>'
      ].join("\n");
    }).join("\n");
    return '<div class="' + gridCls + '">' + itemsHtml + '</div>';
  }

  function openImageLightbox(url, alt, caption) {
    if (!url || typeof document === "undefined") return;
    if (!imageLightbox) {
      imageLightbox = document.createElement("dialog");
      imageLightbox.id = "elgoImageLightbox";
      imageLightbox.className = "image-lightbox-dialog";
      imageLightbox.addEventListener("click", function (e) {
        if (e.target === imageLightbox) imageLightbox.close();
      });
      document.body.appendChild(imageLightbox);
    }
    imageLightbox.innerHTML = [
      '<div class="dialog-head" style="margin-bottom:8px;">',
      '  <strong>' + esc(alt || txt("Question Diagram", "صورة السؤال")) + '</strong>',
      '  <button type="button" class="quiet" id="lbZoomCloseBtn" aria-label="Close">✕</button>',
      '</div>',
      '<div class="image-lightbox-body">',
      '  <img src="' + esc(url) + '" alt="' + esc(alt || "Question diagram") + '">',
         caption ? ('  <p class="question-image-caption" style="margin:0;">' + esc(caption) + '</p>') : '',
      '</div>'
    ].join("\n");
    imageLightbox.querySelector("#lbZoomCloseBtn").addEventListener("click", function () {
      imageLightbox.close();
    });
    if (!imageLightbox.open && typeof imageLightbox.showModal === "function") {
      imageLightbox.showModal();
    }
  }

  function bindImageZoomButtons(scope) {
    if (!scope) return;
    scope.querySelectorAll("[data-zoom-img]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openImageLightbox(
          btn.getAttribute("data-zoom-img"),
          btn.getAttribute("data-zoom-alt"),
          btn.getAttribute("data-zoom-cap")
        );
      });
    });
  }

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatStem(raw) {
    var safe = esc(raw || "");
    safe = safe.replace(/`([^`]+)`/g, "<code>$1</code>");
    safe = safe.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    return safe.replace(/\n/g, "<br>");
  }

  function formatSafeRichText(raw) {
    var safe = formatStem(raw);
    return safe.replace(/&lt;(\/?(?:strong|em|br|sup|sub|code))\s*\/?&gt;/gi, "<$1>");
  }

  function isAr() {
    return root.ElgoTheme && typeof root.ElgoTheme.getLang === "function" && root.ElgoTheme.getLang() === "ar";
  }

  function txt(en, ar) {
    return isAr() ? ar : en;
  }

  function formatDuration(ms) {
    var totalSec = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    var mins = Math.floor(totalSec / 60);
    var secs = totalSec % 60;
    return String(mins).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
  }

  function stopTimer() {
    if (timerHandle) {
      clearInterval(timerHandle);
      timerHandle = null;
    }
  }

  function persistActiveSession() {
    var State = root.ElgoState;
    if (!State || !activeSession) return;
    var st = State.getState();
    st.activeSession = activeSession.completed ? null : activeSession;
    State.saveState(st);
  }

  function presentExplanation(q, chosenId, subjectId) {
    var enriched = q;
    var core = root.BankQuestionCore;
    var presenter = (root.ElgoExplanations && typeof root.ElgoExplanations.present === "function")
      ? root.ElgoExplanations
      : (core && core.ExplanationPresenter && typeof core.ExplanationPresenter.present === "function"
        ? core.ExplanationPresenter
        : null);
    var hasKey = Boolean(q && q.correctOptionId);
    var isRight = Boolean(hasKey && chosenId && chosenId === q.correctOptionId);
    if (presenter) {
      try {
        var curatedHit = typeof presenter.curated === "function" ? presenter.curated(enriched) : null;
        var res = presenter.present(enriched, enriched, { selectedOptId: chosenId || "", isRight: isRight });
        var rawExp = (res && res.explanation) || "";
        var hasArabic = /[\u0600-\u06FF]/.test(rawExp);
        var enText = "";
        var arText = enriched.explanationArabic || enriched.arabicExplanation || enriched.arabicTranslation || "";
        if (curatedHit) {
          enText = [enriched.academicExplanation, enriched.correctReasoning, enriched.explanation]
            .find(function (t) { return t && (!presenter.generic || !presenter.generic(t)) && !/[\u0600-\u06FF]/.test(t); }) || "";
          if (rawExp && hasArabic) arText = rawExp;
          else if (rawExp && !enText) enText = rawExp;
        } else if (hasArabic) {
          arText = rawExp || arText;
        } else {
          enText = rawExp || enriched.academicExplanation || enriched.correctReasoning || enriched.explanation || "";
        }
        return {
          en: enText,
          ar: arText,
          rule: (res && res.rule) || "",
          trick: enriched.memoryTrick || "",
          mistake: (res && res.mistake) || "",
        };
      } catch (_err) {
        // Fallback directly below
      }
    }
    return {
      en: enriched.academicExplanation || enriched.correctReasoning || enriched.explanation || "",
      ar: enriched.explanationArabic || enriched.arabicExplanation || enriched.arabicTranslation || "",
      rule: enriched.rule || "",
      trick: enriched.memoryTrick || "",
      mistake: (!isRight && chosenId) ? (enriched.wrongAnswerClarification || enriched.whyYouMightErr || "") : "",
    };
  }

  async function requestQuizFeedback(body) {
    var State = root.ElgoState;
    var auth = State.getAuth();
    if (!auth) throw new Error(txt("Sign in to use online quiz feedback.", "سجّل الدخول لعرض إجابات الاختبار."));
    var res = await fetch("/api/quiz/feedback", {
      method: "POST",
      cache: "no-store",
      headers: State.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    var data = await res.json();
    var current = State.getAuth();
    if (!current || current.token !== auth.token) throw new Error(txt("Your account changed.", "تغيّر الحساب."));
    if (!res.ok || !data.ok) throw new Error(data.error || txt("Feedback is unavailable.", "الإجابات غير متاحة."));
    return data;
  }

  function safeFocusNoScroll(el) {
    if (!el || typeof el.focus !== "function") return;
    try {
      el.focus({ preventScroll: true });
    } catch (_err) {
      el.focus();
    }
  }

  function scheduleDeferred(fn) {
    if (typeof setTimeout === "function") setTimeout(fn, 0);
    else fn();
  }

  function getReviewState(session) {
    if (!reviewState.has(session)) reviewState.set(session, { questions: new Map(), ready: false, error: "" });
    return reviewState.get(session);
  }

  function buildOptionState(session, q, opt, chosenId, reviewEntry, hasKey) {
    var selected = chosenId === opt.id;
    var isPending = Boolean(reviewEntry && reviewEntry.pending);
    var isError = Boolean(reviewEntry && reviewEntry.error);
    var isAnswered = Boolean(chosenId);
    var revealAnswer = session.isStudy || (session.mode === "practice" && isAnswered && !isPending && !isError);
    var isRightOpt = hasKey && opt.id === q.correctOptionId;
    var cls = "option-btn";
    var statusLabel = "";

    if (revealAnswer) {
      if (isRightOpt) {
        cls += " is-correct";
        statusLabel = txt("✓ Correct", "✓ صح");
      } else if (selected && hasKey && !isRightOpt) {
        cls += " is-wrong";
        statusLabel = txt("✗ Wrong", "✗ خطأ");
      } else if (selected) {
        cls += " is-selected";
        statusLabel = txt("Selected", "مختارة");
      }
    } else if (selected) {
      cls += " is-selected";
      if (session.mode === "practice" && isPending) {
        cls += " is-checking";
        statusLabel = txt("Checking…", "جاري التحقق…");
      } else {
        statusLabel = txt("Selected", "مختارة");
      }
    }
    return { cls: cls, statusLabel: statusLabel, selected: selected };
  }

  function buildFeedbackSlotHtml(session, q, chosenId, reviewEntry, accessError) {
    var State = root.ElgoState;
    var isPending = Boolean(reviewEntry && reviewEntry.pending);
    var isError = Boolean(reviewEntry && reviewEntry.error);
    var isAnswered = Boolean(chosenId);

    if (session.mode === "test") {
      if (accessError) {
        return '<div class="feedback-card" role="status"><p style="margin:0;">' + esc(accessError) + ' <button type="button" class="quiet" id="retryQuizFeedbackBtn">' + esc(txt("Retry", "حاول مرة أخرى")) + '</button></p></div>';
      }
      return "";
    }

    if (!session.isStudy && !isAnswered) return "";

    if (isPending) {
      return [
        '<div class="feedback-card is-checking" id="qFeedbackBox" role="status" aria-live="polite">',
        '  <div class="feedback-headline feedback-checking-row"><span class="feedback-dot" aria-hidden="true"></span>' + esc(txt("Checking answer…", "جاري التحقق من الإجابة…")) + '</div>',
        '</div>'
      ].join("\n");
    }

    if (isError || accessError) {
      var errMsg = (reviewEntry && reviewEntry.error) || accessError || txt("Could not load feedback.", "تعذر تحميل الشرح.");
      return [
        '<div class="feedback-card" id="qFeedbackBox" role="status">',
        '  <div class="feedback-headline">' + esc(errMsg) + '</div>',
        '  <div><button type="button" class="secondary" id="retryQuizFeedbackBtn">' + esc(txt("Retry", "حاول مرة أخرى")) + '</button></div>',
        '</div>'
      ].join("\n");
    }

    var hasKey = Boolean(q.correctOptionId);
    var exp = presentExplanation(q, chosenId, q.subjectId || session.subjectId);
    var boxCls = session.isStudy || !hasKey ? "" : chosenId === q.correctOptionId ? "is-correct" : "is-wrong";
    var headline = !hasKey
      ? esc(State.t("unkeyedNotice"))
      : session.isStudy
        ? (esc(State.t("studyCheckAnswer")) + ": " + esc(q.correctOptionId))
        : chosenId === q.correctOptionId
          ? ("✓ " + esc(State.t("correct")))
          : ("✗ " + esc(State.t("incorrect")) + " — " + esc(State.t("correctAnswerIs")) + " " + esc(q.correctOptionId));

    return [
      '<div class="feedback-card ' + boxCls + '" id="qFeedbackBox" aria-live="polite">',
      '  <div class="feedback-headline">' + headline + '</div>',
         exp.en ? ('<div>' + formatSafeRichText(exp.en) + '</div>') : '',
         exp.rule ? ('<div class="feedback-rule"><strong>' + esc(State.t("keyRuleLabel")) + ':</strong> ' + formatSafeRichText(exp.rule) + '</div>') : '',
         exp.trick ? ('<div class="feedback-rule"><strong>' + esc(State.t("memoryTrickLabel")) + ':</strong> ' + formatSafeRichText(exp.trick) + '</div>') : '',
         exp.mistake ? [
           '<details class="player-more-detail">',
           '  <summary style="cursor:pointer;font-size:0.86rem;font-weight:700;color:var(--accent-text);">' + esc(State.t("whyMisleadLabel")) + '</summary>',
           '  <div style="margin-top:6px;font-size:0.86rem;color:var(--muted);">' + formatSafeRichText(exp.mistake) + '</div>',
           '</details>'
         ].join("\n") : '',
         exp.ar ? ('<div class="feedback-explanation-ar" dir="rtl" lang="ar">' + formatSafeRichText(exp.ar) + '</div>') : '',
      '</div>'
    ].join("\n");
  }

  function bindFeedbackSlotHandlers(container, session, q) {
    var State = root.ElgoState;
    var access = getReviewState(session);
    var retryFeedback = container.querySelector("#retryQuizFeedbackBtn");
    if (retryFeedback) {
      retryFeedback.addEventListener("click", function () {
        if (!State.getAuth() && root.ElgoShell && root.ElgoShell.openAuthModal) {
          root.ElgoShell.openAuthModal("login");
          return;
        }
        access.pending = false;
        access.error = "";
        access.questions.delete(q.internalId);
        var chosenId = session.answers[q.internalId] || null;
        loadFeedback(container, session, q, chosenId);
        patchQuestionFeedbackInPlace(container, session, q);
      });
    }
  }

  function patchQuestionFeedbackInPlace(container, session, q) {
    if (!container || !container.isConnected || activeSession !== session || session.completed) return;
    var currentQ = session.questions[session.currentIndex];
    if (!currentQ || currentQ.internalId !== q.internalId) return;

    var access = getReviewState(session);
    var review = access.questions.get(q.internalId);
    var accessError = session.mode === "test" ? access.error : review && review.error;
    var waitingForTest = session.mode === "test" && !access.ready;
    var enrichedQ = questionWithFeedback(session, q);
    var chosenId = session.answers[q.internalId] || null;
    var isAnswered = Boolean(chosenId);
    var hasKey = Boolean(enrichedQ.correctOptionId);
    var lockBtn = session.isStudy || waitingForTest || (session.mode === "practice" && isAnswered);

    container.querySelectorAll("#qOptionsList [data-opt-id]").forEach(function (btn) {
      var optId = btn.getAttribute("data-opt-id");
      var optObj = (enrichedQ.options || []).find(function (o) { return o.id === optId; }) || { id: optId };
      var st = buildOptionState(session, enrichedQ, optObj, chosenId, review, hasKey);
      btn.className = st.cls;
      btn.setAttribute("aria-pressed", st.selected ? "true" : "false");
      btn.disabled = Boolean(lockBtn);
      var statusEl = btn.querySelector(".option-status");
      if (st.statusLabel) {
        if (!statusEl) {
          statusEl = document.createElement("span");
          statusEl.className = "option-status";
          btn.appendChild(statusEl);
        }
        statusEl.textContent = st.statusLabel;
      } else if (statusEl) {
        statusEl.remove();
      }
    });

    var finishTop = container.querySelector("#finishQuizTopBtn");
    if (finishTop) finishTop.disabled = Boolean(waitingForTest);
    var finishBottom = container.querySelector("#finishQuizBottomBtn");
    if (finishBottom) finishBottom.disabled = Boolean(waitingForTest);

    var total = session.questions.length;
    var answeredCount = Object.keys(session.answers).length;
    var progress = session.isStudy ? session.currentIndex + 1 : answeredCount;
    var pctDone = total > 0 ? Math.round((progress / total) * 100) : 0;
    var progBar = container.querySelector(".player-progress-bar");
    if (progBar) progBar.setAttribute("aria-valuenow", String(progress));
    var progFill = container.querySelector(".player-progress-fill");
    if (progFill) progFill.style.width = pctDone + "%";
    var mapBtn = container.querySelector("#toggleMapBtn");
    if (mapBtn) mapBtn.textContent = txt("Map", "الخريطة") + " (" + answeredCount + "/" + total + ")";
    var counterEl = container.querySelector(".question-counter");
    if (counterEl && !session.isStudy) {
      var State = root.ElgoState;
      counterEl.textContent = State.t("questionLabel") + " " + (session.currentIndex + 1) + " " + State.t("ofLabel") + " " + total + " · " + State.t("answeredLabel") + " " + answeredCount + "/" + total;
    }

    var dot = container.querySelector('[data-jump-idx="' + session.currentIndex + '"]');
    if (dot) {
      var dCls = "nav-dot is-current";
      if (session.mode === "practice" && chosenId && hasKey) {
        dCls += chosenId === enrichedQ.correctOptionId ? " is-correct" : " is-wrong";
      } else if (chosenId) {
        dCls += " is-answered";
      }
      if (session.flags[q.internalId]) dCls += " is-flagged";
      dot.className = dCls;
    }

    var slot = container.querySelector("#qFeedbackSlot");
    if (slot) {
      slot.innerHTML = buildFeedbackSlotHtml(session, enrichedQ, chosenId, review, accessError);
      bindFeedbackSlotHandlers(container, session, enrichedQ);
    }
  }

  function loadFeedback(container, session, question, chosenId) {
    var state = getReviewState(session);
    var isTest = session.mode === "test";
    if (isTest ? state.ready || state.pending : state.questions.has(question.internalId) || (!session.isStudy && !chosenId)) return;
    if (isTest) state.pending = true;
    else state.questions.set(question.internalId, { pending: true });
    var request = isTest
      ? { action: "start", attemptId: session.attemptId, questionIds: session.questions.map(function (q) { return q.internalId; }) }
      : { action: session.mode, questionId: question.internalId, selectedOptionId: chosenId };
    var updateView = function () {
      if (activeSession === session && !session.completed && container.isConnected &&
          session.questions[session.currentIndex].internalId === question.internalId) {
        patchQuestionFeedbackInPlace(container, session, question);
      }
    };
    var pending = requestQuizFeedback(request).then(function (data) {
      if (activeSession !== session || session.completed) return;
      if (isTest) {
        state.ready = true;
        state.pending = false;
      } else {
        var details = data.feedback[question.internalId];
        state.questions.set(question.internalId, details);
        updateView();
        if (!session.isStudy && details && details.correctOptionId && chosenId !== details.correctOptionId) {
          scheduleDeferred(function () {
            root.ElgoState.recordMistake(Object.assign({}, question, details), chosenId, {
              subjectId: question.subjectId || session.subjectId,
              subjectName: session.subjectName,
              collectionId: question.collectionId || session.collectionId,
            });
            if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
          });
        }
        return;
      }
      updateView();
    }).catch(function (error) {
      if (isTest) {
        state.pending = false;
        state.error = error.message;
      } else {
        state.questions.set(question.internalId, { error: error.message });
      }
      updateView();
    });
    if (!isTest) state.questions.set(question.internalId, { pending: pending });
  }

  function questionWithFeedback(session, question) {
    var details = getReviewState(session).questions.get(question.internalId);
    return details && !details.pending && !details.error ? Object.assign({}, question, details) : question;
  }

  function sanitizeTestSession(session) {
    if (!session || session.mode !== "test" || session.completed) return;
    session.questions = session.questions.map(function (question) {
      var clean = Object.assign({}, question);
      ["correctOptionId", "correctAnswer", "correctAnswerText", "explanation", "explanationArabic", "arabicExplanation",
        "arabicTranslation", "academicExplanation", "correctReasoning", "wrongAnswerClarification", "memoryTrick",
        "rule", "whyYouMightErr", "teachingReview"].forEach(function (key) { delete clean[key]; });
      return clean;
    });
  }

  async function readFinishedTest(session, unranked) {
    if (unranked) {
      await requestQuizFeedback({ action: "finish-unranked", attemptId: session.attemptId, answers: session.answers });
    }
    var review = await requestQuizFeedback({ action: "review", attemptId: session.attemptId });
    session.questions = session.questions.map(function (q) {
      return Object.assign({}, q, review.feedback[q.internalId]);
    });
  }

  async function submitAttemptToServer(session) {
    var State = root.ElgoState;
    var durationMs = Math.max(1000, Date.now() - (session.startedAt || Date.now()));
    if (session.mode === "practice") {
      await Promise.all([...getReviewState(session).questions.values()].map(function (item) { return item.pending; }));
    }
    var questions = (session.questions || []).map(function (q) { return questionWithFeedback(session, q); });

    var keyed = questions.filter(function (q) { return Boolean(q.correctOptionId); });
    var score = keyed.filter(function (q) { return session.answers[q.internalId] === q.correctOptionId; }).length;
    var total = session.mode === "practice"
      ? (questions.filter(function (q) { return q.isGradable || q.correctOptionId; }).length || questions.length)
      : (keyed.length || questions.length);
    var pct = total > 0 ? Math.round((score / total) * 100) : 0;
    var validatedByServer = false;
    var rankStatus = session.isGradableCollection ? "local_only" : "practice_mix";
    var statusMessage = session.isStudy ? "Study session completed." : "Completed locally.";

    if (session.mode === "test" && session.isGradableCollection && State.getAuth() && Object.keys(session.answers).length) {
      try {
        var res = await fetch("/api/quiz/submit", {
          method: "POST",
          headers: State.authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            attemptId: session.attemptId,
            subjectId: session.subjectId,
            quizId: session.collectionId,
            quizTitle: session.title,
            mode: "test",
            durationMs: durationMs,
            answers: session.answers,
          }),
        });
        var data = await res.json().catch(function () { return null; });
        if (res.ok && data && data.ok && data.attempt) {
          score = Number(data.attempt.score);
          total = Number(data.attempt.total);
          pct = Number(data.attempt.percentage);
          validatedByServer = Boolean(data.attempt.validatedByServer);
          rankStatus = data.attempt.rankStatus || (data.attempt.countedInRanking ? "ranked" : "partial");
          statusMessage = data.attempt.countedInRanking
            ? "Verified on server & ranked on Leaderboard."
            : "Submitted to server (partial / unranked check).";
          await readFinishedTest(session, false).catch(function () {
            statusMessage += " " + txt("Answer review is unavailable.", "مراجعة الإجابات غير متاحة.");
          });
        } else {
          throw new Error((data && data.error) || "Could not submit. Try again.");
        }
      } catch (error) {
        throw new Error(error.message || "Could not submit. Try again.");
      }
    } else if (session.mode === "test" && State.getAuth()) {
      await readFinishedTest(session, true);
      keyed = session.questions.filter(function (q) { return Boolean(q.correctOptionId); });
      score = keyed.filter(function (q) { return session.answers[q.internalId] === q.correctOptionId; }).length;
      total = session.questions.length;
      pct = total ? Math.round(score * 100 / total) : 0;
    } else if (session.mode === "test") {
      throw new Error(txt("Sign in to submit your Test.", "سجّل الدخول لتسليم الاختبار."));
    } else if (keyed.length === 0) {
      statusMessage = txt("Completed (unkeyed bank questions are practice-only).", "تمت المراجعة (أسئلة بدون مفتاح إجابة رسمي).");
    }

    var summary = {
      attemptId: session.attemptId,
      subjectId: session.subjectId,
      collectionId: session.collectionId,
      title: session.title,
      mode: session.mode,
      score: score,
      total: total,
      percentage: pct,
      durationMs: durationMs,
      validatedByServer: validatedByServer,
      rankStatus: rankStatus,
      statusMessage: statusMessage,
    };

    if (!session.isStudy) {
      State.recordCompletedAttempt(summary);
    } else {
      persistActiveSession();
    }

    return summary;
  }

  function openReportDialog(question, session) {
    var State = root.ElgoState;
    if (!reportDialog) {
      reportDialog = document.createElement("dialog");
      reportDialog.className = "elgo-dialog";
      reportDialog.id = "questionReportDialog";
      document.body.appendChild(reportDialog);
      reportDialog.addEventListener("click", function (e) { if (e.target === reportDialog) reportDialog.close(); });
    }

    reportDialog.innerHTML = [
      '<form class="dialog-body" id="reportQuestionForm">',
      '  <div class="dialog-head">',
      '    <h2>' + esc(txt("Report Question Issue", "الإبلاغ عن مشكلة في السؤال")) + '</h2>',
      '    <button type="button" class="quiet" data-close-report>✕</button>',
      '  </div>',
      '  <p style="margin:0;font-size:0.86rem;color:var(--muted);">' + esc((question.question || question.text || "").slice(0, 120)) + '</p>',
      '  <div class="dialog-field">',
      '    <label for="reportReasonSelect">' + esc(txt("Reason", "السبب")) + '</label>',
      '    <select id="reportReasonSelect" name="reason">',
      '      <option value="incorrect_answer">' + esc(txt("Incorrect answer key", "مفتاح الإجابة غير صحيح")) + '</option>',
      '      <option value="typo">' + esc(txt("Typo or formatting bug", "خطأ إملائي أو تنسيقي")) + '</option>',
      '      <option value="unclear">' + esc(txt("Unclear wording or needs better explanation", "صياغة غير واضحة أو يحتاج شرح أفضل")) + '</option>',
      '      <option value="missing_image">' + esc(txt("Missing diagram / figure", "صورة أو شكل مفقود")) + '</option>',
      '      <option value="outdated">' + esc(txt("Outdated question content", "محتوى قديم أو ملغي")) + '</option>',
      '      <option value="other">' + esc(txt("Other issue", "مشكلة أخرى")) + '</option>',
      '    </select>',
      '  </div>',
      '  <div class="dialog-field">',
      '    <label for="reportDetailsInput">' + esc(txt("Notes (optional)", "ملاحظات (اختياري)")) + '</label>',
      '    <textarea id="reportDetailsInput" rows="3" maxlength="500" placeholder="' + esc(txt("What should be fixed?", "إيه اللي محتاج يتعدل؟")) + '"></textarea>',
      '  </div>',
      '  <div class="inline" style="justify-content:flex-end;">',
      '    <button type="button" class="quiet" data-close-report>Cancel</button>',
      '    <button type="submit" class="primary">Submit Report</button>',
      '  </div>',
      '</form>'
    ].join("\n");

    reportDialog.querySelectorAll("[data-close-report]").forEach(function (btn) {
      btn.addEventListener("click", function () { reportDialog.close(); });
    });

    reportDialog.querySelector("#reportQuestionForm").addEventListener("submit", async function (e) {
      e.preventDefault();
      var reason = reportDialog.querySelector("#reportReasonSelect").value;
      var details = reportDialog.querySelector("#reportDetailsInput").value.trim();
      try {
        var res = await fetch("/api/questions/report", {
          method: "POST",
          headers: State.authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            subjectId: session.subjectId,
            quizId: session.collectionId || "custom",
            questionId: question.id || question.internalId,
            questionText: question.question || question.text || "",
            reason: reason,
            details: details,
          }),
        });
        reportDialog.close();
        root.ElgoShell.showToast(res.ok ? "Report submitted — thank you!" : "Could not send report right now.");
      } catch (_err) {
        reportDialog.close();
        root.ElgoShell.showToast("Offline — report could not be sent.");
      }
    });

    if (!reportDialog.open && typeof reportDialog.showModal === "function") {
      reportDialog.showModal();
    }
  }

  function openFinishConfirmDialog(session, onConfirm) {
    var total = (session.questions || []).length;
    var answered = Object.keys(session.answers || {}).length;
    var unanswered = Math.max(0, total - answered);
    var flagged = Object.values(session.flags || {}).filter(Boolean).length;

    if (!finishDialog) {
      finishDialog = document.createElement("dialog");
      finishDialog.className = "elgo-dialog player-finish-dialog";
      finishDialog.id = "playerFinishDialog";
      finishDialog.setAttribute("aria-labelledby", "playerFinishTitle");
      document.body.appendChild(finishDialog);
      finishDialog.addEventListener("click", function (e) { if (e.target === finishDialog) finishDialog.close(); });
    }

    finishDialog.innerHTML = [
      '<div class="dialog-body">',
      '  <div class="dialog-head">',
      '    <h2 id="playerFinishTitle">' + esc(session.isStudy ? txt("Finish study review?", "تنهي مراجعة المذاكرة؟") : txt("Submit quiz answers?", "تسلّم إجابات الاختبار؟")) + '</h2>',
      '    <button type="button" class="quiet" id="finishCancelX">✕</button>',
      '  </div>',
      '  <div class="results-stats-row">',
      '    <div class="results-stat"><span>' + esc(txt("Answered", "تمت الإجابة")) + '</span><strong>' + answered + ' / ' + total + '</strong></div>',
      '    <div class="results-stat"><span>' + esc(txt("Unanswered", "بلا إجابة")) + '</span><strong>' + unanswered + '</strong></div>',
      '    <div class="results-stat"><span>' + esc(txt("Flagged", "معلّمة")) + '</span><strong>' + flagged + '</strong></div>',
      '  </div>',
      unanswered > 0 && !session.isStudy
        ? '<p style="margin:0;color:var(--warning);font-size:0.88rem;">' + esc(txt(unanswered + " unanswered. You can return or submit now.", "عدد الأسئلة بلا إجابة: " + unanswered + ". يمكنك الرجوع أو التسليم الآن.")) + '</p>'
        : '<p style="margin:0;color:var(--muted);font-size:0.88rem;">' + esc(txt("Finish and review this session?", "تنهي الجلسة وتراجعها؟")) + '</p>',
      '  <div class="inline" style="justify-content:flex-end;">',
      '    <button type="button" class="secondary" id="finishCancelBtn" autofocus>' + esc(txt("Return to quiz", "الرجوع للاختبار")) + '</button>',
      '    <button type="button" class="primary" id="finishConfirmBtn">' + esc(session.isStudy ? txt("Finish study", "إنهاء المذاكرة") : txt("Submit answers", "تسليم الإجابات")) + '</button>',
      '  </div>',
      '</div>'
    ].join("\n");

    finishDialog.querySelector("#finishCancelX").addEventListener("click", function () { finishDialog.close(); });
    finishDialog.querySelector("#finishCancelBtn").addEventListener("click", function () { finishDialog.close(); });
    finishDialog.querySelector("#finishConfirmBtn").addEventListener("click", function () {
      finishDialog.close();
      return onConfirm();
    });

    if (!finishDialog.open && typeof finishDialog.showModal === "function") {
      finishDialog.showModal();
    }
  }

  function renderResultsView(container, session) {
    stopTimer();
    var State = root.ElgoState;
    var Model = root.ElgoModel;
    var r = session.resultData || {
      score: 0,
      total: session.questions.length,
      percentage: 0,
      durationMs: Date.now() - (session.startedAt || Date.now()),
      statusMessage: "Completed.",
    };

    var reviewedQuestions = (session.questions || []).map(function (q) { return questionWithFeedback(session, q); });
    var wrongQuestions = reviewedQuestions.filter(function (q) {
      return q.correctOptionId && session.answers[q.internalId] !== q.correctOptionId;
    });

    var challengeToken = Model.encodeChallenge({
      subjectId: session.subjectId,
      sourceIds: session.sourceIds,
      score: r.score,
      total: r.total,
    });
    var challengeUrl = location.origin + "/?challenge=" + encodeURIComponent(challengeToken);

    var reviewHtml = reviewedQuestions.map(function (q, idx) {
      var chosen = session.answers[q.internalId] || null;
      var hasKey = Boolean(q.correctOptionId);
      var isRight = hasKey && chosen === q.correctOptionId;
      var qSubjId = q.subjectId || session.subjectId;
      var exp = presentExplanation(q, chosen, qSubjId);
      var cls = !hasKey ? "" : isRight ? "is-right" : "is-wrong";
      var badgeText = !hasKey ? txt("No answer key", "بلا إجابة معتمدة") : isRight ? txt("Correct", "صحيح") : txt("Missed", "إجابة فائتة");
      var isSavedQ = State.isBookmarked(q.internalId);

      return [
        '<article class="review-item ' + cls + '">',
        '  <div class="dialog-head">',
        '    <strong>Q' + (idx + 1) + '</strong>',
        '    <div class="inline">',
        '      <button type="button" class="quiet" data-res-bookmark="' + idx + '">' + esc(isSavedQ ? txt("★ Saved (Remove)", "★ محفوظ (إزالة)") : txt("☆ Save", "☆ حفظ")) + '</button>',
        '      <span class="option-status">' + badgeText + '</span>',
        '    </div>',
        '  </div>',
        '  <div>' + formatStem(q.question || q.text) + '</div>',
             renderQuestionImagesHtml(q, { compact: true }),
        '  <div style="font-size:0.84rem;color:var(--muted);">',
        '    ' + esc(txt("Your answer", "إجابتك")) + ' <strong>' + esc(chosen || txt("Not answered", "بلا إجابة")) + '</strong>',
             hasKey ? (' · ' + esc(txt("Correct answer", "الإجابة الصحيحة")) + ' <strong>' + esc(q.correctOptionId) + '</strong>') : '',
        '  </div>',
             (exp.en || exp.ar || exp.rule) ? [
               '<details style="font-size:0.86rem;">',
               '  <summary style="cursor:pointer;color:var(--accent-text);font-weight:700;">Explanation &amp; notes</summary>',
               exp.en ? ('  <div style="margin-top:6px;">' + formatStem(exp.en) + '</div>') : '',
               exp.rule ? ('  <div class="feedback-rule" style="margin-top:6px;"><strong>Rule:</strong> ' + formatStem(exp.rule) + '</div>') : '',
               exp.ar ? ('  <div class="feedback-explanation-ar" style="margin-top:6px;">' + esc(exp.ar) + '</div>') : '',
               '</details>'
             ].join("\n") : '',
        '</article>'
      ].join("\n");
    }).join("\n");

    var mascotSrc = r.percentage >= 70 || session.isStudy
      ? "/assets/mascot/mascot-victory.png"
      : "/assets/mascot/mascot-quiz.png";

    container.innerHTML = [
      '<div class="player-wrap">',
      '  <div class="results-card">',
      '    <div class="results-hero">',
      '      <div style="display:flex;align-items:center;gap:14px;">',
      '        <img src="' + mascotSrc + '" alt="elgo mascot result" width="68" height="68" style="border-radius:16px;flex-shrink:0;">',
      '        <div>',
      '          <p class="eyebrow">' + esc(session.subjectName) + ' · ' + esc(session.title) + '</p>',
      '          <h1 id="quizResultsHeading" tabindex="-1" style="margin:0;">' + (session.isStudy ? esc(txt("Study Review Complete", "انتهت مراجعة المذاكرة")) : (r.score + " / " + r.total + " " + esc(txt("Correct", "إجابة صحيحة")))) + '</h1>',
      '          <p style="margin:6px 0 0;color:var(--muted);">' + esc(r.statusMessage) + '</p>',
      '        </div>',
      '      </div>',
      '      <div class="results-score-big">' + (session.isStudy ? esc(State.t("studyMode")) : (r.percentage + "%")) + '</div>',
      '    </div>',
      '    <div class="results-stats-row">',
      '      <div class="results-stat"><span>' + esc(txt("Mode", "الوضع")) + '</span><strong>' + esc(State.t(session.mode === "study" ? "studyMode" : session.mode === "practice" ? "practiceMode" : "testMode")) + '</strong></div>',
      '      <div class="results-stat"><span>' + esc(txt("Duration", "الوقت")) + '</span><strong>' + formatDuration(r.durationMs) + '</strong></div>',
      '      <div class="results-stat"><span>' + esc(txt("Questions", "الأسئلة")) + '</span><strong>' + session.questions.length + '</strong></div>',
      '      <div class="results-stat"><span>' + esc(txt("Missed", "الأخطاء")) + '</span><strong>' + (session.isStudy ? "—" : wrongQuestions.length) + '</strong></div>',
      '    </div>',
      '    <div class="inline">',
             session.collectionId === "saved"
               ? '<button type="button" class="primary" id="backToSavedBtn">' + esc(txt("★ Back to Saved", "★ رجوع للمحفوظات")) + '</button>'
               : '<button type="button" class="primary" id="backToCourseBtn">' + esc(txt("Back to Course", "رجوع للمادة")) + '</button>',
             (wrongQuestions.length > 0 && !session.isStudy) ? ('<button type="button" class="secondary" id="retryWrongBtn">' + esc(txt("Retry " + wrongQuestions.length + " Missed", "إعادة " + wrongQuestions.length + " خطأ")) + '</button>') : '',
      '      <button type="button" class="secondary" id="retryAllBtn">' + esc(txt("Retake Quiz", "إعادة الاختبار")) + '</button>',
      '      <button type="button" class="secondary" id="copyChallengeBtn">' + esc(txt("⚔️ Copy Challenge Link", "⚔️ نسخ رابط التحدي")) + '</button>',
             (!State.getAuth() && session.mode === "test") ? '<button type="button" class="secondary" id="signInAfterBtn">' + esc(txt("Sign In / Create Account", "تسجيل دخول بحساب")) + '</button>' : '',
      '    </div>',
           (!State.getAuth() && session.mode === "test" && session.isGradableCollection) ? [
             '<form id="resQuickRankForm" class="continue-block" style="margin:12px 0 0;flex-wrap:wrap;gap:10px;">',
             '  <div style="flex:1 1 220px;">',
             '    <strong>🏆 ' + esc(txt("Rank This Score on Leaderboard (No Password Needed)", "سجل نتيجتك في الترتيب (بدون باسورد)")) + '</strong>',
             '    <small>' + esc(txt("Enter just a display name to submit this score right now.", "اكتب اسمك فقط لإرسال نتيجتك للترتيب فوراً.")) + '</small>',
             '  </div>',
             '  <div class="inline" style="flex:1 1 240px;">',
             '    <input type="text" id="resQuickNameInput" required minlength="3" maxlength="24" placeholder="' + esc(txt("Your display name...", "اكتب اسمك...")) + '" style="flex:1;min-width:140px;padding:8px 10px;border-radius:10px;border:1px solid var(--line);background:var(--tile);color:var(--ink);">',
             '    <button type="submit" class="primary" id="resQuickRankBtn">' + esc(txt("Save Name & Rank Score", "سجل الاسم واحفظ الترتيب")) + '</button>',
             '  </div>',
             '</form>'
           ].join("\n") : '',
      '  </div>',
      '  <div class="results-card">',
      '    <h2 style="margin:0;">' + esc(txt("Question Breakdown", "مراجعة الأسئلة")) + '</h2>',
      '    <div class="results-review-list">' + reviewHtml + '</div>',
      '  </div>',
      '</div>'
    ].join("\n");

    var backCourseBtn = container.querySelector("#backToCourseBtn");
    if (backCourseBtn) {
      backCourseBtn.addEventListener("click", function () {
        root.ElgoRouter.navigate("/?flow=hub&subject=" + encodeURIComponent(session.subjectId) + "&view=sources");
      });
    }
    var backSavedBtn = container.querySelector("#backToSavedBtn");
    if (backSavedBtn) {
      backSavedBtn.addEventListener("click", function () {
        root.ElgoRouter.navigate("/?panel=saved");
      });
    }

    container.querySelectorAll("[data-res-bookmark]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = Number(btn.getAttribute("data-res-bookmark"));
        var targetQ = session.questions[idx];
        if (!targetQ) return;
        var savedNow = State.toggleBookmark(targetQ, {
          subjectId: targetQ.subjectId || session.subjectId,
          subjectName: session.subjectName,
          collectionId: targetQ.collectionId || session.collectionId,
        });
        btn.textContent = savedNow ? txt("★ Saved (Remove)", "★ محفوظ (إزالة)") : txt("☆ Save", "☆ حفظ");
        if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
      });
    });
    bindImageZoomButtons(container);

    var retryWrong = container.querySelector("#retryWrongBtn");
    if (retryWrong) {
      retryWrong.addEventListener("click", function () {
        var spec = Model.buildSessionSpec({
          subject: { id: session.subjectId, name: session.subjectName },
          questions: wrongQuestions,
          sourceId: session.collectionId,
          mode: session.mode === "study" ? "practice" : "practice",
          title: session.title + " — Missed Questions",
        });
        launchSpec(spec);
      });
    }

    container.querySelector("#retryAllBtn").addEventListener("click", function () {
      var spec = Model.buildSessionSpec({
        subject: { id: session.subjectId, name: session.subjectName },
        questions: session.questions,
        sourceIds: session.sourceIds,
        sourceId: session.collectionId,
        isGradableCollection: session.isGradableCollection,
        mode: session.mode,
        title: session.title,
      });
      launchSpec(spec);
    });

    container.querySelector("#copyChallengeBtn").addEventListener("click", async function () {
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          await navigator.clipboard.writeText(challengeUrl);
          root.ElgoShell.showToast("Challenge link copied to clipboard!");
        } else {
          window.prompt("Share this challenge link:", challengeUrl);
        }
      } catch (_err) {
        window.prompt("Share this challenge link:", challengeUrl);
      }
    });

    var signInBtn = container.querySelector("#signInAfterBtn");
    if (signInBtn) {
      signInBtn.addEventListener("click", function () {
        root.ElgoShell.openAuthModal("guest");
      });
    }

    var quickRankForm = container.querySelector("#resQuickRankForm");
    if (quickRankForm) {
      quickRankForm.addEventListener("submit", async function (e) {
        e.preventDefault();
        var input = container.querySelector("#resQuickNameInput");
        var btn = container.querySelector("#resQuickRankBtn");
        var uname = input ? input.value.trim() : "";
        if (!uname) return;
        var curAuthRank = State.getAuth();
        if (curAuthRank && curAuthRank.profile && curAuthRank.profile.guest) {
          if (root.ElgoShell) root.ElgoShell.openAuthModal("upgrade");
          return;
        }
        if (btn) btn.disabled = true;
        try {
          var gBeforeGen = typeof State.getAuthGeneration === "function" ? State.getAuthGeneration() : null;
          var stBeforeRank = typeof State.getState === "function" ? State.getState() : null;
          var gBody = typeof State.buildAuthPayload === "function"
            ? State.buildAuthPayload({ mode: "guest", username: uname, includeLocalProgress: true })
            : { username: uname };
          var gRes = await fetch("/api/auth/guest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(gBody),
          });
          var gData = await gRes.json().catch(function () { return null; });
          if (!gRes.ok || !gData || !gData.ok || !gData.token) {
            if (root.ElgoShell) root.ElgoShell.showToast((gData && gData.error) || txt("Could not create guest name.", "تعذر استخدام الاسم ده."));
            return;
          }
          if (typeof State.completeAuthTransition === "function") {
            var rankTransitioned = await State.completeAuthTransitionWithLock(gData, { expectedAuthGeneration: gBeforeGen, skipPlayerClear: true });
            if (!rankTransitioned) return;
          } else {
            State.setAuth(gData);
            var gProg = (gData.profile && gData.profile.progress) || gData.progress;
            if (gProg && typeof State.applyCloudProgress === "function") {
              State.applyCloudProgress(gProg, {
                studentId: gData.profile && gData.profile.studentId,
                username: gData.profile && gData.profile.username,
                replace: Boolean(stBeforeRank && stBeforeRank.ownerStudentId),
                serverTime: gData.serverTime,
              });
            }
          }
          if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();

          var subRes = await fetch("/api/quiz/submit", {
            method: "POST",
            headers: State.authHeaders({ "Content-Type": "application/json" }, gData.token),
            body: JSON.stringify({
              attemptId: session.attemptId,
              subjectId: session.subjectId,
              quizId: session.collectionId,
              quizTitle: session.title,
              mode: "test",
              durationMs: r.durationMs,
              answers: session.answers,
            }),
          });
          var subData = await subRes.json().catch(function () { return null; });
          if (subRes.ok && subData && subData.ok && subData.attempt) {
            var nextSummary = Object.assign({}, r, {
              score: Number(subData.attempt.score),
              total: Number(subData.attempt.total),
              percentage: Number(subData.attempt.percentage),
              validatedByServer: Boolean(subData.attempt.validatedByServer),
              rankStatus: subData.attempt.rankStatus || (subData.attempt.countedInRanking ? "ranked" : "partial"),
              statusMessage: subData.attempt.countedInRanking
                ? txt("Verified on server & ranked on Leaderboard.", "تم اعتماد النتيجة وتسجيلها في لوحة المتصدرين.")
                : txt("Submitted to server (partial / unranked check).", "تم إرسال المحاولة للسيرفر."),
            });
            if (root.ElgoShell) root.ElgoShell.showToast(txt("Score ranked on Leaderboard!", "تم تسجيل نتيجتك في الترتيب!"));
            session.resultData = nextSummary;
            renderResultsView(container, session);
          } else {
            if (root.ElgoShell) root.ElgoShell.showToast((subData && subData.error) || txt("Name saved! Retake Test mode to enter rankings.", "تم حفظ الاسم!"));
            session.resultData = r;
            renderResultsView(container, session);
          }
        } catch (_err) {
          if (root.ElgoShell) root.ElgoShell.showToast(txt("Network error while ranking score.", "تعذر الاتصال بالسيرفر."));
        } finally {
          if (btn) btn.disabled = false;
        }
      });
    }
  }

  function renderQuestionView(container, session, focusSelector) {
    if (session.completed) {
      renderResultsView(container, session);
      return;
    }

    var State = root.ElgoState;
    var q = session.questions[session.currentIndex];
    if (!q) return;

    var total = session.questions.length;
    var chosenId = session.answers[q.internalId] || null;
    var isAnswered = Boolean(chosenId);
    loadFeedback(container, session, q, chosenId);
    var access = getReviewState(session);
    var review = access.questions.get(q.internalId);
    var accessError = session.mode === "test" ? access.error : review && review.error;
    var waitingForTest = session.mode === "test" && !access.ready;
    q = questionWithFeedback(session, q);
    var revealAnswer = session.isStudy || (session.mode === "practice" && isAnswered);
    var hasKey = Boolean(q.correctOptionId);
    var bookmarked = State.isBookmarked(q.internalId);
    var flagged = Boolean(session.flags[q.internalId]);
    var answeredCount = Object.keys(session.answers).length;
    var progress = session.isStudy ? session.currentIndex + 1 : answeredCount;
    var pctDone = total > 0 ? Math.round((progress / total) * 100) : 0;

    var optionsHtml = (q.options || []).map(function (opt) {
      var st = buildOptionState(session, q, opt, chosenId, review, hasKey);
      var lockBtn = session.isStudy || waitingForTest || (session.mode === "practice" && isAnswered);
      return [
        '<button type="button" class="' + st.cls + '" data-opt-id="' + esc(opt.id) + '" aria-pressed="' + (st.selected ? 'true' : 'false') + '"' + (lockBtn ? " disabled" : "") + '>',
        '  <span class="option-letter">' + esc(opt.id) + '</span>',
        '  <span class="option-text">' + formatStem(opt.text) + '</span>',
           st.statusLabel ? '<span class="option-status">' + esc(st.statusLabel) + '</span>' : '',
        '</button>'
      ].join("\n");
    }).join("\n");

    var feedbackSlotHtml = buildFeedbackSlotHtml(session, q, chosenId, review, accessError);

    var dotsHtml = session.questions.map(function (item, idx) {
      var ans = session.answers[item.internalId];
      var enrichedItem = questionWithFeedback(session, item);
      var cls = "nav-dot";
      if (idx === session.currentIndex) cls += " is-current";
      if (session.mode === "practice" && ans && enrichedItem.correctOptionId) {
        cls += ans === enrichedItem.correctOptionId ? " is-correct" : " is-wrong";
      } else if (ans) {
        cls += " is-answered";
      }
      if (session.flags[item.internalId]) cls += " is-flagged";
      return '<button type="button" class="' + cls + '" data-jump-idx="' + idx + '">' + (idx + 1) + '</button>';
    }).join("");

    var compactGridCls = total >= 30 ? " is-compact-grid" : "";
    var mobileNavOpenCls = session._mobileNavOpen ? " is-mobile-open" : "";

    container.innerHTML = [
      '<div class="player-wrap">',
      '  <div class="player-topbar">',
      '    <div class="player-meta">',
      '      <button type="button" class="quiet" id="exitSessionBtn">' + esc(State.t("exitLabel")) + '</button>',
      '      <strong>' + esc(session.title) + '</strong>',
      '      <span class="player-mode-pill">' + esc(session.mode === "study" ? State.t("modeStudyPill") : session.mode === "practice" ? State.t("modePracticePill") : State.t("modeTestPill")) + '</span>',
      '    </div>',
      '    <div class="inline">',
      '      <button type="button" class="quiet player-map-toggle-btn" id="toggleMapBtn" aria-controls="playerNavPanel" aria-expanded="' + (session._mobileNavOpen ? "true" : "false") + '">' + esc(txt("Map", "الخريطة")) + ' (' + answeredCount + '/' + total + ')</button>',
      '      <span class="player-timer" id="playerTimer">' + formatDuration(Date.now() - session.startedAt) + '</span>',
      '      <button type="button" class="primary" id="finishQuizTopBtn"' + (waitingForTest ? ' disabled' : '') + '>' + esc(session.isStudy ? State.t("finishStudy") : State.t("submitExam")) + '</button>',
      '    </div>',
      '  </div>',
      '  <div class="player-progress-bar" role="progressbar" aria-label="' + esc(session.isStudy
        ? State.t("questionLabel") : State.t("answeredLabel")) + '" aria-valuemin="0" aria-valuemax="' + total + '" aria-valuenow="' + progress + '">',
      '    <div class="player-progress-fill" style="width:' + pctDone + '%"></div>',
      '  </div>',
      '  <div class="player-layout">',
      '    <div class="player-main-col">',
      '      <section class="question-card" aria-label="Active Question">',
      '        <div class="question-head">',
      '          <span class="question-counter">' + esc(State.t("questionLabel")) + ' ' + (session.currentIndex + 1) + ' ' + esc(State.t("ofLabel")) + ' ' + total + (session.isStudy ? '' : ' · ' + esc(State.t("answeredLabel")) + ' ' + answeredCount + '/' + total) + '</span>',
      '          <div class="question-actions-inline">',
      '            <button type="button" class="q-tool-btn" id="flagQuestionBtn" aria-pressed="' + (flagged ? "true" : "false") + '">⚑ ' + esc(flagged ? State.t("flaggedLabel") : State.t("flagQuestion")) + '</button>',
      '            <button type="button" class="q-tool-btn" id="bookmarkQuestionBtn" aria-pressed="' + (bookmarked ? "true" : "false") + '">🔖 ' + esc(bookmarked ? State.t("savedLabel") : State.t("bookmarkQuestion")) + '</button>',
      '            <button type="button" class="q-tool-btn" id="reportQuestionBtn">⚠ ' + esc(State.t("reportIssue")) + '</button>',
      '          </div>',
      '        </div>',
      '        <h2 class="question-stem" id="activeQuestionHeading" tabindex="-1">' + formatStem(q.question || q.text) + '</h2>',
               renderQuestionImagesHtml(q),
      '        <div class="options-stack" id="qOptionsList">' + optionsHtml + '</div>',
      '        <div class="player-footer-nav">',
      '          <button type="button" class="secondary" id="prevQuestionBtn"' + (session.currentIndex === 0 ? " disabled" : "") + '>' + esc(State.t("prevQuestion")) + '</button>',
      '          <span class="player-shortcut-hint" style="font-size:0.76rem;color:var(--muted);">' + esc(txt("Shortcuts: A–D answer · ←/→ navigate · F flag · B save", "اختصارات: A–D إجابة · ←/→ تنقل · F تمييز · B حفظ")) + '</span>',
                 session.currentIndex < total - 1
                   ? '<button type="button" class="primary" id="nextQuestionBtn">' + esc(State.t("nextQuestion")) + '</button>'
                   : '<button type="button" class="primary" id="finishQuizBottomBtn"' + (waitingForTest ? ' disabled' : '') + '>' + esc(session.isStudy ? State.t("finishStudy") : State.t("submitExam")) + '</button>',
      '        </div>',
      '      </section>',
      '      <div class="feedback-slot" id="qFeedbackSlot">' + feedbackSlotHtml + '</div>',
      '    </div>',
      '    <aside class="player-nav-panel' + mobileNavOpenCls + '" id="playerNavPanel" aria-label="Question navigator">',
      '      <div class="dialog-head">',
      '        <strong>' + esc(txt("Questions", "الأسئلة")) + ' (' + total + ')</strong>',
      '        <button type="button" class="quiet player-map-toggle-btn" id="closeMapBtn">✕</button>',
      '      </div>',
      '      <div class="player-nav-grid' + compactGridCls + '">' + dotsHtml + '</div>',
      '      <div class="nav-legend">',
      '        <span>' + esc(State.t("answeredLabel")) + ': ' + answeredCount + '</span>',
      '        <span>' + esc(State.t("flaggedLabel")) + ': ' + Object.values(session.flags).filter(Boolean).length + '</span>',
      '      </div>',
      '    </aside>',
      '  </div>',
      '</div>'
    ].join("\n");

    bindFeedbackSlotHandlers(container, session, q);

    if (focusSelector) {
      var focusTarget = container.querySelector(focusSelector);
      safeFocusNoScroll(focusTarget);
    }

    stopTimer();
    timerHandle = setInterval(function () {
      var el = document.getElementById("playerTimer");
      if (el && activeSession && !activeSession.completed) {
        el.textContent = formatDuration(Date.now() - activeSession.startedAt);
      } else if (!el) {
        stopTimer();
      }
    }, 1000);

    bindImageZoomButtons(container);

    container.querySelector("#exitSessionBtn").addEventListener("click", function () {
      stopTimer();
      persistActiveSession();
      if (session.collectionId === "saved") {
        root.ElgoRouter.navigate("/?panel=saved");
      } else {
        root.ElgoRouter.navigate("/?flow=hub&subject=" + encodeURIComponent(session.subjectId) + "&view=sources");
      }
    });

    var toggleMapBtn = container.querySelector("#toggleMapBtn");
    var closeMapBtn = container.querySelector("#closeMapBtn");
    if (toggleMapBtn) {
      toggleMapBtn.addEventListener("click", function () {
        session._mobileNavOpen = !session._mobileNavOpen;
        renderQuestionView(container, session);
      });
    }
    if (closeMapBtn) {
      closeMapBtn.addEventListener("click", function () {
        session._mobileNavOpen = false;
        renderQuestionView(container, session);
      });
    }

    function handleSelectOption(optId, clickedBtn) {
      if (session.isStudy || (session.mode === "test" && !getReviewState(session).ready)) return;
      if (session.mode === "practice" && session.answers[q.internalId]) return;
      session.answers[q.internalId] = optId;
      if (session.mode === "practice") {
        loadFeedback(container, session, q, optId);
      }
      patchQuestionFeedbackInPlace(container, session, q);
      if (session.mode === "test") {
        var targetBtn = clickedBtn || container.querySelector('[data-opt-id="' + CSS.escape(optId) + '"]');
        safeFocusNoScroll(targetBtn);
      }
      scheduleDeferred(function () {
        persistActiveSession();
      });
    }

    container.querySelectorAll("[data-opt-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        handleSelectOption(btn.getAttribute("data-opt-id"), btn);
      });
    });

    container.querySelector("#flagQuestionBtn").addEventListener("click", function () {
      session.flags[q.internalId] = !session.flags[q.internalId];
      persistActiveSession();
      renderQuestionView(container, session, "#flagQuestionBtn");
    });

    container.querySelector("#bookmarkQuestionBtn").addEventListener("click", function () {
      var saved = State.toggleBookmark(q, {
        subjectId: q.subjectId || session.subjectId,
        subjectName: session.subjectName,
        collectionId: q.collectionId || session.collectionId,
        hideAnswer: session.mode === "test" && !session.completed,
        attemptId: session.attemptId,
      });
      if (root.ElgoShell) root.ElgoShell.showToast(saved
        ? txt("Question saved.", "تم حفظ السؤال.")
        : txt("Question removed from saved questions.", "تمت إزالة السؤال من المحفوظات."));
      if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
      renderQuestionView(container, session, "#bookmarkQuestionBtn");
    });

    container.querySelector("#reportQuestionBtn").addEventListener("click", function () {
      openReportDialog(q, session);
    });

    container.querySelectorAll("[data-jump-idx]").forEach(function (dot) {
      dot.addEventListener("click", function () {
        session.currentIndex = Number(dot.getAttribute("data-jump-idx")) || 0;
        session._mobileNavOpen = false;
        persistActiveSession();
        renderQuestionView(container, session, "#activeQuestionHeading");
      });
    });

    container.querySelector("#prevQuestionBtn").addEventListener("click", function () {
      if (session.currentIndex > 0) {
        session.currentIndex -= 1;
        persistActiveSession();
        renderQuestionView(container, session, "#activeQuestionHeading");
      }
    });

    var nextBtn = container.querySelector("#nextQuestionBtn");
    if (nextBtn) {
      nextBtn.addEventListener("click", function () {
        if (session.currentIndex < total - 1) {
          session.currentIndex += 1;
          persistActiveSession();
          renderQuestionView(container, session, "#activeQuestionHeading");
        }
      });
    }

    var finishHandler = function () {
      if (waitingForTest) return;
      openFinishConfirmDialog(session, async function () {
        if (access.finishing) return;
        access.finishing = true;
        try {
          session.resultData = await submitAttemptToServer(session);
        } catch (error) {
          access.error = error.message;
          access.finishing = false;
          renderQuestionView(container, session, "#finishQuizTopBtn");
          return;
        }
        if (session.mode === "test") {
          (session.questions || []).forEach(function (item) {
            if (!item || !item.correctOptionId) return;
            var finalAns = session.answers && session.answers[item.internalId];
            if (!finalAns || finalAns === item.correctOptionId) return;
            State.recordMistake(item, finalAns, {
              subjectId: item.subjectId || session.subjectId,
              subjectName: session.subjectName,
              collectionId: item.collectionId || session.collectionId,
            });
          });
        }
        session.completed = true;
        persistActiveSession();
        if (session.mode === "test" && typeof State.revealBookmarksForCompletedTest === "function") {
          State.revealBookmarksForCompletedTest(session.questions, session.attemptId);
        }
        if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
        if (!container.isConnected || !container.querySelector(".question-card") || activeSession !== session) return;
        renderResultsView(container, session);
        container.querySelector("#quizResultsHeading").focus();
      });
    };

    container.querySelector("#finishQuizTopBtn").addEventListener("click", finishHandler);
    var bottomFinish = container.querySelector("#finishQuizBottomBtn");
    if (bottomFinish) bottomFinish.addEventListener("click", finishHandler);
  }

  function bindGlobalShortcuts() {
    if (shortcutsBound) return;
    shortcutsBound = true;
    document.addEventListener("keydown", function (e) {
      if (!activeSession || activeSession.completed) return;
      if (document.querySelector("dialog[open]")) return;
      if (/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || "")) return;

      var host = document.getElementById("appWorkspace") || document.getElementById("appMain");
      if (!host || !host.querySelector(".question-card")) return;

      var q = activeSession.questions[activeSession.currentIndex];
      if (!q) return;

      var key = String(e.key || "").toUpperCase();
      if (key === "ARROWLEFT") {
        if (activeSession.currentIndex > 0) {
          activeSession.currentIndex -= 1;
          persistActiveSession();
          renderQuestionView(host, activeSession);
        }
      } else if (key === "ARROWRIGHT") {
        if (activeSession.currentIndex < activeSession.questions.length - 1) {
          activeSession.currentIndex += 1;
          persistActiveSession();
          renderQuestionView(host, activeSession);
        }
      } else if (key === "F") {
        activeSession.flags[q.internalId] = !activeSession.flags[q.internalId];
        persistActiveSession();
        renderQuestionView(host, activeSession);
      } else if (key === "B") {
        var State = root.ElgoState;
        State.toggleBookmark(q, {
          subjectId: q.subjectId || activeSession.subjectId,
          subjectName: activeSession.subjectName,
          collectionId: q.collectionId || activeSession.collectionId,
          hideAnswer: activeSession.mode === "test" && !activeSession.completed,
          attemptId: activeSession.attemptId,
        });
        if (root.ElgoShell) root.ElgoShell.renderHeaderAndNav();
        renderQuestionView(host, activeSession);
      } else if (/^[1-4A-D]$/.test(key) && !activeSession.isStudy) {
        if (activeSession.mode === "test" && !getReviewState(activeSession).ready) return;
        var idx = /^[1-4]$/.test(key) ? Number(key) - 1 : key.charCodeAt(0) - 65;
        var opt = q.options && q.options[idx];
        if (!opt) return;
        if (activeSession.mode === "practice" && activeSession.answers[q.internalId]) return;
        activeSession.answers[q.internalId] = opt.id;
        if (activeSession.mode === "practice") {
          loadFeedback(host, activeSession, q, opt.id);
        }
        patchQuestionFeedbackInPlace(host, activeSession, q);
        scheduleDeferred(function () { persistActiveSession(); });
      }
    });
  }

  function launchSpec(spec) {
    activeSession = spec;
    sanitizeTestSession(activeSession);
    persistActiveSession();
    bindGlobalShortcuts();
    if (root.ElgoRouter) {
      root.ElgoRouter.navigate("/?flow=player");
    }
  }

  async function render(container, params) {
    bindGlobalShortcuts();
    if (!activeSession) {
      var st = root.ElgoState.getState();
      if (st.activeSession && Array.isArray(st.activeSession.questions) && st.activeSession.questions.length) {
        activeSession = st.activeSession;
        sanitizeTestSession(activeSession);
        persistActiveSession();
      }
    }

    var reqSubject = params && params.get("subject");
    var reqSource = params && (params.get("quiz") || params.get("source"));
    if ((!activeSession || activeSession.completed) && reqSubject && reqSource && root.ElgoState && root.ElgoModel) {
      try {
        var catalog = await root.ElgoState.loadCatalog();
        var subj = root.ElgoModel.getSubject(catalog, reqSubject);
        var qs = await root.ElgoState.loadQuestionsForSources(reqSubject, [reqSource]);
        if (subj && qs.length) {
          var meta = root.ElgoModel.listSources(catalog, reqSubject, "all").find(function (s) {
            return s.id === reqSource || s.collectionId === reqSource;
          });
          activeSession = root.ElgoModel.buildSessionSpec({
            subject: subj,
            questions: qs,
            sourceIds: [meta ? meta.id : reqSource],
            mode: params.get("mode") || "test",
            isGradableCollection: true,
            title: meta ? root.ElgoState.getQuizTitle(meta) : reqSource,
          });
          sanitizeTestSession(activeSession);
          persistActiveSession();
        }
      } catch (_err) {
        // Fallback to empty state below if source cannot load
      }
    }

    if (!activeSession || !Array.isArray(activeSession.questions) || !activeSession.questions.length) {
      container.innerHTML = [
        '<section class="hub-panel empty-state">',
        '  <h2>' + esc(txt("No active quiz session", "لا توجد جلسة اختبار نشطة")) + '</h2>',
        '  <p>' + esc(txt("Choose a subject and question sets to start a quiz.", "اختر مادة ومجموعات أسئلة لبدء الاختبار.")) + '</p>',
        '  <a href="/?flow=hub" class="primary" style="margin-top:8px;">Browse Courses →</a>',
        '</section>'
      ].join("\n");
      return;
    }

    renderQuestionView(container, activeSession);
  }

  function clearActiveSession() {
    if (activeSession && activeSession.mode === "test" && !activeSession.completed && root.ElgoState.getAuth()) {
      requestQuizFeedback({ action: "abandon", attemptId: activeSession.attemptId }).catch(function () {});
    }
    activeSession = null;
    stopTimer();
  }

  root.ElgoPlayer = {
    launchSpec: launchSpec,
    render: render,
    stopTimer: stopTimer,
    clearActiveSession: clearActiveSession,
    loadStudyFeedback: async function (questionId) {
      var result = await requestQuizFeedback({ action: "study", questionId: questionId });
      return result.feedback[questionId];
    },
    getActiveSession: function () { return activeSession; },
  };
})(typeof window !== "undefined" ? window : globalThis);
