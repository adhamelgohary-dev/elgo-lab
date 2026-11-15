/**
 * Bank Question — Content Catalog / Package Manager (Phase 4 & Phase 13)
 *
 * Separates the *content layer* (faculties → levels → terms → subjects → collections)
 * from the application engine. The engine reads subjects and hierarchy from this catalog
 * instead of hardcoding names or counts.
 *
 * Hierarchy: Faculty → Level → Term/Semester → Subject → Content
 * Default: Faculty of AI -> Level 2 -> Term 1
 *
 * Semantics that matter for safety:
 *  - "deleting" content means removing an item from the active local catalog;
 *  - source questions are never touched by this module;
 *  - user progress lives in separate localStorage keys and is never read,
 *    rewritten or removed here;
 *  - every mutation is metadata-only and reversible (archiving/deleting locally,
 *    restoring/re-enabling).
 */
(function (root) {
  "use strict";

  const STORAGE_KEY = "mcq_bank_content_state_v1";
  const SCHEMA_VERSION = 2;

  const DEFAULT_LEVELS = [
    { id: "level-1", name: "Level 1", status: "active", facultyId: "faculty-ai" },
    { id: "level-2", name: "Level 2", status: "active", facultyId: "faculty-ai" },
    { id: "level-3", name: "Level 3", status: "active", facultyId: "faculty-ai" },
    { id: "level-4", name: "Level 4", status: "active", facultyId: "faculty-ai" },
  ];

  function safeString(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function nowIso(now) {
    if (now instanceof Date) return now.toISOString();
    if (typeof now === "string") return now;
    return new Date().toISOString();
  }

  function deepClone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function defaultState(catalog) {
    const archivedTermIds = [];
    (Array.isArray(catalog && catalog.faculties) ? catalog.faculties : []).forEach((faculty) => {
      (faculty.terms || []).forEach((term) => {
        if (term.status === "archived" && !archivedTermIds.includes(term.id)) {
          archivedTermIds.push(term.id);
        }
      });
    });
    return {
      schemaVersion: SCHEMA_VERSION,
      activeFacultyId: (catalog && catalog.activeFacultyId) || "faculty-ai",
      activeLevelId: "level-2",
      activeTermId: (catalog && catalog.activeTermId) || "term-1",
      viewFacultyId: (catalog && catalog.activeFacultyId) || "faculty-ai",
      viewLevelId: "level-2",
      viewTermId: (catalog && catalog.activeTermId) || "term-1",
      archivedTermIds,
      deletedLevelIds: [],
      deletedTermIds: [],
      deletedSubjectIds: [],
      deletedFacultyIds: [],
      subjects: {},
      installedPackages: {},
      custom: { faculties: [], levels: [], terms: [], subjects: [] },
      updatedAt: null,
    };
  }

  function normalizeState(raw, catalog) {
    const base = defaultState(catalog);
    if (!raw || typeof raw !== "object") return base;
    return {
      schemaVersion: SCHEMA_VERSION,
      activeFacultyId: raw.activeFacultyId || base.activeFacultyId,
      activeLevelId: raw.activeLevelId || base.activeLevelId || "level-2",
      activeTermId: raw.activeTermId || base.activeTermId,
      viewFacultyId: raw.viewFacultyId || raw.activeFacultyId || base.viewFacultyId,
      viewLevelId: raw.viewLevelId || raw.activeLevelId || base.viewLevelId || "level-2",
      viewTermId: raw.viewTermId || raw.activeTermId || base.viewTermId,
      archivedTermIds: Array.isArray(raw.archivedTermIds) ? raw.archivedTermIds.slice() : [],
      deletedLevelIds: Array.isArray(raw.deletedLevelIds) ? raw.deletedLevelIds.slice() : [],
      deletedTermIds: Array.isArray(raw.deletedTermIds) ? raw.deletedTermIds.slice() : [],
      deletedSubjectIds: Array.isArray(raw.deletedSubjectIds) ? raw.deletedSubjectIds.slice() : [],
      deletedFacultyIds: Array.isArray(raw.deletedFacultyIds) ? raw.deletedFacultyIds.slice() : [],
      subjects: raw.subjects && typeof raw.subjects === "object" ? raw.subjects : {},
      installedPackages:
        raw.installedPackages && typeof raw.installedPackages === "object"
          ? raw.installedPackages
          : {},
      custom: {
        faculties: Array.isArray(raw.custom && raw.custom.faculties) ? raw.custom.faculties : [],
        levels: Array.isArray(raw.custom && raw.custom.levels) ? raw.custom.levels : [],
        terms: Array.isArray(raw.custom && raw.custom.terms) ? raw.custom.terms : [],
        subjects: Array.isArray(raw.custom && raw.custom.subjects) ? raw.custom.subjects : [],
      },
      updatedAt: raw.updatedAt || null,
    };
  }

  function createManager(options) {
    const opts = options || {};
    const catalog = opts.catalog || {};
    const storage = opts.storage || (typeof localStorage !== "undefined" ? localStorage : null);
    const storageKey = opts.storageKey || STORAGE_KEY;
    const clock = opts.now;

    function readState() {
      if (!storage) return defaultState(catalog);
      try {
        const raw = storage.getItem(storageKey);
        if (!raw) return defaultState(catalog);
        return normalizeState(JSON.parse(raw), catalog);
      } catch (err) {
        return defaultState(catalog);
      }
    }

    let state = readState();

    function knownTermIds() {
      const ids = new Set();
      (Array.isArray(catalog.faculties) ? catalog.faculties : []).forEach((faculty) => {
        (faculty.terms || []).forEach((term) => ids.add(term.id));
      });
      (state.custom.terms || []).forEach((term) => ids.add(term.id));
      return ids;
    }

    function ensureValidSelection() {
      const known = knownTermIds();
      if (!known.has(state.activeTermId)) state.activeTermId = catalog.activeTermId || "term-1";
      if (!known.has(state.viewTermId)) state.viewTermId = catalog.activeTermId || "term-1";
      if (!known.has(state.activeTermId) && catalog.activeTermId) state.activeTermId = catalog.activeTermId;
      state.archivedTermIds = (state.archivedTermIds || []).filter((id) => known.has(id));
      if (!state.activeLevelId) state.activeLevelId = "level-2";
      if (!state.viewLevelId) state.viewLevelId = state.activeLevelId;
    }
    ensureValidSelection();

    function persist() {
      state.updatedAt = nowIso(clock);
      if (!storage) return state;
      try {
        storage.setItem(storageKey, JSON.stringify(state));
      } catch (err) {
        /* storage full or unavailable: keep in-memory state */
      }
      return state;
    }

    // ==========================================
    // LEVELS (Faculty -> Level -> Term)
    // ==========================================
    function listLevels(facultyId) {
      const targetFaculty = facultyId || state.viewFacultyId || state.activeFacultyId || "faculty-ai";
      const baseLevels = DEFAULT_LEVELS.filter(
        (lvl) => !state.deletedLevelIds.includes(lvl.id) && (!lvl.facultyId || lvl.facultyId === targetFaculty)
      );
      const customLevels = (state.custom.levels || []).filter(
        (lvl) => !state.deletedLevelIds.includes(lvl.id) && (!lvl.facultyId || lvl.facultyId === targetFaculty)
      );
      const byId = new Map();
      baseLevels.forEach((lvl) => byId.set(lvl.id, Object.assign({}, lvl)));
      customLevels.forEach((lvl) => byId.set(lvl.id, Object.assign({}, byId.get(lvl.id) || {}, lvl)));

      return Array.from(byId.values()).map((lvl) => ({
        id: lvl.id,
        name: lvl.name,
        facultyId: lvl.facultyId || targetFaculty,
        status: lvl.id === state.activeLevelId ? "active" : (lvl.status || "active"),
      }));
    }

    function getLevel(levelId) {
      if (!levelId) return null;
      const all = listLevels();
      return all.find((lvl) => lvl.id === levelId) || { id: levelId, name: levelId, status: "active" };
    }

    function addLevel(meta) {
      if (!meta || !meta.id) throw new Error("A level id is required.");
      const facultyId = meta.facultyId || state.viewFacultyId || "faculty-ai";
      if (listLevels(facultyId).some((lvl) => lvl.id === meta.id)) {
        throw new Error(`Level already exists: ${meta.id}`);
      }
      state.deletedLevelIds = state.deletedLevelIds.filter((id) => id !== meta.id);
      state.custom.levels.push({
        id: meta.id,
        facultyId,
        name: meta.name || meta.id,
        status: meta.status || "active",
        createdAt: nowIso(clock),
      });
      persist();
      return state;
    }

    function editLevel(levelId, updates) {
      if (!levelId) throw new Error("A level id is required.");
      let lvl = (state.custom.levels || []).find((item) => item.id === levelId);
      if (!lvl) {
        const base = DEFAULT_LEVELS.find((item) => item.id === levelId);
        lvl = Object.assign({}, base || { id: levelId, name: levelId, status: "active" });
        state.custom.levels.push(lvl);
      }
      Object.assign(lvl, updates, { updatedAt: nowIso(clock) });
      persist();
      return lvl;
    }

    function activateLevel(levelId) {
      state.activeLevelId = levelId;
      state.viewLevelId = levelId;
      persist();
      return state;
    }

    function deactivateLevel(levelId) {
      editLevel(levelId, { status: "inactive" });
      persist();
      return state;
    }

    function deleteLevel(levelId) {
      if (!state.deletedLevelIds.includes(levelId)) {
        state.deletedLevelIds.push(levelId);
      }
      if (state.activeLevelId === levelId) {
        state.activeLevelId = "level-2";
      }
      if (state.viewLevelId === levelId) {
        state.viewLevelId = "level-2";
      }
      persist();
      return state;
    }

    function restoreLevel(levelId) {
      state.deletedLevelIds = state.deletedLevelIds.filter((id) => id !== levelId);
      persist();
      return state;
    }

    // ==========================================
    // TERMS & FACULTIES
    // ==========================================
    function catalogTerm(termId) {
      const faculties = Array.isArray(catalog.faculties) ? catalog.faculties : [];
      for (const faculty of faculties) {
        const term = (faculty.terms || []).find((item) => item.id === termId);
        if (term) return Object.assign({ facultyId: faculty.id }, term);
      }
      return null;
    }

    function customTerm(termId) {
      return (state.custom.terms || []).find((term) => term.id === termId) || null;
    }

    function getTerm(termId) {
      if (state.deletedTermIds.includes(termId)) return null;
      const cat = catalogTerm(termId);
      const cust = customTerm(termId);
      if (!cat && !cust) return null;
      const base = Object.assign({}, cat || {}, cust || {});
      return Object.assign({}, base, {
        status: getTermStatus(termId),
        subjects: listSubjects(termId),
      });
    }

    function getTermStatus(termId) {
      if (state.deletedTermIds.includes(termId)) return "archived";
      if (state.activeTermId === termId) return "active";
      if (state.archivedTermIds.includes(termId)) return "archived";
      return "inactive";
    }

    function listFaculties() {
      const catalogFaculties = Array.isArray(catalog.faculties) ? catalog.faculties : [];
      return catalogFaculties
        .concat(state.custom.faculties || [])
        .filter((faculty) => !state.deletedFacultyIds.includes(faculty.id))
        .map((faculty) =>
          Object.assign({}, faculty, {
            terms: (faculty.terms || [])
              .filter((term) => !state.deletedTermIds.includes(term.id))
              .map((term) =>
                Object.assign({}, term, { status: getTermStatus(term.id) })
              ),
          })
        );
    }

    function listTerms(facultyId) {
      const faculties = listFaculties();
      const faculty = facultyId ? faculties.find((item) => item.id === facultyId) : faculties[0];
      if (!faculty) return [];
      const termsMap = new Map();
      (faculty.terms || []).forEach((t) => termsMap.set(t.id, Object.assign({}, t)));
      (state.custom.terms || [])
        .filter((term) => (!term.facultyId || term.facultyId === faculty.id) && !state.deletedTermIds.includes(term.id))
        .forEach((t) => termsMap.set(t.id, Object.assign({}, termsMap.get(t.id) || {}, t)));
      return Array.from(termsMap.values())
        .filter((t) => !state.deletedTermIds.includes(t.id))
        .map((term) => Object.assign({}, term, { status: getTermStatus(term.id) }));
    }

    function listSubjects(termId) {
      const activeTermId = termId || state.viewTermId || state.activeTermId;
      if (!activeTermId) return [];
      const fromCatalog =
        activeTermId === catalog.activeTermId && Array.isArray(catalog.subjects)
          ? catalog.subjects
          : [];
      const fromCustom = (state.custom.subjects || []).filter(
        (subject) => subject.termId === activeTermId
      );
      const byId = new Map();
      fromCatalog.forEach((subject) => byId.set(subject.id, subject));
      fromCustom.forEach((subject) => {
        byId.set(subject.id, Object.assign({}, byId.get(subject.id) || {}, subject));
      });
      return Array.from(byId.values())
        .filter((subject) => !state.deletedSubjectIds.includes(subject.id))
        .map((subject) =>
          Object.assign({}, subject, {
            enabled: isSubjectEnabled(subject.id),
            installed: Boolean(state.installedPackages[subject.id]),
            installedVersion: state.installedPackages[subject.id]
              ? state.installedPackages[subject.id].version
              : null,
          })
        );
    }

    function getSubject(subjectId) {
      const all = listSubjects(state.activeTermId);
      return all.find((subject) => subject.id === subjectId) || null;
    }

    function isSubjectEnabled(subjectId) {
      if (state.deletedSubjectIds.includes(subjectId)) return false;
      const entry = state.subjects[subjectId];
      if (!entry) return true;
      return entry.enabled !== false;
    }

    function setSubjectEnabled(subjectId, enabled) {
      state.subjects[subjectId] = Object.assign({}, state.subjects[subjectId], {
        enabled: Boolean(enabled),
        updatedAt: nowIso(clock),
      });
      persist();
      return state;
    }

    function deactivateSubject(subjectId) {
      return setSubjectEnabled(subjectId, false);
    }

    function activateSubject(subjectId) {
      state.deletedSubjectIds = state.deletedSubjectIds.filter((id) => id !== subjectId);
      return setSubjectEnabled(subjectId, true);
    }

    function editSubject(subjectId, updates) {
      let subj = (state.custom.subjects || []).find((s) => s.id === subjectId);
      if (!subj) {
        const base = (catalog.subjects || []).find((s) => s.id === subjectId);
        subj = deepClone(base || { id: subjectId, name: subjectId, termId: state.activeTermId });
        state.custom.subjects.push(subj);
      }
      Object.assign(subj, updates, { updatedAt: nowIso(clock) });
      persist();
      return subj;
    }

    function deleteSubject(subjectId) {
      if (!state.deletedSubjectIds.includes(subjectId)) {
        state.deletedSubjectIds.push(subjectId);
      }
      setSubjectEnabled(subjectId, false);
      persist();
      return state;
    }

    function restoreSubject(subjectId) {
      state.deletedSubjectIds = state.deletedSubjectIds.filter((id) => id !== subjectId);
      setSubjectEnabled(subjectId, true);
      persist();
      return state;
    }

    function activateTerm(termId) {
      if (!catalogTerm(termId) && !customTerm(termId)) {
        throw new Error(`Unknown term: ${termId}`);
      }
      const previous = state.activeTermId;
      if (previous && previous !== termId) {
        if (!state.archivedTermIds.includes(previous)) {
          state.archivedTermIds.push(previous);
        }
      }
      state.activeTermId = termId;
      state.viewTermId = termId;
      state.activeFacultyId = (catalogTerm(termId) || {}).facultyId || state.activeFacultyId;
      state.viewFacultyId = state.activeFacultyId;
      state.archivedTermIds = state.archivedTermIds.filter((id) => id !== termId);
      state.deletedTermIds = state.deletedTermIds.filter((id) => id !== termId);
      persist();
      return state;
    }

    function deactivateTerm(termId) {
      if (!state.archivedTermIds.includes(termId)) {
        state.archivedTermIds.push(termId);
      }
      persist();
      return state;
    }

    function editTerm(termId, updates) {
      let term = (state.custom.terms || []).find((t) => t.id === termId);
      if (!term) {
        const base = catalogTerm(termId);
        term = deepClone(base || { id: termId, name: termId, facultyId: state.activeFacultyId });
        state.custom.terms.push(term);
      }
      Object.assign(term, updates, { updatedAt: nowIso(clock) });
      persist();
      return term;
    }

    function deleteTerm(termId) {
      if (state.activeTermId === termId) {
        throw new Error("Cannot delete the currently active term.");
      }
      if (!state.deletedTermIds.includes(termId)) {
        state.deletedTermIds.push(termId);
      }
      persist();
      return state;
    }

    function restoreTerm(termId) {
      state.deletedTermIds = state.deletedTermIds.filter((id) => id !== termId);
      persist();
      return state;
    }

    function setViewSelection(selection) {
      const next = selection || {};
      const facultyId = next.facultyId || state.viewFacultyId;
      const levelId = next.levelId || state.viewLevelId || "level-2";
      const termId = next.termId || state.viewTermId;
      if (!catalogTerm(termId) && !customTerm(termId)) {
        throw new Error(`Unknown term: ${termId}`);
      }
      state.viewFacultyId = facultyId;
      state.viewLevelId = levelId;
      state.viewTermId = termId;
      persist();
      return getViewSelection();
    }

    function getViewSelection() {
      const facId = state.viewFacultyId || state.activeFacultyId || "faculty-ai";
      const lvlId = state.viewLevelId || state.activeLevelId || "level-2";
      const trmId = state.viewTermId || state.activeTermId || "term-1";
      return {
        facultyId: facId,
        levelId: lvlId,
        termId: trmId,
        faculty: listFaculties().find((faculty) => faculty.id === facId) || { id: facId, name: "Faculty of AI" },
        level: getLevel(lvlId) || { id: lvlId, name: "Level 2" },
        term: getTerm(trmId) || { id: trmId, name: "Term 1" },
      };
    }

    function archiveTerm(termId) {
      if (state.activeTermId === termId) {
        throw new Error("Cannot archive the active term without a replacement.");
      }
      if (!state.archivedTermIds.includes(termId)) state.archivedTermIds.push(termId);
      persist();
      return state;
    }

    function replaceActiveTerm(termId) {
      return activateTerm(termId);
    }

    function addFaculty(meta) {
      if (!meta || !meta.id) throw new Error("A faculty id is required.");
      if (listFaculties().some((faculty) => faculty.id === meta.id)) {
        throw new Error(`Faculty already exists: ${meta.id}`);
      }
      state.deletedFacultyIds = state.deletedFacultyIds.filter((id) => id !== meta.id);
      state.custom.faculties.push({
        id: meta.id,
        name: meta.name || meta.id,
        terms: [],
        createdAt: nowIso(clock),
      });
      persist();
      return state;
    }

    function editFaculty(facultyId, updates) {
      let fac = (state.custom.faculties || []).find((f) => f.id === facultyId);
      if (!fac) {
        const base = (catalog.faculties || []).find((f) => f.id === facultyId);
        fac = deepClone(base || { id: facultyId, name: facultyId });
        state.custom.faculties.push(fac);
      }
      Object.assign(fac, updates, { updatedAt: nowIso(clock) });
      persist();
      return fac;
    }

    function deleteFaculty(facultyId) {
      if (state.activeFacultyId === facultyId) {
        throw new Error("Cannot delete the active faculty.");
      }
      if (!state.deletedFacultyIds.includes(facultyId)) {
        state.deletedFacultyIds.push(facultyId);
      }
      persist();
      return state;
    }

    function restoreFaculty(facultyId) {
      state.deletedFacultyIds = state.deletedFacultyIds.filter((id) => id !== facultyId);
      persist();
      return state;
    }

    function addTerm(meta) {
      if (!meta || !meta.id || !meta.facultyId) {
        throw new Error("A term id and facultyId are required.");
      }
      if (listTerms(meta.facultyId).some((term) => term.id === meta.id)) {
        throw new Error(`Term already exists: ${meta.id}`);
      }
      state.deletedTermIds = state.deletedTermIds.filter((id) => id !== meta.id);
      state.custom.terms.push({
        id: meta.id,
        facultyId: meta.facultyId,
        name: meta.name || meta.id,
        status: meta.status || "inactive",
        createdAt: nowIso(clock),
      });
      persist();
      return state;
    }

    function addSubject(meta) {
      if (!meta || !meta.id) throw new Error("A subject id is required.");
      const termId = meta.termId || state.activeTermId;
      if (!termId) throw new Error("No active term to add the subject to.");
      if (listSubjects(termId).some((subject) => subject.id === meta.id)) {
        throw new Error(`Subject already exists: ${meta.id}`);
      }
      state.deletedSubjectIds = state.deletedSubjectIds.filter((id) => id !== meta.id);
      state.custom.subjects.push({
        id: meta.id,
        name: meta.name || meta.id,
        termId,
        version: meta.version || "0.0.0",
        counts: meta.counts || {
          quizzes: 0,
          quizQuestions: 0,
          lectures: 0,
          lectureQuestions: 0,
          sheets: 0,
          sheetQuestions: 0,
        },
        collections: { lectures: [], quizzes: [], sheets: [] },
        createdAt: nowIso(clock),
      });
      persist();
      return state;
    }

    function addCollection(subjectId, collectionType, meta) {
      const allowed = ["lectures", "quizzes", "sheets"];
      if (!allowed.includes(collectionType)) {
        throw new Error(`Unknown collection type: ${collectionType}`);
      }
      if (!meta || !meta.id) throw new Error("A collection id is required.");
      if (!Array.isArray(state.custom.subjects)) state.custom.subjects = [];
      let subject = state.custom.subjects.find((item) => item.id === subjectId);
      if (!subject) {
        const base = Array.isArray(catalog.subjects)
          ? catalog.subjects.find((item) => item.id === subjectId)
          : null;
        if (!base) throw new Error(`Unknown subject: ${subjectId}`);
        subject = deepClone(base);
        state.custom.subjects.push(subject);
      }
      if (!subject.collections) subject.collections = { lectures: [], quizzes: [], sheets: [] };
      if (!Array.isArray(subject.collections[collectionType])) {
        subject.collections[collectionType] = [];
      }
      if (subject.collections[collectionType].some((item) => item.id === meta.id)) {
        throw new Error(`${collectionType} already contains ${meta.id}`);
      }
      subject.collections[collectionType].push({
        id: meta.id,
        title: meta.title || meta.id,
        questionCount: meta.questionCount || 0,
        createdAt: nowIso(clock),
      });
      persist();
      return state;
    }

    function addLecture(subjectId, meta) {
      return addCollection(subjectId, "lectures", meta);
    }

    function addQuiz(subjectId, meta) {
      return addCollection(subjectId, "quizzes", meta);
    }

    function addSheet(subjectId, meta) {
      return addCollection(subjectId, "sheets", meta);
    }

    function markInstalled(subjectId, meta) {
      const info = meta || {};
      state.installedPackages[subjectId] = {
        version: info.version || "0.0.0",
        installedAt: info.installedAt || nowIso(clock),
        termId: info.termId || state.activeTermId,
        checksum: info.checksum || null,
      };
      persist();
      return state;
    }

    function removeInstalledPackage(subjectId) {
      if (state.installedPackages[subjectId]) {
        delete state.installedPackages[subjectId];
        persist();
      }
      return state;
    }

    function getPackageStatus(subjectId, remoteVersion) {
      const installed = state.installedPackages[subjectId];
      if (!installed) return "not-downloaded";
      if (remoteVersion && installed.version !== remoteVersion) return "update-available";
      return "downloaded";
    }

    function getState() {
      return deepClone(state);
    }

    function reload() {
      state = readState();
      ensureValidSelection();
      return state;
    }

    return {
      STORAGE_KEY: storageKey,
      getCatalog: () => catalog,
      getState,
      getTerm,
      getTermStatus,
      getActiveTerm: () => getTerm(state.activeTermId),
      getViewSelection,
      setViewSelection,
      listFaculties,
      addFaculty,
      editFaculty,
      deleteFaculty,
      restoreFaculty,
      listLevels,
      getLevel,
      addLevel,
      editLevel,
      activateLevel,
      deactivateLevel,
      deleteLevel,
      restoreLevel,
      listTerms,
      addTerm,
      editTerm,
      deactivateTerm,
      deleteTerm,
      restoreTerm,
      listSubjects,
      getSubject,
      isSubjectEnabled,
      setSubjectEnabled,
      addSubject,
      activateSubject,
      deactivateSubject,
      editSubject,
      deleteSubject,
      restoreSubject,
      activateTerm,
      archiveTerm,
      replaceActiveTerm,
      addLecture,
      addQuiz,
      addSheet,
      markInstalled,
      removeInstalledPackage,
      getInstalledPackage: (subjectId) => state.installedPackages[subjectId] || null,
      getPackageStatus,
      reload,
      ensureValidSelection,
    };
  }

  const api = {
    STORAGE_KEY,
    SCHEMA_VERSION,
    DEFAULT_LEVELS,
    createManager,
    defaultState,
    normalizeState,
  };

  root.BankQuestionCore = root.BankQuestionCore || {};
  root.BankQuestionCore.ContentCatalog = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
