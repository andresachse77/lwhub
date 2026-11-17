<?php // Dialoge für alle: Anmeldung abgelaufen, Team-Editor ?>
<div class="modal-bg hidden" id="modal-reauth">
  <div class="modal reauth-modal">
    <div class="modal-title">🔑 <span data-i18n="s_reauth_title">Anmeldung abgelaufen</span></div>
    <div class="hint reauth-text" data-i18n="s_reauth_text">Deine Discord-Anmeldung ist abgelaufen, darum wurde gerade nichts gespeichert. Melde dich in einem neuen Fenster neu an – deine Eingaben hier bleiben stehen. Danach den letzten Schritt einfach wiederholen.</div>
    <div class="hint reauth-wait" id="reauth-wait" hidden data-i18n="s_reauth_wait">Warte auf die Anmeldung im neuen Fenster … danach kannst du es schließen.</div>
    <div class="modal-footer">
      <button class="btn btn-ghost" data-action="closeModal" data-args='["modal-reauth"]' data-i18n="s_reauth_later">Später</button>
      <button class="btn btn-gold" data-action="lwhubReauthLogin" data-i18n="s_reauth_btn">Neu anmelden</button>
    </div>
  </div>
</div>
<div class="modal-bg hidden" id="modal-team-editor">
  <div class="modal team-editor-modal">
    <div class="modal-title" data-i18n="s_teams_bearbeiten">Teams bearbeiten</div>
    <div class="field">
      <label data-i18n="s_spieler">Spieler</label>
      <div id="team-editor-member-name" class="team-editor-member-name"></div>
    </div>
    <form id="team-editor-form">
      <div class="field">
        <label data-i18n="s_total_hero_power">Heldenkampfkraft</label>
        <input type="number" id="team-editor-total" min="0" inputmode="numeric" placeholder="Optional">
      </div>
      <div class="field">
        <label data-i18n="s_overlord_level">Overlord-Level</label>
        <input type="number" id="team-editor-monkey-level" min="0" inputmode="numeric" placeholder="Optional">
      </div>
      <div class="field">
        <label>T1</label>
        <div class="team-editor-tier-row">
          <select id="team-editor-type-1">
            <option value="">—</option>
            <option value="panzer" data-i18n="s_panzer">Panzer</option>
            <option value="flugzeug" data-i18n="s_flugzeug">Flugzeug</option>
            <option value="rakete" data-i18n="s_rakete">Rakete</option>
          </select>
          <input type="number" id="team-editor-power-1" min="0" max="999" inputmode="numeric" placeholder="Kampfkraft">
        </div>
      </div>
      <div class="field">
        <label>T2</label>
        <div class="team-editor-tier-row">
          <select id="team-editor-type-2">
            <option value="">—</option>
            <option value="panzer" data-i18n="s_panzer">Panzer</option>
            <option value="flugzeug" data-i18n="s_flugzeug">Flugzeug</option>
            <option value="rakete" data-i18n="s_rakete">Rakete</option>
          </select>
          <input type="number" id="team-editor-power-2" min="0" max="999" inputmode="numeric" placeholder="Kampfkraft">
        </div>
      </div>
      <div class="field">
        <label>T3</label>
        <div class="team-editor-tier-row">
          <select id="team-editor-type-3">
            <option value="">—</option>
            <option value="panzer" data-i18n="s_panzer">Panzer</option>
            <option value="flugzeug" data-i18n="s_flugzeug">Flugzeug</option>
            <option value="rakete" data-i18n="s_rakete">Rakete</option>
          </select>
          <input type="number" id="team-editor-power-3" min="0" max="999" inputmode="numeric" placeholder="Kampfkraft">
        </div>
      </div>
      <div class="field">
        <label>T4</label>
        <div class="team-editor-tier-row">
          <select id="team-editor-type-4">
            <option value="">—</option>
            <option value="panzer" data-i18n="s_panzer">Panzer</option>
            <option value="flugzeug" data-i18n="s_flugzeug">Flugzeug</option>
            <option value="rakete" data-i18n="s_rakete">Rakete</option>
          </select>
          <input type="number" id="team-editor-power-4" min="0" max="999" inputmode="numeric" placeholder="Kampfkraft">
        </div>
      </div>
      <div class="field">
        <label data-i18n="s_helden_slots">Helden-Slots (Drag & Drop)</label>
        <div id="team-editor-dnd" class="team-editor-dnd"></div>
      </div>
    </form>
    <div class="modal-footer">
      <button type="button" class="btn btn-ghost" data-action="closeTeamEditor">Abbrechen</button>
      <button type="button" class="btn btn-gold" data-action="saveTeams" data-args='[{"$":"event"}]'>Speichern</button>
    </div>
  </div>
</div>
