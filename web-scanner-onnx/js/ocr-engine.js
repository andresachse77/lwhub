/*
 * JavaScript port of the RapidOCR 1.4.4 pipeline:
 * PP-OCRv4 text detection (DB) + PP-OCRv4 text recognition (CTC), same ONNX models, same
 * pre-/post-processing parameters (rapidocr_onnxruntime/config.yaml), angle classifier skipped
 * (use_cls=False — screenshots are always upright).
 *
 * Runs unchanged in the browser (onnxruntime-web, inside a Web Worker) and in Node
 * (onnxruntime-node, for the tests). The ONNX runtime is injected,
 * so this file has no dependencies of its own. OpenCV-only steps (resize, findContours, minAreaRect,
 * warpPerspective) are re-implemented here with the same semantics.
 *
 * Images are passed around as { w, h, data } with data = Uint8Array of packed RGB (3 bytes/pixel).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LwOcrEngine = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const CFG = {
    textScore: 0.5,
    minHeight: 30,
    widthHeightRatio: 8,
    maxSideLen: 2000,
    minSideLen: 30,
    det: { limitSideLen: 736, thresh: 0.3, boxThresh: 0.5, maxCandidates: 1000, unclipRatio: 1.6, minSize: 3 },
    rec: { imgH: 48, imgW: 320, batch: 6 },
  };

  // Python's round() / numpy.round() round half to even; Math.round rounds half up.
  function pyRound(x) {
    const r = Math.round(x);
    return (Math.abs(x % 1) === 0.5 && r % 2 !== 0) ? r - 1 : r;
  }

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const toByte = (v) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));

  // ---------------------------------------------------------------- image helpers

  function fromRGBA(rgba, w, h) {
    const data = new Uint8Array(w * h * 3);
    for (let i = 0, j = 0, n = w * h; i < n; i++, j += 4) {
      data[i * 3] = rgba[j];
      data[i * 3 + 1] = rgba[j + 1];
      data[i * 3 + 2] = rgba[j + 2];
    }
    return { w, h, data };
  }

  // cv2.resize(..., INTER_LINEAR) for 8-bit images: half-pixel-centre bilinear sampling with
  // OpenCV's 11-bit fixed-point coefficients and its SIMD vertical-pass rounding (matches cv2 4.10
  // on >99.8% of values, the rest are off by one).
  function resizeLinear(src, dw, dh) {
    const { w, h, data } = src;
    if (dw === w && dh === h) return { w, h, data: data.slice() };
    const SCALE = 2048; // INTER_RESIZE_COEF_SCALE
    const axis = (dn, sn) => {
      const i0 = new Int32Array(dn), i1 = new Int32Array(dn), c0 = new Int32Array(dn), c1 = new Int32Array(dn);
      const s = sn / dn;
      for (let d = 0; d < dn; d++) {
        let f = Math.fround((d + 0.5) * s - 0.5);
        let p = Math.floor(f);
        f = Math.fround(f - p);
        if (p < 0) { p = 0; f = 0; }
        if (p >= sn - 1) { p = sn - 1; f = 0; }
        i0[d] = p; i1[d] = Math.min(p + 1, sn - 1);
        c0[d] = Math.round(Math.fround((1 - f) * SCALE));
        c1[d] = SCALE - c0[d];
      }
      return { i0, i1, c0, c1 };
    };
    const X = axis(dw, w), Y = axis(dh, h);
    // Horizontal pass into int rows (value * 2048), cached per source row.
    const rowCache = new Map();
    const hrow = (sy) => {
      let r = rowCache.get(sy);
      if (r) return r;
      r = new Int32Array(dw * 3);
      const base = sy * w * 3;
      for (let x = 0; x < dw; x++) {
        const a0 = X.c0[x], a1 = X.c1[x], s0 = base + X.i0[x] * 3, s1 = base + X.i1[x] * 3;
        for (let c = 0; c < 3; c++) r[x * 3 + c] = data[s0 + c] * a0 + data[s1 + c] * a1;
      }
      rowCache.set(sy, r);
      return r;
    };
    const out = new Uint8Array(dw * dh * 3);
    for (let y = 0; y < dh; y++) {
      const b0 = Y.c0[y], b1 = Y.c1[y];
      const S0 = hrow(Y.i0[y]), S1 = hrow(Y.i1[y]);
      if (y > 1) rowCache.delete(Y.i0[y - 2]);
      const o = y * dw * 3;
      for (let i = 0; i < dw * 3; i++) {
        // ((mulhi(S0>>4, b0) + mulhi(S1>>4, b1)) + 2) >> 2, saturated to uint8
        const v = ((((S0[i] >> 4) * b0) >> 16) + (((S1[i] >> 4) * b1) >> 16) + 2) >> 2;
        out[o + i] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
    return { w: dw, h: dh, data: out };
  }

  // PIL Image.resize(..., Image.LANCZOS): separable Lanczos-3, horizontal pass first, 8-bit
  // intermediate — used for the enlarged shield-rescue pass.
  function resizeLanczos(src, dw, dh) {
    const sinc = (x) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
    const lanczos = (x) => (x > -3 && x < 3 ? sinc(x) * sinc(x / 3) : 0);
    // Normalised weights as flat typed arrays: `taps` weights per output pixel, starting at start[i].
    const coeffs = (inSize, outSize) => {
      const scale = inSize / outSize;
      const filterscale = Math.max(scale, 1);
      const support = 3 * filterscale;
      const taps = Math.ceil(support) * 2 + 1;
      const start = new Int32Array(outSize), count = new Int32Array(outSize);
      const k = new Float64Array(outSize * taps);
      for (let i = 0; i < outSize; i++) {
        const center = (i + 0.5) * scale;
        const xmin = Math.max(Math.trunc(center - support + 0.5), 0);
        const xmax = Math.min(Math.trunc(center + support + 0.5), inSize);
        let sum = 0;
        for (let x = xmin; x < xmax; x++) {
          const wgt = lanczos((x - center + 0.5) / filterscale);
          k[i * taps + x - xmin] = wgt; sum += wgt;
        }
        if (sum) for (let x = 0; x < xmax - xmin; x++) k[i * taps + x] /= sum;
        start[i] = xmin; count[i] = xmax - xmin;
      }
      return { start, count, k, taps };
    };
    const { w, h, data } = src;
    const H = coeffs(w, dw);
    const mid = new Uint8Array(dw * h * 3);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < dw; x++) {
        const n = H.count[x], kb = x * H.taps;
        let p = (row + H.start[x]) * 3, r = 0, g = 0, b = 0;
        for (let i = 0; i < n; i++, p += 3) {
          const wt = H.k[kb + i];
          r += data[p] * wt; g += data[p + 1] * wt; b += data[p + 2] * wt;
        }
        const o = (y * dw + x) * 3;
        mid[o] = toByte(r); mid[o + 1] = toByte(g); mid[o + 2] = toByte(b);
      }
    }
    const V = coeffs(h, dh);
    const out = new Uint8Array(dw * dh * 3);
    const acc = new Float64Array(dw * 3);
    const stride = dw * 3;
    for (let y = 0; y < dh; y++) {
      // Accumulate whole source rows (sequential memory access) instead of walking columns.
      acc.fill(0);
      const n = V.count[y], kb = y * V.taps;
      for (let i = 0; i < n; i++) {
        const wt = V.k[kb + i];
        const base = (V.start[y] + i) * stride;
        for (let j = 0; j < stride; j++) acc[j] += mid[base + j] * wt;
      }
      const o = y * stride;
      for (let j = 0; j < stride; j++) out[o + j] = toByte(acc[j]);
    }
    return { w: dw, h: dh, data: out };
  }

  function padTopBottom(src, pad) {
    const { w, h, data } = src;
    const out = new Uint8Array(w * (h + pad * 2) * 3);
    out.set(data, pad * w * 3);
    return { w, h: h + pad * 2, data: out };
  }

  function rot90(src) {
    // np.rot90 (counter-clockwise): new[i][j] = old[j][w-1-i]
    const { w, h, data } = src;
    const out = new Uint8Array(w * h * 3);
    for (let i = 0; i < w; i++) {
      for (let j = 0; j < h; j++) {
        const s = (j * w + (w - 1 - i)) * 3, d = (i * h + j) * 3;
        out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2];
      }
    }
    return { w: h, h: w, data: out };
  }

  // ---------------------------------------------------------------- geometry

  function convexHull(points) {
    const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (pts.length <= 2) return pts;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    upper.pop(); lower.pop();
    return lower.concat(upper);
  }

  // cv2.minAreaRect via rotating calipers over the convex hull. Returns the 4 corners plus the two
  // side lengths; for axis-aligned input it reproduces OpenCV's integer bounding rectangle exactly.
  function minAreaRect(points) {
    const hull = convexHull(points);
    if (hull.length === 1) {
      const [x, y] = hull[0];
      return { corners: [[x, y], [x, y], [x, y], [x, y]], w: 0, h: 0 };
    }
    let best = null;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i], b = hull[(i + 1) % hull.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len === 0) continue;
      const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
      const vx = -uy, vy = ux;
      let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
      for (const p of hull) {
        const pu = p[0] * ux + p[1] * uy, pv = p[0] * vx + p[1] * vy;
        if (pu < minU) minU = pu; if (pu > maxU) maxU = pu;
        if (pv < minV) minV = pv; if (pv > maxV) maxV = pv;
      }
      const area = (maxU - minU) * (maxV - minV);
      if (!best || area < best.area - 1e-9) best = { area, ux, uy, vx, vy, minU, maxU, minV, maxV };
    }
    const { ux, uy, vx, vy, minU, maxU, minV, maxV } = best;
    const at = (u, v) => [u * ux + v * vx, u * uy + v * vy];
    return {
      corners: [at(minU, minV), at(maxU, minV), at(maxU, maxV), at(minU, maxV)],
      w: maxU - minU,
      h: maxV - minV,
    };
  }

  // DBPostProcess.get_mini_boxes: order the rectangle's corners tl, tr, br, bl.
  function miniBox(rect) {
    const p = rect.corners.slice().sort((a, b) => a[0] - b[0]);
    let i1, i2, i3, i4;
    if (p[1][1] > p[0][1]) { i1 = 0; i4 = 1; } else { i1 = 1; i4 = 0; }
    if (p[3][1] > p[2][1]) { i2 = 2; i3 = 3; } else { i2 = 3; i3 = 2; }
    return { box: [p[i1], p[i2], p[i3], p[i4]], sside: Math.min(rect.w, rect.h) };
  }

  // DBPostProcess.box_score_fast: mean probability inside the (integer-truncated) box polygon.
  function boxScoreFast(pred, W, H, box) {
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (const [x, y] of box) {
      if (x < xmin) xmin = x; if (x > xmax) xmax = x;
      if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    }
    xmin = clamp(Math.floor(xmin), 0, W - 1); xmax = clamp(Math.ceil(xmax), 0, W - 1);
    ymin = clamp(Math.floor(ymin), 0, H - 1); ymax = clamp(Math.ceil(ymax), 0, H - 1);
    const poly = box.map(([x, y]) => [Math.trunc(x - xmin) + xmin, Math.trunc(y - ymin) + ymin]);
    let sum = 0, n = 0;
    for (let y = ymin; y <= ymax; y++) {
      // Horizontal span of the convex polygon on this scanline (boundary pixels included, like fillPoly).
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < 4; i++) {
        const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % 4];
        if ((y < Math.min(y0, y1)) || (y > Math.max(y0, y1))) continue;
        if (y0 === y1) { lo = Math.min(lo, x0, x1); hi = Math.max(hi, x0, x1); continue; }
        const x = x0 + (y - y0) * (x1 - x0) / (y1 - y0);
        lo = Math.min(lo, x); hi = Math.max(hi, x);
      }
      if (lo > hi) continue;
      const a = Math.max(xmin, Math.ceil(lo - 1e-6)), b = Math.min(xmax, Math.floor(hi + 1e-6));
      for (let x = a; x <= b; x++) { sum += pred[y * W + x]; n++; }
    }
    return n ? sum / n : 0;
  }

  // Clipper's Round(): half away from zero.
  const clipRound = (v) => (v < 0 ? Math.trunc(v - 0.5) : Math.trunc(v + 0.5));

  // pyclipper.PyclipperOffset (JT_ROUND, ET_CLOSEDPOLYGON, arc_tolerance 0.25) for a convex path:
  // the input is truncated to integers, every offset vertex rounded — the same integer polygon
  // Clipper 6.4 produces, so the minAreaRect taken of it afterwards matches.
  function clipperOffsetRound(points, delta) {
    let path = points.map(([x, y]) => [Math.trunc(x), Math.trunc(y)]);
    path = path.filter((p, i) => {
      const q = path[(i + path.length - 1) % path.length];
      return p[0] !== q[0] || p[1] !== q[1];
    });
    if (path.length < 3) return path;
    let area = 0;
    for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
      area += (path[j][0] + path[i][0]) * (path[j][1] - path[i][1]);
    }
    if (-area * 0.5 < 0) path.reverse(); // ClipperOffset::FixOrientations

    const tol = Math.min(0.25, Math.abs(delta) * 0.25);
    let steps = Math.PI / Math.acos(1 - tol / Math.abs(delta));
    if (steps > Math.abs(delta) * Math.PI) steps = Math.abs(delta) * Math.PI;
    const sin = Math.sin((2 * Math.PI) / steps), cos = Math.cos((2 * Math.PI) / steps);
    const stepsPerRad = steps / (2 * Math.PI);

    const n = path.length;
    const normals = path.map((p, i) => {
      const q = path[(i + 1) % n];
      const dx = q[0] - p[0], dy = q[1] - p[1], f = 1 / Math.hypot(dx, dy);
      return [dy * f, -dx * f];
    });
    const out = [];
    const push = (x, y) => out.push([clipRound(x), clipRound(y)]);
    for (let j = 0, k = n - 1; j < n; k = j, j++) {
      const [px, py] = path[j], nk = normals[k], nj = normals[j];
      let sinA = nk[0] * nj[1] - nj[0] * nk[1];
      const cosA = nk[0] * nj[0] + nj[1] * nk[1];
      if (Math.abs(sinA * delta) < 1.0) {
        if (cosA > 0) { push(px + nk[0] * delta, py + nk[1] * delta); continue; }
      } else sinA = clamp(sinA, -1, 1);
      if (sinA * delta < 0) {
        push(px + nk[0] * delta, py + nk[1] * delta);
        out.push([px, py]);
        push(px + nj[0] * delta, py + nj[1] * delta);
        continue;
      }
      const a = Math.atan2(sinA, cosA);
      const st = Math.max(clipRound(stepsPerRad * Math.abs(a)), 1);
      let X = nk[0], Y = nk[1];
      for (let i = 0; i < st; i++) {
        push(px + X * delta, py + Y * delta);
        const X2 = X;
        X = X * cos - sin * Y;
        Y = X2 * sin + Y * cos;
      }
      push(px + nj[0] * delta, py + nj[1] * delta);
    }
    return out;
  }

  // DBPostProcess.unclip + get_mini_boxes: offset by area * ratio / perimeter (shapely Polygon on
  // the float box), then the minimum-area rectangle of the offset polygon.
  function unclipBox(box, ratio) {
    let area = 0, perim = 0;
    for (let i = 0; i < 4; i++) {
      const [x0, y0] = box[i], [x1, y1] = box[(i + 1) % 4];
      area += x0 * y1 - x1 * y0;
      perim += Math.hypot(x1 - x0, y1 - y0);
    }
    area = Math.abs(area) / 2;
    const d = perim ? (area * ratio) / perim : 0;
    return miniBox(minAreaRect(clipperOffsetRound(box, d)));
  }

  function boxesFromBitmap(pred, mask, W, H, destW, destH) {
    const { boxThresh, maxCandidates, unclipRatio, minSize } = CFG.det;
    const visited = new Uint8Array(W * H);
    const stack = new Int32Array(W * H);
    const rowMin = new Int32Array(H).fill(W), rowMax = new Int32Array(H).fill(-1);
    const boxes = [];
    let candidates = 0;
    for (let start = 0; start < W * H && candidates < maxCandidates; start++) {
      if (!mask[start] || visited[start]) continue;
      candidates++;
      // 8-connected component (findContours outer border), tracked as per-row x-extents — the
      // convex hull of those extents equals the hull of the contour.
      let sp = 0, ymin = H, ymax = -1;
      stack[sp++] = start; visited[start] = 1;
      while (sp) {
        const p = stack[--sp];
        const y = (p / W) | 0, x = p - y * W;
        if (x < rowMin[y]) rowMin[y] = x;
        if (x > rowMax[y]) rowMax[y] = x;
        if (y < ymin) ymin = y; if (y > ymax) ymax = y;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= H) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= W) continue;
            const q = ny * W + nx;
            if (mask[q] && !visited[q]) { visited[q] = 1; stack[sp++] = q; }
          }
        }
      }
      const pts = [];
      for (let y = ymin; y <= ymax; y++) {
        if (rowMax[y] < 0) continue;
        pts.push([rowMin[y], y]);
        if (rowMax[y] !== rowMin[y]) pts.push([rowMax[y], y]);
        rowMin[y] = W; rowMax[y] = -1;
      }

      const first = miniBox(minAreaRect(pts));
      if (first.sside < minSize) continue;
      const score = boxScoreFast(pred, W, H, first.box);
      if (boxThresh > score) continue;
      const grown = unclipBox(first.box, unclipRatio);
      if (grown.sside < minSize + 2) continue;
      boxes.push(grown.box.map(([x, y]) => [
        clamp(pyRound((x / W) * destW), 0, destW),
        clamp(pyRound((y / H) * destH), 0, destH),
      ]));
    }
    return boxes;
  }

  // TextDetector.order_points_clockwise + clip_det_res + size filter.
  function filterDetBoxes(boxes, imgW, imgH) {
    const out = [];
    for (const box of boxes) {
      const xs = box.slice().sort((a, b) => a[0] - b[0]);
      const left = xs.slice(0, 2).sort((a, b) => a[1] - b[1]);
      const right = xs.slice(2).sort((a, b) => a[1] - b[1]);
      const ordered = [left[0], right[0], right[1], left[1]].map(([x, y]) => [
        Math.trunc(clamp(x, 0, imgW - 1)),
        Math.trunc(clamp(y, 0, imgH - 1)),
      ]);
      const rw = Math.trunc(Math.hypot(ordered[0][0] - ordered[1][0], ordered[0][1] - ordered[1][1]));
      const rh = Math.trunc(Math.hypot(ordered[0][0] - ordered[3][0], ordered[0][1] - ordered[3][1]));
      if (rw <= 3 || rh <= 3) continue;
      out.push(ordered);
    }
    return out;
  }

  // RapidOCR.sorted_boxes: top-to-bottom, then left-to-right within a 10 px line band.
  function sortBoxes(boxes) {
    const b = boxes.slice().sort((p, q) => p[0][1] - q[0][1] || p[0][0] - q[0][0]);
    for (let i = 0; i < b.length - 1; i++) {
      for (let j = i; j >= 0; j--) {
        if (Math.abs(b[j + 1][0][1] - b[j][0][1]) < 10 && b[j + 1][0][0] < b[j][0][0]) {
          const t = b[j]; b[j] = b[j + 1]; b[j + 1] = t;
        } else break;
      }
    }
    return b;
  }

  // cv2.getPerspectiveTransform: 3x3 homography mapping src[i] -> dst[i].
  function perspectiveTransform(src, dst) {
    const A = [], B = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); B.push(u);
      A.push([0, 0, 0, x, y, 1, -x * v, -y * v]); B.push(v);
    }
    for (let c = 0; c < 8; c++) {
      let piv = c;
      for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]]; [B[c], B[piv]] = [B[piv], B[c]];
      for (let r = 0; r < 8; r++) {
        if (r === c || A[c][c] === 0) continue;
        const f = A[r][c] / A[c][c];
        for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
        B[r] -= f * B[c];
      }
    }
    const m = B.map((v, i) => v / A[i][i]);
    return [m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], 1];
  }

  // get_rotate_crop_image: cv2.warpPerspective(INTER_CUBIC, BORDER_REPLICATE) of the box region,
  // with OpenCV's 1/32-pixel interpolation-table quantisation.
  function cropBox(img, box) {
    const n = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const cw = Math.trunc(Math.max(n(box[0], box[1]), n(box[2], box[3])));
    const ch = Math.trunc(Math.max(n(box[0], box[3]), n(box[1], box[2])));
    const M = perspectiveTransform([[0, 0], [cw, 0], [cw, ch], [0, ch]], box); // dst -> src
    const { w, h, data } = img;
    const A = -0.75;
    const cubic = (t) => {
      const w0 = ((A * (t + 1) - 5 * A) * (t + 1) + 8 * A) * (t + 1) - 4 * A;
      const w1 = ((A + 2) * t - (A + 3)) * t * t + 1;
      const w2 = ((A + 2) * (1 - t) - (A + 3)) * (1 - t) * (1 - t) + 1;
      return [w0, w1, w2, 1 - w0 - w1 - w2];
    };
    const out = new Uint8Array(cw * ch * 3);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const W = M[6] * x + M[7] * y + M[8];
        const sx = (M[0] * x + M[1] * y + M[2]) / W, sy = (M[3] * x + M[4] * y + M[5]) / W;
        const qx = Math.round(sx * 32), qy = Math.round(sy * 32);
        const ix = qx >> 5, iy = qy >> 5;
        const wx = cubic((qx & 31) / 32), wy = cubic((qy & 31) / 32);
        const o = (y * cw + x) * 3;
        for (let c = 0; c < 3; c++) {
          let s = 0;
          for (let j = 0; j < 4; j++) {
            const yy = clamp(iy - 1 + j, 0, h - 1);
            let row = 0;
            for (let i = 0; i < 4; i++) row += data[(yy * w + clamp(ix - 1 + i, 0, w - 1)) * 3 + c] * wx[i];
            s += row * wy[j];
          }
          out[o + c] = toByte(s);
        }
      }
    }
    let crop = { w: cw, h: ch, data: out };
    if (ch / cw >= 1.5) crop = rot90(crop);
    return crop;
  }

  function toCHW(img, dst, offset, stride) {
    // (v / 255 - 0.5) / 0.5, written into a [3, H, stride] plane at `offset` (stride >= img.w).
    const { w, h, data } = img;
    const plane = h * stride;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = (y * w + x) * 3, d = offset + y * stride + x;
        dst[d] = data[s] / 127.5 - 1;
        dst[d + plane] = data[s + 1] / 127.5 - 1;
        dst[d + 2 * plane] = data[s + 2] / 127.5 - 1;
      }
    }
  }

  // ---------------------------------------------------------------- engine

  class OcrEngine {
    /**
     * @param {object} opts
     * @param {object} opts.ort        onnxruntime-web or onnxruntime-node module
     * @param {string|Uint8Array} opts.detModel / opts.recModel   model URL/path or bytes
     * @param {string} opts.keysText   ppocr_keys_v1.txt contents (one character per line)
     * @param {object} [opts.sessionOptions]
     */
    static async create({ ort, detModel, recModel, keysText, sessionOptions = {} }) {
      const det = await ort.InferenceSession.create(detModel, sessionOptions);
      const rec = await ort.InferenceSession.create(recModel, sessionOptions);
      return new OcrEngine(ort, det, rec, keysText);
    }

    constructor(ort, det, rec, keysText) {
      this.ort = ort;
      this.det = det;
      this.rec = rec;
      const keys = keysText.replace(/\r/g, '').split('\n');
      if (keys.length && keys[keys.length - 1] === '') keys.pop();
      this.characters = ['blank', ...keys, ' '];
      this.timings = {};
    }

    /** Adds the time since t0 to stage `name` in this.timings (ms); returns the new t0. */
    lap(name, t0) {
      const now = performance.now();
      this.timings[name] = (this.timings[name] || 0) + (now - t0);
      return now;
    }

    async run(session, data, dims) {
      const feeds = { [session.inputNames[0]]: new this.ort.Tensor('float32', data, dims) };
      const out = await session.run(feeds);
      return out[session.outputNames[0]];
    }

    async detect(img) {
      const { limitSideLen, thresh } = CFG.det;
      const { w, h } = img;
      const ratio = Math.min(w, h) < limitSideLen ? limitSideLen / Math.min(w, h) : 1;
      const rh = pyRound(Math.trunc(h * ratio) / 32) * 32;
      const rw = pyRound(Math.trunc(w * ratio) / 32) * 32;
      if (rw <= 0 || rh <= 0) return [];
      let t = performance.now();
      const resized = resizeLinear(img, rw, rh);
      const input = new Float32Array(3 * rw * rh);
      toCHW(resized, input, 0, rw);
      t = this.lap('det_prep', t);
      const out = await this.run(this.det, input, [1, 3, rh, rw]);
      t = this.lap('det_infer', t);
      const [, , H, W] = out.dims;
      const pred = out.data;
      // pred > thresh, then cv2.dilate with a 2x2 kernel (anchor (1,1): looks up and to the left).
      const seg = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) seg[i] = pred[i] > thresh ? 1 : 0;
      const mask = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          mask[i] = seg[i] || (x > 0 && seg[i - 1]) || (y > 0 && (seg[i - W] || (x > 0 && seg[i - W - 1]))) ? 1 : 0;
        }
      }
      const boxes = sortBoxes(filterDetBoxes(boxesFromBitmap(pred, mask, W, H, w, h), w, h));
      this.lap('det_post', t);
      return boxes;
    }

    async recognize(crops) {
      const { imgH, imgW, batch } = CFG.rec;
      const order = crops.map((c, i) => i).sort((a, b) => crops[a].w / crops[a].h - crops[b].w / crops[b].h);
      const results = new Array(crops.length);
      for (let beg = 0; beg < order.length; beg += batch) {
        const idx = order.slice(beg, beg + batch);
        let maxRatio = imgW / imgH;
        for (const i of idx) maxRatio = Math.max(maxRatio, crops[i].w / crops[i].h);
        const width = Math.trunc(imgH * maxRatio);
        let t = performance.now();
        const input = new Float32Array(idx.length * 3 * imgH * width); // zero padding = mid-grey
        idx.forEach((i, b) => {
          const c = crops[i];
          const want = Math.ceil(imgH * (c.w / c.h));
          const rw = want > width ? width : want;
          toCHW(resizeLinear(c, rw, imgH), input, b * 3 * imgH * width, width);
        });
        t = this.lap('rec_prep', t);
        const out = await this.run(this.rec, input, [idx.length, 3, imgH, width]);
        t = this.lap('rec_infer', t);
        const [, T, C] = out.dims;
        const probs = out.data;
        idx.forEach((i, b) => {
          let text = '', confSum = 0, confN = 0, prev = -1;
          for (let t = 0; t < T; t++) {
            const base = (b * T + t) * C;
            let best = 0, bestP = probs[base];
            for (let k = 1; k < C; k++) if (probs[base + k] > bestP) { bestP = probs[base + k]; best = k; }
            if (best !== 0 && best !== prev) { text += this.characters[best] ?? ''; confSum += bestP; confN++; }
            prev = best;
          }
          results[i] = { text, score: confN ? confSum / confN : 0 };
        });
        this.lap('rec_decode', t);
      }
      return results;
    }

    /**
     * Full RapidOCR __call__ (use_cls=False): returns [{ box: [[x,y]x4], text, score }].
     * `recFilter(box)` can skip recognition of detected boxes whose text is not needed.
     */
    async ocr(img, { recFilter = null } = {}) {
      const rawW = img.w, rawH = img.h;
      let work = img, ratioW = 1, ratioH = 1;
      if (Math.max(work.w, work.h) > CFG.maxSideLen) {
        const r = CFG.maxSideLen / Math.max(work.w, work.h);
        const rh = pyRound(Math.trunc(work.h * r) / 32) * 32, rw = pyRound(Math.trunc(work.w * r) / 32) * 32;
        ratioH = work.h / rh; ratioW = work.w / rw;
        work = resizeLinear(work, rw, rh);
      }
      if (Math.min(work.w, work.h) < CFG.minSideLen) {
        const r = CFG.minSideLen / Math.min(work.w, work.h);
        const rh = pyRound(Math.trunc(work.h * r) / 32) * 32, rw = pyRound(Math.trunc(work.w * r) / 32) * 32;
        ratioH = work.h / rh; ratioW = work.w / rw;
        work = resizeLinear(work, rw, rh);
      }
      let padTop = 0;
      if (work.h <= CFG.minHeight || work.w / work.h > CFG.widthHeightRatio) {
        const newH = Math.max(Math.trunc(work.w / CFG.widthHeightRatio), CFG.minHeight) * 2;
        padTop = Math.trunc(Math.abs(newH - work.h) / 2);
        work = padTopBottom(work, padTop);
      }

      let boxes = await this.detect(work);
      if (recFilter) boxes = boxes.filter(recFilter);
      if (!boxes.length) return [];
      const tc = performance.now();
      const crops = boxes.map((b) => cropBox(work, b));
      this.lap('crop', tc);
      const recs = await this.recognize(crops);

      const out = [];
      boxes.forEach((box, i) => {
        if (recs[i].score < CFG.textScore) return;
        out.push({
          box: box.map(([x, y]) => [
            clamp((x - 0) * ratioW, 0, rawW),
            clamp((y - padTop) * ratioH, 0, rawH),
          ]),
          text: recs[i].text,
          score: recs[i].score,
        });
      });
      return out;
    }
  }

  return { OcrEngine, fromRGBA, resizeLinear, resizeLanczos, CFG };
});
