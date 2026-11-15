/**
 * Bank Question — Content Library (PDFs, Videos, Images)
 *
 * The library is metadata only. It never touches questions or answers.
 *  - bundled defaults come from content/index.js (BANK_CONTENT_LIBRARY);
 *  - local admin edits are stored as an overlay in localStorage;
 *  - uploaded PDF blobs live in IndexedDB (offline) and are never written to
 *    the original source files;
 *  - removing an entry deactivates or archives it in the active configuration;
 *    it does not delete bundled files or source content.
 */
(function (root) {
  "use strict";

  const STORAGE_KEY = "mcq_bank_content_library_v1";
  const SCHEMA_VERSION = 2;

  const DEFAULT_PDF_CATEGORIES = [
    { id: "summaries", name: "Summaries", description: "Subject summaries & cheat sheets", order: 1 },
    { id: "essay-ideas", name: "Essay Ideas", description: "Essay topics, outlines & writing prompts", order: 2 },
    { id: "lecture-notes", name: "Lecture Notes", description: "Official & student lecture notes", order: 3 },
    { id: "assignments", name: "Assignments", description: "Problem sets, sheets & solutions", order: 4 },
    { id: "exam-reviews", name: "Exam Reviews", description: "Midterm & final exam revisions", order: 5 },
    { id: "references", name: "References", description: "Textbooks & reference materials", order: 6 },
    { id: "important-questions", name: "Important Questions", description: "High-yield practice & revision questions", order: 7 },
  ];

  function nowIso(now) {
    if (now instanceof Date) return now.toISOString();
    if (typeof now === "string") return now;
    return new Date().toISOString();
  }

  function slugify(str) {
    return String(str || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "item";
  }

  function deepClone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function isUnsafeLocalPath(rawPath) {
    if (typeof rawPath !== "string") return false;
    const trimmed = rawPath.trim();
    if (!trimmed) return false;
    return (
      /^[a-zA-Z]:[\\/]/.test(trimmed) ||
      /^file:\/\//i.test(trimmed) ||
      /^\\\\/.test(trimmed) ||
      /(?:^|[\\/])(?:Users|Desktop|Downloads|Documents|AppData|Temp)(?:[\\/]|$)/i.test(trimmed)
    );
  }

  function sanitizeAssetPath(rawPath) {
    if (typeof rawPath !== "string") return "";
    let cleaned = rawPath.trim().replace(/\\/g, "/");
    if (!cleaned) return "";
    if (isUnsafeLocalPath(cleaned)) return "";
    if (/^https?:\/\//i.test(cleaned) || /^blob:/i.test(cleaned) || /^data:/i.test(cleaned)) {
      return cleaned;
    }
    // Server-hosted PDFs (R2) are served from the API and keep their absolute path.
    if (/^\/api\/r2\/pdfs\/[a-z0-9-]+\/[a-f0-9]{32}\.pdf$/.test(cleaned)) {
      return cleaned;
    }
    cleaned = cleaned.replace(/^\.\/+/, "").replace(/^\/+/, "");
    return cleaned;
  }

  function inferPdfCategory(item) {
    if (!item) return "lecture-notes";
    const cat = String(item.category || "").trim().toLowerCase();
    if (DEFAULT_PDF_CATEGORIES.some((c) => c.id === cat)) return cat;
    const text = `${item.title || ""} ${item.topic || ""} ${item.path || ""}`.toLowerCase();
    if (text.includes("summary") || text.includes("summarize") || text.includes("summaries")) {
      return "summaries";
    }
    if (text.includes("quiz") || text.includes("exam") || text.includes("subnetting") || text.includes("msq") || text.includes("mcq")) {
      return "exam-reviews";
    }
    if (text.includes("sheet") || text.includes("assignment")) {
      return "assignments";
    }
    return "lecture-notes";
  }

  function emptyOverlay() {
    return {
      schemaVersion: SCHEMA_VERSION,
      pdfs: [],
      pdfCategories: [],
      videos: [],
      images: [],
      removed: { pdfs: [], pdfCategories: [], videos: [], images: [] },
      updatedAt: null,
    };
  }

  function normalizeOverlay(raw) {
    const overlay = emptyOverlay();
    if (!raw || typeof raw !== "object") return overlay;
    ["pdfs", "pdfCategories", "videos", "images"].forEach((type) => {
      if (Array.isArray(raw[type])) overlay[type] = raw[type];
      if (raw.removed && Array.isArray(raw.removed[type])) {
        overlay.removed[type] = raw.removed[type];
      }
    });
    overlay.updatedAt = raw.updatedAt || null;
    return overlay;
  }

  function isValidYouTubeVideoId(id) {
    return typeof id === "string" && /^[A-Za-z0-9_-]{11}$/.test(id.trim());
  }

  function extractYouTubeVideoId(urlOrId) {
    if (typeof urlOrId !== "string") return null;
    const value = urlOrId.trim();
    if (!value) return null;

    const isUrl =
      /^https?:\/\//i.test(value) ||
      /^(?:www\.|m\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)/i.test(value) ||
      value.includes("/") ||
      value.includes("?") ||
      value.includes(".");

    if (isUrl) {
      try {
        let urlStr = value;
        if (!urlStr.startsWith("http://") && !urlStr.startsWith("https://") && !urlStr.startsWith("//")) {
          urlStr = "https://" + urlStr;
        } else if (urlStr.startsWith("//")) {
          urlStr = "https:" + urlStr;
        }
        const parsed = new URL(urlStr);
        const host = parsed.hostname.toLowerCase().replace(/^www\./, "");

        if (host === "youtu.be") {
          const candidate = parsed.pathname.replace(/^\/+/, "").split("/")[0];
          if (isValidYouTubeVideoId(candidate)) return candidate;
          return null;
        }

        if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
          const v = parsed.searchParams.get("v");
          if (v && isValidYouTubeVideoId(v)) return v;

          const parts = parsed.pathname.split("/").filter(Boolean);
          if (parts.length >= 2 && ["embed", "shorts", "v", "e"].includes(parts[0].toLowerCase())) {
            if (isValidYouTubeVideoId(parts[1])) return parts[1];
          }
          return null;
        }

        return null;
      } catch (_err) {
        // Fall through
      }

      const m = value.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?[^#]*v=|embed\/|shorts\/|v\/|e\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i);
      if (m && isValidYouTubeVideoId(m[1])) return m[1];
      return null;
    }

    if (isValidYouTubeVideoId(value)) return value;
    return null;
  }

  const extractYouTubeId = extractYouTubeVideoId;

  function normalizeYouTubeUrl(urlOrId) {
    const videoId = extractYouTubeVideoId(urlOrId);
    return videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
  }

  function privacyEmbedUrl(urlOrId) {
    const videoId = extractYouTubeVideoId(urlOrId);
    return videoId ? `https://www.youtube-nocookie.com/embed/${videoId}` : null;
  }

  function validateVideo(video) {
    const errors = [];
    if (!video || !String(video.title || "").trim()) errors.push("Video title is required.");
    if (!video || !String(video.subjectId || "").trim()) errors.push("Video subject is required.");
    const videoId = extractYouTubeVideoId(video && (video.youtubeUrl || video.videoId));
    if (!videoId) errors.push("A valid YouTube URL or 11-character video id is required.");
    if (video && video.order !== undefined && !Number.isFinite(Number(video.order))) {
      errors.push("Display order must be a number.");
    }
    return { ok: errors.length === 0, errors, videoId };
  }

  function createLibrary(options) {
    const opts = options || {};
    const bundled = opts.bundled || { pdfs: [], videos: [], images: [] };
    const storage = opts.storage || (typeof localStorage !== "undefined" ? localStorage : null);
    const fileStore = opts.fileStore || null;
    const storageKey = opts.storageKey || STORAGE_KEY;
    const clock = opts.now;

    function readOverlay() {
      if (!storage) return emptyOverlay();
      try {
        const raw = storage.getItem(storageKey);
        return normalizeOverlay(raw ? JSON.parse(raw) : null);
      } catch (err) {
        return emptyOverlay();
      }
    }

    let overlay = readOverlay();

    let changeListener = null;

    function writeOverlayToStorage() {
      if (!storage) return;
      try {
        storage.setItem(storageKey, JSON.stringify(overlay));
      } catch (err) {
        /* quota errors are non-fatal; keep in-memory */
      }
    }

    function persist() {
      overlay.updatedAt = nowIso(clock);
      writeOverlayToStorage();
      if (changeListener) {
        try { changeListener(); } catch (err) { /* listener errors must not break editing */ }
      }
    }

    /** Called after every local admin edit (used to publish the overlay to the server). */
    function onChange(listener) {
      changeListener = typeof listener === "function" ? listener : null;
    }

    /** Replace the overlay with the server's shared copy. Does not notify onChange. */
    function replaceOverlay(raw) {
      overlay = normalizeOverlay(raw);
      writeOverlayToStorage();
    }

    function merged(type, subjectId, includeInactive, includeArchived) {
      const bundledList = Array.isArray(bundled[type]) ? bundled[type] : [];
      const byId = new Map();
      bundledList.forEach((item) => byId.set(item.id, Object.assign({}, item)));
      (overlay[type] || []).forEach((item) => {
        byId.set(item.id, Object.assign({}, byId.get(item.id) || {}, item));
      });

      const removedSet = new Set(overlay.removed[type] || []);

      return Array.from(byId.values())
        .filter((item) => !subjectId || item.subjectId === subjectId)
        .filter((item) => {
          const isArchived = removedSet.has(item.id);
          if (isArchived && !includeArchived) return false;
          if (!includeInactive && item.active === false && !isArchived) return false;
          return true;
        })
        .map((item) => {
          const isArchived = removedSet.has(item.id);
          const status = isArchived ? "archived" : (item.active === false ? "inactive" : "active");
          return Object.assign({}, item, { status, active: !isArchived && item.active !== false });
        })
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    }

    // ==========================================
    // PDF METHODS & CATEGORIES
    // ==========================================
    function getPdfCategories(subjectId, includeInactive) {
      const custom = deepClone(merged("pdfCategories", subjectId, includeInactive, false));
      const seen = new Set(custom.map((c) => c.id));
      const defaults = DEFAULT_PDF_CATEGORIES
        .filter((d) => !seen.has(d.id))
        .map((d) => Object.assign({}, d, { subjectId, isDefault: true, active: true }));
      return [...defaults, ...custom].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    }

    function addPdfCategory(meta) {
      if (!meta || !meta.id) throw new Error("A category id is required.");
      if (!meta.subjectId) throw new Error("A category must belong to a subject.");
      return upsert(
        "pdfCategories",
        Object.assign(
          {
            active: true,
            order: 1,
            description: "",
          },
          meta
        )
      );
    }

    function editPdfCategory(id, updates) {
      return editItem("pdfCategories", id, updates);
    }

    function renamePdfCategory(id, newName, subjectId) {
      const cleanName = String(newName || "").trim();
      if (!cleanName) throw new Error("Category name cannot be empty.");
      const existing = (overlay.pdfCategories || []).find((c) => c.id === id);
      if (existing) {
        return editPdfCategory(id, { name: cleanName });
      }
      const def = DEFAULT_PDF_CATEGORIES.find((d) => d.id === id);
      if (def) {
        return addPdfCategory(Object.assign({}, def, { subjectId: subjectId || "all", name: cleanName }));
      }
      throw new Error(`Category not found: ${id}`);
    }

    function reorderPdfCategories(subjectId, orderedIds) {
      if (!Array.isArray(orderedIds)) throw new Error("orderedIds must be an array.");
      const cats = getPdfCategories(subjectId, true);
      orderedIds.forEach((catId, index) => {
        const found = cats.find((c) => c.id === catId);
        if (found) {
          addPdfCategory(Object.assign({}, found, { subjectId: found.subjectId || subjectId || "all", order: index + 1 }));
        }
      });
      return getPdfCategories(subjectId, false);
    }

    function deletePdfCategory(id) {
      return deleteItem("pdfCategories", id);
    }

    function getPdfs(subjectId, includeInactive, includeArchived, categoryId) {
      let list = deepClone(merged("pdfs", subjectId, includeInactive, includeArchived)).map((pdf) => {
        const category = pdf.category || inferPdfCategory(pdf);
        const rawPath = pdf.path || "";
        const unsafe = isUnsafeLocalPath(rawPath);
        const cleanPath = unsafe ? "" : sanitizeAssetPath(rawPath);
        return Object.assign({}, pdf, {
          category,
          topic: pdf.topic || category,
          path: cleanPath || null,
          unsafeLocalPath: unsafe ? rawPath : null,
        });
      });
      if (categoryId && categoryId !== "all") {
        list = list.filter((pdf) => (pdf.category === categoryId || pdf.topic === categoryId));
      }
      return list;
    }

    function addPdf(meta) {
      if (!meta || !meta.id) throw new Error("A PDF id is required.");
      if (!meta.subjectId) throw new Error("A PDF must belong to a subject.");
      if (!meta.path && !meta.fileId) throw new Error("A PDF path or uploaded file is required.");
      if (meta.path && isUnsafeLocalPath(meta.path) && !meta.fileId) {
        throw new Error("Local computer paths (C:\\, E:\\, file://, Desktop) cannot be used on a deployed website. Use a project-relative path such as content/pdfs/... or upload the file.");
      }
      const cleanPath = meta.path ? sanitizeAssetPath(meta.path) : null;
      const cat = meta.category || inferPdfCategory(meta);
      return upsert(
        "pdfs",
        Object.assign(
          {
            type: "pdf",
            active: true,
            order: 1,
            topic: meta.topic || cat,
            category: cat,
            description: "",
            thumbnail: null,
            lectureId: null,
            originalSource: null,
          },
          meta,
          {
            path: cleanPath,
            category: cat,
            topic: meta.topic || cat,
          }
        )
      );
    }

    function editPdf(id, updates) {
      const upd = Object.assign({}, updates);
      if (upd.path !== undefined) {
        if (upd.path && isUnsafeLocalPath(upd.path)) {
          throw new Error("Local computer paths (C:\\, E:\\, file://, Desktop) cannot be used on a deployed website.");
        }
        upd.path = upd.path ? sanitizeAssetPath(upd.path) : "";
      }
      if (upd.category && !upd.topic) {
        upd.topic = upd.category;
      }
      return editItem("pdfs", id, upd);
    }

    function movePdfToCategory(id, newCategoryId) {
      return editPdf(id, { category: newCategoryId, topic: newCategoryId });
    }

    function bulkAddPdfs(subjectId, categoryId, pdfList) {
      if (!subjectId) throw new Error("A subject id is required for bulk PDF import.");
      if (!Array.isArray(pdfList) || pdfList.length === 0) throw new Error("No PDFs provided for import.");
      const results = [];
      pdfList.forEach((item, index) => {
        const id = item.id || `pdf-${subjectId}-${slugify(item.title || "doc")}-${Date.now()}-${index}`;
        const record = addPdf({
          id,
          subjectId,
          title: item.title || `Document ${index + 1}`,
          description: item.description || "",
          category: categoryId || item.category || "lecture-notes",
          topic: categoryId || item.topic || "lecture-notes",
          path: item.path || "",
          fileId: item.fileId || null,
          thumbnail: item.thumbnail || null,
          order: item.order !== undefined ? item.order : index + 1,
        });
        results.push(record);
      });
      return results;
    }

    function activatePdf(id) {
      return activateItem("pdfs", id);
    }

    function deactivatePdf(id) {
      return deactivate("pdfs", id);
    }

    function deletePdf(id) {
      return deleteItem("pdfs", id);
    }

    function restorePdf(id) {
      return restoreItem("pdfs", id);
    }

    // ==========================================
    // VIDEO METHODS
    // ==========================================
    function getVideos(subjectId, options) {
      const filter = options || {};
      let list = merged("videos", subjectId, filter.includeInactive, filter.includeArchived);
      if (filter.topic) list = list.filter((video) => video.topic === filter.topic);
      const query = String(filter.query || "").trim().toLowerCase();
      if (query) {
        list = list.filter((video) =>
          `${video.title || ""} ${video.description || ""} ${video.topic || ""} ${video.lectureTitle || ""}`
            .toLowerCase()
            .includes(query)
        );
      }
      return deepClone(list);
    }

    function groupVideosByTopic(subjectId, options) {
      const groups = [];
      const map = new Map();
      getVideos(subjectId, options).forEach((video) => {
        const key = video.topic || video.lectureTitle || "General";
        if (!map.has(key)) {
          map.set(key, { topic: key, videos: [] });
          groups.push(map.get(key));
        }
        map.get(key).videos.push(video);
      });
      return groups;
    }

    function addVideo(meta) {
      const validation = validateVideo(meta);
      if (!validation.ok) throw new Error(validation.errors.join(" "));
      return upsert(
        "videos",
        Object.assign(
          {
            type: "video",
            active: true,
            order: 1,
            topic: "General",
            lectureId: null,
            lectureTitle: null,
            duration: null,
            playlist: null,
            thumbnail: null,
            description: "",
            youtubeUrl: null,
          },
          meta,
          {
            videoId: validation.videoId,
            embedUrl: privacyEmbedUrl(validation.videoId),
            thumbnail:
              meta.thumbnail ||
              `https://img.youtube.com/vi/${validation.videoId}/hqdefault.jpg`,
          }
        )
      );
    }

    function editVideo(id, updates) {
      const upd = Object.assign({}, updates);
      if (upd.youtubeUrl || upd.videoId) {
        const vidId = extractYouTubeVideoId(upd.youtubeUrl || upd.videoId);
        if (vidId) {
          upd.videoId = vidId;
          upd.embedUrl = privacyEmbedUrl(vidId);
          if (!upd.thumbnail) {
            upd.thumbnail = `https://img.youtube.com/vi/${vidId}/hqdefault.jpg`;
          }
        }
      }
      return editItem("videos", id, upd);
    }

    function activateVideo(id) {
      return activateItem("videos", id);
    }

    function deactivateVideo(id) {
      return deactivate("videos", id);
    }

    function deleteVideo(id) {
      return deleteItem("videos", id);
    }

    function restoreVideo(id) {
      return restoreItem("videos", id);
    }

    // ==========================================
    // IMAGES METHODS
    // ==========================================
    function getImages(subjectId, options) {
      const filter = options || {};
      let list = merged("images", subjectId, filter.includeInactive, filter.includeArchived);
      if (filter.type) list = list.filter((img) => img.type === filter.type);
      if (filter.questionId) list = list.filter((img) => img.questionId === filter.questionId);
      return deepClone(list);
    }

    function addImage(meta) {
      if (!meta || !meta.id) throw new Error("An image id is required.");
      if (!meta.path && !meta.url) throw new Error("An image path or URL is required.");
      return upsert(
        "images",
        Object.assign(
          {
            type: "question", // question | option | explanation | asset
            active: true,
            order: 1,
            title: meta.title || meta.id,
            subjectId: meta.subjectId || null,
            lectureId: meta.lectureId || null,
            questionId: meta.questionId || null,
            path: meta.path || meta.url,
            url: meta.url || meta.path,
          },
          meta
        )
      );
    }

    function editImage(id, updates) {
      return editItem("images", id, updates);
    }

    function activateImage(id) {
      return activateItem("images", id);
    }

    function deactivateImage(id) {
      return deactivate("images", id);
    }

    function deleteImage(id) {
      return deleteItem("images", id);
    }

    function hardDeletePdf(id) {
      return hardDeleteItem("pdfs", id);
    }

    function hardDeleteVideo(id) {
      return hardDeleteItem("videos", id);
    }

    function hardDeleteImage(id) {
      return hardDeleteItem("images", id);
    }

    function restoreImage(id) {
      return restoreItem("images", id);
    }

    // ==========================================
    // GENERIC ITEM OPERATIONS
    // ==========================================
    function upsert(type, item) {
      if (!item || !item.id) throw new Error("An id is required.");
      const existingIndex = (overlay[type] || []).findIndex((entry) => entry.id === item.id);
      const record = Object.assign({}, item, { updatedAt: nowIso(clock) });
      if (!Array.isArray(overlay[type])) overlay[type] = [];
      if (existingIndex >= 0) overlay[type][existingIndex] = record;
      else overlay[type].push(record);
      if (overlay.removed && Array.isArray(overlay.removed[type])) {
        overlay.removed[type] = overlay.removed[type].filter((id) => id !== item.id);
      }
      persist();
      return deepClone(record);
    }

    function editItem(type, id, updates) {
      const allowed = ["pdfs", "pdfCategories", "videos", "images"];
      if (!allowed.includes(type)) throw new Error("Unknown library type: " + type);
      const bundledItem = (bundled[type] || []).find((item) => item.id === id);
      let overlayItem = (overlay[type] || []).find((item) => item.id === id);
      if (!overlayItem) {
        if (!bundledItem) throw new Error(`Item not found: ${id}`);
        overlayItem = deepClone(bundledItem);
        overlay[type].push(overlayItem);
      }
      Object.assign(overlayItem, updates, { updatedAt: nowIso(clock) });
      persist();
      return deepClone(overlayItem);
    }

    function activateItem(type, id) {
      const allowed = ["pdfs", "pdfCategories", "videos", "images"];
      if (!allowed.includes(type)) throw new Error("Unknown library type: " + type);
      if (overlay.removed && Array.isArray(overlay.removed[type])) {
        overlay.removed[type] = overlay.removed[type].filter((item) => item !== id);
      }
      const item = (overlay[type] || []).find((e) => e.id === id);
      if (item) {
        item.active = true;
        item.updatedAt = nowIso(clock);
      } else {
        const bundledItem = (bundled[type] || []).find((e) => e.id === id);
        if (bundledItem) {
          overlay[type].push(Object.assign({}, bundledItem, { active: true, updatedAt: nowIso(clock) }));
        }
      }
      persist();
      return true;
    }

    function deactivate(type, id) {
      const allowed = ["pdfs", "pdfCategories", "videos", "images"];
      if (!allowed.includes(type)) throw new Error("Unknown library type.");
      const bundledItem = (bundled[type] || []).find((item) => item.id === id);
      const overlayItem = (overlay[type] || []).find((item) => item.id === id);
      if (overlayItem) {
        overlayItem.active = false;
        overlayItem.updatedAt = nowIso(clock);
      } else if (bundledItem) {
        overlay[type].push(Object.assign({}, bundledItem, { active: false, updatedAt: nowIso(clock) }));
      } else {
        return false;
      }
      persist();
      return true;
    }

    function deleteItem(type, id) {
      const allowed = ["pdfs", "pdfCategories", "videos", "images"];
      if (!allowed.includes(type)) throw new Error("Unknown library type: " + type);
      if (!overlay.removed[type].includes(id)) {
        overlay.removed[type].push(id);
      }
      const item = (overlay[type] || []).find((e) => e.id === id);
      if (item) {
        item.active = false;
        item.updatedAt = nowIso(clock);
      }
      persist();
      return true;
    }

    function restoreItem(type, id) {
      const allowed = ["pdfs", "pdfCategories", "videos", "images"];
      if (!allowed.includes(type)) throw new Error("Unknown library type: " + type);
      overlay.removed[type] = overlay.removed[type].filter((item) => item !== id);
      const item = (overlay[type] || []).find((e) => e.id === id);
      if (item) {
        item.active = true;
        item.updatedAt = nowIso(clock);
      }
      persist();
      return true;
    }

    function hardDeleteItem(type, id) {
      const allowed = ["pdfs", "pdfCategories", "videos", "images"];
      if (!allowed.includes(type)) throw new Error("Unknown library type: " + type);
      const inBundled = (bundled[type] || []).some((entry) => entry && entry.id === id);
      overlay[type] = (overlay[type] || []).filter((entry) => entry && entry.id !== id);
      if (!Array.isArray(overlay.removed[type])) overlay.removed[type] = [];
      if (inBundled) {
        if (!overlay.removed[type].includes(id)) overlay.removed[type].push(id);
      } else {
        overlay.removed[type] = overlay.removed[type].filter((item) => item !== id);
      }
      persist();
      return { ok: true, id, bundledTombstone: inBundled };
    }

    async function addUploadedPdf(file, meta) {
      if (!fileStore) throw new Error("Offline file storage is not available.");
      if (!file || !meta || !meta.id) throw new Error("A file and id are required.");
      const fileId = `pdf-file-${meta.id}`;
      await fileStore.putFile(fileId, file, {
        name: file.name,
        type: file.type || "application/pdf",
        size: file.size,
      });
      return addPdf(
        Object.assign({}, meta, {
          fileId,
          path: meta.path || null,
          bytes: file.size,
          mimeType: file.type || "application/pdf",
        })
      );
    }

    async function resolvePdfUrl(pdf) {
      if (!pdf) return null;
      if (pdf.fileId && fileStore) {
        const stored = await fileStore.getFile(pdf.fileId);
        if (stored && stored.blob) {
          return URL.createObjectURL(stored.blob);
        }
      }
      return pdf.path || null;
    }

    function getState() {
      return deepClone(overlay);
    }

    return {
      STORAGE_KEY: storageKey,
      getPdfs,
      getPdfCategories,
      addPdfCategory,
      editPdfCategory,
      renamePdfCategory,
      reorderPdfCategories,
      deletePdfCategory,
      movePdfToCategory,
      bulkAddPdfs,
      addPdf,
      editPdf,
      activatePdf,
      deactivatePdf,
      deletePdf,
      hardDeletePdf,
      restorePdf,
      getVideos,
      groupVideosByTopic,
      addVideo,
      editVideo,
      activateVideo,
      deactivateVideo,
      deleteVideo,
      hardDeleteVideo,
      restoreVideo,
      getImages,
      addImage,
      editImage,
      activateImage,
      deactivateImage,
      deleteImage,
      hardDeleteImage,
      restoreImage,
      addUploadedPdf,
      resolvePdfUrl,
      validateVideo,
      getState,
      onChange,
      replaceOverlay,
    };
  }

  const api = {
    STORAGE_KEY,
    SCHEMA_VERSION,
    createLibrary,
    extractYouTubeId,
    extractYouTubeVideoId,
    isValidYouTubeVideoId,
    normalizeYouTubeUrl,
    privacyEmbedUrl,
    validateVideo,
    isUnsafeLocalPath,
    sanitizeAssetPath,
    inferPdfCategory,
    normalizeOverlay,
    emptyOverlay,
  };

  root.BankQuestionCore = root.BankQuestionCore || {};
  root.BankQuestionCore.ContentLibrary = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
