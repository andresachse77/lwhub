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

  // Spaltenkopf "Rang | Kommandant | <Wert>" der Ranglisten (wie ScreenClassifier in Thomas' App):
  // "Punkte" = VS (Allianz-Duell), "Kampfkraft" = Staerke-Rangliste, "Kills", "Spendenpunkte".
  function columnHeader(lines) {
    const header = lines.filter((l) => /kommandant/i.test(l.text)).sort((a, b) => a.top - b.top)[0];
    if (!header) return null;
    const label = lines
      .filter((l) => l !== header && l.left > header.right && Math.abs(cy(l) - cy(header)) < height(header))
      .map((l) => l.text).join(' ').toLowerCase();
    return { header, label };
  }

  function detectMode(lines) {
    const col = columnHeader(lines);
    if (col) {
      if (/spende/.test(col.label)) return 'donation'; // "Spendenpunkte" enthaelt auch "punkte"
      if (/kills/.test(col.label)) return 'kills';
      if (/punkte/.test(col.label)) return 'vs';
    }
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
    const typical = typicalHeight(anchors);
    const rankHeight = typicalHeight(lines.filter((l) => RANK_POSITION_RE.test(l.text.trim())
      && anchors.some((a) => l.right < a.left && Math.abs(cy(l) - cy(a)) < height(a) * 1.5)));
    const badgePool = [...lines, ...extraBadges];
    const rows = [];
    for (const anchor of anchors) {
      if (isClippedNumber(anchor, typical)) continue;
      const rowHeight = Math.max(height(anchor) * 2.5, 1);
      const sameRow = (l) => Math.abs(cy(l) - cy(anchor)) < rowHeight * 0.6;

      const badgeLine = maxBy(badgePool.filter((l) => RANK_BADGE_RE.test(l.text.trim())
        && sameRow(l) && l.right < anchor.left), (l) => l.left);

      const positionLine = maxBy(lines.filter((l) => l !== anchor
        && RANK_POSITION_RE.test(l.text.trim())
        && isFullRankNumber(l, rankHeight)
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

  // ─── Halb verdeckte Zeilen ──────────────────────────────────────────────────────────────────────
  // Oben schneidet der Spaltenkopf die erste Zeile an, unten die fest eingeblendete eigene Zeile. Die
  // Texterkennung liest dort Reste: eine flache Zahl ("907" statt 47.897.581, "101950620" statt
  // 191950630) oder einen angeschnittenen Namen ("KICllaru" statt "Ric hard"). Die Zeile ist in der
  // Nachbar-Aufnahme vollstaendig, darum wird sie verworfen.
  // Gemessen an 194 NxU2-Aufnahmen (17.10.): volle Zahlen haben >= 0.83 der ueblichen Hoehe, angeschnittene
  // <= 0.54. Eine einzelne "0" liefert immer eine flache Box und zaehlt nicht als angeschnitten.
  const CLIPPED_NUMBER_RATIO = 0.7;

  function typicalHeight(anchors) {
    const hs = anchors.map(height).sort((a, b) => a - b);
    return hs.length ? hs[Math.floor(hs.length / 2)] : 0;
  }

  const isClippedNumber = (anchor, typical) => anchor.text.replace(/[^0-9]/g, '').length > 1
    && height(anchor) < typical * CLIPPED_NUMBER_RATIO;

  // Rangnummer links in der Zeile. Ueber die Mitte geprueft: zweistellige Nummern ragen mit dem rechten
  // Rand ueber ein Viertel der Bildbreite hinaus (rechts ~285 px bei 1118 px Breite).
  const isRankColumn = (l, image) => RANK_POSITION_RE.test(l.text.trim()) && cx(l) < image.w * 0.25;

  // Flache Ziffern in der Platz-Spalte sind keine Platznummer: eine hinter der eigenen Zeile angeschnittene
  // ("561" statt 11) oder eine Verzierung im Avatar ("000"). NxU1 17.10.: 23 bzw. 7 px gegen ~38 px. Ein
  // einziger solcher Ausreisser liess das Cockpit "Platz 85–560 nicht erfasst" melden.
  const isFullRankNumber = (l, rankHeight) => height(l) >= rankHeight * CLIPPED_NUMBER_RATIO;
  const rankColumnHeight = (lines, image) => typicalHeight(lines.filter((l) => isRankColumn(l, image)));

  function stableSortBy(list, key) {
    return list.map((x, i) => [x, i]).sort((a, b) => key(a[0]) - key(b[0]) || a[1] - b[1]).map((p) => p[0]);
  }

  function needsRescue(lines, rows, mode) {
    if (mode !== 'ranking' && mode !== 'members' && mode !== 'unknown') return false;
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

  // ─── VS (Allianz-Duell) ─────────────────────────────────────────────────────────────────────────
  // Layout (Thomas' App, ParserConfig.VS_RANG): je Zeile Rang | Avatar | Name, darunter
  // "[NxU1] Nexus United 1" | Punkte rechts. Tagesrang hat eine Wochentag-Leiste (Mo–Sa), der gewaehlte
  // Tag ist hell hinterlegt. Unten ist die eigene Zeile fest eingeblendet (echte Werte, doppelt egal).
  const VS_POINTS_RE = /^[0-9]{1,3}(?:[.,\s][0-9]{3})+$|^[0-9]{1,6}$/;
  const VS_DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

  /** Helligkeit des Hintergrunds in einem Rechteck: 80-%-Wert der Pixel-Luminanz (Schrift zaehlt kaum). */
  function boxBrightness(image, l) {
    const x0 = Math.max(0, Math.floor(l.left)), x1 = Math.min(image.w - 1, Math.ceil(l.right));
    const y0 = Math.max(0, Math.floor(l.top)), y1 = Math.min(image.h - 1, Math.ceil(l.bottom));
    const vals = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = (y * image.w + x) * 3;
        vals.push(0.299 * image.data[i] + 0.587 * image.data[i + 1] + 0.114 * image.data[i + 2]);
      }
    }
    vals.sort((a, b) => a - b);
    return vals.length ? vals[Math.floor(vals.length * 0.8)] : 0;
  }

  function vsInfo(lines, image) {
    const col = columnHeader(lines);
    const dayTabs = lines.filter((l) => VS_DAYS.includes(l.text.trim()) && (!col || l.bottom < col.header.top));
    if (dayTabs.length < 3) return { type: 'VS_WEEK', day: null };
    const day = image ? maxBy(dayTabs, (l) => boxBrightness(image, l)).text.trim() : null;
    return { type: 'VS_DAY', day };
  }

  // VS: der Name steht ueber der Allianz-Zeile "[NxU2] …". Liegt er direkt am Spaltenkopf (< 1.0
  // Zeilenhoehen) und naeher an der Allianz-Zeile als volle Namen, ist seine Oberkante abgeschnitten.
  // Gemessen in Hoehen der Allianz-Zeile: angeschnitten <= 1.42, voll >= 1.48. Fehlt der Name ganz und
  // laege sein Platz direkt am Spaltenkopf, steckt er darunter. Ohne Allianz-Zeile dient die Zahl als
  // Bezug (Name ~0.9 Zahlenhoehen darueber, angeschnitten < 0.8). Die erste Zeile der Liste hat genug
  // Abstand zum Spaltenkopf und ist nie betroffen.
  function isClippedVsName(anchor, nameLine, tagLine, top, tagHeight, numberHeight) {
    const unit = tagLine ? tagHeight : numberHeight;
    const nameTop = nameLine ? nameLine.top : (tagLine ? tagLine.top - unit * 1.6 : anchor.top - unit * 0.9);
    if (nameTop - top >= unit) return false;
    if (!nameLine) return true;
    return tagLine ? tagLine.top - nameLine.top < unit * 1.45 : anchor.top - nameLine.top < unit * 0.8;
  }

  function groupVsRows(lines, image) {
    const col = columnHeader(lines);
    const top = col ? col.header.bottom : 0;
    const anchors = lines.filter((l) => cy(l) > top && l.left > image.w * 0.6 && VS_POINTS_RE.test(l.text.trim()));
    const typical = typicalHeight(anchors);
    const tagHeight = typicalHeight(lines.filter((l) => cy(l) > top && /^\s*[\[(]/.test(l.text)));
    const rankHeight = rankColumnHeight(lines, image);
    const rows = [];
    for (const anchor of anchors) {
      if (isClippedNumber(anchor, typical)) continue;
      const reach = height(anchor) * 2.5;
      const tagLine = minBy(lines.filter((l) => l !== anchor && cy(l) > cy(anchor) && cy(l) - cy(anchor) < reach
        && l.right < anchor.left && /^\s*[\[(]/.test(l.text)), (l) => cy(l) - cy(anchor));
      const nameLine = minBy(lines.filter((l) => l !== anchor && l !== tagLine && cy(l) < cy(anchor) && cy(anchor) - cy(l) < reach
        && l.right < anchor.left && !/^\s*[\[(]/.test(l.text)
        && (tagLine ? Math.abs(l.left - tagLine.left) < image.w * 0.03 : l.left > image.w * 0.3)), (l) => cy(anchor) - cy(l));
      if (col && isClippedVsName(anchor, nameLine, tagLine, top, tagHeight, typical)) continue;
      const posLine = minBy(lines.filter((l) => isRankColumn(l, image) && isFullRankNumber(l, rankHeight)
        && Math.abs(cy(l) - cy(anchor)) < reach), (l) => Math.abs(cy(l) - cy(anchor)));
      const tag = tagLine ? (tagLine.text.match(/[\[(]\s*([^\])]+?)\s*[\])]/) || [])[1] || null : null;
      const boxLines = [anchor, tagLine, nameLine, posLine].filter(Boolean);
      rows.push({
        anchor_y: anchor.top,
        rank_position: posLine ? posLine.text.trim() : null,
        name: nameLine ? cleanName(nameLine.text) : '',
        alliance_tag: tag,
        points: parseInt(anchor.text.replace(/[^0-9]/g, ''), 10),
        confidence: { name: nameLine ? nameLine.score : null, points: anchor.score },
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

  // ─── Kills- und Spenden-Rangliste (Reiter in der Staerke-Rangliste) ────────────────────────────
  // Je Zeile Platz | Avatar | Schild | Name | Wert rechts, Name und Wert auf derselben Hoehe (anders als
  // bei VS, wo der Name ueber dem Wert steht). Kills sind oft achtstellig, ohne Trennzeichen. Unten ist
  // die eigene Zeile fest eingeblendet (echte Werte, doppelt egal). Spenden haben die Reiter
  // "Täglich" | "Wöchentlich", der gewaehlte ist hell hinterlegt.
  const VALUE_RE = /^[0-9]{1,3}(?:[.,\s][0-9]{3})+$|^[0-9]{1,12}$/;

  function valueInfo(lines, image, mode) {
    if (mode === 'kills') return { type: 'KILLS', day: null };
    const tabs = lines.filter((l) => /^t[äa]glich$|^w[öo]chentlich$/i.test(l.text.trim()));
    if (tabs.length < 2 || !image) return { type: 'DONATION_WEEK', day: null };
    const picked = maxBy(tabs, (l) => boxBrightness(image, l)).text.trim();
    return { type: /^t/i.test(picked) ? 'DONATION_DAY' : 'DONATION_WEEK', day: null };
  }

  function groupValueRows(lines, image) {
    const col = columnHeader(lines);
    const top = col ? col.header.bottom : 0;
    const anchors = lines.filter((l) => cy(l) > top && l.left > image.w * 0.6 && VALUE_RE.test(l.text.trim()));
    const typical = typicalHeight(anchors);
    const rankHeight = rankColumnHeight(lines, image);
    const rows = [];
    for (const anchor of anchors) {
      if (isClippedNumber(anchor, typical)) continue;
      const reach = height(anchor) * 1.2;
      const nameLine = minBy(lines.filter((l) => l !== anchor && Math.abs(cy(l) - cy(anchor)) < reach
        && l.right < anchor.left && l.left > image.w * 0.3 && !RANK_BADGE_RE.test(l.text.trim())),
      (l) => Math.abs(cy(l) - cy(anchor)));
      const posLine = minBy(lines.filter((l) => isRankColumn(l, image) && isFullRankNumber(l, rankHeight)
        && Math.abs(cy(l) - cy(anchor)) < height(anchor) * 2.5), (l) => Math.abs(cy(l) - cy(anchor)));
      // Am Bildrand angeschnittene Zeilen liefern keinen oder nur einen Rest-Namen ("3", "R", "K3") –
      // die Zeile ist in der Nachbar-Aufnahme vollstaendig.
      const name = nameLine ? cleanName(nameLine.text) : '';
      if (name.replace(/[^\p{L}\p{N}]/gu, '').length < 3) continue;
      const boxLines = [anchor, nameLine, posLine].filter(Boolean);
      rows.push({
        anchor_y: anchor.top,
        rank_position: posLine ? posLine.text.trim() : null,
        name,
        alliance_tag: null,
        points: parseInt(anchor.text.replace(/[^0-9]/g, ''), 10),
        confidence: { name: nameLine ? nameLine.score : null, points: anchor.score },
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

  // Platznummern, in deren Zeile gar keine Zahl erkannt wurde. Das ist fast immer eine einzelne "0", die die
  // Texterkennung nicht findet (Spieler ohne Punkte am Listenende). Die Zeile wurde also gesehen, nur ohne
  // Wert – das Cockpit meldet diese Plaetze nicht als uebersprungen. Angeschnittene Zeilen haben eine
  // (verworfene) Zahl und zaehlen hier nicht.
  function ranksWithoutValue(lines, image, valueRe) {
    const col = columnHeader(lines);
    const top = col ? col.header.bottom : 0;
    const values = lines.filter((l) => cy(l) > top && l.left > image.w * 0.6 && valueRe.test(l.text.trim()));
    const reach = typicalHeight(values) * 2.5;
    const rankHeight = rankColumnHeight(lines, image);
    return lines.filter((l) => cy(l) > top && isRankColumn(l, image) && isFullRankNumber(l, rankHeight) && !values.some((v) => Math.abs(cy(v) - cy(l)) < reach))
      .map((l) => l.text.trim());
  }

  // Erkannte Textzeile mit Position (gerundet) – fuer die gesammelten Aufnahmen zur Nacharbeit
  const rawLine = (l) => ({ text: l.text, score: Math.round(l.score * 1000) / 1000,
    left: Math.round(l.left), top: Math.round(l.top), right: Math.round(l.right), bottom: Math.round(l.bottom) });

  /** Equivalent of server.py's POST /process for one RGB frame ({ w, h, data }). */
  async function processFrame(engine, image) {
    engine.timings = {};
    const lines = await ocrLines(engine, image);
    const mode = detectMode(lines);
    if (mode === 'vs' || mode === 'kills' || mode === 'donation') {
      // VS, Kills und Spenden laufen als Wert-Kacheln (vs_rows + vs.type) durch Cockpit und Sync,
      // nie als Kampfkraft.
      return {
        width: image.w, height: image.h, mode,
        raw_lines: lines.map(rawLine),
        cards: [], rankings: [],
        vs: mode === 'vs' ? vsInfo(lines, image) : valueInfo(lines, image, mode),
        vs_rows: mode === 'vs' ? groupVsRows(lines, image) : groupValueRows(lines, image),
        ranks_without_value: ranksWithoutValue(lines, image, mode === 'vs' ? VS_POINTS_RE : VALUE_RE),
        rescued: false,
        timings: engine.timings,
      };
    }
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
      raw_lines: [...lines, ...rescue].map(rawLine),
      cards: mode === 'ranking' ? [] : rows,
      rankings: mode === 'ranking' ? rows : [],
      rescued, // the enlarged second pass ran (it dominates the frame time)
      timings: engine.timings,
    };
  }

  return { processFrame, ocrLines, detectMode, buildRows, needsRescue, shieldRescue, groupVsRows, vsInfo, groupValueRows, valueInfo, ranksWithoutValue };
});
