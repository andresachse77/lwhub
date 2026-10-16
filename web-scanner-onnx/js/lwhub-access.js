/*
 * Gemeinsamer Zugang fuer Scanner und Kampfkraft-Trend: uebernimmt den lwhub-Login (Discord-Token im
 * localStorage der Hauptseite, gleiche Domain) und laesst den Server pruefen, ob der Nutzer R4/R5 der
 * Allianz oder Site-Admin ist (GET /scans/access, api/src/caller-auth.php).
 *
 * Erwartet im Seiten-HTML: #accessGate, #accessGateTitle, #accessGateText, #accessGateLogin,
 * #accessGateRetry und #userBadge.
 */
const LwhubAccess = {
  /** Same-origin-API zuerst (lwhub.de bzw. lokaler PHP-Router), dann die bekannten Ausweichadressen. */
  apiCandidates() {
    return [...new Set([
      ...(location.protocol.startsWith('http') ? [`${location.origin}/api`] : []),
      'http://127.0.0.1:8080/api',
      'https://lwhub.de/api',
    ])];
  },

  readStorageJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; }
  },

  discordToken() {
    try { return localStorage.getItem('discord_token') || null; } catch (_) { return null; }
  },

  authHeaders() {
    const token = this.discordToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  },

  /** Allianz des aktiven Chars aus lwhub als Vorauswahl. */
  preferredAlliance(fallback = 'NxU1') {
    const auth = this.readStorageJson('iny_auth_state_v1');
    const activeChar = this.readStorageJson('iny_active_char_v1');
    return activeChar?.alliance || auth?.active_alliance || auth?.alliance || fallback;
  },

  /** Erste erreichbare API samt Allianzliste: { apiUrl, alliances } (apiUrl = letzter Kandidat, falls keiner antwortet). */
  async findApi() {
    const candidates = this.apiCandidates();
    for (const candidate of candidates) {
      try {
        const resp = await fetch(`${candidate}/alliances`, { signal: AbortSignal.timeout(2000) });
        if (!resp.ok) continue;
        const data = await resp.json();
        if (data.ok && Array.isArray(data.alliances) && data.alliances.length > 0) {
          return { apiUrl: candidate, alliances: data.alliances };
        }
      } catch (_) {}
    }
    return { apiUrl: candidates[0], alliances: [] };
  },

  fillAllianceSelect(select, alliances, preferred) {
    if (!alliances.length) return;
    select.innerHTML = '';
    for (const a of alliances) {
      const opt = document.createElement('option');
      opt.value = a.short_name;
      opt.textContent = `${a.short_name}${a.title ? ' – ' + a.title : ''}`;
      if (a.short_name === preferred) opt.selected = true;
      select.appendChild(opt);
    }
  },

  /**
   * Fragt den Server, ob der angemeldete Nutzer fuer `alliance` freigeschaltet ist, und zeigt die Sperre
   * bzw. das Nutzer-Badge an. `what` benennt das Werkzeug in den Texten ("Der Scanner", "Der Trend").
   * Liefert die Antwort des Servers ({ ok, name, rank, site_admin }) oder null.
   */
  async check(apiUrl, alliance, what = 'Der Scanner') {
    // Auch ohne Token fragen: der lokale PHP-Server (lwhub-Vorschau) laesst lokale Aufrufe durch,
    // live antwortet der Server ohne Token mit 401 und die Seite zeigt die Anmeldung.
    let resp, data = {};
    try {
      resp = await fetch(`${apiUrl}/scans/access?alliance=${encodeURIComponent(alliance)}`, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(10000),
      });
      data = await resp.json().catch(() => ({}));
    } catch (err) {
      this.showGate('Zugang konnte nicht geprüft werden', `Die lwhub-API ist nicht erreichbar (${err.message}).`, { retry: true });
      return null;
    }
    if (resp.status === 401) {
      this.showGate('Anmeldung abgelaufen', 'Deine Discord-Anmeldung ist nicht mehr gültig. Melde dich in lwhub neu an und öffne die Seite danach erneut.', { login: true, retry: true });
      return null;
    }
    if (!resp.ok || !data.ok) {
      this.showGate('Kein Zugriff', data.error || `${what} ist nur für R4 und R5 der Allianz ${alliance}.`, { retry: true });
      return null;
    }
    document.getElementById('accessGate').hidden = true;
    const badge = document.getElementById('userBadge');
    badge.hidden = false;
    badge.className = 'badge-stat success';
    badge.textContent = data.site_admin ? '🛡️ Site-Admin' : `🛡️ ${data.name || 'Angemeldet'} · R${data.rank}`;
    return data;
  },

  showGate(title, text, { login = false, retry = false } = {}) {
    document.getElementById('accessGate').hidden = false;
    document.getElementById('accessGateTitle').textContent = title;
    document.getElementById('accessGateText').textContent = text;
    document.getElementById('accessGateLogin').hidden = !login;
    document.getElementById('accessGateRetry').hidden = !retry;
    document.getElementById('userBadge').hidden = true;
  },
};
