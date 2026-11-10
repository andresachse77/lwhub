/*
 * Scan-Runde absturzsicher aufheben: jede Live-Ansicht landet sofort im Browser (IndexedDB), mit der Zeit,
 * zu der sie erfasst wurde. Stuerzt der Browser ab oder wird die Seite neu geladen, bietet der Scanner an,
 * die Runde neu auszuwerten (die Bilder laufen dann wie Screenshots noch einmal durch die Erkennung).
 * Nichts davon verlaesst den Rechner. Geloescht wird mit "Pool leeren", "Verwerfen" oder nach 3 Tagen.
 *
 *   await ScanSession.add({ blob, label, at, alliance });
 *   const info = await ScanSession.info();   // { count, firstAt, lastAt, alliances } oder null
 *   const files = await ScanSession.files(); // File-Objekte, lastModified = Erfassungszeit
 *   await ScanSession.clear();
 */
const ScanSession = (() => {
  const DB_NAME = 'lwhub-scanner';
  const STORE = 'frames';
  const MAX_AGE_MS = 3 * 24 * 3600 * 1000;
  let dbPromise = null;
  let failed = false;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB fehlt')); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'seq', autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => { failed = true; });
    return dbPromise;
  }

  function tx(mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      let result;
      Promise.resolve(fn(store)).then((r) => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  function readAll() {
    return tx('readonly', (store) => new Promise((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    }));
  }

  return {
    get available() { return !failed; },

    /** Eine Ansicht sichern. Fehler (Speicher voll, privates Fenster) nur melden, nie den Scan stoppen. */
    async add({ blob, label, at, alliance }) {
      if (!blob || failed) return false;
      try {
        await tx('readwrite', (store) => { store.add({ blob, label, at, alliance }); });
        return true;
      } catch (err) {
        console.warn('[ScanSession] nicht gesichert:', err);
        return false;
      }
    },

    async info() {
      try {
        const rows = await readAll();
        if (!rows.length) return null;
        const times = rows.map((r) => r.at).filter(Number.isFinite);
        return {
          count: rows.length,
          firstAt: Math.min(...times),
          lastAt: Math.max(...times),
          alliances: [...new Set(rows.map((r) => r.alliance).filter(Boolean))],
        };
      } catch (_) {
        return null;
      }
    },

    async files() {
      const rows = (await readAll()).sort((a, b) => a.seq - b.seq);
      return rows.map((r, i) => new File([r.blob], `ansicht-${String(i + 1).padStart(5, '0')}.png`,
        { type: r.blob.type || 'image/png', lastModified: r.at }));
    },

    async clear() {
      try { await tx('readwrite', (store) => { store.clear(); }); } catch (_) {}
    },

    /** Alte Runden (aelter als 3 Tage seit der letzten Ansicht) wegraeumen. */
    async dropStale() {
      const info = await this.info();
      if (info && Date.now() - info.lastAt > MAX_AGE_MS) { await this.clear(); return true; }
      return false;
    },
  };
})();
