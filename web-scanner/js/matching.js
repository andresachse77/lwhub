/**
 * LWHub Scanner - Fuzzy Matcher & API Sync
 */

const MatchingEngine = {
  // Levenshtein Distanz
  levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      prev = cur;
    }
    return prev[n];
  },

  // Ähnlichkeit 0.0 bis 1.0
  similarity(s1, s2) {
    const longer = s1.length > s2.length ? s1 : s2;
    if (longer.length === 0) return 1.0;
    const dist = this.levenshtein(s1, s2);
    return (longer.length - dist) / longer.length;
  },

  // Name säubern (entfernt Sonderzeichen, Spaces, Groß-/Kleinschreibung)
  cleanName(str) {
    return (str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase();
  },

  /**
   * Findet das passendste Mitglied für eine erkannte Kachel.
   * @param {Object} card { name, power, level, ... }
   * @param {Array} members Liste von LWHub Mitgliedern
   * @returns {Object|null} { member, score, exact }
   */
  findMatch(card, members) {
    const cardClean = this.cleanName(card.name);
    if (cardClean.length < 2) return null;

    let bestMember = null;
    let bestScore = 0;
    let exact = false;

    for (const m of members) {
      const mClean = this.cleanName(m.name);
      
      // 1. Exakter Treffer auf Primärname
      if (mClean === cardClean) {
        return { member: m, score: 1.0, exact: true };
      }

      // 2. Prüfung auf bekannte Aliase
      if (Array.isArray(m.aliases)) {
        for (const alias of m.aliases) {
          if (this.cleanName(alias) === cardClean) {
            return { member: m, score: 1.0, exact: true };
          }
        }
      }

      // 3. Fuzzy Treffer berechnen
      const sim = this.similarity(cardClean, mClean);
      if (sim > bestScore) {
        bestScore = sim;
        bestMember = m;
      }
    }

    // Mindestschwelle 0.75 für automatische Erkennung
    if (bestScore >= 0.75 && bestMember) {
      return { member: bestMember, score: bestScore, exact: false };
    }

    return null;
  },

  /**
   * Holt die aktuelle Mitgliederliste von LWHub
   */
  async fetchLwHubMembers(apiUrl, alliance) {
    const url = `${apiUrl}/members?alliance=${encodeURIComponent(alliance)}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`Fehler beim Laden der Mitglieder (${resp.status}): ${await resp.text()}`);
    }
    const data = await resp.json();
    return data.map(m => ({
      id: m.id || m.player_id,
      name: m.name || m.current_name,
      rank: m.default_rank || m.current_rank_code || 3,
      current_power: m.current_power || null,
      hq_level: m.hq_level || null,
      discord_username: m.discord_username || null,
      discord_avatar_url: m.discord_avatar_url || null,
      aliases: m.aliases || []
    }));
  },

  /**
   * Sendet die gematchten Daten atomar an den Batch-Sync-Endpunkt
   */
  async syncToLwHub(apiUrl, alliance, assignedPairs, newPlayers, archivePlayerIds = []) {
    const entries = [];

    // 1. Zugeordnete Spieler (können mehrere Kacheln haben, z. B. Power + HQ)
    for (const [memberId, data] of assignedPairs.entries()) {
      const tiles = data.tiles || (data.card ? [data] : []);
      let bestPower = null;
      let bestLevel = null;
      let statuses = [];
      let bestConfidence = 1.0;

      for (const t of tiles) {
        const c = t.card || t;
        if (c.power && (!bestPower || String(c.power).length >= String(bestPower).length)) {
          bestPower = c.power;
        }
        if (c.level && !bestLevel) {
          bestLevel = c.level;
        }
        if (c.status && !statuses.includes(c.status)) {
          statuses.push(c.status);
        }
        if (c.confidence && typeof c.confidence === 'object' && c.confidence.name) {
          bestConfidence = Math.max(bestConfidence, c.confidence.name);
        }
      }

      entries.push({
        name: data.member.name,
        player_id: memberId,
        power_str: bestPower,
        level_str: bestLevel,
        status: statuses.join(' • ') || null,
        confidence: bestConfidence
      });
    }

    // 2. Neu angelegte Spieler (können ebenfalls mehrere Kacheln haben)
    for (const item of newPlayers) {
      const tiles = item.tiles || (item.card ? [item] : []);
      let bestPower = null;
      let bestLevel = null;
      let statuses = [];
      let bestConfidence = 0.8;
      const playerName = item.name || tiles[0]?.card?.name || '(Neuer Spieler)';

      for (const t of tiles) {
        const c = t.card || t;
        if (c.power && (!bestPower || String(c.power).length >= String(bestPower).length)) {
          bestPower = c.power;
        }
        if (c.level && !bestLevel) {
          bestLevel = c.level;
        }
        if (c.status && !statuses.includes(c.status)) {
          statuses.push(c.status);
        }
      }

      entries.push({
        name: playerName,
        is_new: true,
        power_str: bestPower,
        level_str: bestLevel,
        status: statuses.join(' • ') || null,
        confidence: bestConfidence
      });
    }

    const payload = {
      alliance: alliance,
      source: 'desktop_web_scanner',
      recorded_at: new Date().toISOString(),
      entries: entries,
      archive_player_ids: archivePlayerIds
    };

    console.log('Synchronisiere mit LWHub:', payload);
    const resp = await fetch(`${apiUrl}/scans/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const responseText = await resp.text();
    let resData;
    try {
      resData = JSON.parse(responseText);
    } catch {
      throw new Error(`Ungültige Serverantwort (${resp.status}): ${responseText.slice(0, 500)}`);
    }
    if (!resp.ok) {
      throw new Error(`Serverfehler (${resp.status}): ${resData.error || responseText}`);
    }

    return { ok: true, count: entries.length, summary: resData.summary };
  }
};

window.MatchingEngine = MatchingEngine;
