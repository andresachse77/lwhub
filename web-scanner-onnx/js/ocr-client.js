/*
 * Page-side wrapper around ocr-worker.js: drop-in replacement for the old
 * `fetch(OCR_SERVER + '/process', { body: form })` call — process(canvas) resolves with the same JSON.
 *
 * Runs a pool of workers, each with its own ONNX sessions. One session does not get faster beyond
 * ~4 WASM threads (measured on a 32-thread i9: 4 threads 1.7 s/frame, 16 threads 1.9 s, 32 threads
 * 2.9 s), so throughput comes from several frames in parallel instead. Each worker processes its
 * frames strictly one after another.
 */
// Versionsanhang (?v=…) der Seite an den Worker weitergeben, damit nach einem Deploy kein alter Stand aus dem Cache laeuft.
const OCR_WORKER_URL = new URL('ocr-worker.js' + new URL(document.currentScript.src).search, document.currentScript.src).href;

class OcrWorkerHandle {
  constructor() {
    this.worker = new Worker(OCR_WORKER_URL);
    this.pending = new Map();
    this.nextId = 1;
    this.chain = Promise.resolve();
    this.queued = 0;
  }

  init(backend, threads, onProgress) {
    return new Promise((resolve, reject) => {
      this.worker.onmessage = (ev) => {
        const msg = ev.data;
        if (msg.type === 'progress') onProgress?.(msg.text, msg.ratio);
        else if (msg.type === 'notice') this.onNotice?.(msg.text);
        else if (msg.type === 'ready') resolve(msg);
        else if (msg.type === 'result' || msg.type === 'error') {
          const p = msg.id !== undefined ? this.pending.get(msg.id) : null;
          if (!p) { if (msg.type === 'error') reject(new Error(msg.message)); return; }
          this.pending.delete(msg.id);
          if (msg.type === 'result') p.resolve({ ...msg.result, elapsed_ms: msg.ms });
          else p.reject(new Error(msg.message));
        }
      };
      this.worker.onerror = (ev) => reject(new Error(ev.message || 'OCR-Worker konnte nicht gestartet werden'));
      this.worker.postMessage({ type: 'init', backend, threads });
    });
  }

  /**
   * framePromise resolves to { bitmap } or { width, height, buffer } (transferred to the worker).
   * The worker counts as busy from this call on, so concurrent callers spread over the pool.
   */
  process(framePromise) {
    this.queued++;
    const run = async () => {
      const frame = await framePromise;
      return new Promise((resolve, reject) => {
        const id = this.nextId++;
        this.pending.set(id, { resolve, reject });
        this.worker.postMessage({ type: 'process', id, ...frame }, [frame.bitmap || frame.buffer]);
      });
    };
    const p = this.chain.then(run, run).finally(() => { this.queued--; });
    this.chain = p.catch(() => {});
    return p;
  }

  terminate() {
    this.worker.terminate();
    for (const { reject } of this.pending.values()) reject(new Error('OCR-Engine wurde neu gestartet'));
    this.pending.clear();
  }
}

class BrowserOcr {
  constructor() {
    this.workers = [];
    this.readyInfo = null;
    this.onNotice = null; // (text) => void, e.g. a worker switched from WebGPU to the CPU
  }

  static get maxCores() { return navigator.hardwareConcurrency || 4; }

  /** Default core budget: all logical cores but one, so the browser and the game stay responsive. */
  static get defaultCores() { return Math.max(1, BrowserOcr.maxCores - 1); }

  /**
   * Splits a core budget into workers × threads: 4 threads per worker (more threads do not speed up
   * one session), one worker per 4 cores, at most 8 workers — beyond that throughput stays flat and
   * only memory grows. Same split for WebGPU, since crop and post-processing stay on the CPU.
   * Measured on i9-14900K (32 threads) / RTX 4070, 40 frames: CPU 1 worker 2.2 s/frame,
   * 6 workers 0.78 s, 8 workers 0.75 s; WebGPU 1 worker 0.77 s, 6 workers 0.24 s.
   */
  static split(cores) {
    const c = Math.max(1, Math.min(BrowserOcr.maxCores, Math.floor(cores) || 1));
    return { threads: Math.min(4, c), workers: Math.max(1, Math.min(8, Math.floor(c / 4))) };
  }

  /**
   * Starts the worker pool. The first worker downloads the models (progress via onProgress), the
   * others then load them from the browser cache. `cores` is the CPU budget (default max − 1);
   * `threads` / `workers` override the split. Resolves with { backend, threads, workers, ms }.
   */
  async init(backend, onProgress, { cores, threads, workers } = {}) {
    this.workers.forEach((w) => w.terminate());
    this.workers = [];
    this.readyInfo = null;
    const t0 = performance.now();
    const plan = BrowserOcr.split(cores || BrowserOcr.defaultCores);
    threads = threads || plan.threads;
    const count = Math.max(1, workers || plan.workers);
    const handle = () => {
      const w = new OcrWorkerHandle();
      w.onNotice = (text) => this.onNotice?.(text);
      return w;
    };

    const first = handle();
    this.workers.push(first);
    const info = await first.init(backend, threads, onProgress);
    if (count > 1) {
      onProgress?.(`Starte ${count} OCR-Worker…`, 1);
      const rest = Array.from({ length: count - 1 }, handle);
      this.workers.push(...rest);
      await Promise.all(rest.map((w) => w.init(backend, threads)));
    }
    // No extra CPU workers next to the GPU ones: in WebGPU mode the CPU already does resize, crops,
    // upscaling and decoding for every GPU worker, so mixed pools measured slower (7 GPU + 2 CPU
    // 0.19 s/frame, 7 GPU + 4 CPU 0.21 s, 7 GPU alone 0.17 s).
    this.readyInfo = { ...info, workers: count, ms: performance.now() - t0 };
    return this.readyInfo;
  }

  get ready() { return this.readyInfo !== null; }

  /** How many frames can usefully be in flight at once. */
  get size() { return this.workers.length; }

  /**
   * OCR one frame (canvas, image or ImageBitmap) on the least busy worker; resolves with the
   * /process JSON. The source stays usable (a copy is handed to the worker as an ImageBitmap; the
   * pixel readback then happens in the worker instead of on the page's main thread).
   */
  process(source) {
    const worker = this.workers.reduce((a, b) => (b.queued < a.queued ? b : a));
    if (typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function') {
      return worker.process(createImageBitmap(source).then((bitmap) => ({ bitmap })));
    }
    const w = source.naturalWidth || source.videoWidth || source.width;
    const h = source.naturalHeight || source.videoHeight || source.height;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0);
    const { data } = ctx.getImageData(0, 0, w, h);
    return worker.process(Promise.resolve({ width: w, height: h, buffer: data.buffer }));
  }
}
