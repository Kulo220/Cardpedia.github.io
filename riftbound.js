// =====================================================================
// Riftbound - fournisseur de données (API Riftcodex, gratuite, sans clé)
// https://riftcodex.com/docs
//
// Cette API n'a pas de filtre par type ni de recherche de nom souple sur
// toute la liste. On télécharge donc le catalogue complet UNE fois (~1450
// cartes, une quinzaine de requêtes), on le garde 24 h dans le navigateur,
// puis toutes les recherches (nom, code, type, domaine) se font sur place.
//
// Une entrée = une impression : les versions alternatives (Alternate Art,
// Showcase...) ont chacune leur code, tu peux donc suivre celle que tu as.
// =====================================================================

const API_URL = 'https://api.riftcodex.com/cards';
const PAGE_SIZE = 24;
const CACHE_KEY = 'tcg:riftbound:catalog:v1';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 h

// ---------- Utilitaires ----------

const norm = (s) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// « :rb_energy_1::rb_rune_fury: » -> « (1)[Fury] »
function cleanIcons(text) {
  return text
    .replace(/:rb_energy_(\d+):/g, '($1)')
    .replace(/:rb_rune_(\w+):/g, (_, rune) => `[${cap(rune)}]`)
    .replace(/:rb_(\w+):/g, (_, name) => cap(name));
}

// Texte riche (HTML) -> texte simple, avec les retours à la ligne
function richToText(html) {
  if (!html) return '';
  const withBreaks = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p>/gi, '\n');
  const text = new DOMParser().parseFromString(withBreaks, 'text/html').body.textContent ?? '';
  return cleanIcons(text).trim();
}

// ---------- Carte de l'API -> format commun à tous les jeux ----------

function normalize(c) {
  const cl = c.classification ?? {};
  const attrs = c.attributes ?? {};
  const meta = c.metadata ?? {};
  const data = {};

  if (cl.supertype) data.supertype = cl.supertype;
  if (cl.domain?.length) data.domain = cl.domain;
  for (const key of ['energy', 'might', 'power']) {
    if (attrs[key] != null) data[key] = attrs[key];
  }
  const desc = richToText(c.text?.rich) || cleanIcons(c.text?.plain ?? '');
  if (desc) data.desc = desc;
  if (c.tags?.length) data.tags = c.tags;
  if (meta.alternate_art) data.alt_art = true;
  if (meta.overnumbered) data.overnumbered = true;

  return {
    game: 'riftbound',
    external_id: c.riftbound_id, // ex. ogn-001-298 : unique par impression
    name: c.name,
    card_type: cl.type ?? null,
    set_code: c.set?.set_id ?? null,
    set_name: c.set?.label ?? null,
    rarity: cl.rarity ?? null,
    image_url: c.media?.image_url ?? null,
    data,
  };
}

// ---------- Téléchargement et cache du catalogue ----------

async function fetchPage(page, extra = '') {
  const res = await fetch(`${API_URL}?size=100&page=${page}${extra}`);
  if (!res.ok) {
    const err = new Error(`Riftcodex : erreur ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Télécharge une liste de pages, 3 à la fois
async function runPages(pages, extra, onItems) {
  const queue = [...pages];
  const worker = async () => {
    while (queue.length) {
      const page = queue.shift();
      onItems((await fetchPage(page, extra)).items);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
}

async function downloadCatalog(onProgress) {
  const all = new Map();
  const add = (items) => {
    for (const c of items ?? []) if (c.riftbound_id) all.set(c.riftbound_id, normalize(c));
  };

  const first = await fetchPage(1, '&sort=collector_number');
  const pages = first.pages ?? 1;
  add(first.items);

  let done = 1;
  const progress = () => onProgress?.(`Chargement du catalogue Riftbound… ${done}/${pages}`);
  progress();

  const rest = Array.from({ length: pages - 1 }, (_, i) => i + 2);
  await runPages(rest, '&sort=collector_number', (items) => {
    add(items);
    done += 1;
    progress();
  });

  // Sécurité : si des cartes manquent (pagination instable), 2e passage en sens inverse
  if (all.size < (first.total ?? 0)) {
    try {
      const every = Array.from({ length: pages }, (_, i) => i + 1);
      await runPages(every, '&sort=collector_number&dir=-1', add);
    } catch (err) {
      console.warn('Riftbound : second passage incomplet', err);
    }
  }
  return [...all.values()];
}

function readCache({ allowStale = false } = {}) {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { t, cards } = JSON.parse(raw);
    if (!Array.isArray(cards) || !cards.length) return null;
    if (!allowStale && Date.now() - t > CACHE_TTL) return null;
    return cards;
  } catch {
    return null;
  }
}

function writeCache(cards) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), cards }));
  } catch {
    /* stockage plein ou indisponible : on garde juste la version en mémoire */
  }
}

// ---------- Filtres de type / domaine ----------

const KNOWN_TYPES = ['Unit', 'Spell', 'Gear', 'Legend', 'Battlefield', 'Rune'];
const KNOWN_DOMAINS = ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order'];

const byKnownOrder = (known) => (a, b) => {
  const ia = known.indexOf(a);
  const ib = known.indexOf(b);
  if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  return a.localeCompare(b, 'en');
};

// Les valeurs viennent du catalogue lui-même : jamais de type « inventé »
function buildGroups({ types, supertypes, domains }) {
  const groups = [];
  for (const t of [...types].sort(byKnownOrder(KNOWN_TYPES))) {
    groups.push({ key: `type:${t}`, label: t, section: 'Type', matches: (c) => c.card_type === t });
  }
  for (const s of [...supertypes].sort()) {
    groups.push({ key: `super:${s}`, label: s, section: 'Supertype', matches: (c) => c.data?.supertype === s });
  }
  for (const d of [...domains].sort(byKnownOrder(KNOWN_DOMAINS))) {
    groups.push({ key: `domain:${d}`, label: d, section: 'Domaine', matches: (c) => c.data?.domain?.includes(d) });
  }
  return groups;
}

// Liste provisoire tant que le catalogue n'est pas chargé
let groups = buildGroups({
  types: KNOWN_TYPES,
  supertypes: ['Champion', 'Token', 'Signature'],
  domains: KNOWN_DOMAINS,
});

let catalog = null; // cartes normalisées
let loading = null; // téléchargement en cours

function setCatalog(cards) {
  catalog = cards;
  groups = buildGroups({
    types: new Set(cards.map((c) => c.card_type).filter(Boolean)),
    supertypes: new Set(cards.map((c) => c.data?.supertype).filter(Boolean)),
    domains: new Set(cards.flatMap((c) => c.data?.domain ?? [])),
  });
}

function ensureCatalog(onProgress) {
  if (catalog) return Promise.resolve(catalog);
  if (!loading) {
    loading = (async () => {
      const cached = readCache();
      if (cached) return cached;
      try {
        const fresh = await downloadCatalog(onProgress);
        if (fresh.length > 50) writeCache(fresh);
        return fresh;
      } catch (err) {
        const stale = readCache({ allowStale: true }); // mieux vaut un vieux catalogue que rien
        if (stale) return stale;
        throw err;
      }
    })()
      .then((cards) => {
        setCatalog(cards);
        return cards;
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

// ---------- Fournisseur ----------

export default {
  id: 'riftbound',
  label: 'Riftbound',
  idLabel: 'Code de la carte',
  idPlaceholder: 'ex. ogn-001',
  idInputMode: 'text',
  namePlaceholder: 'Nom en anglais, ex. Blazing Scorcher',

  // Menu des types : liste provisoire, puis valeurs réelles du catalogue
  get typeGroups() {
    return groups;
  },

  // Appelé à l'arrivée sur le jeu : utilise le catalogue en cache (sans réseau)
  init() {
    if (catalog) return;
    const cached = readCache({ allowStale: true });
    if (cached) setCatalog(cached);
  },

  validate({ mode, text, type }) {
    const query = text.trim();
    if (mode === 'id') {
      if (!query) return 'Entre le code de la carte (ex. ogn-001).';
      if (!/^[a-z0-9-]{2,20}$/i.test(query)) return 'Le code ne contient que des lettres, chiffres et tirets (ex. ogn-001).';
      return null;
    }
    if (!query && !type) return 'Entre un nom, un code, ou choisis un type.';
    if (query && query.length < 2 && !type) return 'Entre au moins 2 caractères.';
    return null;
  },

  async search({ mode, text, type, offset = 0, onProgress }) {
    const cards = await ensureCatalog(onProgress);
    const query = norm(text);
    const group = type ? groups.find((g) => g.key === type) : null;

    const found = cards.filter((c) => {
      if (query) {
        if (mode === 'id') {
          if (!c.external_id.toLowerCase().includes(query)) return false;
        } else if (!norm(c.name).includes(query)) {
          return false;
        }
      }
      return !group || group.matches(c);
    });

    found.sort((a, b) =>
      mode === 'id'
        ? a.external_id.localeCompare(b.external_id)
        : a.name.localeCompare(b.name, 'en') || a.external_id.localeCompare(b.external_id),
    );

    const page = found.slice(offset, offset + PAGE_SIZE);
    return {
      cards: page,
      total: found.length,
      hasMore: offset + page.length < found.length,
      nextOffset: offset + page.length,
      lang: null,
    };
  },

  // Les images d'origine font ~744 px de large : on demande une version réduite
  // (paramètres de redimensionnement du CDN ; ignorés s'ils ne sont pas gérés)
  thumbUrl(url) {
    try {
      const u = new URL(url);
      u.searchParams.set('w', '112');
      u.searchParams.set('auto', 'format');
      return u.toString();
    } catch {
      return url;
    }
  },

  // Grande version de l'image, demandée au clic sur la miniature
  fullUrl(url) {
    try {
      const u = new URL(url);
      u.searchParams.set('w', '640');
      u.searchParams.set('auto', 'format');
      return u.toString();
    } catch {
      return url;
    }
  },

  metaLine(card) {
    const d = card.data ?? {};
    const parts = [[d.supertype, card.card_type].filter(Boolean).join(' ') || 'Carte'];
    if (d.domain?.length) parts.push(d.domain.join(' / '));
    if (d.energy != null) parts.push(`Energy ${d.energy}`);
    if (d.might != null) parts.push(`Might ${d.might}`);
    if (d.power != null) parts.push(`Power ${d.power}`);
    if (card.set_code) parts.push(card.set_code);
    if (card.rarity) parts.push(card.rarity);
    if (d.alt_art) parts.push('Alt art');
    if (d.overnumbered) parts.push('Overnumbered');
    parts.push(card.external_id);
    return parts.join(' · ');
  },
};
