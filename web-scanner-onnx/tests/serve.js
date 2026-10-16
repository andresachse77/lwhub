// Minimal static server for local testing of the browser OCR, with the same cross-origin-isolation
// headers as ../.htaccess (needed for multi-threaded WASM). Serves the lwhub repo root, so the page
// is at http://127.0.0.1:8796/web-scanner-onnx/ and ../web-scanner/ resolves like on lwhub.de.
// The PHP API is not served here — the cockpit falls back to https://lwhub.de/api or mock members.
//
//   node serve.js [port]
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const PORT = Number(process.argv[2]) || 8796;
// NO_COI=1 drops the isolation headers to test the single-threaded fallback (e.g. host without mod_headers).
const ISOLATION = process.env.NO_COI ? {} : {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8', '.onnx': 'application/octet-stream',
};

http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': fs.statSync(file).size,
    ...ISOLATION,
  });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`serving ${ROOT} at http://127.0.0.1:${PORT}/web-scanner-onnx/`));
