/*
 * 1:1 port of the frame-processing logic in web-scanner/server.py (POST /process): OCR the frame,
 * detect which screen it shows, group the text lines into member cards / leaderboard rows, and run
 * the enlarged shield-rescue pass when a rank badge is missing. The result has exactly the JSON shape
 * the server returns, so the cockpit consumes it unchanged.
 *
 * The comments explaining *why* each heuristic exists live in server.py; keep both in sync.
 * Depends on LwOcrEngine (ocr-engine.js). Works in browser workers and in Node.
 */
(function (root, factory) {
  const engine = typeof module === 'object' && module.exports ? require('./ocr-engine.js') : root.LwOcrEngine;
  const api = factory(engine);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LwScannerPipeline = api;
})(typeof self !== 'undefined' ? self : globalThis, function (LwOcrEngine) {
  'use strict';

  const KAMPF_RE = /k[ae]mp/i;
  const HEADER_RE = new RegExp(
    '^(leader|ingenieure?|soldat(en)?|offizier(e)?|rookie|verwalter|rekrutierer|muse'
    + '|kriegsherr|kriegsanf[uü]hrer|kriegsf[uü]hrer'
    + '|mitglieder\\s*suchen|mitgliederliste)$',
    'i',
  );
  const FRACTION_RE = /^[0-9]{1,3}\s*\/\s*[0-9]{1,3}$/;
  const POWER_RE = /([0-9]{2,4}[.,]?[0-9]{0,2})\s*M/i;
  const LEVEL_RE = /Lv\.?\s*([0-9]{1,2})/i;
  const MEMBERS_HEADER_RE = /mitgliederliste/i;
  const RANKING_HEADER_RE = /st[äa]rke[\s-]*rangliste|rangliste/i;
  const RANK_BADGE_RE = /^R[1-5]$/;
  const RANKING_NOISE_RE = /^(rang|kommandant|kampfkraft)$|geschenk|erhalten|!$/i;
  const RANK_POSITION_RE = /^[0-9]{1,3}$/;
  const RAW_POWER_RE = /^[0-9]{5,}$/;
  const GENDER_ICON_PREFIX_RE = /^[Oo](?=[A-ZÄÖÜ])/;

  const SHIELD_RECOVERY_SCALE = 2;
  const SHIELD_MIN_SCORE = 0.7;
  // Shield boxes ("R1"–"R5") are almost square: aspect 1.15–1.83 over all 300 shields in the 84 test
  // captures. The rescue pass only keeps shields, so it only needs to *read* boxes of that shape —
  // skipping the other ~75 % of the lines roughly halves the cost of the second pass.
  const SHIELD_MAX_ASPECT = 2.5;
  const isShieldShaped = (box) => {
    const xs = box.map((p) => p[0]), ys = box.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    return h > 0 && w / h <= SHIELD_MAX_ASPECT;
  };

  const cleanName = (text) => text.trim().replace(GENDER_ICON_PREFIX_RE, '');
  const cx = (l) => (l.left + l.right) / 2;
  const cy = (l) => (l.top + l.bottom) / 2;
  const height = (l) => l.bottom - l.top;
  const vars = (l) => ({ text: l.text, score: l.score, left: l.left, top: l.top, right: l.right, bottom: l.bottom });

  // Python's min()/max() with key= return the *first* extreme element on ties.
  function minBy(list, key) {
    let best = null, bestK = Infinity;
    for (const x of list) { const k = key(x); if (k < bestK) { best = x; bestK = k; } }
    return best;
  }
  function maxBy(list, key) {
    let best = null, bestK = -Infinity;
    for (const x of list) { const k = key(x); if (k > bestK) { best = x; bestK = k; } }
    return best;
  }

  function toLine(box, text, score) {
    const xs = box.map((p) => p[0]), ys = box.map((p) => p[1]);
    return { text, score, left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
  }

  async function ocrLines(engine, image, scale = 1, options = {}) {
    const t = performance.now();
    const src = scale === 1 ? image : LwOcrEngine.resizeLanczos(image, image.w * scale, image.h * scale);
    if (scale !== 1) engine.lap('rescue_upscale', t);
    const result = await engine.ocr(src, options);
    return result.map(({ box, text, score }) => toLine(
      scale === 1 ? box : box.map(([x, y]) => [x / scale, y / scale]), text, score,
    ));
  }

  async function shieldRescue(engine, image, lines) {
    const already = lines.filter((l) => RANK_BADGE_RE.test(l.text.trim()));
    const found = [];
    for (const l of await ocrLines(engine, image, SHIELD_RECOVERY_SCALE, { recFilter: isShieldShaped })) {
      if (!RANK_BADGE_RE.test(l.text.trim()) || l.score < SHIELD_MIN_SCORE) continue;
      if (already.some((o) => Math.abs(cy(o) - cy(l)) < 12 && Math.abs(cx(o) - cx(l)) < 25)) continue;
      found.push(l);
    }
    return found;
  }

  function detectMode(lines) {
    const texts = lines.map((l) => l.text).join(' ');
    if (RANKING_HEADER_RE.test(texts)) return 'ranking';
    const exact = new Set(lines.map((l) => l.text.trim().toLowerCase()));
    if (exact.has('kills') && exact.has('spende')) return 'ranking';
    if (MEMBERS_HEADER_RE.test(texts)) return 'members';
    return 'unknown';
  }

  function findLeaderCard(lines, extraBadges = []) {
    const badge = [...lines, ...extraBadges].find((l) => l.text.trim() === 'R5');
    if (!badge) return null;
    const nameCandidates = lines.filter((l) => l !== badge
      && Math.abs(cy(l) - cy(badge)) < height(badge) * 1.5
      && l.left > badge.right);
    if (!nameCandidates.length) return null;
    const nameLine = minBy(nameCandidates, (l) => l.left);
    return {
      anchor_y: badge.top,
      name: cleanName(nameLine.text),
      values_text: '',
      status: 'R5 (Anführer-Banner)',
      rank_code: 5,
      power: null,
      level: null,
      confidence: { name: nameLine.score, values: null, status: null },
      box: {
        left: Math.min(badge.left, nameLine.left) - 10,
        top: badge.top - 10,
        right: Math.max(badge.right, nameLine.right) + 10,
        bottom: nameLine.bottom + 10,
      },
      name_box: vars(nameLine),
      values_box: null,
      status_box: null,
    };
  }

  function groupRankingRows(lines, extraBadges = []) {
    const anchors = lines.filter((l) => RAW_POWER_RE.test(l.text.trim()));
    const badgePool = [...lines, ...extraBadges];
    const rows = [];
    for (const anchor of anchors) {
      const rowHeight = Math.max(height(anchor) * 2.5, 1);
      const sameRow = (l) => Math.abs(cy(l) - cy(anchor)) < rowHeight * 0.6;

      const badgeLine = maxBy(badgePool.filter((l) => RANK_BADGE_RE.test(l.text.trim())
        && sameRow(l) && l.right < anchor.left), (l) => l.left);

      const positionLine = maxBy(lines.filter((l) => l !== anchor
        && RANK_POSITION_RE.test(l.text.trim())
        && sameRow(l)
        && l.right < anchor.left
        && (badgeLine === null || l.right < badgeLine.left)), (l) => l.left);

      const nameLine = maxBy(lines.filter((l) => l !== anchor && l !== badgeLine && l !== positionLine
        && sameRow(l)
        && l.left < anchor.left
        && !RANK_POSITION_RE.test(l.text.trim())
        && !RANK_BADGE_RE.test(l.text.trim())
        && !RANKING_NOISE_RE.test(l.text.trim())), (l) => l.left);

      const boxLines = [anchor, badgeLine, nameLine, positionLine].filter(Boolean);
      const badgeText = badgeLine ? badgeLine.text.trim() : null;
      rows.push({
        anchor_y: anchor.top,
        rank_position: positionLine ? positionLine.text.trim() : null,
        rank_badge: badgeText,
        rank_code: badgeText ? parseInt(badgeText[1], 10) : null,
        name: nameLine ? cleanName(nameLine.text) : '',
        power: anchor.text.trim(),
        confidence: { name: nameLine ? nameLine.score : null, power: anchor.score },
        box: {
          left: Math.min(...boxLines.map((x) => x.left)) - 10,
          top: Math.min(...boxLines.map((x) => x.top)) - 6,
          right: Math.max(...boxLines.map((x) => x.right)) + 10,
          bottom: Math.max(...boxLines.map((x) => x.bottom)) + 6,
        },
      });
    }
    return stableSortBy(rows, (r) => r.anchor_y);
  }

  function groupCards(lines, extraBadges = []) {
    const anchors = lines.filter((l) => KAMPF_RE.test(l.text));
    const badgePool = [...lines, ...extraBadges];
    const cards = [];
    for (const anchor of anchors) {
      const cardHeight = Math.max(height(anchor) * 4, 1);

      const nameLine = minBy(lines.filter((l) => l !== anchor
        && anchor.top - cardHeight * 0.75 < cy(l) && cy(l) < anchor.top
        && l.left < anchor.right
        && l.left >= anchor.left - cardHeight * 0.5
        && !HEADER_RE.test(l.text.trim())
        && !RANK_BADGE_RE.test(l.text.trim())), (l) => anchor.top - cy(l));

      const refCy = nameLine ? cy(nameLine) : anchor.top - cardHeight * 0.3;
      const statusLine = minBy(lines.filter((l) => l !== anchor && l !== nameLine
        && Math.abs(cy(l) - refCy) < cardHeight * 0.5
        && l.left > anchor.left + cardHeight * 1.5
        && !FRACTION_RE.test(l.text.trim())), (l) => Math.abs(cy(l) - refCy));

      const powerMatch = POWER_RE.exec(anchor.text);
      const levelMatch = LEVEL_RE.exec(anchor.text);

      const barLine = maxBy(badgePool.filter((l) => RANK_BADGE_RE.test(l.text.trim())
        && l.bottom < anchor.top
        && lines.some((c) => FRACTION_RE.test(c.text.trim()) && Math.abs(cy(c) - cy(l)) < height(l) * 1.5)),
      (l) => l.bottom);

      const boxLines = [anchor, nameLine, statusLine].filter(Boolean);
      const cardBox = {
        left: Math.min(...boxLines.map((x) => x.left)),
        top: Math.min(...boxLines.map((x) => x.top)) - cardHeight * 0.15,
        right: Math.max(...boxLines.map((x) => x.right)),
        bottom: anchor.bottom + cardHeight * 0.1,
      };

      const power = powerMatch ? powerMatch[1].replace(/,/g, '.') : null;
      if (nameLine === null && power === null) continue;

      cards.push({
        anchor_y: anchor.top,
        name: nameLine ? cleanName(nameLine.text) : '',
        values_text: anchor.text,
        status: statusLine ? statusLine.text.trim() : '',
        rank_code: barLine ? parseInt(barLine.text.trim()[1], 10) : null,
        power,
        level: levelMatch ? levelMatch[1] : null,
        confidence: {
          name: nameLine ? nameLine.score : null,
          values: anchor.score,
          status: statusLine ? statusLine.score : null,
        },
        box: cardBox,
        name_box: nameLine ? vars(nameLine) : null,
        values_box: vars(anchor),
        status_box: statusLine ? vars(statusLine) : null,
      });
    }
    return stableSortBy(cards, (c) => c.anchor_y);
  }

  function stableSortBy(list, key) {
    return list.map((x, i) => [x, i]).sort((a, b) => key(a[0]) - key(b[0]) || a[1] - b[1]).map((p) => p[0]);
  }

  function needsRescue(lines, rows, mode) {
    if (mode === 'ranking') return rows.some((r) => r.rank_code === null || r.rank_code === undefined);
    for (const header of lines.filter((l) => FRACTION_RE.test(l.text.trim()))) {
      if (!lines.some((l) => RANK_BADGE_RE.test(l.text.trim()) && Math.abs(cy(l) - cy(header)) < height(header) * 1.5)) {
        return true;
      }
    }
    return false;
  }

  function buildRows(lines, mode, extraBadges = []) {
    if (mode === 'ranking') return groupRankingRows(lines, extraBadges);
    const cards = groupCards(lines, extraBadges);
    const leader = findLeaderCard(lines, extraBadges);
    if (leader) cards.unshift(leader);
    return cards;
  }

  /** Equivalent of server.py's POST /process for one RGB frame ({ w, h, data }). */
  async function processFrame(engine, image) {
    engine.timings = {};
    const lines = await ocrLines(engine, image);
    const mode = detectMode(lines);
    let rows = buildRows(lines, mode);
    let rescue = [];
    const rescued = needsRescue(lines, rows, mode);
    if (rescued) {
      rescue = await shieldRescue(engine, image, lines);
      if (rescue.length) rows = buildRows(lines, mode, rescue);
    }
    return {
      width: image.w,
      height: image.h,
      mode,
      raw_lines: [...lines, ...rescue].map((l) => ({ text: l.text, score: l.score })),
      cards: mode === 'ranking' ? [] : rows,
      rankings: mode === 'ranking' ? rows : [],
      rescued, // the enlarged second pass ran (it dominates the frame time)
      timings: engine.timings,
    };
  }

  return { processFrame, ocrLines, detectMode, buildRows, needsRescue, shieldRescue };
});
