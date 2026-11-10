/*
 * 🔗 Teilen auf allen Dokumentseiten (Konzepte, Handbuch), immer sichtbar neben "← Zur App".
 * Handy/Tablet: Teilen-Menue des Geraets, PC: Link in die Zwischenablage. Der Link enthaelt den
 * Abschnitt (#…), damit man z. B. direkt auf "Eventauswertung" im Handbuch verweisen kann.
 * Einbinden am Ende der Seite: <script src="doc-share.js"></script> (im Handbuch: ../doc-share.js)
 */
(function () {
  var lang = (document.documentElement.lang || 'de').slice(0, 2);
  var T = {
    de: { share: 'Teilen', title: 'Link zu dieser Seite teilen', copied: 'Kopiert', manual: 'Link zum Kopieren:' },
    en: { share: 'Share', title: 'Share a link to this page', copied: 'Copied', manual: 'Link to copy:' },
    fr: { share: 'Partager', title: 'Partager le lien de cette page', copied: 'Copié', manual: 'Lien à copier :' }
  }[lang] || null;
  if (!T) T = { share: 'Teilen', title: 'Link zu dieser Seite teilen', copied: 'Kopiert', manual: 'Link zum Kopieren:' };

  var style = document.createElement('style');
  style.textContent =
    '.doc-actions { position: fixed; top: 12px; right: 12px; z-index: 1000; display: flex; gap: 8px; }' +
    '.doc-actions .back-to-app { position: static; }' +
    '.doc-share { padding: 7px 14px; border-radius: 999px; cursor: pointer; background: rgba(13,17,23,.92);' +
    ' border: 1px solid rgba(240,165,0,.45); color: #f0a500; font: 600 13px/1 system-ui, sans-serif;' +
    ' box-shadow: 0 4px 14px rgba(0,0,0,.35); }' +
    '.doc-share:hover { background: rgba(240,165,0,.15); }' +
    '.doc-share:focus-visible { outline: 2px solid #f0a500; outline-offset: 2px; }';
  document.head.appendChild(style);

  var bar = document.createElement('div');
  bar.className = 'doc-actions';
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'doc-share';
  btn.title = T.title;
  btn.textContent = '🔗 ' + T.share;
  bar.appendChild(btn);
  var back = document.querySelector('.back-to-app');
  if (back) bar.appendChild(back);
  document.body.appendChild(bar);

  btn.addEventListener('click', function () {
    var url = location.href;
    var isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (isTouch && navigator.share) {
      navigator.share({ title: document.title, url: url }).catch(function () {});
      return;
    }
    var done = function () {
      btn.textContent = '✓ ' + T.copied;
      setTimeout(function () { btn.textContent = '🔗 ' + T.share; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { window.prompt(T.manual, url); });
    } else {
      window.prompt(T.manual, url);
    }
  });
})();
