/* Lazy-Loaded Admin & Co-Admin Portal (Master Cookie + Co-Admin Bearer Token) */
(function (root) {
  "use strict";

  const PROMPT_TEMPLATES = [
    {
      id: "json-gen",
      title: "1. Generate Bilingual Quiz JSON (With Explanations)",
      desc: "Creates exam-grade MCQs with correct answers, EN + AR explanations, rules & common traps.",
      prompt: [
        "Create a computer science multiple-choice quiz from the lecture notes/topic below.",
        "Return ONLY valid JSON (no markdown commentary outside JSON) matching this exact schema:",
        "{",
        '  "title": "Descriptive Quiz Title",',
        '  "kind": "quiz",',
        '  "questions": [',
        "    {",
        '      "id": "Q1",',
        '      "question": "Clear, complete question stem?",',
        '      "options": [',
        '        { "id": "A", "text": "First option" },',
        '        { "id": "B", "text": "Second option" },',
        '        { "id": "C", "text": "Third option" },',
        '        { "id": "D", "text": "Fourth option" }',
        "      ],",
        '      "correctOptionId": "B",',
        '      "explanation": "Clear English academic explanation of why B is right and distractors are wrong.",',
        '      "explanationArabic": "شرح مبسط بالعربي يوضح سبب صحة الإجابة B ولماذا باقي الاختيارات خاطئة.",',
        '      "rule": "One-sentence key rule or formula to remember.",',
        '      "whyYouMightErr": "Brief note on the misconception behind the most tempting distractor.",',
        '      "image": "Optional URL (/api/r2/quiz-images/..., /content/images/..., or https://...) ONLY if a figure is provided"',
        "    }",
        "  ]",
        "}",
        "Rules: Balance correctOptionId evenly across A, B, C, D. Omit \"image\" when there is no figure. Never invent fake URLs. Output valid JSON only.",
      ].join("\n"),
    },
    {
      id: "convert-json",
      title: "2. Convert Lecture / PDF / Quiz Text to Elgo JSON",
      desc: "Preserves existing questions verbatim, maps answer keys, and enriches missing explanations.",
      prompt: [
        "Convert the raw MCQ text / sheet pasted below into Elgo Lab JSON format.",
        "Keep every question stem and option wording faithful to the original text.",
        "If an answer key is marked, set correctOptionId to \"A\", \"B\", \"C\", or \"D\". If truly unmarked, set correctOptionId to null (never guess randomly).",
        "If the source includes an image URL or figure path, preserve it in `image` (or `images: [{ url, alt, caption }]`).",
        "Include concise English explanation (`explanation`), Arabic explanation (`explanationArabic`), key rule (`rule`), and common mistake (`whyYouMightErr`) for each question.",
        'Return ONLY valid JSON: { "title": "...", "kind": "quiz", "questions": [ { "id": "Q1", "question": "...", "image": "...", "options": [{ "id": "A", "text": "..." }], "correctOptionId": "A", "explanation": "...", "explanationArabic": "...", "rule": "...", "whyYouMightErr": "..." } ] }',
      ].join("\n"),
    },
    {
      id: "plaintext-tpl",
      title: "3. Fast Plaintext Format (No JSON Required)",
      desc: "Paste or ask AI for clean numbered text with Answer:, Image:, Explanation:, Arabic Explanation:, and Rule: lines.",
      prompt: [
        "Format all questions in clean numbered plaintext using this exact structure:",
        "",
        "1. Which algorithm finds shortest paths from a single source with non-negative weights?",
        "Image: /content/images/optional-graph.png",
        "Caption: Optional figure caption",
        "A) Bellman-Ford",
        "B) Dijkstra",
        "C) Kruskal",
        "D) Floyd-Warshall",
        "Answer: B",
        "Explanation: Dijkstra greedily selects the minimum tentative distance vertex assuming edges are non-negative.",
        "Arabic Explanation: خوارزمية دايكسترا تختار أقل مسافة في كل خطوة بشرط عدم وجود أوزان سالبة.",
        "Rule: Non-negative weights -> Dijkstra O((V+E) log V); negative weights -> Bellman-Ford.",
        "Why: Students often confuse Kruskal (MST) with Dijkstra (shortest path).",
      ].join("\n"),
    },
  ];

  function esc(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function toast(msg) {
    if (root.ElgoShell && typeof root.ElgoShell.showToast === "function") {
      root.ElgoShell.showToast(msg);
    }
  }

  function slugify(str) {
    return String(str || "")
      .toLowerCase()
      .normalize("NFKC")
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64);
  }

  function getStripQuizId(src) {
    const raw = String((src && (src.collectionId || src.id)) || "");
    return raw.includes("::") ? raw.split("::").pop() : raw;
  }

  async function copyToClipboard(text, label) {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(text);
        toast(`${label || "Text"} copied to clipboard.`);
        return true;
      }
    } catch (_e) { /* fallback below */ }
    toast("Select and copy text from the box.");
    return false;
  }

  async function apiFetch(url, options) {
    const state = root.ElgoState;
    const opts = Object.assign({ credentials: "same-origin" }, options || {});
    opts.headers = state.authHeaders(opts.headers || {});
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => null);
    return { res, data };
  }

  function getQImages(q) {
    if (root.ElgoModel && typeof root.ElgoModel.getQuestionImages === "function") {
      return root.ElgoModel.getQuestionImages(q);
    }
    return q && q.image ? [{ url: String(q.image) }] : [];
  }

  function syncQuestionImageProps(qObj, imgsList) {
    if (!qObj || typeof qObj !== "object") return;
    const clean = Array.isArray(imgsList) ? imgsList.filter((it) => it && it.url) : [];
    if (clean.length === 0) {
      delete qObj.image;
      delete qObj.imageAlt;
      delete qObj.imageCaption;
      delete qObj.images;
      return;
    }
    qObj.image = clean[0].url;
    if (clean[0].alt) qObj.imageAlt = clean[0].alt;
    else delete qObj.imageAlt;
    if (clean[0].caption) qObj.imageCaption = clean[0].caption;
    else delete qObj.imageCaption;
    qObj.images = clean.map((it) => {
      const o = { url: it.url };
      if (it.alt) o.alt = it.alt;
      if (it.caption) o.caption = it.caption;
      return o;
    });
  }

  function renderAdminImageThumbs(qOrImgs) {
    const imgs = Array.isArray(qOrImgs) ? qOrImgs : getQImages(qOrImgs);
    if (!imgs.length) return "";
    return `
      <div class="admin-q-thumb-row">
        ${imgs.map((img, idx) => `
          <span class="admin-q-thumb" title="${esc(img.caption || img.alt || img.url)}">
            <img src="${esc(img.url)}" alt="${esc(img.alt || `Diagram ${idx + 1}`)}">
            <span>${esc(img.caption || img.alt || `Image ${idx + 1}`)}</span>
          </span>
        `).join("")}
      </div>
    `;
  }

  async function uploadQuizImageFile(file, subjectId) {
    if (!file) throw new Error("Choose an image file first.");
    const okType = /^image\/(?:png|jpeg|jpg|webp|gif)$/i.test(file.type || "") || /\.(png|jpe?g|webp|gif)$/i.test(file.name || "");
    if (!okType) throw new Error("Only PNG, JPEG, WebP, or GIF images are accepted.");
    if (file.size > 8 * 1024 * 1024) throw new Error("Image exceeds the 8 MB limit.");
    const qs = new URLSearchParams({ subjectId: subjectId || "general" });
    const { res, data } = await apiFetch(`/api/admin/r2/upload-image?${qs.toString()}`, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!res.ok || !data || !data.ok || !data.image || !data.image.url) {
      throw new Error((data && data.error) || "Image upload failed (verify storage/R2 is enabled).");
    }
    return data.image.url;
  }

  function mountQuestionImagesEditor(hostEl, imgsList, subjectId, onMutate) {
    function render() {
      const canAddMore = imgsList.length < 6;
      hostEl.innerHTML = `
        <div class="dialog-body" style="padding:8px 0 0;gap:10px;">
          ${imgsList.length === 0 ? `<p class="question-meta" style="margin:0;">No images attached yet. Upload a PNG/JPG/WebP/GIF file or paste an image URL below.</p>` : `
            <div class="admin-list">
              ${imgsList.map((img, i) => `
                <div class="admin-row is-compact" style="align-items:center;">
                  <img src="${esc(img.url)}" alt="${esc(img.alt || `Image ${i + 1}`)}" style="width:72px;height:54px;object-fit:cover;border-radius:8px;border:1px solid var(--line);flex-shrink:0;">
                  <div class="admin-row-main" style="gap:4px;">
                    <span class="question-meta" style="word-break:break-all;">${esc(img.url)}</span>
                    <input type="text" data-img-cap="${i}" maxlength="240" placeholder="Optional caption / note shown under image" value="${esc(img.caption || "")}" style="padding:5px 8px;font-size:0.8rem;">
                  </div>
                  <div class="admin-row-actions">
                    <button type="button" class="admin-btn-danger" data-img-rm="${i}">Remove</button>
                  </div>
                </div>
              `).join("")}
            </div>
          `}
          ${canAddMore ? `
            <div class="inline" style="flex-wrap:wrap;gap:8px;align-items:center;border-top:1px dashed var(--line);padding-top:8px;">
              <label class="secondary" style="cursor:pointer;padding:6px 11px;font-size:0.8rem;">
                📁 Upload Image File
                <input type="file" data-img-upload accept="image/png,image/jpeg,image/webp,image/gif" multiple class="hidden">
              </label>
              <input type="text" data-img-url-in placeholder="/api/r2/..., /content/images/..., or https://..." style="flex:1 1 200px;padding:6px 9px;font-size:0.82rem;">
              <input type="text" data-img-cap-in placeholder="Caption (optional)" style="flex:0 1 150px;padding:6px 9px;font-size:0.82rem;">
              <button type="button" class="secondary" data-img-add-url>Add URL</button>
            </div>
            <span class="question-meta" data-img-status style="display:block;"></span>
          ` : `<span class="question-meta">Maximum 6 images per question reached.</span>`}
        </div>
      `;

      hostEl.querySelectorAll("[data-img-cap]").forEach((inp) => {
        inp.addEventListener("input", () => {
          const i = Number(inp.getAttribute("data-img-cap"));
          if (imgsList[i]) {
            const val = inp.value.trim();
            if (val) imgsList[i].caption = val;
            else delete imgsList[i].caption;
            if (typeof onMutate === "function") onMutate();
          }
        });
      });

      hostEl.querySelectorAll("[data-img-rm]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const i = Number(btn.getAttribute("data-img-rm"));
          imgsList.splice(i, 1);
          if (typeof onMutate === "function") onMutate();
          render();
        });
      });

      const upInput = hostEl.querySelector("[data-img-upload]");
      const statusEl = hostEl.querySelector("[data-img-status]");
      if (upInput) {
        upInput.addEventListener("change", async () => {
          const files = Array.from(upInput.files || []);
          if (!files.length) return;
          if (statusEl) statusEl.textContent = "Uploading image...";
          upInput.disabled = true;
          try {
            for (const f of files) {
              if (imgsList.length >= 6) break;
              const url = await uploadQuizImageFile(f, subjectId);
              if (!imgsList.some((x) => x.url === url)) {
                imgsList.push({ url });
              }
            }
            if (typeof onMutate === "function") onMutate();
            render();
            toast("Image uploaded and attached.");
          } catch (err) {
            if (statusEl) statusEl.textContent = (err && err.message) || "Upload failed.";
            upInput.disabled = false;
          }
        });
      }

      const addUrlBtn = hostEl.querySelector("[data-img-add-url]");
      if (addUrlBtn) {
        addUrlBtn.addEventListener("click", () => {
          const urlIn = hostEl.querySelector("[data-img-url-in]");
          const capIn = hostEl.querySelector("[data-img-cap-in]");
          const rawUrl = String((urlIn && urlIn.value) || "").trim();
          const sanitizer = root.ElgoModel && root.ElgoModel.sanitizeImageUrl;
          const clean = sanitizer ? sanitizer(rawUrl) : rawUrl;
          if (!clean) {
            if (statusEl) statusEl.textContent = "Invalid URL. Use /api/r2/..., /content/images/..., https://..., or safe PNG/JPG/WebP/GIF data URI.";
            return;
          }
          if (imgsList.some((x) => x.url === clean)) {
            if (statusEl) statusEl.textContent = "That image is already attached to this question.";
            return;
          }
          const entry = { url: clean };
          const capVal = String((capIn && capIn.value) || "").trim();
          if (capVal) entry.caption = capVal;
          imgsList.push(entry);
          if (typeof onMutate === "function") onMutate();
          render();
        });
      }
    }
    render();
  }

  // Reusable single-instance modal <dialog> for crisp editing & confirmation
  let modalDialog = null;
  function ensureModal() {
    if (!modalDialog || !document.body.contains(modalDialog)) {
      modalDialog = document.createElement("dialog");
      modalDialog.className = "elgo-dialog admin-modal";
      modalDialog.id = "elgoAdminModal";
      document.body.appendChild(modalDialog);
      modalDialog.addEventListener("click", (e) => {
        if (e.target === modalDialog) modalDialog.close();
      });
    }
    return modalDialog;
  }

  function openModal({ title, html, wide, onMount }) {
    const dlg = ensureModal();
    dlg.classList.toggle("is-wide", Boolean(wide));
    dlg.innerHTML = `
      <div class="dialog-body">
        <div class="dialog-head">
          <h2 style="margin:0;font-size:1.08rem;">${esc(title)}</h2>
          <button type="button" class="quiet" data-modal-close aria-label="Close">✕</button>
        </div>
        ${html}
      </div>
    `;
    dlg.querySelectorAll("[data-modal-close]").forEach((btn) => {
      btn.addEventListener("click", () => dlg.close());
    });
    if (typeof onMount === "function") onMount(dlg);
    if (!dlg.open && typeof dlg.showModal === "function") dlg.showModal();
    return dlg;
  }

  function confirmModal({ title, message, confirmLabel, danger }) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (val) => {
        if (settled) return;
        settled = true;
        resolve(val);
      };
      const dlg = openModal({
        title: title || "Confirm Action",
        html: `
          <p style="margin:0;color:var(--muted);font-size:0.9rem;line-height:1.5;">${esc(message)}</p>
          <div class="inline" style="justify-content:flex-end;">
            <button type="button" class="secondary" id="adminConfirmCancel">Cancel</button>
            <button type="button" class="${danger ? "admin-btn-danger" : "primary"}" id="adminConfirmOk">${esc(confirmLabel || "Confirm")}</button>
          </div>
        `,
        onMount: (d) => {
          d.addEventListener("close", () => done(false), { once: true });
          d.querySelector("#adminConfirmCancel").addEventListener("click", () => { done(false); d.close(); });
          d.querySelector("#adminConfirmOk").addEventListener("click", () => { done(true); d.close(); });
        },
      });
      if (!dlg.open) done(false);
    });
  }

  async function render(container, params) {
    const state = root.ElgoState;
    await state.loadPublicOverrides().catch(() => null);
    let catalog = await state.loadCatalog();

    let activeTab = (params && typeof params.get === "function" && params.get("tab")) || "courses";
    if (!["courses", "library", "importer", "reports", "users", "settings"].includes(activeTab)) {
      activeTab = "courses";
    }
    let selectedCourseId = (catalog.subjects && catalog.subjects[0] && catalog.subjects[0].id) || "";
    let courseKindFilter = "all";
    let libraryTypeTab = "pdfs"; // Strictly separated: "pdfs" | "videos"
    let libraryCategoryFilter = "all";
    let importerDraftState = { subjectId: selectedCourseId, title: "", quizId: "", kind: "quiz", raw: "", parsed: null };

    async function syncCatalog() {
      if (typeof state.refreshDynamicState === "function") {
        catalog = await state.refreshDynamicState();
      } else {
        await state.loadPublicOverrides();
        catalog = state.getCatalog();
      }
      if (selectedCourseId && !(catalog.subjects || []).some((s) => s.id === selectedCourseId)) {
        selectedCourseId = (catalog.subjects && catalog.subjects[0] && catalog.subjects[0].id) || "";
      }
      if (!selectedCourseId && catalog.subjects && catalog.subjects[0]) {
        selectedCourseId = catalog.subjects[0].id;
      }
      if (root.ElgoShell && typeof root.ElgoShell.renderHeaderAndNav === "function") {
        root.ElgoShell.renderHeaderAndNav();
      }
    }

    async function checkSession() {
      const { res, data } = await apiFetch("/api/admin/session", { cache: "no-store" });
      if (res.ok && data && data.authenticated) {
        return { authenticated: true, role: data.role || "coadmin", expiresAt: data.expiresAt || null };
      }
      return { authenticated: false, role: null, expiresAt: null };
    }

    function openCourseEditorModal(existingSubj, onSaved) {
      const isEdit = Boolean(existingSubj && existingSubj.id);
      openModal({
        title: isEdit ? `Edit Course: ${state.getSubjectName(existingSubj)}` : "Create New Course",
        html: `
          <form id="courseModalForm" class="dialog-body" style="padding:0;">
            <label class="admin-field">
              <span>Course Name (English)</span>
              <input type="text" id="cmNameEn" required maxlength="120" value="${esc(existingSubj ? state.getSubjectName(existingSubj) : "")}" placeholder="e.g. Operating Systems">
            </label>
            <label class="admin-field">
              <span>Course Name (Arabic, optional)</span>
              <input type="text" id="cmNameAr" dir="rtl" maxlength="120" value="${esc((existingSubj && existingSubj.nameAr) || "")}" placeholder="مثال: نظم التشغيل">
            </label>
            <label class="admin-field">
              <span>Course ID Slug ${isEdit ? "(locked)" : "(auto-generated if empty)"}</span>
              <input type="text" id="cmSlugId" maxlength="64" ${isEdit ? "readonly" : ""} value="${esc((existingSubj && existingSubj.id) || "")}" placeholder="operating-systems">
            </label>
            <label class="admin-field">
              <span>Short Description (optional)</span>
              <input type="text" id="cmDesc" maxlength="300" value="${esc((existingSubj && existingSubj.description) || "")}" placeholder="Core OS concepts, scheduling, memory, and filesystems">
            </label>
            <div id="cmErr" class="dialog-error hidden"></div>
            <div class="inline" style="justify-content:flex-end;">
              <button type="button" class="secondary" data-modal-close>Cancel</button>
              <button type="submit" class="primary" id="cmSubmit">${isEdit ? "Save Changes" : "Create Course"}</button>
            </div>
          </form>
        `,
        onMount: (dlg) => {
          const form = dlg.querySelector("#courseModalForm");
          const nameInput = dlg.querySelector("#cmNameEn");
          const slugInput = dlg.querySelector("#cmSlugId");
          const errEl = dlg.querySelector("#cmErr");
          if (!isEdit) {
            nameInput.addEventListener("input", () => {
              if (!slugInput.dataset.touched) slugInput.value = slugify(nameInput.value);
            });
            slugInput.addEventListener("input", () => { slugInput.dataset.touched = "1"; });
          }
          form.addEventListener("submit", async (e) => {
            e.preventDefault();
            errEl.classList.add("hidden");
            const btn = dlg.querySelector("#cmSubmit");
            btn.disabled = true;
            try {
              const name = nameInput.value.trim();
              const nameAr = dlg.querySelector("#cmNameAr").value.trim();
              const id = isEdit ? existingSubj.id : (slugify(slugInput.value) || slugify(name));
              const description = dlg.querySelector("#cmDesc").value.trim();

              if (isEdit && existingSubj && !existingSubj.isCustom && !nameAr && !description) {
                const { res: rnRes, data: rnData } = await apiFetch("/api/admin/subjects/name", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ subjectId: id, name }),
                });
                if (!rnRes.ok || !rnData || !rnData.ok) throw new Error((rnData && rnData.error) || "Rename failed.");
              }
              const { res, data } = await apiFetch("/api/admin/subjects", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, name, nameAr, description }),
              });
              if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || "Could not save course.");

              await syncCatalog();
              selectedCourseId = id;
              dlg.close();
              toast(isEdit ? "Course updated." : "Course created.");
              if (typeof onSaved === "function") onSaved(id);
            } catch (ex) {
              errEl.textContent = ex.message || "Error saving course.";
              errEl.classList.remove("hidden");
            } finally {
              btn.disabled = false;
            }
          });
        },
      });
    }

    let onlineRefreshTimer = null;

    function clearOnlineRefreshTimer() {
      if (onlineRefreshTimer !== null) {
        clearInterval(onlineRefreshTimer);
        onlineRefreshTimer = null;
      }
    }

    async function paint() {
      clearOnlineRefreshTimer();
      container.innerHTML = `<div class="admin-wrap"><div class="admin-card">Checking administrator session...</div></div>`;
      const session = await checkSession();

      if (!session.authenticated) {
        const auth = state.getAuth();
        container.innerHTML = `
          <div class="admin-wrap">
            <section class="admin-header-card">
              <div class="dialog-head">
                <div>
                  <h1 style="margin:0;font-size:1.35rem;">Admin & Moderation Portal</h1>
                  <p class="question-meta" style="margin:4px 0 0;">Master administrator password cookie or promoted Co-Admin student account required.</p>
                </div>
                <a href="/?flow=hub" class="secondary" data-nav="courses">← Back to Courses</a>
              </div>
            </section>

            <section class="admin-card">
              <h2 style="margin:0;font-size:1.05rem;">Master Administrator Sign In</h2>
              <form id="adminLoginForm" class="admin-form-grid">
                <label class="admin-field">
                  <span>Master Admin Password</span>
                  <input type="password" id="adminPassInput" required autocomplete="current-password" placeholder="Enter master password">
                </label>
                <div>
                  <button type="submit" class="primary" id="adminLoginBtn">Unlock Admin Portal</button>
                </div>
              </form>
              <div id="adminLoginError" class="dialog-error hidden"></div>
              <p class="question-meta" style="margin:0;">
                ${auth && auth.profile
                  ? `Signed in as student <strong>${esc(auth.profile.username)}</strong>. If you have Co-Admin privileges, refresh once granted.`
                  : `Co-Admin? Sign in with your student account first to verify Co-Admin permissions.`}
              </p>
            </section>
          </div>
        `;

        const form = container.querySelector("#adminLoginForm");
        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          const err = container.querySelector("#adminLoginError");
          const btn = container.querySelector("#adminLoginBtn");
          err.classList.add("hidden");
          btn.disabled = true;
          try {
            const password = container.querySelector("#adminPassInput").value;
            const { res, data } = await apiFetch("/api/admin/login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ password }),
            });
            if (!res.ok || !data || !data.ok) {
              throw new Error((data && data.error) || `Login failed (${res.status})`);
            }
            toast("Admin session unlocked.");
            paint();
          } catch (ex) {
            err.textContent = ex.message || "Authentication failed.";
            err.classList.remove("hidden");
          } finally {
            btn.disabled = false;
          }
        });
        return;
      }

      const tabs = [
        { id: "courses", label: "Courses & Quizzes" },
        { id: "library", label: "PDFs & Videos" },
        { id: "importer", label: "Import Quiz & Prompts" },
        { id: "reports", label: "Reports" },
        { id: "users", label: "Users & Online" },
        { id: "settings", label: "Settings & Hosting" },
      ];

      container.innerHTML = `
        <div class="admin-wrap">
          <section class="admin-header-card">
            <div class="dialog-head">
              <div>
                <h1 style="margin:0;font-size:1.35rem;">Admin Portal</h1>
                <p class="question-meta" style="margin:4px 0 0;">
                  Role: <strong>${session.role === "master" ? "Master Admin (Full Access)" : "Co-Admin"}</strong>
                </p>
              </div>
              <div class="inline">
                <button type="button" class="secondary admin-online-pill-btn" id="adminHeaderOnlineBtn" title="View active online users and usernames">
                  <span class="admin-online-dot" aria-hidden="true"></span>
                  <span id="adminHeaderOnlineLabel">Live Users</span>
                </button>
                <a href="/?flow=hub" class="secondary" data-nav="courses">← Student View</a>
                ${session.role === "master" ? `<button type="button" class="secondary" id="adminLogoutBtn">Lock Session</button>` : ""}
              </div>
            </div>
            <div class="admin-tabs">
              ${tabs.map((t) => `<button type="button" class="admin-tab${activeTab === t.id ? " is-active" : ""}" data-tab="${t.id}">${esc(t.label)}</button>`).join("")}
            </div>
          </section>
          <section class="admin-card" id="adminTabBody"></section>
        </div>
      `;

      async function syncHeaderOnlineBadge() {
        const badgeLabel = container.querySelector("#adminHeaderOnlineLabel");
        if (!badgeLabel) return;
        const { res, data } = await apiFetch("/api/admin/online-users");
        if (!res.ok || !data || !data.ok) return;
        badgeLabel.textContent = `${Number(data.totalOnline || 0)} Online (${Number(data.identifiedCount || 0)} named)`;
      }

      const headerOnlineBtn = container.querySelector("#adminHeaderOnlineBtn");
      if (headerOnlineBtn) {
        headerOnlineBtn.addEventListener("click", () => switchTab("users"));
      }
      syncHeaderOnlineBadge();

      const logoutBtn = container.querySelector("#adminLogoutBtn");
      if (logoutBtn) {
        logoutBtn.addEventListener("click", async () => {
          clearOnlineRefreshTimer();
          await apiFetch("/api/admin/logout", { method: "POST" });
          toast("Admin session locked.");
          paint();
        });
      }

      function switchTab(nextId) {
        activeTab = nextId;
        clearOnlineRefreshTimer();
        container.querySelectorAll("[data-tab]").forEach((b) => {
          b.classList.toggle("is-active", b.getAttribute("data-tab") === activeTab);
        });
        renderTab(container.querySelector("#adminTabBody"), session);
      }

      container.querySelectorAll("[data-tab]").forEach((btn) => {
        btn.addEventListener("click", () => switchTab(btn.getAttribute("data-tab")));
      });

      container._switchAdminTab = switchTab;
      await renderTab(container.querySelector("#adminTabBody"), session);
    }

    async function renderTab(body, session) {
      if (activeTab === "courses") return renderCoursesTab(body);
      if (activeTab === "library") return renderLibraryTab(body);
      if (activeTab === "importer") return renderImporterTab(body);
      if (activeTab === "reports") return renderReportsTab(body);
      if (activeTab === "users") return renderUsersTab(body, session);
      if (activeTab === "settings") return renderSettingsTab(body, session);
    }

    // ------------------------------------------------------------------------
    // TAB 1: PER-COURSE & QUIZZES MANAGER (COMPACT + MODAL EDITING + DELETE)
    // ------------------------------------------------------------------------
    async function renderCoursesTab(body) {
      const subjects = catalog.subjects || [];
      const currentSubj = subjects.find((s) => s.id === selectedCourseId) || subjects[0] || null;
      if (currentSubj) selectedCourseId = currentSubj.id;

      const visibleSubjSources = currentSubj
        ? (catalog.sources || []).filter((s) => s && s.subjectId === currentSubj.id)
        : [];
      const hiddenSubjSources = currentSubj
        ? (catalog.hiddenSources || []).filter((s) => s && s.subjectId === currentSubj.id).map((s) => Object.assign({}, s, { isHidden: true }))
        : [];
      const allSubjSources = visibleSubjSources.concat(hiddenSubjSources);
      const dynCat = (state.getDynamicCatalog && state.getDynamicCatalog()) || {};
      const dynImgCounts = (dynCat && dynCat.questionImageCounts) || {};
      const filteredSources = allSubjSources.filter((s) => {
        if (courseKindFilter === "hidden") return Boolean(s.isHidden);
        return courseKindFilter === "all" || s.kind === courseKindFilter;
      });

      const coursePillsHtml = subjects.map((s) => `
        <button type="button" class="admin-course-pill${currentSubj && s.id === currentSubj.id ? " is-active" : ""}" data-pick-course="${esc(s.id)}">
          <span>${esc(state.getSubjectName(s))}</span>
          <small>(${Number((s.counts && s.counts.totalQuestions) || 0)} Qs)</small>
        </button>
      `).join("");

      body.innerHTML = `
        <div class="admin-toolbar">
          <div>
            <h2 style="margin:0;font-size:1.05rem;">Courses &amp; Quizzes (${subjects.length} courses)</h2>
            <p class="question-meta" style="margin:2px 0 0;">Pick a course below to manage, rename, preview, import, hide, or delete its quizzes separately.</p>
          </div>
          <div class="inline">
            <button type="button" class="primary" id="newCourseBtn">+ New Course</button>
          </div>
        </div>

        <div class="admin-course-strip">${coursePillsHtml || `<span class="question-meta">No active courses yet. Create one to start.</span>`}</div>

        ${!currentSubj ? `<div class="empty-state">Click <strong>+ New Course</strong> above to add your first course.</div>` : `
          <div class="admin-row" style="align-items:center;">
            <div class="admin-row-main">
              <div class="admin-row-title-line">
                <strong style="font-size:1rem;">${esc(state.getSubjectName(currentSubj))}</strong>
                ${currentSubj.isCustom ? `<span class="admin-badge is-accent">Custom</span>` : `<span class="admin-badge">Bundled</span>`}
                <span class="admin-badge">${esc(currentSubj.id)}</span>
              </div>
              <span class="question-meta">
                ${visibleSubjSources.length} active${hiddenSubjSources.length ? ` · ${hiddenSubjSources.length} hidden` : ""} question banks/sheets · ${Number((currentSubj.counts && currentSubj.counts.totalQuestions) || 0)} visible questions · ${state.getPdfs(currentSubj.id).length} PDFs · ${state.getVideos(currentSubj.id).length} videos
              </span>
            </div>
            <div class="admin-row-actions">
              <button type="button" class="secondary" id="editSelectedCourseBtn">Edit Course</button>
              <button type="button" class="secondary" id="jumpImportForCourseBtn">+ Import Quiz</button>
              <button type="button" class="secondary" id="jumpLibForCourseBtn">Manage PDFs / Videos</button>
              <button type="button" class="admin-btn-danger" id="deleteSelectedCourseBtn">Delete Course</button>
            </div>
          </div>

          <div class="admin-subtabs">
            ${[
              { k: "all", label: `All (${allSubjSources.length})` },
              { k: "quiz", label: `Quizzes (${allSubjSources.filter((s) => s.kind === "quiz" || !s.kind).length})` },
              { k: "sheet", label: `Sheets (${allSubjSources.filter((s) => s.kind === "sheet").length})` },
              { k: "lecture", label: `Lecture Qs (${allSubjSources.filter((s) => s.kind === "lecture").length})` },
              { k: "hidden", label: `Hidden (${hiddenSubjSources.length})` },
            ].map((t) => `
              <button type="button" class="admin-subtab${courseKindFilter === t.k ? " is-active" : ""}" data-course-kind="${t.k}">${esc(t.label)}</button>
            `).join("")}
          </div>

          ${filteredSources.length === 0 ? `<div class="empty-state">${courseKindFilter === "hidden" ? "No hidden quizzes or sheets in this course." : "No quizzes or sheets in this view yet. Click <strong>+ Import Quiz</strong> to add one."}</div>` : `
            <div class="admin-list">
              ${filteredSources.map((src) => {
                const quizId = getStripQuizId(src);
                const kindLabel = src.kind === "sheet" ? "Sheet" : src.kind === "lecture" ? "Lecture" : "Quiz";
                const isHidden = Boolean(src.isHidden);
                const ovImgCount = Number(dynImgCounts[`${currentSubj.id}::${quizId}`] || 0);
                return `
                  <div class="admin-row is-compact">
                    <div class="admin-row-main">
                      <div class="admin-row-title-line">
                        <strong>${esc(state.getQuizTitle(src, currentSubj.id))}</strong>
                        <span class="admin-badge">${esc(kindLabel)}</span>
                        ${isHidden ? `<span class="admin-badge is-warn">Hidden</span>` : `<span class="admin-badge is-accent">Active</span>`}
                        ${src.isCustom ? `<span class="admin-badge">Live</span>` : ""}
                        ${ovImgCount > 0 ? `<span class="admin-badge">🖼️ ${ovImgCount}</span>` : ""}
                        <span class="admin-badge">${Number(src.questionCount || 0)} Qs</span>
                      </div>
                      <span class="question-meta">ID: ${esc(quizId)}${isHidden ? " · Hidden from students" : ""}</span>
                    </div>
                    <div class="admin-row-actions">
                      <button type="button" class="secondary" data-quiz-preview="${esc(quizId)}">Preview Qs</button>
                      <button type="button" class="secondary" data-quiz-images="${esc(quizId)}" data-quiz-title="${esc(state.getQuizTitle(src, currentSubj.id))}">Images</button>
                      <button type="button" class="secondary" data-quiz-toggle-hide="${esc(quizId)}" data-next-hidden="${isHidden ? "0" : "1"}">${isHidden ? "Show" : "Hide"}</button>
                      <button type="button" class="secondary" data-quiz-rename="${esc(quizId)}" data-quiz-title="${esc(state.getQuizTitle(src, currentSubj.id))}" data-quiz-custom="${src.isCustom ? "1" : "0"}">Edit / Rename</button>
                      <button type="button" class="admin-btn-danger" data-quiz-delete="${esc(quizId)}" data-quiz-title="${esc(state.getQuizTitle(src, currentSubj.id))}" data-quiz-custom="${src.isCustom ? "1" : "0"}">Delete</button>
                    </div>
                  </div>
                `;
              }).join("")}
            </div>
          `}
        `}
      `;

      body.querySelector("#newCourseBtn").addEventListener("click", () => {
        openCourseEditorModal(null, () => renderCoursesTab(body));
      });

      body.querySelectorAll("[data-pick-course]").forEach((btn) => {
        btn.addEventListener("click", () => {
          selectedCourseId = btn.getAttribute("data-pick-course");
          courseKindFilter = "all";
          renderCoursesTab(body);
        });
      });

      if (!currentSubj) return;

      body.querySelector("#editSelectedCourseBtn").addEventListener("click", () => {
        openCourseEditorModal(currentSubj, () => renderCoursesTab(body));
      });

      body.querySelector("#jumpImportForCourseBtn").addEventListener("click", () => {
        importerDraftState.subjectId = currentSubj.id;
        if (container._switchAdminTab) container._switchAdminTab("importer");
      });

      body.querySelector("#jumpLibForCourseBtn").addEventListener("click", () => {
        if (container._switchAdminTab) container._switchAdminTab("library");
      });

      body.querySelector("#deleteSelectedCourseBtn").addEventListener("click", async () => {
        const ok = await confirmModal({
          title: "Delete Entire Course?",
          message: `This will permanently remove "${state.getSubjectName(currentSubj)}" (${currentSubj.id}), all custom quizzes, uploaded R2 PDFs, videos, reports, and scores for this course.`,
          confirmLabel: "Permanently Delete Course",
          danger: true,
        });
        if (!ok) return;
        const { res, data } = await apiFetch(`/api/admin/subjects?subjectId=${encodeURIComponent(currentSubj.id)}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subjectId: currentSubj.id, isBundled: !currentSubj.isCustom }),
        });
        if (!res.ok || !data || !data.ok) {
          toast((data && data.error) || "Could not delete course.");
          return;
        }
        await syncCatalog();
        toast("Course permanently deleted.");
        renderCoursesTab(body);
      });

      body.querySelectorAll("[data-course-kind]").forEach((btn) => {
        btn.addEventListener("click", () => {
          courseKindFilter = btn.getAttribute("data-course-kind");
          renderCoursesTab(body);
        });
      });

      body.querySelectorAll("[data-quiz-preview]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const quizId = btn.getAttribute("data-quiz-preview");
          const entries = await state.loadSubject(currentSubj.id, { includeHidden: true }).then((d) => state.extractSubjectEntries(d)).catch(() => []);
          const found = entries.find((e) => e.id === quizId);
          const qs = (found && found.questions) || [];
          openModal({
            title: `${found ? found.title : quizId} (${qs.length} Qs)`,
            wide: true,
            html: qs.length === 0
              ? `<p class="question-meta">No questions found in this collection.</p>`
              : `<div class="admin-preview-list" style="max-height:65vh;">
                  ${qs.map((q, idx) => `
                    <div class="admin-preview-item">
                      <strong>Q${idx + 1}: ${esc(q.question || q.text || "")}</strong>
                      ${renderAdminImageThumbs(q)}
                      <div class="question-meta">${(q.options || []).map((o) => `${o.id === q.correctOptionId ? "✓ " : ""}${esc(o.id)}) ${esc(o.text)}`).join(" · ")}</div>
                      ${(q.explanation || q.explanationArabic || q.rule) ? `<div style="font-size:0.78rem;color:var(--accent-text);">${esc(q.explanation || q.rule || "")} ${q.explanationArabic ? `· ${esc(q.explanationArabic)}` : ""}</div>` : ""}
                    </div>
                  `).join("")}
                </div>`,
          });
        });
      });

      body.querySelectorAll("[data-quiz-images]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const quizId = btn.getAttribute("data-quiz-images");
          const qTitle = btn.getAttribute("data-quiz-title") || quizId;
          btn.disabled = true;
          try {
            const entries = await state.loadSubject(currentSubj.id, { includeHidden: true }).then((d) => state.extractSubjectEntries(d)).catch(() => []);
            const found = entries.find((e) => e.id === quizId);
            const qs = (found && found.questions) || [];
            if (!qs.length) {
              toast("No questions found in this quiz.");
              return;
            }
            const draftByQId = {};
            const hadInitialImage = new Set();
            qs.forEach((q) => {
              const cur = getQImages(q).map((it) => Object.assign({}, it));
              draftByQId[q.id] = cur;
              if (cur.length > 0) hadInitialImage.add(q.id);
            });
            let activeQId = qs[0].id;
            let filterMode = "all";
            let qSearch = "";
            let changed = false;

            openModal({
              title: `Quiz Images — ${qTitle} (${qs.length} Qs)`,
              wide: true,
              html: `
                <div class="dialog-body" style="padding:0;gap:10px;">
                  <div class="inline" style="justify-content:space-between;flex-wrap:wrap;gap:8px;">
                    <div class="inline">
                      <button type="button" class="admin-subtab is-active" data-qm-filter="all">All (${qs.length})</button>
                      <button type="button" class="admin-subtab" data-qm-filter="with">With Images</button>
                      <button type="button" class="admin-subtab" data-qm-filter="missing">No Image</button>
                    </div>
                    <input type="search" id="qmSearchInput" placeholder="Search question..." style="min-width:190px;padding:6px 10px;border-radius:9px;border:1px solid var(--line);background:var(--tile);color:var(--ink);">
                  </div>
                  <div id="qmListHost" class="admin-preview-list" style="max-height:56vh;"></div>
                  <div class="inline" style="justify-content:space-between;border-top:1px solid var(--line);padding-top:10px;">
                    <span class="question-meta" id="qmDirtyLabel">Attach PNG/JPG/WebP/GIF files or URLs to any question, then save.</span>
                    <div class="inline">
                      <button type="button" class="secondary" data-modal-close>Cancel</button>
                      <button type="button" class="primary" id="qmSaveBtn">Save Quiz Images</button>
                    </div>
                  </div>
                </div>
              `,
              onMount: (dlg) => {
                const listHost = dlg.querySelector("#qmListHost");
                const searchInput = dlg.querySelector("#qmSearchInput");
                const dirtyLabel = dlg.querySelector("#qmDirtyLabel");
                const saveBtn = dlg.querySelector("#qmSaveBtn");

                function paintList() {
                  const needle = qSearch.trim().toLowerCase();
                  const shown = qs.filter((q) => {
                    const imgs = draftByQId[q.id] || [];
                    if (filterMode === "with" && imgs.length === 0) return false;
                    if (filterMode === "missing" && imgs.length > 0) return false;
                    if (needle) {
                      const hay = `${q.id} ${q.question || q.text || ""}`.toLowerCase();
                      if (!hay.includes(needle)) return false;
                    }
                    return true;
                  });
                  if (dirtyLabel) {
                    const withCount = qs.filter((q) => (draftByQId[q.id] || []).length > 0).length;
                    dirtyLabel.textContent = `${withCount} of ${qs.length} questions have images${changed ? " · Unsaved changes" : ""}`;
                  }
                  listHost.innerHTML = shown.length === 0
                    ? `<p class="question-meta">No questions match this filter.</p>`
                    : shown.map((q) => {
                        const imgs = draftByQId[q.id] || [];
                        const isOpen = activeQId === q.id;
                        return `
                          <div class="admin-preview-item" data-qm-qid="${esc(q.id)}">
                            <div class="admin-row-title-line" style="justify-content:space-between;">
                              <div class="admin-row-title-line">
                                <span class="admin-badge">${esc(q.id)}</span>
                                <strong>${esc((q.question || q.text || "").slice(0, 140))}</strong>
                                ${imgs.length ? `<span class="admin-badge is-accent">🖼️ ${imgs.length}</span>` : ""}
                              </div>
                              <button type="button" class="secondary" data-qm-open="${esc(q.id)}">${isOpen ? "Editing Images ▾" : (imgs.length ? "Edit Images" : "+ Add Image")}</button>
                            </div>
                            ${renderAdminImageThumbs(imgs)}
                            ${isOpen ? `<div class="qm-editor-mount"></div>` : ""}
                          </div>
                        `;
                      }).join("");

                  listHost.querySelectorAll("[data-qm-open]").forEach((openBtn) => {
                    openBtn.addEventListener("click", () => {
                      const targetId = openBtn.getAttribute("data-qm-open");
                      activeQId = activeQId === targetId ? "" : targetId;
                      paintList();
                    });
                  });

                  const mountEl = listHost.querySelector(".qm-editor-mount");
                  if (mountEl && activeQId && draftByQId[activeQId]) {
                    mountQuestionImagesEditor(mountEl, draftByQId[activeQId], currentSubj.id, () => {
                      changed = true;
                      const card = mountEl.closest("[data-qm-qid]");
                      if (card) {
                        const thumbRow = card.querySelector(".admin-q-thumb-row");
                        if (thumbRow) thumbRow.remove();
                        const imgs = draftByQId[activeQId] || [];
                        if (imgs.length) mountEl.insertAdjacentHTML("beforebegin", renderAdminImageThumbs(imgs));
                      }
                      if (dirtyLabel) {
                        const withCount = qs.filter((q) => (draftByQId[q.id] || []).length > 0).length;
                        dirtyLabel.textContent = `${withCount} of ${qs.length} questions have images · Unsaved changes`;
                      }
                    });
                  }
                }

                dlg.querySelectorAll("[data-qm-filter]").forEach((fBtn) => {
                  fBtn.addEventListener("click", () => {
                    filterMode = fBtn.getAttribute("data-qm-filter");
                    dlg.querySelectorAll("[data-qm-filter]").forEach((b) => b.classList.toggle("is-active", b === fBtn));
                    paintList();
                  });
                });
                searchInput.addEventListener("input", () => {
                  qSearch = searchInput.value;
                  paintList();
                });

                saveBtn.addEventListener("click", async () => {
                  saveBtn.disabled = true;
                  try {
                    const imagesByQuestionId = {};
                    qs.forEach((q) => {
                      const imgs = draftByQId[q.id] || [];
                      if (imgs.length > 0 || hadInitialImage.has(q.id)) {
                        imagesByQuestionId[q.id] = imgs;
                      }
                    });
                    const { res, data } = await apiFetch("/api/admin/quizzes/images", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ subjectId: currentSubj.id, quizId, imagesByQuestionId }),
                    });
                    if (!res.ok || !data || !data.ok) {
                      toast((data && data.error) || "Could not save quiz images.");
                      return;
                    }
                    await syncCatalog();
                    dlg.close();
                    toast("Quiz images saved!");
                    renderCoursesTab(body);
                  } finally {
                    saveBtn.disabled = false;
                  }
                });

                paintList();
              },
            });
          } finally {
            btn.disabled = false;
          }
        });
      });

      body.querySelectorAll("[data-quiz-toggle-hide]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const quizId = btn.getAttribute("data-quiz-toggle-hide");
          const hidden = btn.getAttribute("data-next-hidden") === "1";
          btn.disabled = true;
          const { res, data } = await apiFetch("/api/admin/quizzes/visibility", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subjectId: currentSubj.id, quizId, hidden }),
          });
          if (!res.ok || !data || !data.ok) {
            btn.disabled = false;
            toast((data && data.error) || "Could not update quiz visibility.");
            return;
          }
          await syncCatalog();
          toast(hidden ? "Quiz hidden from students." : "Quiz is visible to students.");
          renderCoursesTab(body);
        });
      });

      body.querySelectorAll("[data-quiz-rename]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const quizId = btn.getAttribute("data-quiz-rename");
          const curTitle = btn.getAttribute("data-quiz-title");
          openModal({
            title: `Edit Quiz Title (${quizId})`,
            html: `
              <form id="renameQuizModalForm" class="dialog-body" style="padding:0;">
                <label class="admin-field">
                  <span>Display Title</span>
                  <input type="text" id="rqTitleInput" required maxlength="160" value="${esc(curTitle)}">
                </label>
                <div class="inline" style="justify-content:flex-end;">
                  <button type="button" class="secondary" data-modal-close>Cancel</button>
                  <button type="submit" class="primary">Save Quiz Title</button>
                </div>
              </form>
            `,
            onMount: (dlg) => {
              dlg.querySelector("#renameQuizModalForm").addEventListener("submit", async (e) => {
                e.preventDefault();
                const name = dlg.querySelector("#rqTitleInput").value.trim();
                const { res, data } = await apiFetch("/api/admin/quizzes/name", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ subjectId: currentSubj.id, quizId, name }),
                });
                if (!res.ok || !data || !data.ok) {
                  toast((data && data.error) || "Could not update quiz title.");
                  return;
                }
                await syncCatalog();
                dlg.close();
                toast("Quiz title saved.");
                renderCoursesTab(body);
              });
            },
          });
        });
      });

      body.querySelectorAll("[data-quiz-delete]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const quizId = btn.getAttribute("data-quiz-delete");
          const qTitle = btn.getAttribute("data-quiz-title");
          const isBundled = btn.getAttribute("data-quiz-custom") !== "1";
          const ok = await confirmModal({
            title: "Delete Quiz?",
            message: `Permanently delete "${qTitle}" (${quizId}) and all its scores/reports from ${state.getSubjectName(currentSubj)}?`,
            confirmLabel: "Delete Quiz",
            danger: true,
          });
          if (!ok) return;
          const delQs = new URLSearchParams({
            subjectId: currentSubj.id,
            quizId,
            isBundled: isBundled ? "1" : "0",
          });
          const { res, data } = await apiFetch(`/api/admin/quizzes?${delQs.toString()}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subjectId: currentSubj.id, quizId, isBundled }),
          });
          if (!res.ok || !data || !data.ok) {
            toast((data && data.error) || "Could not delete quiz.");
            return;
          }
          await syncCatalog();
          toast("Quiz deleted.");
          renderCoursesTab(body);
        });
      });
    }

    // ------------------------------------------------------------------------
    // TAB 2: PER-COURSE & SEPARATED PDF / VIDEO LIBRARY (+ MODAL FORMS)
    // ------------------------------------------------------------------------
    async function renderLibraryTab(body) {
      const lib = state.getContentLibrary();
      const subjects = catalog.subjects || [];
      if (selectedCourseId && !subjects.some((s) => s.id === selectedCourseId) && selectedCourseId !== "__all__") {
        selectedCourseId = (subjects[0] && subjects[0].id) || "";
      }
      const filterSubjId = selectedCourseId === "__all__" ? "" : (selectedCourseId || "");

      const { data: curRemote } = await apiFetch("/api/content/overrides");
      let baseUpdatedAt = curRemote && curRemote.updatedAt ? curRemote.updatedAt : null;

      async function publishOverlay(force) {
        if (!lib) return false;
        const { res, data } = await apiFetch("/api/admin/content", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ overrides: lib.getState(), baseUpdatedAt, force: Boolean(force) }),
        });
        if (!res.ok || !data || !data.ok) {
          if (res.status === 409) {
            const okForce = await confirmModal({
              title: "Library Conflict Detected",
              message: "Another admin edited the library just now. Overwrite with your latest change?",
              confirmLabel: "Overwrite Server Copy",
              danger: true,
            });
            if (okForce) return publishOverlay(true);
          }
          toast((data && data.error) || "Publish library changes failed.");
          return false;
        }
        baseUpdatedAt = data.updatedAt || baseUpdatedAt;
        await syncCatalog();
        toast("Library updated.");
        return true;
      }

      const subjectOptsHtml = subjects.map((s) =>
        `<option value="${esc(s.id)}"${s.id === filterSubjId ? " selected" : ""}>${esc(state.getSubjectName(s))}</option>`
      ).join("");

      const allPdfs = lib ? lib.getPdfs(filterSubjId, true, false) : [];
      const allVideos = lib ? lib.getVideos(filterSubjId, { includeInactive: true, includeArchived: false }) : [];

      const PDF_CAT_LABELS = {
        summaries: "Summaries",
        "lecture-notes": "Lecture Notes",
        assignments: "Assignments",
        "exam-reviews": "Exam Reviews",
        references: "References",
      };
      function formatCatLabel(cat) {
        const key = String(cat || "summaries").toLowerCase();
        if (PDF_CAT_LABELS[key]) return PDF_CAT_LABELS[key];
        return key.replace(/[-_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
      }

      const catCounts = { all: allPdfs.length };
      Object.keys(PDF_CAT_LABELS).forEach((k) => { catCounts[k] = 0; });
      allPdfs.forEach((p) => {
        const k = String(p.category || "summaries").toLowerCase();
        catCounts[k] = (catCounts[k] || 0) + 1;
      });
      if (libraryCategoryFilter !== "all" && !(libraryCategoryFilter in catCounts)) {
        libraryCategoryFilter = "all";
      }

      const filteredPdfs = libraryCategoryFilter === "all"
        ? allPdfs
        : allPdfs.filter((p) => String(p.category || "summaries").toLowerCase() === libraryCategoryFilter);

      function getStatusBadges(item, typeLabel) {
        const isArchived = item && item.removed === true;
        const isActive = item && item.active !== false && !isArchived;
        return `
          <span class="admin-badge">${esc(typeLabel)}</span>
          ${isArchived ? `<span class="admin-badge is-danger">Archived</span>` : (!isActive ? `<span class="admin-badge is-warn">Hidden</span>` : `<span class="admin-badge is-accent">Active</span>`)}
        `;
      }

      function renderLibraryRow(item, typeMode) {
        const isArchived = item.removed === true;
        const isActive = item.active !== false && !isArchived;
        const kindPrefix = typeMode === "pdfs" ? "pdf" : "video";
        const catKey = String(item.category || "summaries").toLowerCase();
        const catBadge = typeMode === "pdfs" ? `<span class="admin-badge">${esc(formatCatLabel(catKey))}</span>` : "";
        const metaSub = typeMode === "pdfs"
          ? `${item.subjectId} · ${catKey} · ${item.path || ""}`
          : `${item.subjectId} · ${item.topic || "Video"} · ${item.youtubeId || item.youtubeUrl || item.url || ""}`;
        const openHref = typeMode === "pdfs"
          ? (item.path ? `/${String(item.path).replace(/^\/+/, "")}` : "")
          : (item.youtubeUrl || item.url || "");
        return `
          <div class="admin-row is-compact">
            <div class="admin-row-main">
              <div class="admin-row-title-line">
                <strong>${esc(item.title || item.id)}</strong>
                ${catBadge}
                ${getStatusBadges(item, typeMode === "pdfs" ? "PDF" : "Video")}
              </div>
              <span class="question-meta">${esc(metaSub)}</span>
            </div>
            <div class="admin-row-actions">
              ${openHref ? `<a href="${esc(openHref)}" target="_blank" rel="noopener noreferrer" class="secondary">Open ↗</a>` : ""}
              <button type="button" class="secondary" data-lib-edit="${kindPrefix}" data-item-id="${esc(item.id)}">Edit</button>
              ${isArchived
                ? `<button type="button" class="secondary" data-lib-action="restore-${kindPrefix}" data-item-id="${esc(item.id)}">Restore</button>`
                : `<button type="button" class="secondary" data-lib-action="${isActive ? `deactivate-${kindPrefix}` : `activate-${kindPrefix}`}" data-item-id="${esc(item.id)}">${isActive ? "Hide" : "Show"}</button>`}
              <button type="button" class="admin-btn-danger" data-lib-hard-delete="${kindPrefix}" data-item-id="${esc(item.id)}" data-item-title="${esc(item.title || item.id)}" data-item-path="${esc(item.path || "")}">Delete</button>
            </div>
          </div>
        `;
      }

      const items = libraryTypeTab === "pdfs" ? filteredPdfs : allVideos;
      let listMarkup = "";
      if (libraryTypeTab === "pdfs" && libraryCategoryFilter === "all" && filteredPdfs.length > 0) {
        const catOrder = Object.keys(catCounts).filter((k) => k !== "all" && catCounts[k] > 0);
        listMarkup = catOrder.map((catKey) => {
          const groupItems = filteredPdfs.filter((p) => String(p.category || "summaries").toLowerCase() === catKey);
          return `
            <div class="admin-cat-group-head">
              <span>📂 ${esc(formatCatLabel(catKey))}</span>
              <small>${groupItems.length} file${groupItems.length === 1 ? "" : "s"}</small>
            </div>
            <div class="admin-list">
              ${groupItems.map((item) => renderLibraryRow(item, "pdfs")).join("")}
            </div>
          `;
        }).join("");
      } else {
        listMarkup = `<div class="admin-list">${items.map((item) => renderLibraryRow(item, libraryTypeTab)).join("")}</div>`;
      }

      const categoryPillsHtml = libraryTypeTab === "pdfs" ? `
        <div class="filter-bar" aria-label="PDF Category Filter">
          <button type="button" class="filter-pill${libraryCategoryFilter === "all" ? " is-active" : ""}" data-pdf-cat="all">All Categories (${catCounts.all})</button>
          ${Object.keys(catCounts).filter((k) => k !== "all").map((catKey) => `
            <button type="button" class="filter-pill${libraryCategoryFilter === catKey ? " is-active" : ""}" data-pdf-cat="${esc(catKey)}">${esc(formatCatLabel(catKey))} (${catCounts[catKey]})</button>
          `).join("")}
        </div>
      ` : "";

      body.innerHTML = `
        <div class="admin-toolbar">
          <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;">
            <label class="admin-field" style="min-width:230px;">
              <select id="libCourseFilter">
                ${subjectOptsHtml}
                <option value="__all__"${selectedCourseId === "__all__" ? " selected" : ""}>All Courses</option>
              </select>
            </label>
            <div class="admin-subtabs" role="tablist">
              <button type="button" class="admin-subtab${libraryTypeTab === "pdfs" ? " is-active" : ""}" data-lib-tab="pdfs">📄 PDFs <small>(${allPdfs.length})</small></button>
              <button type="button" class="admin-subtab${libraryTypeTab === "videos" ? " is-active" : ""}" data-lib-tab="videos">🎬 Videos <small>(${allVideos.length})</small></button>
            </div>
          </div>
          <div class="inline">
            ${libraryTypeTab === "pdfs"
              ? `<button type="button" class="primary" id="openUploadPdfBtn">+ Upload PDF</button>`
              : `<button type="button" class="primary" id="openAddVideoBtn">+ Add Video</button>`}
          </div>
        </div>
        ${categoryPillsHtml}

        ${items.length === 0
          ? `<div class="empty-state">No ${libraryTypeTab === "pdfs" ? "PDF files" : "videos"} found for this filter. Click the button above to add one.</div>`
          : listMarkup}
      `;

      body.querySelector("#libCourseFilter").addEventListener("change", (e) => {
        selectedCourseId = e.target.value;
        renderLibraryTab(body);
      });

      body.querySelectorAll("[data-lib-tab]").forEach((btn) => {
        btn.addEventListener("click", () => {
          libraryTypeTab = btn.getAttribute("data-lib-tab");
          renderLibraryTab(body);
        });
      });

      body.querySelectorAll("[data-pdf-cat]").forEach((btn) => {
        btn.addEventListener("click", () => {
          libraryCategoryFilter = btn.getAttribute("data-pdf-cat") || "all";
          renderLibraryTab(body);
        });
      });

      const uploadBtn = body.querySelector("#openUploadPdfBtn");
      if (uploadBtn) {
        uploadBtn.addEventListener("click", () => {
          openModal({
            title: "Upload PDF File (≤ 25 MB)",
            html: `
              <form id="pdfUploadModalForm" class="dialog-body" style="padding:0;">
                <label class="admin-field">
                  <span>Course</span>
                  <select id="pmSubj">${subjectOptsHtml}</select>
                </label>
                <label class="admin-field">
                  <span>Title</span>
                  <input type="text" id="pmTitle" required maxlength="160" placeholder="Lecture 5 Summary">
                </label>
                <label class="admin-field">
                  <span>Category</span>
                  <select id="pmCat">
                    <option value="summaries">Summaries</option>
                    <option value="lecture-notes">Lecture Notes</option>
                    <option value="assignments">Assignments</option>
                    <option value="exam-reviews">Exam Reviews</option>
                    <option value="references">References</option>
                  </select>
                </label>
                <label class="admin-field">
                  <span>PDF File</span>
                  <input type="file" id="pmFile" accept="application/pdf" required>
                </label>
                <div class="inline" style="justify-content:flex-end;">
                  <button type="button" class="secondary" data-modal-close>Cancel</button>
                  <button type="submit" class="primary" id="pmSubmitBtn">Upload &amp; Publish PDF</button>
                </div>
              </form>
            `,
            onMount: (dlg) => {
              dlg.querySelector("#pdfUploadModalForm").addEventListener("submit", async (e) => {
                e.preventDefault();
                const file = dlg.querySelector("#pmFile").files[0];
                if (!file) return;
                const btn = dlg.querySelector("#pmSubmitBtn");
                btn.disabled = true;
                try {
                  const subjectId = dlg.querySelector("#pmSubj").value;
                  const title = dlg.querySelector("#pmTitle").value.trim();
                  const category = dlg.querySelector("#pmCat").value;
                  const qs = new URLSearchParams({ subjectId, title, category });
                  const { res, data } = await apiFetch(`/api/admin/r2/upload?${qs.toString()}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/pdf" },
                    body: file,
                  });
                  if (!res.ok || !data || !data.ok) {
                    toast((data && data.error) || "PDF upload failed.");
                    return;
                  }
                  if (lib && data.pdf) {
                    lib.addPdf({
                      id: data.pdf.id,
                      subjectId: data.pdf.subjectId,
                      category: data.pdf.category,
                      title: data.pdf.title,
                      path: data.pdf.url,
                      active: true,
                    });
                    await publishOverlay(false);
                  }
                  dlg.close();
                  renderLibraryTab(body);
                } finally {
                  btn.disabled = false;
                }
              });
            },
          });
        });
      }

      const addVidBtn = body.querySelector("#openAddVideoBtn");
      if (addVidBtn) {
        addVidBtn.addEventListener("click", () => {
          openModal({
            title: "Attach YouTube Study Video",
            html: `
              <form id="vidModalForm" class="dialog-body" style="padding:0;">
                <label class="admin-field">
                  <span>Course</span>
                  <select id="vmSubj">${subjectOptsHtml}</select>
                </label>
                <label class="admin-field">
                  <span>Title</span>
                  <input type="text" id="vmTitle" required maxlength="160" placeholder="Lecture Walkthrough">
                </label>
                <label class="admin-field">
                  <span>YouTube URL or Video ID</span>
                  <input type="text" id="vmUrl" required placeholder="https://youtu.be/...">
                </label>
                <label class="admin-field">
                  <span>Topic / Section (optional)</span>
                  <input type="text" id="vmTopic" maxlength="100" placeholder="Week 4">
                </label>
                <div class="inline" style="justify-content:flex-end;">
                  <button type="button" class="secondary" data-modal-close>Cancel</button>
                  <button type="submit" class="primary">Add &amp; Publish Video</button>
                </div>
              </form>
            `,
            onMount: (dlg) => {
              dlg.querySelector("#vidModalForm").addEventListener("submit", async (e) => {
                e.preventDefault();
                if (!lib) return;
                try {
                  const subjectId = dlg.querySelector("#vmSubj").value;
                  const title = dlg.querySelector("#vmTitle").value.trim();
                  const rawUrl = dlg.querySelector("#vmUrl").value.trim();
                  const topic = dlg.querySelector("#vmTopic").value.trim();
                  const slug = slugify(title).slice(0, 32) || "video";
                  lib.addVideo({
                    id: `vid-${subjectId}-${slug}-${Date.now()}`,
                    subjectId,
                    title,
                    topic,
                    youtubeUrl: rawUrl,
                    url: rawUrl,
                    active: true,
                  });
                  await publishOverlay(false);
                  dlg.close();
                  renderLibraryTab(body);
                } catch (err) {
                  toast(err.message || "Invalid video details.");
                }
              });
            },
          });
        });
      }

      body.querySelectorAll("[data-lib-edit]").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (!lib) return;
          const kind = btn.getAttribute("data-lib-edit");
          const itemId = btn.getAttribute("data-item-id");
          const item = (kind === "pdf" ? allPdfs : allVideos).find((x) => x.id === itemId);
          if (!item) return;
          openModal({
            title: `Edit ${kind === "pdf" ? "PDF" : "Video"} Details`,
            html: `
              <form id="editLibItemForm" class="dialog-body" style="padding:0;">
                <label class="admin-field">
                  <span>Title</span>
                  <input type="text" id="emTitle" required maxlength="160" value="${esc(item.title || "")}">
                </label>
                ${kind === "pdf" ? `
                  <label class="admin-field">
                    <span>Category</span>
                    <select id="emCategory">
                      ${["summaries", "lecture-notes", "assignments", "exam-reviews", "references"].map((c) =>
                        `<option value="${c}"${item.category === c ? " selected" : ""}>${c}</option>`
                      ).join("")}
                    </select>
                  </label>
                ` : `
                  <label class="admin-field">
                    <span>Topic</span>
                    <input type="text" id="emTopic" maxlength="100" value="${esc(item.topic || "")}">
                  </label>
                  <label class="admin-field">
                    <span>YouTube URL or Video ID</span>
                    <input type="text" id="emUrl" required value="${esc(item.youtubeUrl || item.url || item.youtubeId || "")}">
                  </label>
                `}
                <div class="inline" style="justify-content:flex-end;">
                  <button type="button" class="secondary" data-modal-close>Cancel</button>
                  <button type="submit" class="primary">Save Changes</button>
                </div>
              </form>
            `,
            onMount: (dlg) => {
              dlg.querySelector("#editLibItemForm").addEventListener("submit", async (e) => {
                e.preventDefault();
                try {
                  const title = dlg.querySelector("#emTitle").value.trim();
                  if (kind === "pdf") {
                    lib.editPdf(itemId, { title, category: dlg.querySelector("#emCategory").value });
                  } else {
                    const urlVal = dlg.querySelector("#emUrl").value.trim();
                    lib.editVideo(itemId, { title, topic: dlg.querySelector("#emTopic").value.trim(), youtubeUrl: urlVal, url: urlVal });
                  }
                  await publishOverlay(false);
                  dlg.close();
                  renderLibraryTab(body);
                } catch (err) {
                  toast(err.message || "Update failed.");
                }
              });
            },
          });
        });
      });

      body.querySelectorAll("[data-lib-action]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!lib) return;
          const action = btn.getAttribute("data-lib-action");
          const itemId = btn.getAttribute("data-item-id");
          try {
            if (action === "activate-pdf") lib.activatePdf(itemId);
            else if (action === "deactivate-pdf") lib.deactivatePdf(itemId);
            else if (action === "restore-pdf") lib.restorePdf(itemId);
            else if (action === "activate-video") lib.activateVideo(itemId);
            else if (action === "deactivate-video") lib.deactivateVideo(itemId);
            else if (action === "restore-video") lib.restoreVideo(itemId);
            await publishOverlay(false);
            renderLibraryTab(body);
          } catch (err) {
            toast(err.message || "Library action failed.");
          }
        });
      });

      body.querySelectorAll("[data-lib-hard-delete]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!lib) return;
          const kind = btn.getAttribute("data-lib-hard-delete");
          const itemId = btn.getAttribute("data-item-id");
          const itemTitle = btn.getAttribute("data-item-title");
          const itemPath = btn.getAttribute("data-item-path");
          const ok = await confirmModal({
            title: `Permanently Delete ${kind === "pdf" ? "PDF" : "Video"}?`,
            message: `This will permanently delete "${itemTitle}" from the library${itemPath.startsWith("/api/r2/") ? " and purge the uploaded file from storage" : ""}.`,
            confirmLabel: "Permanently Delete",
            danger: true,
          });
          if (!ok) return;

          if (kind === "pdf" && (itemPath.startsWith("/api/r2/") || itemId.startsWith("pdf-"))) {
            const fileQs = new URLSearchParams({ id: itemId || "", path: itemPath || "" });
            const { res, data } = await apiFetch(`/api/admin/r2/file?${fileQs.toString()}`, {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: itemId, path: itemPath }),
            });
            if (!res.ok || !data || !data.ok) {
              toast((data && data.error) || "Storage file delete failed.");
              return;
            }
            if (typeof lib.hardDeletePdf === "function") lib.hardDeletePdf(itemId);
            else lib.deletePdf(itemId);
          } else if (kind === "pdf") {
            if (typeof lib.hardDeletePdf === "function") lib.hardDeletePdf(itemId);
            else lib.deletePdf(itemId);
          } else {
            if (typeof lib.hardDeleteVideo === "function") lib.hardDeleteVideo(itemId);
            else lib.deleteVideo(itemId);
          }
          await publishOverlay(false);
          renderLibraryTab(body);
        });
      });
    }

    // ------------------------------------------------------------------------
    // TAB 3: LIVE QUIZ IMPORTER + READY-TO-COPY AI PROMPTS
    // ------------------------------------------------------------------------
    function renderImporterTab(body) {
      const Core = root.BankQuestionCore || {};
      const subjects = catalog.subjects || [];
      if (importerDraftState.subjectId && !subjects.some((s) => s.id === importerDraftState.subjectId)) {
        importerDraftState.subjectId = (subjects[0] && subjects[0].id) || "";
      } else if (!importerDraftState.subjectId && subjects[0]) {
        importerDraftState.subjectId = subjects[0].id;
      }

      const subjectOptions = subjects.map((s) =>
        `<option value="${esc(s.id)}"${s.id === importerDraftState.subjectId ? " selected" : ""}>${esc(state.getSubjectName(s))}</option>`
      ).join("");

      body.innerHTML = `
        <div class="admin-toolbar">
          <div>
            <h2 style="margin:0;font-size:1.05rem;">Live Quiz Importer &amp; Ready AI Prompts</h2>
            <p class="question-meta" style="margin:2px 0 0;">Copy a prompt for ChatGPT/Claude/Gemini, paste JSON or plaintext MCQs below, verify answers &amp; explanations, and publish live.</p>
          </div>
          <a href="https://github.com" class="hidden" id="promptsDocPlaceholder"></a>
        </div>

        <details open>
          <summary style="cursor:pointer;font-weight:700;font-size:0.9rem;color:var(--accent-text);">🤖 Ready AI Prompts (1-Click Copy for Users &amp; Instructors)</summary>
          <div class="admin-prompt-grid" style="margin-top:10px;">
            ${PROMPT_TEMPLATES.map((p) => `
              <div class="admin-prompt-card">
                <strong style="font-size:0.86rem;">${esc(p.title)}</strong>
                <span class="question-meta">${esc(p.desc)}</span>
                <pre>${esc(p.prompt)}</pre>
                <div class="inline">
                  <button type="button" class="secondary" data-copy-prompt="${esc(p.id)}">Copy Prompt</button>
                  <button type="button" class="quiet" data-try-prompt="${esc(p.id)}">View Full</button>
                </div>
              </div>
            `).join("")}
          </div>
        </details>

        <div class="admin-form-grid">
          <label class="admin-field">
            <span>Target Course <button type="button" class="quiet" id="impQuickNewCourse" style="padding:1px 6px;font-size:0.74rem;">+ New</button></span>
            <select id="impSubj">${subjectOptions || `<option value="">No courses — click + New</option>`}</select>
          </label>
          <label class="admin-field">
            <span>Quiz Title</span>
            <input type="text" id="impTitle" value="${esc(importerDraftState.title || "Imported Practice Quiz")}" maxlength="160">
          </label>
          <label class="admin-field">
            <span>Quiz ID Slug</span>
            <input type="text" id="impQuizId" value="${esc(importerDraftState.quizId || "")}" maxlength="80" placeholder="auto-from-title">
          </label>
          <label class="admin-field">
            <span>Type</span>
            <select id="impKind">
              <option value="quiz"${importerDraftState.kind === "quiz" ? " selected" : ""}>Quiz / Bank</option>
              <option value="sheet"${importerDraftState.kind === "sheet" ? " selected" : ""}>Sheet</option>
              <option value="lecture"${importerDraftState.kind === "lecture" ? " selected" : ""}>Lecture Practice</option>
            </select>
          </label>
        </div>

        <div class="inline" style="justify-content:space-between;flex-wrap:wrap;">
          <span class="question-meta">Paste JSON or numbered text (supports <code>Answer: B</code>, <code>Image:</code>, <code>Caption:</code>, <code>Explanation:</code>, <code>Arabic Explanation:</code>, <code>Rule:</code>) — or attach uploaded images per question after preview.</span>
          <label class="secondary" style="cursor:pointer;padding:6px 11px;font-size:0.8rem;">
            Load .json / .txt File
            <input type="file" id="impFileInput" accept=".json,.txt,.md,application/json,text/plain" class="hidden">
          </label>
        </div>

        <label class="admin-field">
          <textarea id="impRaw" rows="7" placeholder="Paste AI JSON output or Q1. Question...&#10;A) ...&#10;B) ...&#10;Answer: B&#10;Explanation: ...&#10;Arabic Explanation: ...&#10;Rule: ...">${esc(importerDraftState.raw || "")}</textarea>
        </label>

        <div class="inline">
          <button type="button" class="secondary" id="impValidateBtn">Parse &amp; Preview</button>
          <button type="button" class="primary hidden" id="impPublishBtn">🚀 Publish Live to Course</button>
          <button type="button" class="secondary hidden" id="impDownloadBtn">Download Clean JSON</button>
        </div>

        <div id="impPreviewWrap" class="question-meta">Paste content above or load a file, then click <strong>Parse &amp; Preview</strong>.</div>
      `;

      const subjSel = body.querySelector("#impSubj");
      const titleInput = body.querySelector("#impTitle");
      const idInput = body.querySelector("#impQuizId");
      const kindSel = body.querySelector("#impKind");
      const rawInput = body.querySelector("#impRaw");
      const previewWrap = body.querySelector("#impPreviewWrap");
      const publishBtn = body.querySelector("#impPublishBtn");
      const dlBtn = body.querySelector("#impDownloadBtn");
      let lastValidPayload = importerDraftState.parsed;

      function syncDraftMeta() {
        importerDraftState.subjectId = subjSel.value;
        importerDraftState.title = titleInput.value;
        importerDraftState.quizId = idInput.value;
        importerDraftState.kind = kindSel.value;
        importerDraftState.raw = rawInput.value;
      }

      body.querySelectorAll("[data-copy-prompt]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const tpl = PROMPT_TEMPLATES.find((p) => p.id === btn.getAttribute("data-copy-prompt"));
          if (tpl) copyToClipboard(tpl.prompt, tpl.title);
        });
      });

      body.querySelectorAll("[data-try-prompt]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const tpl = PROMPT_TEMPLATES.find((p) => p.id === btn.getAttribute("data-try-prompt"));
          if (!tpl) return;
          openModal({
            title: tpl.title,
            wide: true,
            html: `
              <pre style="white-space:pre-wrap;font-size:0.82rem;background:var(--tile);padding:12px;border-radius:10px;border:1px solid var(--line);max-height:55vh;overflow:auto;">${esc(tpl.prompt)}</pre>
              <div class="inline" style="justify-content:flex-end;">
                <button type="button" class="secondary" data-modal-close>Close</button>
                <button type="button" class="primary" id="modalCopyPromptBtn">Copy Prompt</button>
              </div>
            `,
            onMount: (dlg) => {
              dlg.querySelector("#modalCopyPromptBtn").addEventListener("click", () => {
                copyToClipboard(tpl.prompt, tpl.title);
              });
            },
          });
        });
      });

      body.querySelector("#impQuickNewCourse").addEventListener("click", () => {
        syncDraftMeta();
        openCourseEditorModal(null, (newId) => {
          importerDraftState.subjectId = newId;
          renderImporterTab(body);
        });
      });

      body.querySelector("#impFileInput").addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const content = await file.text();
        rawInput.value = content;
        if (!titleInput.value || titleInput.value === "Imported Practice Quiz") {
          titleInput.value = file.name.replace(/\.(json|txt|md)$/i, "");
        }
        syncDraftMeta();
        toast(`Loaded ${file.name}.`);
      });

      function runParse() {
        syncDraftMeta();
        const raw = rawInput.value.trim();
        const subjectId = subjSel.value;
        const title = titleInput.value.trim() || "Imported Practice Quiz";
        const collectionId = slugify(idInput.value) || slugify(title) || "imported-quiz";
        if (!raw) {
          previewWrap.innerHTML = `<div class="dialog-error">Please paste JSON or MCQ text first.</div>`;
          return;
        }
        try {
          if (!Core.ImportPipeline || typeof Core.ImportPipeline.createPipeline !== "function") {
            throw new Error("ImportPipeline module is not loaded.");
          }
          // If JSON has top-level title/kind and user left default title, adopt it seamlessly
          let detectedTitle = title;
          let detectedKind = kindSel.value;
          const isJson = raw.startsWith("{") || raw.startsWith("[");
          if (isJson) {
            try {
              const parsedObj = JSON.parse(raw);
              if (parsedObj && typeof parsedObj === "object" && !Array.isArray(parsedObj)) {
                if (parsedObj.title && (!titleInput.dataset.touched || title === "Imported Practice Quiz")) {
                  detectedTitle = String(parsedObj.title).trim();
                  titleInput.value = detectedTitle;
                }
                if (parsedObj.kind && ["quiz", "sheet", "lecture"].includes(parsedObj.kind)) {
                  detectedKind = parsedObj.kind;
                  kindSel.value = detectedKind;
                }
              }
            } catch (_e) { /* let pipeline throw structured JSON error */ }
          }
          const finalQuizId = slugify(idInput.value) || slugify(detectedTitle) || collectionId;
          if (!idInput.value) idInput.value = finalQuizId;

          const pipeline = Core.ImportPipeline.createPipeline({ storage: null });
          const draft = pipeline.parse({ kind: isJson ? "json" : "text", text: raw, subjectId, collectionId: finalQuizId, title: detectedTitle });
          const questions = Array.isArray(draft.questions) ? draft.questions : [];
          const issues = Array.isArray(draft.issues) ? draft.issues : [];
          const hasErrors = issues.some((it) => it && it.severity === "error") || questions.length === 0;
          const payload = { subjectId, quizId: finalQuizId, kind: detectedKind, title: detectedTitle, questions };

          lastValidPayload = hasErrors ? null : payload;
          importerDraftState.parsed = lastValidPayload;
          publishBtn.classList.toggle("hidden", hasErrors || !subjectId);
          dlBtn.classList.toggle("hidden", hasErrors);

          function paintImporterPreview() {
            const keyedCount = questions.filter((q) => Boolean(q.correctOptionId)).length;
            const imgCount = questions.filter((q) => getQImages(q).length > 0).length;
            previewWrap.innerHTML = `
              <div class="admin-stat-grid" style="margin-bottom:10px;">
                <div class="admin-stat-box"><span>Parsed Questions</span><strong>${questions.length}</strong></div>
                <div class="admin-stat-box"><span>With Answer Key</span><strong>${keyedCount} / ${questions.length}</strong></div>
                <div class="admin-stat-box"><span>With Images</span><strong>${imgCount}</strong></div>
                <div class="admin-stat-box"><span>With Explanations</span><strong>${questions.filter((q) => q.explanation || q.explanationArabic || q.rule).length}</strong></div>
                <div class="admin-stat-box"><span>Status</span><strong>${hasErrors ? "Needs Fix" : "Ready ✓"}</strong></div>
              </div>
              ${issues.length ? `<div class="dialog-error" style="margin-bottom:10px;">${issues.slice(0, 6).map((it) => esc(`[${it.severity || "info"}] ${it.message || it}`)).join("<br>")}</div>` : ""}
              <div class="admin-preview-list">
                ${questions.map((q, idx) => {
                  const qImgs = getQImages(q);
                  return `
                    <div class="admin-preview-item">
                      <div class="admin-row-title-line" style="justify-content:space-between;">
                        <div class="admin-row-title-line">
                          <strong>Q${idx + 1}. ${esc((q.question || q.text || "").slice(0, 140))}</strong>
                          ${q.correctOptionId ? `<span class="admin-badge is-accent">Key: ${esc(q.correctOptionId)}</span>` : `<span class="admin-badge is-warn">No Key</span>`}
                          ${qImgs.length ? `<span class="admin-badge is-accent">🖼️ ${qImgs.length}</span>` : ""}
                          ${q.explanation ? `<span class="admin-badge">EN ✓</span>` : ""}
                          ${(q.explanationArabic || q.arabicExplanation) ? `<span class="admin-badge">AR ✓</span>` : ""}
                          ${q.rule ? `<span class="admin-badge">Rule ✓</span>` : ""}
                        </div>
                        <button type="button" class="quiet" data-imp-img-idx="${idx}">${qImgs.length ? `🖼️ Images (${qImgs.length})` : "🖼️ + Image"}</button>
                      </div>
                      ${renderAdminImageThumbs(qImgs)}
                      <div class="question-meta">${(q.options || []).map((o) => `${o.id === q.correctOptionId ? "✓ " : ""}${esc(o.id)}) ${esc(o.text)}`).join(" · ")}</div>
                    </div>
                  `;
                }).join("")}
              </div>
            `;

            previewWrap.querySelectorAll("[data-imp-img-idx]").forEach((imgBtn) => {
              imgBtn.addEventListener("click", () => {
                const idx = Number(imgBtn.getAttribute("data-imp-img-idx"));
                const targetQ = questions[idx];
                if (!targetQ) return;
                const workingImgs = getQImages(targetQ).map((it) => Object.assign({}, it));
                openModal({
                  title: `Attach Images — Q${idx + 1}`,
                  wide: true,
                  html: `
                    <p class="question-meta" style="margin:0 0 8px;">${esc((targetQ.question || targetQ.text || "").slice(0, 200))}</p>
                    <div id="impImgEditorMount"></div>
                    <div class="inline" style="justify-content:flex-end;margin-top:10px;">
                      <button type="button" class="primary" data-modal-close>Done</button>
                    </div>
                  `,
                  onMount: (dlg) => {
                    const mount = dlg.querySelector("#impImgEditorMount");
                    mountQuestionImagesEditor(mount, workingImgs, subjSel.value || "general", () => {
                      syncQuestionImageProps(targetQ, workingImgs);
                      paintImporterPreview();
                    });
                  },
                });
              });
            });
          }

          paintImporterPreview();
        } catch (err) {
          lastValidPayload = null;
          importerDraftState.parsed = null;
          publishBtn.classList.add("hidden");
          dlBtn.classList.add("hidden");
          previewWrap.innerHTML = `<div class="dialog-error">Validation error: ${esc(err.message)}</div>`;
        }
      }

      titleInput.addEventListener("input", () => { titleInput.dataset.touched = "1"; });
      body.querySelector("#impValidateBtn").addEventListener("click", runParse);

      publishBtn.addEventListener("click", async () => {
        if (!lastValidPayload) return;
        const subjectId = subjSel.value;
        if (!subjectId) {
          toast("Select or create a Target Course first.");
          return;
        }
        publishBtn.disabled = true;
        try {
          const toPublish = Object.assign({}, lastValidPayload, {
            subjectId,
            title: titleInput.value.trim() || lastValidPayload.title,
            quizId: slugify(idInput.value) || lastValidPayload.quizId,
            kind: kindSel.value || lastValidPayload.kind,
          });
          const { res, data } = await apiFetch("/api/admin/quizzes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(toPublish),
          });
          if (!res.ok || !data || !data.ok) {
            toast((data && data.error) || "Failed to publish quiz.");
            return;
          }
          await syncCatalog();
          selectedCourseId = subjectId;
          toast(`Published "${toPublish.title}" (${toPublish.questions.length} Qs) live!`);
          importerDraftState = { subjectId, title: "", quizId: "", kind: "quiz", raw: "", parsed: null };
          if (container._switchAdminTab) container._switchAdminTab("courses");
        } finally {
          publishBtn.disabled = false;
        }
      });

      dlBtn.addEventListener("click", () => {
        if (!lastValidPayload) return;
        const blob = new Blob([JSON.stringify(lastValidPayload, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${lastValidPayload.quizId || "quiz"}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      });

      if (importerDraftState.raw && !lastValidPayload) {
        // leave ready for user validation
      }
    }

    // ------------------------------------------------------------------------
    // TAB 4: QUESTION REPORTS (MODAL NOTE + HARD DELETE)
    // ------------------------------------------------------------------------
    async function renderReportsTab(body) {
      let status = "open";
      async function load() {
        body.innerHTML = `<p class="question-meta">Loading question reports...</p>`;
        const { res, data } = await apiFetch(`/api/admin/reports?status=${encodeURIComponent(status)}`);
        if (!res.ok || !data || !data.ok) {
          body.innerHTML = `<div class="dialog-error">${esc((data && data.error) || "Could not load reports.")}</div>`;
          return;
        }
        const reports = data.reports || [];
        body.innerHTML = `
          <div class="dialog-head">
            <h2 style="margin:0;font-size:1.05rem;">Question Issue Reports (${reports.length})</h2>
            <select id="repFilterSelect" style="padding:7px 10px;border-radius:9px;border:1px solid var(--line);background:var(--tile);color:var(--ink);">
              <option value="open"${status === "open" ? " selected" : ""}>Open</option>
              <option value="resolved"${status === "resolved" ? " selected" : ""}>Resolved</option>
              <option value="dismissed"${status === "dismissed" ? " selected" : ""}>Dismissed</option>
              <option value="all"${status === "all" ? " selected" : ""}>All</option>
            </select>
          </div>
          ${reports.length === 0 ? `<div class="empty-state">No reports matching "${esc(status)}".</div>` : `
            <div class="admin-list">
              ${reports.map((r) => `
                <div class="admin-row">
                  <div class="admin-row-main">
                    <strong>${esc(r.subjectId)} / ${esc(r.quizId)} · Q: ${esc(r.questionId)}</strong>
                    <span class="question-meta">By ${esc(r.username || "Anonymous")} · Reason: <strong>${esc(r.reason)}</strong> · Status: ${esc(r.status)}</span>
                    ${r.questionText ? `<div style="font-size:0.86rem;">"${esc(r.questionText)}"</div>` : ""}
                    ${r.details ? `<div style="font-size:0.84rem;color:var(--muted);">${esc(r.details)}</div>` : ""}
                    ${r.resolutionNote ? `<div style="font-size:0.82rem;color:var(--accent-text);">Note: ${esc(r.resolutionNote)}</div>` : ""}
                  </div>
                  <div class="admin-row-actions">
                    <button type="button" class="primary" data-resolve="${esc(r.id)}" data-next="resolved">Resolve</button>
                    <button type="button" class="secondary" data-resolve="${esc(r.id)}" data-next="dismissed">Dismiss</button>
                    ${r.status !== "open" ? `<button type="button" class="quiet" data-resolve="${esc(r.id)}" data-next="open">Reopen</button>` : ""}
                    <button type="button" class="admin-btn-danger" data-del-report="${esc(r.id)}">Delete</button>
                  </div>
                </div>
              `).join("")}
            </div>
          `}
        `;
        body.querySelector("#repFilterSelect").addEventListener("change", (e) => { status = e.target.value; load(); });
        body.querySelectorAll("[data-resolve]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const id = btn.getAttribute("data-resolve");
            const nextStatus = btn.getAttribute("data-next");
            openModal({
              title: `Mark Report as ${nextStatus}`,
              html: `
                <form id="resolveRepModalForm" class="dialog-body" style="padding:0;">
                  <label class="admin-field">
                    <span>Resolution Note (optional)</span>
                    <textarea id="repNoteInput" rows="3" maxlength="500" placeholder="Fixed answer key / clarified note..."></textarea>
                  </label>
                  <div class="inline" style="justify-content:flex-end;">
                    <button type="button" class="secondary" data-modal-close>Cancel</button>
                    <button type="submit" class="primary">Save Status</button>
                  </div>
                </form>
              `,
              onMount: (dlg) => {
                dlg.querySelector("#resolveRepModalForm").addEventListener("submit", async (e) => {
                  e.preventDefault();
                  const note = dlg.querySelector("#repNoteInput").value.trim();
                  const { res: r2, data: d2 } = await apiFetch("/api/admin/reports/resolve", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id, status: nextStatus, resolutionNote: note }),
                  });
                  if (!r2.ok || !d2 || !d2.ok) {
                    toast((d2 && d2.error) || "Action failed.");
                    return;
                  }
                  dlg.close();
                  toast(`Report marked ${nextStatus}.`);
                  load();
                });
              },
            });
          });
        });
        body.querySelectorAll("[data-del-report]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const id = btn.getAttribute("data-del-report");
            const ok = await confirmModal({
              title: "Delete Report?",
              message: "Permanently delete this question issue report?",
              confirmLabel: "Delete Report",
              danger: true,
            });
            if (!ok) return;
            const { res: r2, data: d2 } = await apiFetch(`/api/admin/reports?id=${encodeURIComponent(id)}`, { method: "DELETE" });
            if (!r2.ok || !d2 || !d2.ok) {
              toast((d2 && d2.error) || "Could not delete report.");
              return;
            }
            toast("Report permanently deleted.");
            load();
          });
        });
      }
      await load();
    }

    // ------------------------------------------------------------------------
    // TAB 5: ONLINE USERS, LEARNERS & ROLES (MODAL CONFIRM HARD DELETE)
    // ------------------------------------------------------------------------
    async function renderUsersTab(body, session) {
      let query = "";
      let showAll = false;
      const areaNames = {
        hub: "Course Hub",
        player: "Quiz Player",
        leaderboard: "Leaderboard",
        saved: "Saved Questions",
        mistakes: "Mistakes Notebook",
        settings: "Settings & Account",
        lecture: "Lecture Guide",
        admin: "Admin Portal",
      };

      async function paintOnlinePanel(onlineHost) {
        if (!onlineHost || !onlineHost.isConnected) {
          clearOnlineRefreshTimer();
          return;
        }
        const { res, data } = await apiFetch("/api/admin/online-users");
        if (!onlineHost.isConnected) {
          clearOnlineRefreshTimer();
          return;
        }
        const headerBadgeLabel = container.querySelector("#adminHeaderOnlineLabel");
        if (!res.ok || !data || !data.ok) {
          onlineHost.innerHTML = `<div class="dialog-error">${esc((data && data.error) || "Could not load online users.")}</div>`;
          return;
        }
        const onlineUsers = Array.isArray(data.users) ? data.users : [];
        const totalOnline = Number(data.totalOnline || 0);
        const identifiedCount = Number(data.identifiedCount != null ? data.identifiedCount : onlineUsers.length);
        const anonymousCount = Math.max(0, Number(data.anonymousCount != null ? data.anonymousCount : (totalOnline - identifiedCount)));
        if (headerBadgeLabel) {
          headerBadgeLabel.textContent = `${totalOnline} Online (${identifiedCount} named)`;
        }
        onlineHost.innerHTML = `
          <div class="dialog-head" style="flex-wrap:wrap;gap:8px;">
            <div class="inline">
              <span class="admin-online-dot" aria-hidden="true"></span>
              <div>
                <h3 style="margin:0;font-size:0.98rem;">Online Users Right Now</h3>
                <small style="color:var(--muted);">Active within the last ${Number(data.activeWindowSeconds || 90)}s · Auto-updates every 15s</small>
              </div>
            </div>
            <button type="button" class="secondary" id="refreshOnlineUsersBtn">↻ Refresh Online</button>
          </div>
          <div class="admin-stat-grid">
            <div class="admin-stat-box"><span>Total Online Browsers</span><strong>${totalOnline}</strong></div>
            <div class="admin-stat-box"><span>Online With Username</span><strong>${identifiedCount}</strong></div>
            <div class="admin-stat-box"><span>Browsing Without Name</span><strong>${anonymousCount}</strong></div>
          </div>
          ${onlineUsers.length === 0 ? `
            <div class="empty-state">
              ${totalOnline > 0
                ? `${totalOnline} active browser(s) detected, but none are signed in with a username yet.`
                : "No active signed-in users or guests detected in the last 90 seconds."}
            </div>
          ` : `
            <div class="admin-list">
              ${onlineUsers.map((u) => {
                const idle = Number(u.idleSeconds || 0);
                const seenText = idle <= 5 ? "Just now" : `${idle}s ago`;
                const areaLabel = areaNames[u.currentArea] || (u.currentArea ? u.currentArea : "");
                const showDisplay = u.displayName && u.displayName !== u.username;
                return `
                  <div class="admin-row is-compact">
                    <div class="admin-row-main">
                      <div class="admin-row-title-line">
                        <span class="admin-online-dot" aria-hidden="true"></span>
                        <strong>${esc(u.username)}</strong>
                        ${showDisplay ? `<span class="question-meta">(${esc(u.displayName)})</span>` : ""}
                        ${u.isAdmin ? `<span class="admin-badge is-accent">🛡️ Admin (Co-Admin)</span>` : ""}
                        <span class="admin-badge">${u.isGuest ? "Guest (No Password)" : "Registered"}</span>
                        ${areaLabel ? `<span class="admin-badge">📍 ${esc(areaLabel)}</span>` : ""}
                      </div>
                      <span class="question-meta">ID: ${esc(u.studentId)} · Last active: ${esc(seenText)}</span>
                    </div>
                  </div>
                `;
              }).join("")}
            </div>
          `}
        `;
        const refBtn = onlineHost.querySelector("#refreshOnlineUsersBtn");
        if (refBtn) {
          refBtn.addEventListener("click", () => paintOnlinePanel(onlineHost));
        }
      }

      async function load() {
        const shouldFetch = query.length >= 2 || showAll;
        let res = { ok: true };
        let data = { users: [], hasMore: false };
        if (shouldFetch) {
          const qs = query.length >= 2 ? `q=${encodeURIComponent(query)}` : "all=1";
          const fetched = await apiFetch(`/api/admin/users?${qs}`);
          res = fetched.res;
          data = fetched.data || { users: [] };
        }
        const users = (data && data.users) || [];
        body.innerHTML = `
          <div class="admin-online-panel" id="adminOnlinePanel">
            <p class="question-meta" style="margin:0;">Loading live online users...</p>
          </div>
          <div class="dialog-head" style="flex-wrap:wrap;gap:10px;">
            <div>
              <h2 style="margin:0;font-size:1.05rem;">Learners &amp; Admins${shouldFetch ? ` (${users.length}${data && data.hasMore ? "+" : ""})` : ""}</h2>
              ${session.role !== "master" ? `<small style="color:var(--muted);">Master Admin password session is required to grant or revoke Admin privileges.</small>` : `<small style="color:var(--muted);">Search a learner or click "Show All Users" to display everyone at once and manage Admin access.</small>`}
            </div>
            <div class="inline" style="flex-wrap:wrap;">
              <form id="userSearchForm" class="inline">
                <input type="text" id="userSearchInput" value="${esc(query)}" placeholder="Search username (min 2 chars)" style="padding:7px 10px;border-radius:9px;border:1px solid var(--line);background:var(--tile);color:var(--ink);">
                <button type="submit" class="secondary">Search</button>
                ${query ? `<button type="button" class="quiet" id="clearUserSearchBtn">Clear</button>` : ""}
              </form>
              <button type="button" class="${showAll ? "secondary" : "primary"}" id="toggleAllUsersBtn">
                ${showAll ? "🙈 Hide Users List" : "👥 Show All Users"}
              </button>
            </div>
          </div>
          ${!shouldFetch ? `
            <div class="empty-state">
              Users list is hidden by default. Use the search box above or click <strong>Show All Users</strong> to view and manage registered &amp; guest learners.
            </div>
          ` : !res.ok ? `<div class="dialog-error">${esc((data && data.error) || "Failed to load users")}</div>` : users.length === 0 ? `
            <div class="empty-state">No matching users found.</div>
          ` : `
            <div class="admin-list">
              ${users.map((u) => {
                const isGuest = String(u.studentId || "").startsWith("gst_");
                return `
                  <div class="admin-row is-compact">
                    <div class="admin-row-main">
                      <div class="admin-row-title-line">
                        <strong>${esc(u.username)}</strong>
                        ${u.isAdmin ? `<span class="admin-badge is-accent">🛡️ Admin (Co-Admin)</span>` : ""}
                        <span class="admin-badge">${isGuest ? "Guest (No Password)" : "Registered"}</span>
                      </div>
                      <span class="question-meta">ID: ${esc(u.studentId)} · Joined: ${esc(String(u.createdAt || "").slice(0, 10))}</span>
                    </div>
                    <div class="admin-row-actions">
                      ${session.role === "master" ? `
                        <button type="button" class="${u.isAdmin ? "secondary" : "primary"}" data-role-id="${esc(u.studentId)}" data-role-name="${esc(u.username)}" data-next-admin="${u.isAdmin ? "0" : "1"}">
                          ${u.isAdmin ? "Revoke Admin" : "Make Admin"}
                        </button>
                      ` : ""}
                      <button type="button" class="admin-btn-danger" data-del-user="${esc(u.studentId)}" data-del-name="${esc(u.username)}">Delete</button>
                    </div>
                  </div>
                `;
              }).join("")}
            </div>
          `}
        `;
        const onlineHost = body.querySelector("#adminOnlinePanel");
        paintOnlinePanel(onlineHost);
        clearOnlineRefreshTimer();
        onlineRefreshTimer = setInterval(() => {
          if (activeTab !== "users" || !onlineHost || !onlineHost.isConnected) {
            clearOnlineRefreshTimer();
            return;
          }
          paintOnlinePanel(onlineHost);
        }, 15000);
        body.querySelector("#userSearchForm").addEventListener("submit", (e) => {
          e.preventDefault();
          query = body.querySelector("#userSearchInput").value.trim();
          if (query.length > 0 && query.length < 2) {
            toast("Enter at least 2 characters to search.");
            return;
          }
          load();
        });
        const clearBtn = body.querySelector("#clearUserSearchBtn");
        if (clearBtn) {
          clearBtn.addEventListener("click", () => {
            query = "";
            load();
          });
        }
        body.querySelector("#toggleAllUsersBtn").addEventListener("click", () => {
          showAll = !showAll;
          if (showAll) query = "";
          load();
        });
        body.querySelectorAll("[data-role-id]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const studentId = btn.getAttribute("data-role-id");
            const uname = btn.getAttribute("data-role-name") || studentId;
            const isAdmin = btn.getAttribute("data-next-admin") === "1";
            const { res: r2, data: d2 } = await apiFetch("/api/admin/users/role", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ studentId, isAdmin }),
            });
            if (!r2.ok || !d2 || !d2.ok) {
              toast((d2 && d2.error) || "Role update failed.");
              return;
            }
            toast(isAdmin ? `${uname} is now an Admin (Co-Admin).` : `Admin access revoked for ${uname}.`);
            load();
          });
        });
        body.querySelectorAll("[data-del-user]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const studentId = btn.getAttribute("data-del-user");
            const uname = btn.getAttribute("data-del-name");
            const ok = await confirmModal({
              title: "Delete User Account?",
              message: `Permanently delete student "${uname}" and all their sessions, attempts, and leaderboard scores?`,
              confirmLabel: "Delete User",
              danger: true,
            });
            if (!ok) return;
            const { res: r2, data: d2 } = await apiFetch("/api/admin/users/delete", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ studentId }),
            });
            if (!r2.ok || !d2 || !d2.ok) {
              toast((d2 && d2.error) || "Delete failed.");
              return;
            }
            toast("User removed.");
            load();
          });
        });
      }
      await load();
    }

    // ------------------------------------------------------------------------
    // TAB 6: SITE SETTINGS & HOSTING DIAGNOSTICS
    // ------------------------------------------------------------------------
    async function renderSettingsTab(body, session) {
      const settings = state.getSiteSettings() || {};
      const odInit = (settings.offlineDownloads && typeof settings.offlineDownloads === "object") ? settings.offlineDownloads : {};
      let quizzesMode = (odInit.quizzesMode === "all" || odInit.quizzesMode === "selected") ? odInit.quizzesMode : "disabled";
      let lecturesMode = (odInit.lecturesMode === "all" || odInit.lecturesMode === "selected") ? odInit.lecturesMode : "disabled";
      let allowedQuizIds = Array.isArray(odInit.allowedQuizIds) ? odInit.allowedQuizIds.slice() : [];
      let allowedLectureIds = Array.isArray(odInit.allowedLectureIds) ? odInit.allowedLectureIds.slice() : [];

      let diagHtml = `<p class="question-meta">Diagnostics are restricted to Master Admin sessions.</p>`;
      if (session.role === "master") {
        const { data } = await apiFetch("/api/admin/diagnostics");
        if (data && data.ok) {
          const isSelfHosted = String(data.storageMode || "").includes("self-hosted");
          diagHtml = `
            <div class="admin-stat-grid">
              <div class="admin-stat-box"><span>Hosting Runtime</span><strong>${isSelfHosted ? "Self-Hosted Node" : "Cloudflare Workers"}</strong></div>
              <div class="admin-stat-box"><span>${isSelfHosted ? "SQLite Database" : "Cloudflare D1"}</span><strong>${data.d1Bound ? "Ready ✓" : "Missing"}</strong></div>
              <div class="admin-stat-box"><span>${isSelfHosted ? "Disk File Store" : "Cloudflare R2"}</span><strong>${data.r2Bound ? "Bound ✓" : "Unbound"}</strong></div>
              <div class="admin-stat-box"><span>Admin Secret</span><strong>${data.adminSecretConfigured ? "Configured ✓" : "Missing"}</strong></div>
            </div>
          `;
        }
      }

      function openOfflinePickerModal(kind) {
        const isQuizzes = kind === "quizzes";
        const currentSet = new Set(isQuizzes ? allowedQuizIds : allowedLectureIds);
        const subjects = catalog.subjects || [];
        const groupsHtml = subjects.map((subj) => {
          const items = isQuizzes
            ? (root.ElgoModel ? root.ElgoModel.listSources(catalog, subj.id, "all") : [])
            : (root.ElgoModel ? root.ElgoModel.listLectures(catalog, subj.id) : []);
          const allKey = `${subj.id}::*`;
          return `
            <div class="admin-picker-group">
              <label style="font-weight:800;color:var(--accent-text);">
                <input type="checkbox" data-pick-item="${esc(allKey)}"${currentSet.has(allKey) ? " checked" : ""}>
                <span>All ${isQuizzes ? "quizzes" : "lectures"} in ${esc(state.getSubjectName(subj))}</span>
              </label>
              ${items.length === 0 ? `<small style="color:var(--muted);">No ${isQuizzes ? "quizzes" : "lectures"} in this course yet.</small>` : items.map((item) => {
                const key = isQuizzes ? String(item.id) : `${subj.id}::${item.id}`;
                const title = isQuizzes ? state.getQuizTitle(item, subj.id) : (item.title || item.id);
                return `
                  <label>
                    <input type="checkbox" data-pick-item="${esc(key)}"${currentSet.has(key) ? " checked" : ""}>
                    <span>${esc(title)}</span>
                  </label>
                `;
              }).join("")}
            </div>
          `;
        }).join("");

        openModal({
          title: isQuizzes ? "Select Allowed Offline Quiz HTML Pages" : "Select Allowed Offline Lecture Explanation Pages",
          wide: true,
          html: `
            <div class="dialog-body" style="padding:0;">
              <div class="inline" style="justify-content:space-between;">
                <small style="color:var(--muted);">Checked courses or individual items will show the ⬇ Offline HTML button to students.</small>
                <div class="inline">
                  <button type="button" class="quiet" id="pickAllBtn">Select All</button>
                  <button type="button" class="quiet" id="pickClearBtn">Clear All</button>
                </div>
              </div>
              <div class="admin-picker-scroll">${groupsHtml}</div>
              <div class="inline" style="justify-content:flex-end;">
                <button type="button" class="secondary" data-modal-close>Cancel</button>
                <button type="button" class="primary" id="savePickerSelectionBtn">Apply Selection</button>
              </div>
            </div>
          `,
          onMount: (dlg) => {
            dlg.querySelector("#pickAllBtn").addEventListener("click", () => {
              dlg.querySelectorAll("[data-pick-item]").forEach((cb) => { cb.checked = true; });
            });
            dlg.querySelector("#pickClearBtn").addEventListener("click", () => {
              dlg.querySelectorAll("[data-pick-item]").forEach((cb) => { cb.checked = false; });
            });
            dlg.querySelector("#savePickerSelectionBtn").addEventListener("click", () => {
              const nextIds = Array.from(dlg.querySelectorAll("[data-pick-item]:checked")).map((cb) => cb.getAttribute("data-pick-item"));
              if (isQuizzes) allowedQuizIds = nextIds;
              else allowedLectureIds = nextIds;
              closeModal();
              paintSettingsBody();
            });
          },
        });
      }

      function paintSettingsBody() {
        const bannerTextVal = body.querySelector("#setBannerText") ? body.querySelector("#setBannerText").value : (settings.announcement || settings.bannerText || "");
        const bannerUrlVal = body.querySelector("#setBannerUrl") ? body.querySelector("#setBannerUrl").value : (settings.bannerUrl || "");

        body.innerHTML = `
          <h2 style="margin:0;font-size:1.05rem;">Site Announcement &amp; Offline HTML Controls</h2>
          <form id="siteSettingsForm" class="admin-form-grid">
            <label class="admin-field">
              <span>Global Announcement Banner Text</span>
              <input type="text" id="setBannerText" value="${esc(bannerTextVal)}" maxlength="220" placeholder="Leave empty to hide banner">
            </label>
            <label class="admin-field">
              <span>Banner Link (optional https:// or /...)</span>
              <input type="text" id="setBannerUrl" value="${esc(bannerUrlVal)}" placeholder="/?panel=leaderboard">
            </label>

            <div class="admin-row" style="align-items:flex-end;flex-wrap:wrap;gap:12px;">
              <label class="admin-field" style="flex:1 1 220px;">
                <span>Offline Quiz HTML Downloads</span>
                <select id="setOfflineQuizMode">
                  <option value="disabled"${quizzesMode === "disabled" ? " selected" : ""}>Disabled (Students cannot download)</option>
                  <option value="all"${quizzesMode === "all" ? " selected" : ""}>Allow All Quizzes &amp; Sheets</option>
                  <option value="selected"${quizzesMode === "selected" ? " selected" : ""}>Allow Specific Quizzes / Courses Only</option>
                </select>
              </label>
              ${quizzesMode === "selected" ? `
                <button type="button" class="secondary" id="pickOfflineQuizzesBtn">Choose Quizzes (${allowedQuizIds.length} allowed)</button>
              ` : ""}
            </div>

            <div class="admin-row" style="align-items:flex-end;flex-wrap:wrap;gap:12px;">
              <label class="admin-field" style="flex:1 1 220px;">
                <span>Offline Lecture Explanation HTML Downloads</span>
                <select id="setOfflineLectureMode">
                  <option value="disabled"${lecturesMode === "disabled" ? " selected" : ""}>Disabled (Students cannot download)</option>
                  <option value="all"${lecturesMode === "all" ? " selected" : ""}>Allow All Lecture Explanations</option>
                  <option value="selected"${lecturesMode === "selected" ? " selected" : ""}>Allow Specific Lectures / Courses Only</option>
                </select>
              </label>
              ${lecturesMode === "selected" ? `
                <button type="button" class="secondary" id="pickOfflineLecturesBtn">Choose Lectures (${allowedLectureIds.length} allowed)</button>
              ` : ""}
            </div>

            <div>
              <button type="submit" class="primary">Publish Settings</button>
            </div>
          </form>
          <h2 style="margin:10px 0 0;font-size:1.05rem;">Hosting &amp; Infrastructure Diagnostics</h2>
          ${diagHtml}
        `;

        body.querySelector("#setOfflineQuizMode").addEventListener("change", (e) => {
          quizzesMode = e.target.value;
          paintSettingsBody();
        });
        body.querySelector("#setOfflineLectureMode").addEventListener("change", (e) => {
          lecturesMode = e.target.value;
          paintSettingsBody();
        });
        const pickQBtn = body.querySelector("#pickOfflineQuizzesBtn");
        if (pickQBtn) pickQBtn.addEventListener("click", () => openOfflinePickerModal("quizzes"));
        const pickLBtn = body.querySelector("#pickOfflineLecturesBtn");
        if (pickLBtn) pickLBtn.addEventListener("click", () => openOfflinePickerModal("lectures"));

        body.querySelector("#siteSettingsForm").addEventListener("submit", async (e) => {
          e.preventDefault();
          const text = body.querySelector("#setBannerText").value.trim();
          const next = Object.assign({}, settings, {
            announcement: text,
            bannerText: text,
            bannerVisible: Boolean(text),
            bannerUrl: body.querySelector("#setBannerUrl").value.trim(),
            offlineDownloads: {
              quizzesMode,
              lecturesMode,
              allowedQuizIds,
              allowedLectureIds,
            },
          });
          const { res, data } = await apiFetch("/api/admin/site-settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ settings: next }),
          });
          if (!res.ok || !data || !data.ok) {
            toast((data && data.error) || "Failed to save site settings.");
            return;
          }
          await syncCatalog();
          if (root.ElgoShell && typeof root.ElgoShell.renderSiteBanner === "function") {
            root.ElgoShell.renderSiteBanner();
          }
          toast("Site settings published.");
        });
      }

      paintSettingsBody();
    }

    await paint();
  }

  root.ElgoAdmin = { render };
})(typeof window !== "undefined" ? window : globalThis);
