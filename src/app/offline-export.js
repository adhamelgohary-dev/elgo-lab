/**
 * Elgo Lab — Standalone Offline HTML Exporter (`src/app/offline-export.js`)
 * Generates self-contained offline HTML pages for Quizzes and Lecture Explanations
 * ONLY when permitted by Admin settings (`siteSettings.offlineDownloads`).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.ElgoOfflineExport = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeScriptJson(value) {
    return JSON.stringify(value)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");
  }

  function sanitizeOfflineFragmentHtml(html) {
    return String(html || "")
      .replace(/<\s*(script|iframe|object|embed|base|form)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
      .replace(/<\s*(script|iframe|object|embed|base|link|meta)\b[^>]*\/?>/gi, "")
      .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, '$1="#"');
  }

  function getConfig(settings) {
    var s = settings && typeof settings === "object" ? settings : {};
    var od = s.offlineDownloads && typeof s.offlineDownloads === "object" ? s.offlineDownloads : {};
    var validMode = function (v) {
      return v === "all" || v === "selected" ? v : "disabled";
    };
    return {
      quizzesMode: validMode(od.quizzesMode),
      lecturesMode: validMode(od.lecturesMode),
      allowedQuizIds: Array.isArray(od.allowedQuizIds) ? od.allowedQuizIds : [],
      allowedLectureIds: Array.isArray(od.allowedLectureIds) ? od.allowedLectureIds : [],
    };
  }

  function buildMatchCandidates(subjectId, itemId) {
    var subj = String(subjectId || "").trim();
    var raw = String(itemId || "").trim();
    var bare = raw.indexOf("::") >= 0 ? raw.split("::").pop() : raw;
    var candidates = [];
    if (subj) candidates.push(subj + "::*");
    if (raw) candidates.push(raw);
    if (bare) candidates.push(bare);
    if (subj && raw) candidates.push(subj + "::" + raw);
    if (subj && bare) candidates.push(subj + "::" + bare);
    return candidates;
  }

  function isQuizDownloadAllowed(settings, subjectId, sourceId) {
    var cfg = getConfig(settings);
    if (cfg.quizzesMode === "all") return true;
    if (cfg.quizzesMode !== "selected") return false;
    var set = {};
    cfg.allowedQuizIds.forEach(function (id) { set[id] = true; });
    return buildMatchCandidates(subjectId, sourceId).some(function (k) { return Boolean(set[k]); });
  }

  function isLectureDownloadAllowed(settings, subjectId, lectureId) {
    var cfg = getConfig(settings);
    if (cfg.lecturesMode === "all") return true;
    if (cfg.lecturesMode !== "selected") return false;
    var set = {};
    cfg.allowedLectureIds.forEach(function (id) { set[id] = true; });
    return buildMatchCandidates(subjectId, lectureId).some(function (k) { return Boolean(set[k]); });
  }

  function safeFilename(name) {
    var slug = String(name || "elgo-offline")
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06ff._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    return (slug || "elgo-offline") + ".html";
  }

  function triggerHtmlDownload(filename, htmlString) {
    if (typeof document === "undefined" || typeof Blob === "undefined") return false;
    var blob = new Blob([String(htmlString || "")], { type: "text/html;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = safeFilename(String(filename || "elgo-lab").replace(/\.html$/i, ""));
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      try {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (_e) { /* ignore */ }
    }, 500);
    return true;
  }

  var SHARED_OFFLINE_CSS = [
    ":root{--bg:#18191B;--surface:#212327;--tile:#282B30;--ink:#F3EFE8;--muted:#A9B0BA;--accent:#F59B59;--accent-ink:#1C1208;--good:#4CC38A;--bad:#E56B6F;--line:rgba(255,255,255,.11);}",
    "[data-theme='daylight']{--bg:#F8F5EF;--surface:#FFFFFF;--tile:#F2ECE1;--ink:#1D1B18;--muted:#686055;--accent:#C8641C;--accent-ink:#FFFDF9;--good:#198754;--bad:#C93B3F;--line:rgba(29,27,24,.12);}",
    "*{box-sizing:border-box;}body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;line-height:1.65;}",
    ".wrap{max-width:860px;margin:0 auto;padding:24px 16px 56px;}",
    ".topbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:14px 18px;margin-bottom:18px;position:sticky;top:10px;z-index:10;}",
    ".brand{font-weight:800;letter-spacing:-.02em;}.brand span{color:var(--accent);}",
    ".controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}",
    "button{font:inherit;font-size:.86rem;font-weight:700;padding:8px 13px;border-radius:10px;border:1px solid var(--line);background:var(--tile);color:var(--ink);cursor:pointer;}",
    "button.primary{background:var(--accent);color:var(--accent-ink);border-color:transparent;}",
    ".hero{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:20px 22px;margin-bottom:18px;}",
    ".eyebrow{margin:0 0 6px;font-size:.74rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);}",
    ".hero h1{margin:0 0 8px;font-size:clamp(1.3rem,2.6vw,1.8rem);}",
    ".lead-ar{direction:rtl;text-align:right;margin:10px 0 0;padding:10px 14px;border-radius:12px;background:var(--tile);border-inline-start:3px solid var(--accent);font-family:'Segoe UI',Tahoma,sans-serif;}",
    ".card{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:18px 20px;margin-bottom:14px;}",
    "@media print{.topbar .controls{display:none;}.topbar{position:static;}body{background:#fff;color:#000;}}"
  ].join("");

  function buildOfflineQuizHtml(opts) {
    var o = opts && typeof opts === "object" ? opts : {};
    var courseTitle = String(o.courseTitle || "Elgo Lab");
    var quizTitle = String(o.quizTitle || "Offline Quiz");
    var subtitle = String(o.subtitle || "");
    var rawQs = Array.isArray(o.questions) ? o.questions : [];
    var expMap = o.explanationsMap && typeof o.explanationsMap === "object" ? o.explanationsMap : {};
    var gScope = typeof window !== "undefined" ? window : globalThis;

    function resolveImages(q) {
      if (gScope.ElgoModel && typeof gScope.ElgoModel.getQuestionImages === "function") {
        return gScope.ElgoModel.getQuestionImages(q);
      }
      var list = Array.isArray(q && q.images) ? q.images.slice() : [];
      if (q && q.image) list.unshift({ url: q.image, alt: q.imageAlt || "", caption: q.imageCaption || "" });
      var seen = new Set();
      return list.map(function (it) {
        var u = typeof it === "string" ? it.trim() : String((it && (it.url || it.src)) || "").trim();
        if (!/^(\/(?!\/)|https:\/\/|data:image\/(?:png|jpeg|jpg|webp|gif);base64,)/i.test(u)) return null;
        if (seen.has(u)) return null;
        seen.add(u);
        return { url: u, alt: (it && it.alt) || "", caption: (it && it.caption) || "" };
      }).filter(Boolean).slice(0, 6);
    }

    var normalized = rawQs.map(function (q, idx) {
      var optsList = Array.isArray(q.options) ? q.options : [];
      var qExp = q.explanation && typeof q.explanation === "object" ? q.explanation : null;
      var matchedExp = (q.id && expMap[q.id]) || (q.originalId && expMap[q.originalId]) || null;
      var enExp = q.explanationEnglish || (qExp && qExp.en) || (typeof q.explanation === "string" ? q.explanation : "") || (matchedExp && (matchedExp.en || matchedExp.explanation)) || "";
      var arExp = q.explanationArabic || (qExp && qExp.ar) || q.arabicExplanation || (matchedExp && matchedExp.ar) || "";
      var rule = q.rule || (qExp && qExp.rule) || (matchedExp && matchedExp.rule) || "";
      return {
        num: idx + 1,
        prompt: String(q.prompt || q.question || ""),
        images: resolveImages(q),
        options: optsList.map(function (opt) {
          return { id: String(opt.id || opt.label || ""), text: String(opt.text || "") };
        }),
        correctOptionId: String(q.correctOptionId || ""),
        en: String(enExp || ""),
        ar: String(arExp || ""),
        rule: String(rule || ""),
      };
    });

    var quizCss = SHARED_OFFLINE_CSS + [
      ".score-pill{padding:6px 12px;border-radius:999px;background:var(--tile);border:1px solid var(--line);font-size:.84rem;font-weight:700;}",
      ".q-num{font-size:.76rem;font-weight:800;color:var(--accent);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;}",
      ".q-stem{margin:0 0 12px;font-size:1.02rem;font-weight:600;white-space:pre-wrap;}",
      ".q-imgs{display:grid;gap:8px;margin:0 0 12px;}",
      ".q-img-fig{margin:0;padding:8px;border-radius:10px;background:var(--tile);border:1px solid var(--line);text-align:center;}",
      ".q-img-fig img{max-width:100%;max-height:300px;object-fit:contain;border-radius:8px;display:block;margin:0 auto;}",
      ".q-img-cap{font-size:.78rem;color:var(--muted);margin-top:5px;}",
      ".opts{display:grid;gap:8px;}",
      ".opt-btn{width:100%;text-align:left;display:flex;gap:10px;align-items:flex-start;padding:11px 13px;border-radius:12px;border:1px solid var(--line);background:var(--tile);color:var(--ink);font-weight:500;}",
      ".opt-btn.is-correct{border-color:var(--good);background:rgba(76,195,138,.16);}",
      ".opt-btn.is-wrong{border-color:var(--bad);background:rgba(229,107,111,.15);}",
      ".opt-key{min-width:24px;height:24px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:.8rem;background:var(--surface);border:1px solid var(--line);}",
      ".exp-box{margin-top:12px;padding:12px 14px;border-radius:12px;background:var(--tile);border:1px solid var(--line);font-size:.9rem;display:none;}",
      ".exp-box.is-open{display:block;}",
      ".exp-rule{margin-top:6px;padding-top:6px;border-top:1px dashed var(--line);font-size:.86rem;}",
      ".exp-ar{margin-top:8px;direction:rtl;text-align:right;color:var(--ink);font-family:'Segoe UI',Tahoma,sans-serif;}"
    ].join("");

    var viewerScript = [
      "(function(){",
      "var payload=JSON.parse(document.getElementById('quiz-data').textContent);",
      "var host=document.getElementById('quizHost');",
      "var scoreEl=document.getElementById('scorePill');",
      "var toggleKeyBtn=document.getElementById('toggleStudyBtn');",
      "var themeBtn=document.getElementById('themeBtn');",
      "var printBtn=document.getElementById('printBtn');",
      "var studyMode=false;var hasFeedback=payload.some(function(q){return q.correctOptionId||q.en||q.ar||q.rule;});",
      "var chosen={};",
      "function updateScore(){var right=0,answered=0;payload.forEach(function(q,i){if(chosen[i]){answered++;if(chosen[i]===q.correctOptionId)right++;}});scoreEl.textContent=hasFeedback?'Score: '+right+' / '+payload.length+' ('+answered+' answered)':answered+' / '+payload.length+' answered';}",
      "function render(){host.innerHTML='';payload.forEach(function(q,qi){",
      "  var card=document.createElement('article');card.className='card';",
      "  var num=document.createElement('div');num.className='q-num';num.textContent='Question '+q.num+' of '+payload.length;",
      "  var stem=document.createElement('p');stem.className='q-stem';stem.textContent=q.prompt;",
      "  card.appendChild(num);card.appendChild(stem);",
      "  if(Array.isArray(q.images)&&q.images.length){",
      "    var imgGrid=document.createElement('div');imgGrid.className='q-imgs';",
      "    q.images.forEach(function(im){",
      "      var u=String((im&&im.url)||'');",
      "      if(!/^(\\/(?!\\/)|https:\\/\\/|data:image\\/(?:png|jpeg|jpg|webp|gif);base64,)/i.test(u))return;",
      "      var fg=document.createElement('figure');fg.className='q-img-fig';",
      "      var ig=document.createElement('img');ig.src=u;ig.alt=String((im&&im.alt)||'Question diagram');",
      "      fg.appendChild(ig);",
      "      if(im&&im.caption){var cp=document.createElement('figcaption');cp.className='q-img-cap';cp.textContent=String(im.caption);fg.appendChild(cp);}",
      "      imgGrid.appendChild(fg);",
      "    });",
      "    if(imgGrid.children.length)card.appendChild(imgGrid);",
      "  }",
      "  var opts=document.createElement('div');opts.className='opts';",
      "  var sel=chosen[qi]||'';var reveal=studyMode||Boolean(sel);",
      "  q.options.forEach(function(o){",
      "    var b=document.createElement('button');b.type='button';b.className='opt-btn';",
      "    if(reveal&&q.correctOptionId&&o.id===q.correctOptionId)b.classList.add('is-correct');",
      "    else if(sel&&o.id===sel){if(q.correctOptionId)b.classList.add('is-wrong');else b.setAttribute('style','outline:2px solid var(--accent)');}",
      "    var k=document.createElement('span');k.className='opt-key';k.textContent=o.id;",
      "    var t=document.createElement('span');t.textContent=o.text;",
      "    b.appendChild(k);b.appendChild(t);",
      "    b.addEventListener('click',function(){chosen[qi]=o.id;render();});",
      "    opts.appendChild(b);",
      "  });",
      "  card.appendChild(opts);",
      "  if(q.en||q.ar||q.rule){",
      "    var exp=document.createElement('div');exp.className='exp-box'+(reveal?' is-open':'');",
      "    if(q.en){var p1=document.createElement('div');p1.textContent=q.en;exp.appendChild(p1);}",
      "    if(q.rule){var p2=document.createElement('div');p2.className='exp-rule';p2.textContent='Rule: '+q.rule;exp.appendChild(p2);}",
      "    if(q.ar){var p3=document.createElement('div');p3.className='exp-ar';p3.textContent=q.ar;exp.appendChild(p3);}",
      "    card.appendChild(exp);",
      "  }",
      "  host.appendChild(card);",
      "});updateScore();toggleKeyBtn.textContent=studyMode?'Hide Study Key':'Show All Answers & Notes';}",
      "toggleKeyBtn.addEventListener('click',function(){studyMode=!studyMode;render();});",
      "themeBtn.addEventListener('click',function(){var next=document.documentElement.getAttribute('data-theme')==='daylight'?'evening':'daylight';document.documentElement.setAttribute('data-theme',next);themeBtn.textContent=next==='daylight'?'Evening':'Daylight';});",
      "printBtn.addEventListener('click',function(){window.print();});",
      "toggleKeyBtn.hidden=!hasFeedback;render();",
      "})();"
    ].join("");

    return [
      "<!doctype html>",
      '<html lang="en" data-theme="evening">',
      "<head>",
      '  <meta charset="utf-8">',
      '  <meta name="viewport" content="width=device-width,initial-scale=1">',
      "  <title>" + esc(quizTitle) + " · " + esc(courseTitle) + " — Elgo Lab Offline</title>",
      "  <style>" + quizCss + "</style>",
      "</head>",
      "<body>",
      '  <div class="wrap">',
      '    <header class="topbar">',
      '      <div class="brand">elgo lab<span>.</span> offline</div>',
      '      <span class="score-pill" id="scorePill">Score: 0 / ' + normalized.length + "</span>",
      '      <div class="controls">',
      '        <button type="button" class="primary" id="toggleStudyBtn">Show All Answers &amp; Notes</button>',
      '        <button type="button" id="themeBtn">Daylight</button>',
      '        <button type="button" id="printBtn">Print / PDF</button>',
      "      </div>",
      "    </header>",
      '    <section class="hero">',
      '      <p class="eyebrow">' + esc(courseTitle) + " · OFFLINE QUIZ</p>",
      "      <h1>" + esc(quizTitle) + "</h1>",
      subtitle ? ('      <p style="margin:0;color:var(--muted);">' + esc(subtitle) + "</p>") : "",
      "    </section>",
      '    <main id="quizHost"></main>',
      "  </div>",
      '  <script type="application/json" id="quiz-data">' + escapeScriptJson(normalized) + "</script>",
      "  <script>" + viewerScript + "</script>",
      "</body>",
      "</html>"
    ].join("\n");
  }

  function buildOfflineLectureHtml(opts) {
    var o = opts && typeof opts === "object" ? opts : {};
    var courseTitle = String(o.courseTitle || "Elgo Lab");
    var lectureTitle = String(o.lectureTitle || "Lecture Explanation");
    var guideEn = String(o.guideEn || "");
    var guideAr = String(o.guideAr || "");
    var cleanBody = sanitizeOfflineFragmentHtml(o.bodyHtml || "");

    var lectureCss = SHARED_OFFLINE_CSS + [
      ".article{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:24px 26px;}",
      ".article h2{margin:24px 0 10px;font-size:1.25rem;color:var(--accent);}.article h3{margin:18px 0 8px;font-size:1.05rem;}",
      ".article pre,.article code{background:var(--tile);border:1px solid var(--line);border-radius:8px;padding:2px 6px;font-size:.9em;}",
      ".article pre{padding:12px;overflow:auto;}.article pre code{border:0;padding:0;background:transparent;}",
      ".article table{width:100%;border-collapse:collapse;margin:14px 0;font-size:.92rem;}",
      ".article th,.article td{border:1px solid var(--line);padding:8px 10px;text-align:left;}",
      ".article th{background:var(--tile);}",
      ".article [dir='rtl'],.article [lang='ar']{direction:rtl;text-align:right;font-family:'Segoe UI',Tahoma,sans-serif;}"
    ].join("");

    var helperScript = [
      "(function(){",
      "var t=document.getElementById('themeBtn'),p=document.getElementById('printBtn');",
      "if(t)t.addEventListener('click',function(){var n=document.documentElement.getAttribute('data-theme')==='daylight'?'evening':'daylight';document.documentElement.setAttribute('data-theme',n);t.textContent=n==='daylight'?'Evening':'Daylight';});",
      "if(p)p.addEventListener('click',function(){window.print();});",
      "})();"
    ].join("");

    return [
      "<!doctype html>",
      '<html lang="en" data-theme="evening">',
      "<head>",
      '  <meta charset="utf-8">',
      '  <meta name="viewport" content="width=device-width,initial-scale=1">',
      "  <title>" + esc(lectureTitle) + " · " + esc(courseTitle) + " — Elgo Lab Offline</title>",
      "  <style>" + lectureCss + "</style>",
      "</head>",
      "<body>",
      '  <div class="wrap">',
      '    <header class="topbar">',
      '      <div class="brand">elgo lab<span>.</span> offline lecture</div>',
      '      <div class="controls">',
      '        <button type="button" id="themeBtn">Daylight</button>',
      '        <button type="button" class="primary" id="printBtn">Print / PDF</button>',
      "      </div>",
      "    </header>",
      '    <section class="hero">',
      '      <p class="eyebrow">' + esc(courseTitle) + " · LECTURE EXPLANATION</p>",
      "      <h1>" + esc(lectureTitle) + "</h1>",
      guideEn ? ('      <p style="margin:8px 0 0;color:var(--muted);">' + esc(guideEn) + "</p>") : "",
      guideAr ? ('      <p class="lead-ar" lang="ar" dir="rtl">' + esc(guideAr) + "</p>") : "",
      "    </section>",
      '    <article class="article">' + cleanBody + "</article>",
      "  </div>",
      "  <script>" + helperScript + "</script>",
      "</body>",
      "</html>"
    ].join("\n");
  }

  async function inlineQuizImages(questions) {
    var raw = Array.isArray(questions) ? questions : [];
    if (typeof fetch !== "function" || typeof FileReader !== "function") return raw;
    var gScope = typeof window !== "undefined" ? window : globalThis;
    var cache = new Map();
    var MAX_TOTAL_BYTES = 12 * 1024 * 1024;
    var totalBytes = 0;

    async function toDataUri(url) {
      if (!url || url.indexOf("/") !== 0 || url.indexOf("//") === 0) return url;
      if (cache.has(url)) return cache.get(url);
      try {
        var res = await fetch(url, { cache: "force-cache" });
        if (!res.ok) { cache.set(url, url); return url; }
        var blob = await res.blob();
        if (!blob || !/^image\/(?:png|jpeg|jpg|webp|gif)$/i.test(blob.type || "") || blob.size > 2.5 * 1024 * 1024 || (totalBytes + blob.size) > MAX_TOTAL_BYTES) {
          cache.set(url, url);
          return url;
        }
        var dataUrl = await new Promise(function (resolve) {
          var reader = new FileReader();
          reader.onload = function () { resolve(typeof reader.result === "string" ? reader.result : url); };
          reader.onerror = function () { resolve(url); };
          reader.readAsDataURL(blob);
        });
        totalBytes += blob.size;
        cache.set(url, dataUrl);
        return dataUrl;
      } catch (_e) {
        cache.set(url, url);
        return url;
      }
    }

    var out = [];
    for (var i = 0; i < raw.length; i += 1) {
      var q = Object.assign({}, raw[i]);
      var imgs = (gScope.ElgoModel && typeof gScope.ElgoModel.getQuestionImages === "function")
        ? gScope.ElgoModel.getQuestionImages(q)
        : (q.image ? [{ url: q.image }] : []);
      if (imgs.length > 0) {
        var inlined = [];
        for (var j = 0; j < imgs.length; j += 1) {
          inlined.push(Object.assign({}, imgs[j], { url: await toDataUri(imgs[j].url) }));
        }
        q.images = inlined;
        q.image = inlined[0].url;
      }
      out.push(q);
    }
    return out;
  }

  return {
    getConfig: getConfig,
    isQuizDownloadAllowed: isQuizDownloadAllowed,
    isLectureDownloadAllowed: isLectureDownloadAllowed,
    escapeScriptJson: escapeScriptJson,
    sanitizeOfflineFragmentHtml: sanitizeOfflineFragmentHtml,
    buildOfflineQuizHtml: buildOfflineQuizHtml,
    buildOfflineLectureHtml: buildOfflineLectureHtml,
    inlineQuizImages: inlineQuizImages,
    triggerHtmlDownload: triggerHtmlDownload,
    safeFilename: safeFilename,
  };
});
