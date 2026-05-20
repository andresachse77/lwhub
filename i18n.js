(() => {
  const STORAGE_KEY = 'iny_lang_v1';
  const SUPPORTED = ['de', 'en', 'it', 'fr', 'pl', 'es', 'zh'];
  // Sprachnamen je UI-Sprache – hier zentral pflegen statt in jeder JSON
  const LANG_NAMES = {
    de: { de: 'Deutsch',    en: 'Englisch',    it: 'Italienisch', fr: 'Französisch', pl: 'Polnisch',     es: 'Spanisch',   zh: 'Mandarin'    },
    en: { de: 'German',     en: 'English',     it: 'Italian',     fr: 'French',      pl: 'Polish',       es: 'Spanish',    zh: 'Mandarin'    },
    it: { de: 'Tedesco',    en: 'Inglese',     it: 'Italiano',    fr: 'Francese',    pl: 'Polacco',      es: 'Spagnolo',   zh: 'Mandarino'   },
    fr: { de: 'Allemand',   en: 'Anglais',     it: 'Italien',     fr: 'Français',    pl: 'Polonais',     es: 'Espagnol',   zh: 'Mandarin'    },
    pl: { de: 'Niemiecki',  en: 'Angielski',   it: 'Włoski',      fr: 'Francuski',   pl: 'Polski',       es: 'Hiszpański', zh: 'Mandaryński' },
    es: { de: 'Alemán',     en: 'Inglés',      it: 'Italiano',    fr: 'Francés',     pl: 'Polaco',       es: 'Español',    zh: 'Mandarín'    },
    zh: { de: '德语',        en: '英语',         it: '意大利语',     fr: '法语',         pl: '波兰语',        es: '西班牙语',    zh: '普通话'       },
  };
  const loaded = {};
  let currentLang = 'de';
  let persistHandler = null;
  let observer = null;
  let applying = false;
  let applyTimer = null;
  let deReverseLookup = null;
  let deReverseLookupNorm = null;
  const _nodeOriginals = new WeakMap(); // textNode → original German core text

  function repairMojibake(text) {
    return String(text || '')
      .replace(/â‰¥/g, '≥')
      .replace(/â‰¤/g, '≤')
      .replace(/â€¦/g, '…')
      .replace(/â€“/g, '–')
      .replace(/â€”/g, '—')
      .replace(/â€ž/g, '„')
      .replace(/â€œ/g, '“')
      .replace(/â€/g, '”')
      .replace(/â€˜/g, '‘')
      .replace(/â€™/g, '’')
      .replace(/Ã„/g, 'Ä')
      .replace(/Ã–/g, 'Ö')
      .replace(/Ãœ/g, 'Ü')
      .replace(/Ã¤/g, 'ä')
      .replace(/Ã¶/g, 'ö')
      .replace(/Ã¼/g, 'ü')
      .replace(/ÃŸ/g, 'ß')
      .replace(/Â/g, '');
  }

  function normLang(v) {
    const s = String(v || '').trim().toLowerCase();
    return SUPPORTED.includes(s) ? s : 'de';
  }

  async function loadLocale(lang) {
    const n = normLang(lang);
    if (loaded[n]) return loaded[n];
    try {
      const res = await fetch(`locales/${n}.json`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      loaded[n] = await res.json();
    } catch (_) {
      loaded[n] = { strings: {}, phrases: {}, prefixes: {} };
    }
    return loaded[n];
  }

  function getBundle(lang = currentLang) {
    return loaded[normLang(lang)] || { strings: {}, phrases: {}, prefixes: {} };
  }

  function getStringDict(bundle) {
    if (!bundle) return {};
    if (bundle.strings && typeof bundle.strings === 'object') return bundle.strings;
    if (bundle.phrases && typeof bundle.phrases === 'object') return bundle.phrases;
    return {};
  }

  function buildDeReverseLookup() {
    const de = getBundle('de');
    const source = getStringDict(de);
    const map = new Map();
    const normMap = new Map();
    Object.keys(source).forEach((key) => {
      const text = source[key];
      if (typeof text === 'string' && text) {
        if (!map.has(text)) map.set(text, key);
        const n = normalizeLookupText(text);
        if (n && !normMap.has(n)) normMap.set(n, key);

        const repaired = repairMojibake(text);
        if (repaired && !map.has(repaired)) map.set(repaired, key);
        const rn = normalizeLookupText(repaired);
        if (rn && !normMap.has(rn)) normMap.set(rn, key);
      }
    });
    deReverseLookup = map;
    deReverseLookupNorm = normMap;
  }

  function normalizeLookupText(text) {
    return repairMojibake(text)
      .trim()
      .replace(/[–—]/g, '-')
      .replace(/…/g, '...')
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  function isUppercaseLike(text) {
    const letters = String(text || '').replace(/[^\p{L}]/gu, '');
    if (!letters) return false;
    return letters === letters.toUpperCase() && letters !== letters.toLowerCase();
  }

  function applyCaseStyle(source, translated) {
    return isUppercaseLike(source) ? String(translated).toUpperCase() : translated;
  }

  function translateRaw(raw) {
    const text = String(raw ?? '');
    const bundle = getBundle(currentLang);
    const de = getBundle('de');
    const strings = getStringDict(bundle);
    const deStrings = getStringDict(de);

    // Collapse simple colon variants (e.g. "Regelwerk:" -> "Regelwerk" + ":")
    // so we can avoid maintaining duplicate keys for punctuation-only variants.
    if (text.endsWith(':')) {
      const base = text.slice(0, -1);
      const translatedBase = translateRaw(base);
      if (translatedBase !== base) return translatedBase + ':';
    }

    if (Object.prototype.hasOwnProperty.call(strings, text)) {
      return strings[text];
    }

    if (!deReverseLookup) buildDeReverseLookup();
    const repairedText = repairMojibake(text);
    const normalizedText = normalizeLookupText(repairedText);
    const mappedKey = deReverseLookup.get(text)
      || deReverseLookup.get(repairedText)
      || (deReverseLookupNorm ? deReverseLookupNorm.get(normalizedText) : null);
    if (mappedKey && Object.prototype.hasOwnProperty.call(strings, mappedKey)) {
      return applyCaseStyle(text, strings[mappedKey]);
    }

    const prefixes = bundle.prefixes || {};
    for (const key of Object.keys(prefixes)) {
      if (text.startsWith(key)) return prefixes[key] + text.slice(key.length);
    }

    if (Object.prototype.hasOwnProperty.call(deStrings, text)) {
      return deStrings[text];
    }
    if (mappedKey && Object.prototype.hasOwnProperty.call(deStrings, mappedKey)) {
      return applyCaseStyle(text, deStrings[mappedKey]);
    }
    return text;
  }

  function replaceTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node || !node.nodeValue) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA') return NodeFilter.FILTER_REJECT;
        if (parent.closest('[data-i18n-skip="1"]')) return NodeFilter.FILTER_REJECT;
        const v = node.nodeValue;
        if (!v.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const current = node.nodeValue;
      const lead = current.match(/^\s*/)?.[0] || '';
      const trail = current.match(/\s*$/)?.[0] || '';
      const storedCore = _nodeOriginals.get(node);
      const core = storedCore ?? current.trim();
      const translated = translateRaw(core);
      if (translated !== core) {
        node.nodeValue = lead + translated + trail;
        if (!storedCore) _nodeOriginals.set(node, core);
      } else if (storedCore) {
        // Back to original language — restore the stored German text
        node.nodeValue = lead + core + trail;
      }
    });
  }

  function replaceAttributes(root) {
    const attrs = ['title', 'placeholder', 'aria-label'];
    const all = root.querySelectorAll('*');
    all.forEach((el) => {
      attrs.forEach((attr) => {
        if (!el.hasAttribute(attr)) return;
        const origKey = `data-i18n-orig-${attr}`;
        if (!el.hasAttribute(origKey)) {
          // First time: store original before translating
          const source = el.getAttribute(attr);
          const out = translateRaw(source);
          if (out !== source) {
            el.setAttribute(origKey, source);
            el.setAttribute(attr, out);
          }
        } else {
          // Re-apply: always translate from stored original
          const source = el.getAttribute(origKey);
          const out = translateRaw(source);
          if (out !== el.getAttribute(attr)) el.setAttribute(attr, out);
        }
      });
    });
  }

  function updateLanguageSwitcher() {
    const sel = document.getElementById('lang-switch');
    if (!sel) return;
    sel.value = currentLang;
    const names = LANG_NAMES[currentLang] || {};
    sel.title = translateRaw('Sprache');
    const nativeNames = LANG_NAMES[currentLang] ? Object.fromEntries(SUPPORTED.map(l => [l, LANG_NAMES[l][l] || l])) : { de: 'Deutsch', en: 'English', it: 'Italiano' };
    Array.from(sel.options).forEach((opt) => {
      const v = normLang(opt.value);
      const cur = names[v] || v.toUpperCase();
      const nat = nativeNames[v] || v.toUpperCase();
      opt.textContent = cur === nat ? cur : `${cur} (${nat})`;
    });
  }

  function replaceDataI18n(root) {
    const bundle = getBundle(currentLang);
    const strings = getStringDict(bundle);
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (Object.prototype.hasOwnProperty.call(strings, key)) {
        el.textContent = strings[key];
      }
    });
  }

  function applyI18n(root = document.body) {
    if (!root || applying) return;
    applying = true;
    try {
      replaceDataI18n(root);
      replaceTextNodes(root);
      replaceAttributes(root);
      updateLanguageSwitcher();
    } finally {
      applying = false;
    }
  }

  function queueApplyI18n() {
    clearTimeout(applyTimer);
    applyTimer = setTimeout(() => applyI18n(document.body), 30);
  }

  function startObserver() {
    if (observer || !document.body) return;
    observer = new MutationObserver(() => queueApplyI18n());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['title', 'placeholder', 'aria-label']
    });
  }

  function detectInitialLanguage(initialFromApp = '') {
    const urlLang = new URLSearchParams(window.location.search).get('lang');
    if (SUPPORTED.includes(String(urlLang || '').toLowerCase())) return normLang(urlLang);
    if (SUPPORTED.includes(String(initialFromApp || '').toLowerCase())) return normLang(initialFromApp);
    const fromStorage = localStorage.getItem(STORAGE_KEY);
    if (SUPPORTED.includes(String(fromStorage || '').toLowerCase())) return normLang(fromStorage);
    const browser = String(navigator.language || 'de').slice(0, 2).toLowerCase();
    return SUPPORTED.includes(browser) ? browser : 'de';
  }

  async function setAppLanguage(lang, opts = {}) {
    const options = {
      persistLocal: opts.persistLocal !== false,
      persistServer: opts.persistServer === true
    };

    const next = normLang(lang);
    await loadLocale('de');
    await loadLocale(next);
    currentLang = next;
    deReverseLookup = null;
    deReverseLookupNorm = null;
    document.documentElement.setAttribute('lang', currentLang);

    if (options.persistLocal) {
      try { localStorage.setItem(STORAGE_KEY, currentLang); } catch (_) {}
    }

    applyI18n(document.body);
    document.dispatchEvent(new CustomEvent('i18n:language-changed', { detail: { lang: next } }));

    if (options.persistServer && typeof persistHandler === 'function') {
      try { await persistHandler(currentLang); } catch (_) {}
    }
  }

  async function initI18n(initialFromApp = '') {
    const initial = detectInitialLanguage(initialFromApp);
    await setAppLanguage(initial, { persistLocal: true, persistServer: false });

    const switcher = document.getElementById('lang-switch');
    if (switcher && !switcher.dataset.i18nBound) {
      switcher.dataset.i18nBound = '1';
      switcher.addEventListener('change', async (e) => {
        await setAppLanguage(e.target.value, { persistLocal: true, persistServer: true });
      });
    }

    startObserver();
    queueApplyI18n();
  }

  window.trText = translateRaw;
  window.applyI18n = applyI18n;
  window.setAppLanguage = setAppLanguage;
  window.initI18n = initI18n;
  window.registerI18nPersistHandler = (fn) => { persistHandler = fn; };
})();
