/**
 * LWHub Scanner - Drag & Drop State Engine
 * Verwaltet den Status der Zuweisungen, Multi-Kacheln pro Mitglied,
 * Stacking, permanente Kachel-Pools und stabile Listen-Sortierung.
 */

class CockpitState {
  constructor() {
    this.members = []; // Alle aus LWHub geladenen Mitglieder
    // memberId -> { member, tiles: [ { id, card, canvas, seenCount, score, manual } ] }
    this.assigned = new Map();
    this.unclearCards = []; // Unzugeordnete Kacheln { id, card, canvas, seenCount }
    // [ { id, name, tiles: [ { id, card, canvas, seenCount, manual } ] } ]
    this.newPlayers = [];
    this.scannedCardsPool = []; // Permanenter Pool aller Roh-Kacheln der Session { id, card, canvas, seenCount }
    this.markedForArchive = new Set(); // memberId's, die beim Sync archiviert werden sollen
    this.archiveSuggestionDismissed = false;
    
    // Filter & Sortierung
    this.filterMode = 'all'; // 'all' | 'unassigned' | 'assigned' | 'archive'
    this.sortMode = 'rank_name'; // 'rank_name' | 'name_asc' | 'name_desc'
    this.searchQuery = '';

    this.cardIdCounter = 0;
    this.tileIdCounter = 0;
    this.poolIdCounter = 0;
    this.newPlayerCounter = 0;
  }

  setMembers(membersList) {
    this.members = [...membersList];
    this.sortMembers();
    this.markedForArchive.clear();
    this.archiveSuggestionDismissed = false;

    // Wenn schon Kacheln im Pool sind: Automatisch gegen die neuen Mitglieder abgleichen!
    if (this.scannedCardsPool.length > 0) {
      this.rematchAll();
    } else {
      this.assigned.clear();
      this.render();
    }
  }

  setSortMode(mode) {
    this.sortMode = mode;
    this.sortMembers();
    this.render();
  }

  setFilterMode(filter) {
    this.filterMode = filter;
    this.render();
  }

  setSearchQuery(query) {
    this.searchQuery = (query || '').toLowerCase().trim();
    this.render();
  }

  sortMembers() {
    this.members.sort((a, b) => {
      if (this.sortMode === 'rank_name') {
        const rA = Number(a.rank || a.current_rank_code || 3);
        const rB = Number(b.rank || b.current_rank_code || 3);
        if (rB !== rA) return rB - rA;
        return a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
      } else if (this.sortMode === 'name_desc') {
        return b.name.localeCompare(a.name, 'de', { sensitivity: 'base' });
      } else {
        return a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
      }
    });
  }

  // Führt einen kompletten Neu-Abgleich aller bisher gescannten Kacheln durch
  rematchAll() {
    const poolSnapshot = this.scannedCardsPool.map(item => ({
      id: item.id,
      card: { ...item.card },
      canvas: item.canvas,
      seenCount: item.seenCount || 1
    }));

    this.assigned.clear();
    this.unclearCards = [];
    this.newPlayers = [];
    this.markedForArchive.clear();

    for (const item of poolSnapshot) {
      this.addScannedCard(item.card, item.canvas, item.seenCount, false, item.id);
    }

    this.render();
    console.log(`Rematch durchgeführt für ${poolSnapshot.length} Kacheln gegen ${this.members.length} Mitglieder.`);
  }

  // Setzt die gesamte Scan-Session zurück
  resetAllScans() {
    this.scannedCardsPool = [];
    this.assigned.clear();
    this.unclearCards = [];
    this.newPlayers = [];
    this.markedForArchive.clear();
    this.archiveSuggestionDismissed = false;
    this.render();
  }

  // Ermittelt aggregierte Werte über alle Kacheln eines Mitglieds (z. B. Power + HQ + Rang)
  getAggregatedData(tiles) {
    let bestPower = null;
    let bestLevel = null;
    let statuses = [];
    let bestConfidence = 1.0;
    const vs = {};

    for (const t of tiles) {
      const c = t.card || t;
      if (c.vs) {
        const k = this.vsKey(c);
        if (!vs[k] || c.vs.points > vs[k].points) vs[k] = c.vs;
      }
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

    return {
      power: bestPower,
      level: bestLevel,
      status: statuses.join(' • ') || null,
      confidence: bestConfidence,
      vs: Object.values(vs),
      count: tiles.length
    };
  }

  // VS-Kacheln (Allianz-Duell) sind eine eigene Kachelart je Tag bzw. Woche – nie mit Kampfkraft vermischt.
  vsKey(card) {
    return card && card.vs ? `${card.vs.type}:${card.vs.day || ''}` : null;
  }

  // Beim Stapeln gleicher VS-Kacheln zaehlt der hoechste Wert (VS-Punkte steigen im Tagesverlauf nur).
  mergeVs(target, card) {
    if (target && target.vs && card.vs && card.vs.points > target.vs.points) target.vs = { ...target.vs, points: card.vs.points };
  }

  // Kachelart-Vergleich: gleiche Kampfkraft, gleiches HQ-Level oder (wenn beide wertlos) gleicher Status.
  // Wird für Kacheln ohne Namen genutzt, wo der Name als Stacking-Schlüssel fehlt.
  sameTileType(a, b) {
    if (a.vs || b.vs) return this.vsKey(a) === this.vsKey(b);
    if (a.power && b.power) return a.power === b.power;
    if (a.level && b.level) return a.level === b.level;
    if (!a.power && !b.power && !a.level && !b.level) {
      return (a.status || '') === (b.status || '');
    }
    return false;
  }

  // Fügt eine neue Scan-Kachel hinzu (vom OCR Engine oder Re-Match) mit Multi-Kachel- & Stacking-Logik
  // poolId: Pool-Eintrag, aus dem die Kachel stammt (beim Rematch); sonst wird er hier ermittelt.
  addScannedCard(card, canvas, incomingCount = 1, addToPool = true, poolId = null) {
    const cardClean = window.MatchingEngine.cleanName(card.name);

    // 1. In den permanenten Session-Pool aufnehmen bzw. stacken
    if (addToPool) {
      let poolItem = this.scannedCardsPool.find(p => {
        const pClean = window.MatchingEngine.cleanName(p.card.name);
        // Kacheln ohne Name stacken rein über die Kachelart (Power/HQ/Status)
        if (cardClean.length < 2 || pClean.length < 2) {
          return cardClean.length < 2 && pClean.length < 2 && this.sameTileType(card, p.card);
        }
        if (pClean !== cardClean) return false;
        if (card.vs || p.card.vs) return this.vsKey(card) === this.vsKey(p.card);
        // Gleiche Kachelart im Pool stacken
        if (card.power && p.card.power && card.power === p.card.power) return true;
        if (card.level && p.card.level && card.level === p.card.level) return true;
        if (!card.power && !p.card.power && !card.level && !p.card.level) return true;
        return false;
      });

      if (poolItem) {
        poolItem.seenCount = (poolItem.seenCount || 1) + incomingCount;
        if (!poolItem.card.power && card.power) poolItem.card.power = card.power;
        if (!poolItem.card.level && card.level) poolItem.card.level = card.level;
        if (!poolItem.card.rank_code && card.rank_code) poolItem.card.rank_code = card.rank_code;
        this.mergeVs(poolItem.card, card);
        poolId = poolItem.id;
      } else {
        poolId = 'pool_' + (++this.poolIdCounter);
        this.scannedCardsPool.push({
          id: poolId,
          card: { ...card },
          canvas: canvas,
          seenCount: incomingCount
        });
      }
    }

    // 2. AUTOMATISCHEN MATCH GEGEN DIE MITGLIEDERLISTE PRÜFEN
    const match = window.MatchingEngine.findMatch(card, this.members);

    if (match) {
      const memberId = match.member.id;
      const tileObj = {
        id: 'tile_' + (++this.tileIdCounter),
        card: { ...card },
        canvas: canvas,
        seenCount: incomingCount,
        score: match.score,
        exact: match.exact,
        byPower: !!match.byPower,
        manual: false,
        poolIds: new Set(poolId ? [poolId] : [])
      };

      if (!this.assigned.has(memberId)) {
        // Erstes Kachel für dieses Mitglied
        this.assigned.set(memberId, {
          member: match.member,
          tiles: [tileObj]
        });
        this.markedForArchive.delete(memberId);
        this.render();
        return { status: 'auto_assigned', member: match.member, tile: tileObj };
      } else {
        // Mitglied hat bereits Kacheln: Prüfen ob Duplikat (Stacking) oder zusätzliche Kachel (z. B. HQ)!
        const entry = this.assigned.get(memberId);
        let duplicateTile = entry.tiles.find(t => {
          if (card.vs || t.card.vs) return this.vsKey(card) === this.vsKey(t.card);
          // Gleiche Kampfkraft
          if (card.power && t.card.power && card.power === t.card.power) return true;
          // Gleiches HQ-Level bei gleicher Kachelart
          if (card.level && t.card.level && card.level === t.card.level) return true;
          // Gleicher Status
          if (card.status && t.card.status && card.status === t.card.status) return true;
          return false;
        });

        if (duplicateTile) {
          // Identische Kachelart -> STACKEN!
          duplicateTile.seenCount = (duplicateTile.seenCount || 1) + incomingCount;
          if (!duplicateTile.card.power && card.power) duplicateTile.card.power = card.power;
          if (!duplicateTile.card.level && card.level) duplicateTile.card.level = card.level;
          if (!duplicateTile.card.rank_code && card.rank_code) duplicateTile.card.rank_code = card.rank_code;
          this.mergeVs(duplicateTile.card, card);
          if (poolId) (duplicateTile.poolIds ||= new Set()).add(poolId);
          this.render();
          return { status: 'stacked_tile', member: match.member, tile: duplicateTile };
        } else {
          // Zusätzliche Kachel (z. B. eine für Kampfkraft, eine für HQ)!
          entry.tiles.push(tileObj);
          this.render();
          return { status: 'additional_tile', member: match.member, tile: tileObj };
        }
      }
    }

    // 3. PRÜFUNG GEGEN NEUE SPIELER
    let existingNewPlayer = this.newPlayers.find(np => {
      const npClean = window.MatchingEngine.cleanName(np.name);
      return cardClean.length >= 2 && npClean === cardClean;
    });

    if (existingNewPlayer) {
      let duplicateTile = existingNewPlayer.tiles.find(t => {
        if (card.vs || t.card.vs) return this.vsKey(card) === this.vsKey(t.card);
        if (card.power && t.card.power && card.power === t.card.power) return true;
        if (card.level && t.card.level && card.level === t.card.level) return true;
        return false;
      });

      if (duplicateTile) {
        duplicateTile.seenCount = (duplicateTile.seenCount || 1) + incomingCount;
        if (!duplicateTile.card.power && card.power) duplicateTile.card.power = card.power;
        if (!duplicateTile.card.level && card.level) duplicateTile.card.level = card.level;
        if (!duplicateTile.card.rank_code && card.rank_code) duplicateTile.card.rank_code = card.rank_code;
        this.mergeVs(duplicateTile.card, card);
      } else {
        existingNewPlayer.tiles.push({
          id: 'tile_' + (++this.tileIdCounter),
          card: { ...card },
          canvas: canvas,
          seenCount: incomingCount
        });
      }
      this.render();
      return { status: 'new_player_updated', player: existingNewPlayer };
    }

    // 4. STACKING-CHECK IM UNKLAR-TRAY: Gibt es bereits eine sehr ähnliche unklare Kachel?
    let existingUnclear = this.unclearCards.find(item => {
      const itemClean = window.MatchingEngine.cleanName(item.card.name);
      // "(kein Name)"-Kacheln: kein Name als Schlüssel -> über die Kachelart stacken
      if (cardClean.length < 2 || itemClean.length < 2) {
        return cardClean.length < 2 && itemClean.length < 2 && this.sameTileType(card, item.card);
      }
      if (this.vsKey(card) !== this.vsKey(item.card)) return false;
      if (cardClean === itemClean) return true;
      if (window.MatchingEngine.similarity(cardClean, itemClean) >= 0.88) return true;
      return false;
    });

    if (existingUnclear) {
      // Duplikat im Unklar-Tray -> STACKEN statt neuer Kachel!
      existingUnclear.seenCount = (existingUnclear.seenCount || 1) + incomingCount;
      if (poolId) existingUnclear.poolIds.add(poolId);
      this.mergeVs(existingUnclear.card, card);
      if (!existingUnclear.card.power && card.power) existingUnclear.card.power = card.power;
      if (!existingUnclear.card.level && card.level) existingUnclear.card.level = card.level;
      this.render();
      return { status: 'stacked_unclear', card: existingUnclear };
    }

    // 5. Kacheln ohne lesbaren Namen, die auch über die Kampfkraft keinem Mitglied eindeutig zuzuordnen
    //    sind, taugen nicht zum Zuordnen: nicht anzeigen. Sie bleiben im Pool – ein Rematch gegen eine
    //    andere Mitgliederliste kann sie noch per Kampfkraft zuordnen.
    if (cardClean.length < 2) {
      return { status: 'dropped_nameless' };
    }

    // 6. Neuer Eintrag in den Unklar-Tray
    const cardId = 'card_' + (++this.cardIdCounter);
    const cardObj = { id: cardId, card, canvas, seenCount: incomingCount, poolIds: new Set(poolId ? [poolId] : []) };
    this.unclearCards.unshift(cardObj);
    this.render();
    return { status: 'unclear' };
  }

  // Zuweisung manuell per Drag & Drop herstellen (fügt Kachel zum Mitglied hinzu)
  assignCardToMember(cardId, memberId) {
    let cardIdx = this.unclearCards.findIndex(c => c.id === cardId);
    let cardObj = null;

    if (cardIdx !== -1) {
      cardObj = this.unclearCards.splice(cardIdx, 1)[0];
    } else {
      // Evtl. aus einem neuen Spieler herausziehen
      for (const np of this.newPlayers) {
        const tIdx = np.tiles.findIndex(t => t.id === cardId);
        if (tIdx !== -1) {
          cardObj = np.tiles.splice(tIdx, 1)[0];
          break;
        }
      }
      this.newPlayers = this.newPlayers.filter(np => np.tiles.length > 0);
    }

    if (!cardObj) return;

    const member = this.members.find(m => m.id === memberId);
    if (!member) return;

    this.markedForArchive.delete(memberId);

    const tileObj = {
      id: cardObj.id || ('tile_' + (++this.tileIdCounter)),
      card: cardObj.card,
      canvas: cardObj.canvas,
      seenCount: cardObj.seenCount || 1,
      score: 1.0,
      manual: true,
      poolIds: cardObj.poolIds
    };

    if (!this.assigned.has(memberId)) {
      this.assigned.set(memberId, {
        member: member,
        tiles: [tileObj]
      });
    } else {
      const entry = this.assigned.get(memberId);
      entry.tiles.push(tileObj);
    }

    this.render();
  }

  // Kachel als neuen Spieler vormerken (oder zu bestehendem neuen Spieler hinzufügen)
  assignCardAsNewPlayer(cardId, targetNewPlayerId = null) {
    let cardIdx = this.unclearCards.findIndex(c => c.id === cardId);
    if (cardIdx === -1) return;
    const cardObj = this.unclearCards.splice(cardIdx, 1)[0];

    const tileObj = {
      id: cardObj.id,
      card: cardObj.card,
      canvas: cardObj.canvas,
      seenCount: cardObj.seenCount || 1,
      manual: true,
      poolIds: cardObj.poolIds
    };

    if (targetNewPlayerId) {
      const existing = this.newPlayers.find(p => p.id === targetNewPlayerId);
      if (existing) {
        existing.tiles.push(tileObj);
        this.render();
        return;
      }
    }

    this.newPlayers.push({
      id: 'new_player_' + (++this.newPlayerCounter),
      name: cardObj.card.name || '(Neuer Spieler)',
      tiles: [tileObj]
    });

    this.render();
  }

  // Kachel aus dem Unklar-Tray endgültig verwerfen – auch aus dem Pool, damit ein Rematch sie nicht zurückholt
  deleteUnclearCard(cardId) {
    const idx = this.unclearCards.findIndex(c => c.id === cardId);
    if (idx === -1) return;
    const [removed] = this.unclearCards.splice(idx, 1);
    if (removed.poolIds && removed.poolIds.size) {
      this.scannedCardsPool = this.scannedCardsPool.filter(p => !removed.poolIds.has(p.id));
    }
    this.render();
  }

  // Einzelne Kachel von einem Mitglied lösen
  detachTile(memberId, tileId) {
    if (!this.assigned.has(memberId)) return;
    const entry = this.assigned.get(memberId);
    const tIdx = entry.tiles.findIndex(t => t.id === tileId);
    if (tIdx === -1) return;

    const removed = entry.tiles.splice(tIdx, 1)[0];
    this.unclearCards.unshift({
      id: 'card_' + (++this.cardIdCounter),
      card: removed.card,
      canvas: removed.canvas,
      seenCount: removed.seenCount || 1,
      poolIds: new Set(removed.poolIds || [])
    });

    if (entry.tiles.length === 0) {
      this.assigned.delete(memberId);
    }

    this.render();
  }

  // Einzelne Kachel von einem neuen Spieler lösen
  detachNewPlayerTile(newPlayerId, tileId) {
    const np = this.newPlayers.find(p => p.id === newPlayerId);
    if (!np) return;
    const tIdx = np.tiles.findIndex(t => t.id === tileId);
    if (tIdx === -1) return;

    const removed = np.tiles.splice(tIdx, 1)[0];
    this.unclearCards.unshift({
      id: 'card_' + (++this.cardIdCounter),
      card: removed.card,
      canvas: removed.canvas,
      seenCount: removed.seenCount || 1,
      poolIds: new Set(removed.poolIds || [])
    });

    if (np.tiles.length === 0) {
      this.newPlayers = this.newPlayers.filter(p => p.id !== newPlayerId);
    }

    this.render();
  }

  // Mitglied für Archivierung vormerken / umschalten
  toggleArchiveMember(memberId) {
    if (this.markedForArchive.has(memberId)) {
      this.markedForArchive.delete(memberId);
    } else {
      if (this.assigned.has(memberId)) {
        // Alle Kacheln zurück in den Unklar-Tray
        const entry = this.assigned.get(memberId);
        for (const t of entry.tiles) {
          this.unclearCards.unshift({
            id: 'card_' + (++this.cardIdCounter),
            card: t.card,
            canvas: t.canvas,
            seenCount: t.seenCount || 1,
            poolIds: new Set(t.poolIds || [])
          });
        }
        this.assigned.delete(memberId);
      }
      this.markedForArchive.add(memberId);
    }
    this.render();
  }

  // Alle nicht im Scan gefundenen Mitglieder vormerken
  archiveAllUnassigned() {
    const unassignedList = this.members.filter(m => !this.assigned.has(m.id));
    for (const m of unassignedList) {
      this.markedForArchive.add(m.id);
    }
    this.render();
  }

  clearArchiveMarks() {
    this.markedForArchive.clear();
    this.render();
  }

  dismissArchiveSuggestion() {
    this.archiveSuggestionDismissed = true;
    this.render();
  }

  // Rendert die linke und rechte Senke komplett neu
  render() {
    this.renderLeftPane();
    this.renderRightTray();
    this.updateStats();
  }

  updateStats() {
    const total = this.members.length;
    const assignedCount = this.assigned.size;
    const unassignedCount = total - assignedCount;
    const archiveCount = this.markedForArchive.size;

    const statEl = document.getElementById('statErfasst');
    if (statEl) {
      statEl.textContent = `${assignedCount} / ${total} Erfasst`;
      statEl.className = assignedCount === total && total > 0 ? 'badge-stat success' : 'badge-stat warning';
    }

    const poolCountEl = document.getElementById('statPoolCount');
    if (poolCountEl) {
      poolCountEl.textContent = `${this.scannedCardsPool.length} Kacheln im Pool`;
    }

    // Filter-Pill Zähler aktualisieren
    const pillAll = document.getElementById('countPillAll');
    if (pillAll) pillAll.textContent = total;
    const pillUnassigned = document.getElementById('countPillUnassigned');
    if (pillUnassigned) pillUnassigned.textContent = unassignedCount;
    const pillAssigned = document.getElementById('countPillAssigned');
    if (pillAssigned) pillAssigned.textContent = assignedCount;
    const pillArchive = document.getElementById('countPillArchive');
    if (pillArchive) pillArchive.textContent = archiveCount;
  }

  renderLeftPane() {
    const unifiedListContainer = document.getElementById('unifiedMembersList');
    const newPlayersContainer = document.getElementById('newPlayersList');
    const bannerContainer = document.getElementById('archiveSuggestionContainer');

    if (!unifiedListContainer) return;
    unifiedListContainer.innerHTML = '';
    if (newPlayersContainer) newPlayersContainer.innerHTML = '';

    // 1. Vorgemerkte neue Spieler (Drop-Zone ganz oben)
    if (newPlayersContainer) {
      for (const item of this.newPlayers) {
        const row = document.createElement('div');
        row.className = 'member-row assigned';
        row.style.borderColor = 'var(--purple, #a371f7)';

        const agg = this.getAggregatedData(item.tiles);

        const info = document.createElement('div');
        info.className = 'member-info';
        info.innerHTML = `
          <div class="member-name" style="color: var(--purple, #a371f7);">
            <span>➕ ${this.escapeHtml(item.name)}</span>
            <span class="badge-tag">${item.tiles.length} Kachel(n)</span>
          </div>
          <div class="member-sub">
            Neuer Spieler &bull; Scan: <strong>${agg.power ? this.powerLabel(agg.power) : '—'}</strong> &bull; HQ ${agg.level || '?'}
          </div>
        `;

        const tilesArea = document.createElement('div');
        tilesArea.className = 'member-tiles-area';

        const chipsList = document.createElement('div');
        chipsList.className = 'tiles-chips-list';

        for (const t of item.tiles) {
          const chip = document.createElement('div');
          chip.className = 'matched-card-chip';

          const stackBadge = (t.seenCount > 1) ? `<span class="badge-stack">x${t.seenCount}</span>` : '';

          // Wichtig: innerHTML zuerst setzen, Canvas danach anhängen.
          // Ein "innerHTML +=" NACH dem Canvas würde den Canvas-Inhalt zerstören
          // (Canvas-Pixel werden bei der HTML-Serialisierung nicht erhalten -> schwarz).
          chip.innerHTML = `
            <div class="matched-details">
              <span class="matched-power">${this.tileValueLabel(t.card, '—')} ${stackBadge}</span>
              <span class="member-sub">${this.escapeHtml(t.card.status || '')}</span>
            </div>
            <button class="btn-detach" title="Diese Kachel lösen" onclick="window.cockpit.detachNewPlayerTile('${item.id}', '${t.id}')">✕</button>
          `;
          chip.prepend(this.cloneCanvas(t.canvas));
          chipsList.appendChild(chip);
        }

        // Drop-Slot für weitere Kacheln
        const plusSlot = document.createElement('div');
        plusSlot.className = 'member-drop-slot compact';
        plusSlot.title = 'Weitere Kachel (z. B. HQ) auf diesen neuen Spieler ziehen';
        plusSlot.textContent = '➕ Kachel';
        this.attachDropHandlers(plusSlot, (cardId) => {
          this.assignCardAsNewPlayer(cardId, item.id);
        });

        tilesArea.appendChild(chipsList);
        tilesArea.appendChild(plusSlot);

        row.appendChild(info);
        row.appendChild(tilesArea);
        newPlayersContainer.appendChild(row);
      }
    }

    // 2. Archivierungs-Vorschlags-Banner rendern
    if (bannerContainer) {
      bannerContainer.innerHTML = '';
      const hasScans = this.assigned.size > 0 || this.scannedCardsPool.length > 0;
      const unassignedCount = this.members.filter(m => !this.assigned.has(m.id)).length;
      const markedCount = this.markedForArchive.size;

      if (!this.archiveSuggestionDismissed && hasScans && unassignedCount > 0) {
        const banner = document.createElement('div');
        banner.className = 'archive-suggestion-banner';
        banner.innerHTML = `
          <div class="banner-content">
            <div class="banner-title">
              <span>📦</span> <strong>${unassignedCount} Mitglied(er) nicht im Scan gefunden</strong>
            </div>
            <div class="banner-desc">
              Spieler, die die Allianz verlassen haben, können hier direkt zur Archivierung vorgemerkt werden.
            </div>
          </div>
          <div class="banner-actions">
            ${markedCount < unassignedCount ? `
              <button class="btn btn-sm btn-danger" onclick="window.cockpit.archiveAllUnassigned()">
                📦 Alle ${unassignedCount} archivieren
              </button>
            ` : `
              <button class="btn btn-sm btn-secondary" onclick="window.cockpit.clearArchiveMarks()">
                ↩ Markierungen aufheben (${markedCount})
              </button>
            `}
            <button class="btn btn-sm btn-secondary" onclick="window.cockpit.dismissArchiveSuggestion()" title="Banner ausblenden">✕</button>
          </div>
        `;
        bannerContainer.appendChild(banner);
      }
    }

    // 3. FÜHRENDE BASIS-MITGLIEDERLISTE IN STABILER SORTIERUNG
    let visibleMembers = this.members.filter(m => {
      const isAssigned = this.assigned.has(m.id);
      const isMarked = this.markedForArchive.has(m.id);

      // Filter-Pills
      if (this.filterMode === 'unassigned' && isAssigned) return false;
      if (this.filterMode === 'assigned' && !isAssigned) return false;
      if (this.filterMode === 'archive' && !isMarked) return false;

      // Such-Filter
      if (this.searchQuery !== '') {
        const nameMatch = m.name.toLowerCase().includes(this.searchQuery);
        const aliasMatch = Array.isArray(m.aliases) && m.aliases.some(a => a.toLowerCase().includes(this.searchQuery));
        if (!nameMatch && !aliasMatch) return false;
      }

      return true;
    });

    if (visibleMembers.length === 0) {
      unifiedListContainer.innerHTML = `
        <div style="color: var(--text-dim); text-align: center; padding: 24px; font-size: 13px;">
          Keine Mitglieder für den aktuellen Filter gefunden.
        </div>
      `;
      return;
    }

    for (const m of visibleMembers) {
      const isAssigned = this.assigned.has(m.id);
      const isMarked = this.markedForArchive.has(m.id);
      const assignedData = this.assigned.get(m.id);

      const row = document.createElement('div');
      row.className = `member-row ${isAssigned ? 'assigned' : 'unassigned'} ${isMarked ? 'marked-archive' : ''}`;
      row.dataset.memberId = m.id;

      // Info-Bereich links
      const info = document.createElement('div');
      info.className = 'member-info';

      const prevPowerStr = this.powerLabel(m.current_power) || '—';
      const prevHqStr = m.hq_level ? `HQ ${m.hq_level}` : '';
      const prevDetails = `LWHub: ${prevPowerStr} ${prevHqStr ? '&bull; ' + prevHqStr : ''}`;

      let scanSummaryHtml = '';
      if (isAssigned && assignedData.tiles.length > 0) {
        const agg = this.getAggregatedData(assignedData.tiles);
        // Ein Wert je Zeile: mit Kills und Spenden werden es schnell sechs Werte, in einer Zeile unlesbar
        const vsIcon = (v) => v.type === 'KILLS' ? '⚔️' : /^DONATION/.test(v.type) ? '🎁' : '🏆';
        const parts = [];
        if (agg.power) parts.push(`⚡ <strong>${this.powerLabel(agg.power)}</strong>`);
        for (const v of agg.vs) parts.push(`${vsIcon(v)} <strong>${this.vsLabel(v)}</strong>`);
        if (agg.level) parts.push(`🏰 <strong>HQ ${agg.level}</strong>`);
        if (agg.status) parts.push(`🏷️ ${this.escapeHtml(agg.status)}`);
        scanSummaryHtml = `
          <div class="scan-summary-tag" title="Zusammengeführte Scandaten aus ${agg.count} Kachel(n)">
            ${parts.map((p) => `<span class="scan-summary-item">${p}</span>`).join('')}
            <span class="badge-tag">${agg.count} Kachel(n)</span>
          </div>
        `;
      }

      info.innerHTML = `
        <div class="member-name">
          <span class="rank-badge r${m.rank}">R${m.rank}</span>
          <span class="${isMarked ? 'strikethrough' : ''}">${this.escapeHtml(m.name)}</span>
          ${isMarked ? '<span class="badge-archive-tag">Wird archiviert</span>' : ''}
          ${isAssigned ? '<span class="badge-assigned-tag">✓ Erfasst</span>' : ''}
        </div>
        <div class="member-sub">${prevDetails}</div>
        ${scanSummaryHtml}
      `;

      // Kacheln- / Aktionen-Bereich rechts
      const tilesArea = document.createElement('div');
      tilesArea.className = 'member-tiles-area';

      if (isAssigned) {
        // Gepaarte Kacheln anzeigen
        const chipsList = document.createElement('div');
        chipsList.className = 'tiles-chips-list';

        for (const t of assignedData.tiles) {
          const chip = document.createElement('div');
          chip.className = 'matched-card-chip';

          const stackBadge = (t.seenCount > 1) ? `<span class="badge-stack" title="${t.seenCount}x im Scan erfasst">x${t.seenCount}</span>` : '';

          let tileLabel = this.tileValueLabel(t.card, 'Kachel');
          if (t.byPower) tileLabel += ' <span class="badge-bypower" title="Name nicht lesbar – über die Kampfkraft zugeordnet">≈ per Kampfkraft</span>';

          // innerHTML zuerst, Canvas danach anhängen (siehe Kommentar oben) –
          // sonst wäre der Canvas-Inhalt nach "innerHTML +=" schwarz.
          chip.innerHTML = `
            <div class="matched-details">
              <span class="matched-power">${tileLabel} ${stackBadge}</span>
              <span class="member-sub">${this.escapeHtml(t.card.status || '')}</span>
            </div>
            <button class="btn-detach" title="Diese Kachel trennen / zurücklegen" onclick="window.cockpit.detachTile('${m.id}', '${t.id}')">✕</button>
          `;
          chip.prepend(this.cloneCanvas(t.canvas));
          chipsList.appendChild(chip);
        }

        // Drop-Slot für WEITERE Kacheln (z. B. HQ, Spenden etc.)
        const plusSlot = document.createElement('div');
        plusSlot.className = 'member-drop-slot compact';
        plusSlot.title = 'Weitere Kachel (z. B. HQ oder Spenden) auf diesen Spieler ziehen';
        plusSlot.textContent = '➕ Kachel';
        this.attachDropHandlers(plusSlot, (cardId) => {
          this.assignCardToMember(cardId, m.id);
        });

        tilesArea.appendChild(chipsList);
        tilesArea.appendChild(plusSlot);

      } else if (!isMarked) {
        // Noch keine Kachel & nicht archiviert
        const slot = document.createElement('div');
        slot.className = 'member-drop-slot';
        slot.textContent = '📥 Kachel hier ablegen';
        this.attachDropHandlers(slot, (cardId) => {
          this.assignCardToMember(cardId, m.id);
        });
        tilesArea.appendChild(slot);

        const btnArchive = document.createElement('button');
        btnArchive.className = 'btn btn-sm btn-archive-row';
        btnArchive.title = 'Dieses Mitglied beim Sync archivieren';
        btnArchive.innerHTML = '📦 Archivieren';
        btnArchive.onclick = () => this.toggleArchiveMember(m.id);
        tilesArea.appendChild(btnArchive);

      } else {
        // Zur Archivierung markiert
        const unarchiveBtn = document.createElement('button');
        unarchiveBtn.className = 'btn btn-sm btn-secondary';
        unarchiveBtn.innerHTML = '↩ Behalten / Nicht archivieren';
        unarchiveBtn.onclick = () => this.toggleArchiveMember(m.id);
        tilesArea.appendChild(unarchiveBtn);
      }

      row.appendChild(info);
      row.appendChild(tilesArea);
      unifiedListContainer.appendChild(row);
    }
  }

  renderRightTray() {
    const grid = document.getElementById('unclearCardsGrid');
    const trayCount = document.getElementById('countUnclearTray');
    if (!grid) return;

    grid.innerHTML = '';
    if (trayCount) trayCount.textContent = this.unclearCards.length;

    for (const item of this.unclearCards) {
      const seenCount = item.seenCount || 1;
      const cardEl = document.createElement('div');
      cardEl.className = 'ocr-card';
      cardEl.draggable = true;
      cardEl.dataset.cardId = item.id;

      cardEl.appendChild(this.cloneCanvas(item.canvas));

      const stackBadge = seenCount > 1 ? `<span class="badge-stack" title="${seenCount}x im Scan erfasst">x${seenCount}</span>` : '';

      const meta = document.createElement('div');
      meta.className = 'ocr-card-meta';
      meta.innerHTML = `
        <div style="display:flex; align-items:center; gap:4px; overflow:hidden;">
          <span class="ocr-card-name" title="${this.escapeHtml(item.card.name)}">${this.escapeHtml(item.card.name || '(kein Name)')}</span>
          ${stackBadge}
        </div>
        <span class="ocr-card-power">${this.tileValueLabel(item.card)}</span>
      `;

      const sub = document.createElement('div');
      sub.className = 'ocr-card-status';
      sub.innerHTML = `${item.card.level ? 'HQ ' + item.card.level : ''} &bull; ${this.escapeHtml(item.card.status || '')}`;

      cardEl.appendChild(meta);
      cardEl.appendChild(sub);

      const del = document.createElement('button');
      del.className = 'ocr-card-delete';
      del.title = 'Kachel löschen';
      del.textContent = '🗑';
      del.addEventListener('click', (e) => { e.stopPropagation(); this.deleteUnclearCard(item.id); });
      del.addEventListener('mousedown', (e) => e.stopPropagation());
      cardEl.appendChild(del);

      // Drag Handlers
      cardEl.addEventListener('dragstart', (e) => {
        cardEl.classList.add('dragging');
        e.dataTransfer.setData('text/plain', item.id);
        e.dataTransfer.effectAllowed = 'move';
      });

      cardEl.addEventListener('dragend', () => {
        cardEl.classList.remove('dragging');
      });

      grid.appendChild(cardEl);
    }
  }

  attachDropHandlers(el, onDropCard) {
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('drag-over');
    });

    el.addEventListener('dragleave', () => {
      el.classList.remove('drag-over');
    });

    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const cardId = e.dataTransfer.getData('text/plain');
      if (cardId) onDropCard(cardId);
    });
  }

  cloneCanvas(original) {
    const c = document.createElement('canvas');
    c.width = original.width;
    c.height = original.height;
    c.className = 'ocr-card-canvas';
    const ctx = c.getContext('2d');
    ctx.drawImage(original, 0, 0);
    return c;
  }

  // "VS Sa · 42.1M Pkt", "VS Woche · 199.9M Pkt", "Kills · 29.8M", "Spenden Woche · 140K"
  vsLabel(vs) {
    const p = vs.points >= 1e6 ? `${(vs.points / 1e6).toFixed(1)}M` : vs.points >= 1e3 ? `${Math.round(vs.points / 1e3)}K` : String(vs.points);
    if (vs.type === 'KILLS') return `Kills · ${p}`;
    if (vs.type === 'DONATION_WEEK') return `Spenden Woche · ${p}`;
    if (vs.type === 'DONATION_DAY') return `Spenden Tag · ${p}`;
    return `VS ${vs.type === 'VS_WEEK' ? 'Woche' : (vs.day || 'Tag')} · ${p} Pkt`;
  }

  // Hauptwert einer Kachel: VS-Punkte, Kampfkraft oder HQ-Level
  tileValueLabel(card, fallback = '?') {
    if (card.vs) return this.vsLabel(card.vs);
    if (card.power) return this.powerLabel(card.power);
    return card.level ? 'HQ ' + card.level : fallback;
  }

  // "270.5M" – egal ob die Kachel aus der Mitgliederliste (Millionen) oder der Rangliste (ganze Zahl) stammt
  powerLabel(power) {
    return window.MatchingEngine.formatPower(power) || (power ? power + 'M' : null);
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

window.CockpitState = CockpitState;
