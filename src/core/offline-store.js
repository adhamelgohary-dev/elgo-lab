/**
 * Bank Question — Offline content store (Phase 6)
 *
 * Persists downloaded content packages in IndexedDB when available, with an
 * in-memory fallback for tests and environments without IndexedDB. It stores
 * only content packages and the last seen manifest; user progress never enters
 * this store (progress stays in localStorage).
 */
(function (root) {
  "use strict";

  const DB_NAME = "bank_question_offline";
  const DB_VERSION = 2;
  const PACKAGE_STORE = "packages";
  const META_STORE = "meta";
  const FILE_STORE = "files";

  function createMemoryStore(seed) {
    const packages = new Map(Object.entries(seed || {}));
    const meta = new Map();
    const files = new Map();
    return {
      kind: "memory",
      async putPackage(id, payload) {
        packages.set(String(id), payload);
      },
      async getPackage(id) {
        return packages.has(String(id)) ? packages.get(String(id)) : null;
      },
      async deletePackage(id) {
        return packages.delete(String(id));
      },
      async listPackageIds() {
        return Array.from(packages.keys());
      },
      async putMeta(key, value) {
        meta.set(String(key), value);
      },
      async getMeta(key) {
        return meta.has(String(key)) ? meta.get(String(key)) : null;
      },
      async putFile(id, blob, metaInfo) {
        files.set(String(id), { blob, meta: metaInfo || null, storedAt: new Date().toISOString() });
      },
      async getFile(id) {
        return files.has(String(id)) ? files.get(String(id)) : null;
      },
      async deleteFile(id) {
        return files.delete(String(id));
      },
      async listFileIds() {
        return Array.from(files.keys());
      },
      async clear() {
        packages.clear();
        meta.clear();
        files.clear();
      },
    };
  }

  function openDatabase(indexedDb) {
    return new Promise((resolve, reject) => {
      const request = indexedDb.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(PACKAGE_STORE)) {
          db.createObjectStore(PACKAGE_STORE);
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE);
        }
        if (!db.objectStoreNames.contains(FILE_STORE)) {
          db.createObjectStore(FILE_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function transaction(db, storeName, mode, action) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      try {
        result = action(store);
      } catch (err) {
        reject(err);
        return;
      }
      tx.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  function createIndexedDbStore(indexedDb, dbPromise) {
    return {
      kind: "indexeddb",
      async putPackage(id, payload) {
        const db = await dbPromise;
        await transaction(db, PACKAGE_STORE, "readwrite", (store) => store.put(payload, String(id)));
      },
      async getPackage(id) {
        const db = await dbPromise;
        return transaction(db, PACKAGE_STORE, "readonly", (store) => store.get(String(id)));
      },
      async deletePackage(id) {
        const db = await dbPromise;
        await transaction(db, PACKAGE_STORE, "readwrite", (store) => store.delete(String(id)));
      },
      async listPackageIds() {
        const db = await dbPromise;
        const keys = await transaction(db, PACKAGE_STORE, "readonly", (store) => store.getAllKeys());
        return Array.from(keys || []);
      },
      async putMeta(key, value) {
        const db = await dbPromise;
        await transaction(db, META_STORE, "readwrite", (store) => store.put(value, String(key)));
      },
      async getMeta(key) {
        const db = await dbPromise;
        const value = await transaction(db, META_STORE, "readonly", (store) => store.get(String(key)));
        return value === undefined ? null : value;
      },
      async putFile(id, blob, metaInfo) {
        const db = await dbPromise;
        await transaction(db, FILE_STORE, "readwrite", (store) =>
          store.put({ blob, meta: metaInfo || null, storedAt: new Date().toISOString() }, String(id))
        );
      },
      async getFile(id) {
        const db = await dbPromise;
        const value = await transaction(db, FILE_STORE, "readonly", (store) => store.get(String(id)));
        return value === undefined ? null : value;
      },
      async deleteFile(id) {
        const db = await dbPromise;
        await transaction(db, FILE_STORE, "readwrite", (store) => store.delete(String(id)));
      },
      async listFileIds() {
        const db = await dbPromise;
        const keys = await transaction(db, FILE_STORE, "readonly", (store) => store.getAllKeys());
        return Array.from(keys || []);
      },
      async clear() {
        const db = await dbPromise;
        await transaction(db, PACKAGE_STORE, "readwrite", (store) => store.clear());
        await transaction(db, META_STORE, "readwrite", (store) => store.clear());
        await transaction(db, FILE_STORE, "readwrite", (store) => store.clear());
      },
    };
  }

  function createOfflineStore(options) {
    const opts = options || {};
    const indexedDb =
      opts.indexedDB ||
      (typeof indexedDB !== "undefined" ? indexedDB : null) ||
      (root && root.indexedDB) ||
      null;
    if (!indexedDb) return createMemoryStore(opts.seed);
    const dbPromise = openDatabase(indexedDb);
    // Guard against environments where opening the DB fails (private mode).
    dbPromise.catch(() => {});
    return createIndexedDbStore(indexedDb, dbPromise);
  }

  const api = {
    DB_NAME,
    DB_VERSION,
    PACKAGE_STORE,
    META_STORE,
    FILE_STORE,
    createOfflineStore,
    createMemoryStore,
  };

  root.BankQuestionCore = root.BankQuestionCore || {};
  root.BankQuestionCore.OfflineStore = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
