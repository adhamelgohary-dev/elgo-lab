(function (root) {
  "use strict";

  function cloneArray(list) {
    return Array.isArray(list) ? list.slice() : [];
  }

  function shuffleArray(list) {
    var copy = cloneArray(list);
    for (var i = copy.length - 1; i > 0; i -= 1) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  function normalizeSubjectCounts(subj) {
    var counts = (subj && subj.counts && typeof subj.counts === "object") ? subj.counts : {};
    var quizzes = Number(counts.quizzes != null ? counts.quizzes : (subj && subj.quizzesCount) || 0);
    var lectures = Number(counts.lectures != null ? counts.lectures : (subj && subj.lecturesCount) || 0);
    var sheets = Number(counts.sheets != null ? counts.sheets : (subj && subj.sheetsCount) || 0);
    var pdfs = Number(counts.pdfs != null ? counts.pdfs : (subj && subj.pdfsCount) || 0);
    var videos = Number(counts.videos != null ? counts.videos : (subj && subj.videosCount) || 0);
    var quizQuestions = Number(counts.quizQuestions || 0);
    var lectureQuestions = Number(counts.lectureQuestions || 0);
    var sheetQuestions = Number(counts.sheetQuestions || 0);
    var totalQuestions = Number(
      counts.totalQuestions != null
        ? counts.totalQuestions
        : (subj && subj.questionsCount) || (quizQuestions + lectureQuestions + sheetQuestions)
    );
    return {
      quizzes: quizzes,
      quizQuestions: quizQuestions,
      lectures: lectures,
      lectureQuestions: lectureQuestions,
      sheets: sheets,
      sheetQuestions: sheetQuestions,
      pdfs: pdfs,
      videos: videos,
      totalQuestions: totalQuestions,
    };
  }

  function normalizeCatalog(raw) {
    var cat = raw && typeof raw === "object" ? raw : {};
    var subjects = cloneArray(cat.subjects).map(function (s, idx) {
      var counts = normalizeSubjectCounts(s);
      return Object.assign({}, s, {
        order: Number.isFinite(Number(s && s.order)) ? Number(s.order) : idx + 1,
        counts: counts,
        quizzesCount: counts.quizzes,
        lecturesCount: counts.lectures,
        sheetsCount: counts.sheets,
        questionsCount: counts.totalQuestions,
        pdfsCount: counts.pdfs,
        videosCount: counts.videos,
      });
    }).sort(function (a, b) {
      return a.order - b.order;
    });

    var sources = cloneArray(cat.sources).map(function (s) {
      var kind = (s && (s.kind || s.type)) || "quiz";
      return Object.assign({}, s, { kind: kind, type: (s && s.type) || kind });
    });
    var lectures = cloneArray(cat.lectures);
    var resources = cloneArray(cat.resources);

    return {
      schemaVersion: cat.schemaVersion || 1,
      generatedAt: cat.generatedAt || null,
      hierarchy: cat.hierarchy || { faculties: [] },
      subjects: subjects,
      sources: sources,
      lectures: lectures,
      resources: resources,
    };
  }

  function listSubjects(catalog, filter) {
    var cat = normalizeCatalog(catalog);
    if (!filter) return cat.subjects;
    return cat.subjects.filter(function (s) {
      if (filter.facultyId && s.facultyId && s.facultyId !== filter.facultyId) return false;
      if (filter.levelId && s.levelId && s.levelId !== filter.levelId) return false;
      if (filter.termId && s.termId && s.termId !== filter.termId) return false;
      return true;
    });
  }

  function getSubject(catalog, subjectId) {
    return listSubjects(catalog).find(function (s) {
      return s.id === subjectId;
    }) || null;
  }

  function listSources(catalog, subjectId, kindFilter) {
    var cat = normalizeCatalog(catalog);
    return cat.sources.filter(function (src) {
      if (subjectId && src.subjectId !== subjectId) return false;
      if (kindFilter && kindFilter !== "all" && src.kind !== kindFilter) return false;
      return true;
    });
  }

  function listLectures(catalog, subjectId) {
    var cat = normalizeCatalog(catalog);
    return cat.lectures.filter(function (lec) {
      return !subjectId || lec.subjectId === subjectId;
    });
  }

  function listResources(catalog, subjectId, typeFilter) {
    var cat = normalizeCatalog(catalog);
    return cat.resources.filter(function (res) {
      if (subjectId && res.subjectId !== subjectId) return false;
      if (typeFilter && res.type !== typeFilter) return false;
      return res.active !== false;
    });
  }

  function buildSessionSpec(opts) {
    var o = opts || {};
    var subject = o.subject || {};
    var subjectId = o.subjectId || subject.id || "";
    var subjectName = o.subjectName || subject.name || subjectId || "Course";
    var rawQuestions = cloneArray(o.questions);
    var mode = o.mode === "study" || o.mode === "practice" ? o.mode : "test";
    var isStudy = mode === "study";
    var sourceIds = cloneArray(o.sourceIds);
    var collectionId = o.collectionId || o.sourceId || "";

    if (!collectionId && sourceIds.length === 1) {
      var parts = String(sourceIds[0]).split("::");
      collectionId = parts[2] || parts[parts.length - 1] || "";
    }

    var questions = rawQuestions.map(function (q, idx) {
      var copiedOpts = cloneArray(q.options).map(function (opt) {
        return Object.assign({}, opt);
      });
      if (o.shuffleOptions) {
        copiedOpts = shuffleArray(copiedOpts);
      }
      return Object.assign({}, q, {
        displayIndex: idx,
        options: copiedOpts,
      });
    });

    if (o.shuffleQuestions) {
      questions = shuffleArray(questions);
    }

    var isGradableCollection = Boolean(
      o.isGradableCollection != null
        ? o.isGradableCollection
        : (sourceIds.length === 1 && collectionId && collectionId !== "saved" && collectionId !== "mistakes")
    );

    return {
      attemptId: o.attemptId || ("att_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8)),
      subjectId: subjectId,
      subjectName: subjectName,
      collectionId: collectionId,
      sourceIds: sourceIds,
      title: o.title || (sourceIds.length > 1 ? ("Mixed (" + sourceIds.length + " sources)") : (collectionId || subjectName)),
      mode: mode,
      isStudy: isStudy,
      isGradableCollection: isGradableCollection,
      shuffleQuestions: Boolean(o.shuffleQuestions),
      shuffleOptions: Boolean(o.shuffleOptions),
      questions: questions,
      currentIndex: Number(o.currentIndex) || 0,
      answers: Object.assign({}, o.answers || {}),
      flags: Object.assign({}, o.flags || {}),
      startedAt: Number(o.startedAt) || Date.now(),
      completed: false,
      resultData: null,
    };
  }

  function continueRecommendation(state, catalog) {
    var st = state || {};
    if (st.activeSession && Array.isArray(st.activeSession.questions) && st.activeSession.questions.length > 0 && !st.activeSession.completed) {
      return {
        type: "activeSession",
        session: st.activeSession,
      };
    }
    if (st.lastAttempt && st.lastAttempt.subjectId) {
      var subj = getSubject(catalog, st.lastAttempt.subjectId);
      if (subj) {
        return {
          type: "lastSubject",
          subject: subj,
          attempt: st.lastAttempt,
        };
      }
    }
    return null;
  }

  function encodeChallenge(payload) {
    try {
      var json = JSON.stringify(payload || {});
      if (typeof TextEncoder !== "undefined") {
        var bytes = new TextEncoder().encode(json);
        var bin = "";
        for (var i = 0; i < bytes.length; i += 1) {
          bin += String.fromCharCode(bytes[i]);
        }
        return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      }
      return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    } catch (_err) {
      return "";
    }
  }

  function decodeChallenge(token) {
    if (!token) return null;
    try {
      var b64 = String(token).replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      var bin = atob(b64);
      if (typeof TextDecoder !== "undefined") {
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i += 1) {
          bytes[i] = bin.charCodeAt(i);
        }
        return JSON.parse(new TextDecoder().decode(bytes));
      }
      return JSON.parse(decodeURIComponent(escape(bin)));
    } catch (_err) {
      return null;
    }
  }

  function sanitizeImageUrl(raw) {
    if (typeof raw !== "string") return "";
    var s = raw.trim();
    if (!s) return "";
    if (/^\/(?!\/)[^\s"'<>\\]{1,500}$/.test(s)) return s;
    if (/^https:\/\/[^\s"'<>\\]{4,1000}$/i.test(s)) return s;
    if (/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]{16,400000}$/i.test(s)) return s;
    return "";
  }

  function getQuestionImages(q) {
    if (!q || typeof q !== "object") return [];
    var defaultAlt = q.imageAlt || q.alt ? String(q.imageAlt || q.alt).trim().slice(0, 200) : "";
    var defaultCaption = q.imageCaption || q.caption ? String(q.imageCaption || q.caption).trim().slice(0, 300) : "";
    var list = [];
    if (Array.isArray(q.images)) {
      q.images.forEach(function (it) { list.push(it); });
    }
    var single = q.image || q.imageUrl || q.img || q.diagram || q.figure;
    if (single) list.push(single);

    var out = [];
    var seen = new Set();
    for (var i = 0; i < list.length; i += 1) {
      var item = list[i];
      if (!item) continue;
      var rawUrl = "";
      var alt = defaultAlt;
      var caption = defaultCaption;
      if (typeof item === "string") {
        rawUrl = item;
      } else if (typeof item === "object") {
        rawUrl = String(item.url || item.src || item.image || "");
        alt = item.alt ? String(item.alt).trim().slice(0, 200) : defaultAlt;
        caption = item.caption ? String(item.caption).trim().slice(0, 300) : defaultCaption;
      }
      var clean = sanitizeImageUrl(rawUrl);
      if (!clean || seen.has(clean)) continue;
      seen.add(clean);
      var obj = { url: clean };
      if (alt) obj.alt = alt;
      if (caption) obj.caption = caption;
      out.push(obj);
      if (out.length >= 6) break;
    }
    return out;
  }

  root.ElgoModel = {
    normalizeCatalog: normalizeCatalog,
    listSubjects: listSubjects,
    getSubject: getSubject,
    listSources: listSources,
    listLectures: listLectures,
    listResources: listResources,
    buildSessionSpec: buildSessionSpec,
    continueRecommendation: continueRecommendation,
    encodeChallenge: encodeChallenge,
    decodeChallenge: decodeChallenge,
    shuffleArray: shuffleArray,
    sanitizeImageUrl: sanitizeImageUrl,
    getQuestionImages: getQuestionImages,
  };
})(typeof window !== "undefined" ? window : globalThis);
