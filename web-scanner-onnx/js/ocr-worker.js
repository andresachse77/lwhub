/*
 * Web Worker that owns the ONNX models and runs the whole frame pipeline off the UI thread.
 *
 * Messages in:   { type: 'init', backend: 'wasm' | 'webgpu', threads?: number }
 *                { type: 'process', id, bitmap }                   (ImageBitmap, transferred)
 *                { type: 'process', id, width, height, buffer }   (RGBA pixels, fallback without OffscreenCanvas)
 * Messages out:  { type: 'progress', text, ratio }   model download progress
 *                { type: 'ready', backend, threads, ms }
 *                { type: 'result', id, result, ms }   result = processFrame() JSON
 *                { type: 'error', id?, message }
 */
/* global ort, LwOcrEngine, LwScannerPipeline */
const ORT_VERSION = '1.30.0';
const ORT_CDN = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
const MODEL_BASE = new URL('../models/', self.location.href).href;

let engine = null;
let backend = 'wasm';

async function fetchWithProgress(url, label, onBytes) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`${label} konnte nicht geladen werden (${resp.status})`);
  const total = Number(resp.headers.get('content-length')) || 0;
  if (!resp.body || !total) return new Uint8Array(await resp.arrayBuffer());
  const reader = resp.body.getReader();
  const out = new Uint8Array(total);
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.set(value, got);
    got += value.length;
    onBytes(value.length);
  }
  return got === total ? out : out.slice(0, got);
}

async function init(requested, requestedThreads) {
  const t0 = performance.now();
  backend = requested === 'webgpu' && self.navigator.gpu ? 'webgpu' : 'wasm';
  importScripts(ORT_CDN + (backend === 'webgpu' ? 'ort.webgpu.min.js' : 'ort.wasm.min.js'));
  importScripts('ocr-engine.js' + self.location.search, 'scanner-pipeline.js' + self.location.search);

  ort.env.wasm.wasmPaths = ORT_CDN;
  // Multi-threaded WASM needs SharedArrayBuffer, i.e. a cross-origin-isolated page (see .htaccess).
  const cores = self.navigator.hardwareConcurrency || 1;
  const threads = !self.crossOriginIsolated ? 1
    : requestedThreads ? Math.max(1, Math.min(cores, requestedThreads))
    : Math.min(4, cores);
  ort.env.wasm.numThreads = threads;
  // Hide ORT's harmless "nodes not assigned to preferred EP" warnings (shape ops run on CPU by design).
  ort.env.logLevel = 'error';
  // ORT's wasm core requests its adapter with a hard-coded powerPreference, which Chrome ignores on
  // Windows and warns about once per worker. Strip the option there; behaviour is unchanged.
  if (backend === 'webgpu' && /Windows/.test(self.navigator.userAgent)) {
    const gpu = self.navigator.gpu;
    const requestAdapter = gpu.requestAdapter.bind(gpu);
    gpu.requestAdapter = (options) => {
      const { powerPreference, ...rest } = options || {};
      return requestAdapter(rest);
    };
  }

  // Models are ~15 MB together; report progress since the first visit has to download them.
  const sizes = { det: 4745517, rec: 10857958 };
  let loaded = 0;
  const tick = (n) => {
    loaded += n;
    const ratio = Math.min(1, loaded / (sizes.det + sizes.rec));
    self.postMessage({ type: 'progress', text: `Lade OCR-Modelle… ${Math.round(ratio * 100)} %`, ratio });
  };
  const [det, rec, keys] = await Promise.all([
    fetchWithProgress(MODEL_BASE + 'ch_PP-OCRv4_det_infer.onnx', 'Erkennungsmodell', tick),
    fetchWithProgress(MODEL_BASE + 'ch_PP-OCRv4_rec_infer.onnx', 'Texterkennungsmodell', tick),
    fetch(MODEL_BASE + 'ppocr_keys_v1.txt').then((r) => {
      if (!r.ok) throw new Error(`Zeichenliste konnte nicht geladen werden (${r.status})`);
      return r.text();
    }),
  ]);
  self.postMessage({ type: 'progress', text: 'Initialisiere OCR-Engine…', ratio: 1 });

  const sessionOptions = {
    executionProviders: backend === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'],
    graphOptimizationLevel: 'all',
    logSeverityLevel: 3,
  };
  engine = await LwOcrEngine.OcrEngine.create({ ort, detModel: det, recModel: rec, keysText: keys, sessionOptions });

  // Warm-up: the first real frame should not pay for kernel setup.
  await engine.ocr({ w: 64, h: 64, data: new Uint8Array(64 * 64 * 3) });
  self.postMessage({ type: 'ready', backend, threads: backend === 'wasm' ? threads : null, ms: performance.now() - t0 });
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    try {
      await init(msg.backend, msg.threads);
    } catch (err) {
      self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
    }
    return;
  }
  if (msg.type === 'process') {
    try {
      if (!engine) throw new Error('OCR-Engine ist noch nicht bereit');
      const t0 = performance.now();
      let image;
      if (msg.bitmap) {
        // Pixel readback happens here, off the page's main thread.
        const { width, height } = msg.bitmap;
        const ctx = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });
        ctx.drawImage(msg.bitmap, 0, 0);
        msg.bitmap.close();
        image = LwOcrEngine.fromRGBA(ctx.getImageData(0, 0, width, height).data, width, height);
      } else {
        image = LwOcrEngine.fromRGBA(new Uint8ClampedArray(msg.buffer), msg.width, msg.height);
      }
      const result = await LwScannerPipeline.processFrame(engine, image);
      self.postMessage({ type: 'result', id: msg.id, result, ms: performance.now() - t0 });
    } catch (err) {
      self.postMessage({ type: 'error', id: msg.id, message: err && err.message ? err.message : String(err) });
    }
  }
};
