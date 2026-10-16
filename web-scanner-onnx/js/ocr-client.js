/*
 * Page-side wrapper around ocr-worker.js: drop-in replacement for the old
 * `fetch(OCR_SERVER + '/process', { body: form })` call — process(canvas) resolves with the same JSON.
 * Frames are processed strictly one after another (one ONNX session, no concurrent runs).
 */
const OCR_WORKER_URL = new URL('ocr-worker.js', document.currentScript.src).href;

class BrowserOcr {
  constructor() {
    this.worker = null;
    this.pending = new Map();
    this.nextId = 1;
    this.chain = Promise.resolve();
    this.readyInfo = null;
  }

  /** Loads the models in the worker. onProgress(text, ratio) receives download progress. */
  init(backend, onProgress) {
    if (this.worker) this.worker.terminate();
    for (const { reject } of this.pending.values()) reject(new Error('OCR-Engine wurde neu gestartet'));
    this.pending.clear();
    this.readyInfo = null;
    this.worker = new Worker(OCR_WORKER_URL);
    return new Promise((resolve, reject) => {
      this.worker.onmessage = (ev) => {
        const msg = ev.data;
        if (msg.type === 'progress') onProgress?.(msg.text, msg.ratio);
        else if (msg.type === 'ready') { this.readyInfo = msg; resolve(msg); }
        else if (msg.type === 'result' || msg.type === 'error') {
          const p = msg.id !== undefined ? this.pending.get(msg.id) : null;
          if (!p) { if (msg.type === 'error') reject(new Error(msg.message)); return; }
          this.pending.delete(msg.id);
          if (msg.type === 'result') p.resolve({ ...msg.result, elapsed_ms: msg.ms });
          else p.reject(new Error(msg.message));
        }
      };
      this.worker.onerror = (ev) => reject(new Error(ev.message || 'OCR-Worker konnte nicht gestartet werden'));
      this.worker.postMessage({ type: 'init', backend });
    });
  }

  get ready() { return this.readyInfo !== null; }

  /** OCR one frame (canvas, image or ImageBitmap); resolves with the /process JSON. */
  process(source) {
    const run = () => new Promise((resolve, reject) => {
      const w = source.naturalWidth || source.videoWidth || source.width;
      const h = source.naturalHeight || source.videoHeight || source.height;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(source, 0, 0);
      const { data } = ctx.getImageData(0, 0, w, h);
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'process', id, width: w, height: h, buffer: data.buffer }, [data.buffer]);
    });
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }
}
