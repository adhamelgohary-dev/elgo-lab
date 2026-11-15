"use strict";
/** Shared admin content: the library notifies on edits and can adopt the server copy. */
const test = require("node:test");
const assert = require("node:assert/strict");

global.window = global;
const Library = require("../src/core/content-library.js");

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m };
}

test("admin edits trigger onChange so they can be published to the server", () => {
  const lib = Library.createLibrary({ storage: memoryStorage(), bundled: { pdfs: [], videos: [], images: [] } });
  let calls = 0;
  lib.onChange(() => { calls += 1; });
  lib.addPdf({ id: "pdf-a", subjectId: "ml", title: "A", path: "/api/r2/pdfs/ml/" + "a".repeat(32) + ".pdf" });
  assert.ok(calls >= 1);
});

test("replaceOverlay adopts the shared copy for students without echoing it back", () => {
  const storage = memoryStorage();
  const lib = Library.createLibrary({ storage, bundled: { pdfs: [], videos: [], images: [] } });
  let calls = 0;
  lib.onChange(() => { calls += 1; });
  lib.replaceOverlay({ videos: [{ id: "v1", subjectId: "ml", title: "Shared", url: "https://youtu.be/dQw4w9WgXcQ", videoId: "dQw4w9WgXcQ", active: true, order: 1 }], removed: { pdfs: ["old"] } });
  assert.equal(calls, 0, "adopting remote content must not trigger a publish loop");
  assert.equal(lib.getVideos("ml").length, 1);
  assert.deepEqual(lib.getState().removed.pdfs, ["old"]);
  assert.ok(storage.getItem(lib.STORAGE_KEY).includes("Shared"), "cached locally for the next visit");
});

test("server-hosted PDF paths keep their absolute /api/r2 location", () => {
  const key = "/api/r2/pdfs/ml/" + "c".repeat(32) + ".pdf";
  assert.equal(Library.sanitizeAssetPath(key), key);
  assert.equal(Library.sanitizeAssetPath("/api/r2/evil.html"), "api/r2/evil.html".replace(/^/, ""), "other absolute paths are still made relative");
  assert.equal(Library.sanitizeAssetPath(["C:", "Users", "me", "x.pdf"].join(String.fromCharCode(92))), "");
});

test("hardDeletePdf and hardDeleteVideo completely remove custom entries and tombstone bundled ones", () => {
  const lib = Library.createLibrary({
    storage: memoryStorage(),
    bundled: {
      pdfs: [{ id: "bundled-pdf-1", subjectId: "ml", title: "Bundled PDF", path: "content/pdfs/ml/b.pdf", active: true }],
      videos: [{ id: "bundled-vid-1", subjectId: "ml", title: "Bundled Vid", youtubeUrl: "https://youtu.be/dQw4w9WgXcQ", active: true }],
      images: [],
    },
  });

  lib.addPdf({ id: "pdf-custom-1", subjectId: "ml", title: "Custom PDF", path: "/api/r2/pdfs/ml/" + "d".repeat(32) + ".pdf" });
  lib.addVideo({ id: "vid-custom-1", subjectId: "ml", title: "Custom Vid", youtubeUrl: "https://youtu.be/dQw4w9WgXcQ" });

  lib.hardDeletePdf("pdf-custom-1");
  lib.hardDeleteVideo("vid-custom-1");
  assert.equal(lib.getState().pdfs.length, 0);
  assert.equal(lib.getState().videos.length, 0);
  assert.equal(lib.getState().removed.pdfs.includes("pdf-custom-1"), false);
  assert.equal(lib.getState().removed.videos.includes("vid-custom-1"), false);

  lib.hardDeletePdf("bundled-pdf-1");
  lib.hardDeleteVideo("bundled-vid-1");
  assert.equal(lib.getPdfs("ml").length, 0);
  assert.equal(lib.getVideos("ml").length, 0);
  assert.equal(lib.getPdfs("ml", true, false).length, 0);
  assert.equal(lib.getVideos("ml", { includeInactive: true, includeArchived: false }).length, 0);
  assert.equal(lib.getState().removed.pdfs.includes("bundled-pdf-1"), true);
  assert.equal(lib.getState().removed.videos.includes("bundled-vid-1"), true);
});
