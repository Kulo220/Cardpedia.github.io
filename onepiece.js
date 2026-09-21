// =====================================================================
// One Piece Card Game - fournisseur de données
//
// Cartes : jeu de données « Punk Records », des fichiers JSON publics
//          hébergés sur GitHub (https://github.com/buhbbl/punk-records),
//          issus du site officiel. Accessibles depuis un navigateur, sans clé.
// Noms   : la liste française est chargée en plus : tu peux chercher
//          « Luffy » comme le nom anglais (l'effet des cartes reste en anglais).
// Prix   : API gratuite optcgapi.com (TCGplayer, en dollars seulement).
//
// Comme pour Riftbound : on télécharge le catalogue complet UNE fois (une
// requête par extension), on le garde 7 jours dans le navigateur, puis toutes
// les recherches (nom, numéro, catégorie, couleur, rareté) se font sur place.
//
// Une entrée = une impression : les versions alternatives (id terminé par
// _p1, _p2...) sont des cartes distinctes que tu peux suivre séparément.
// =====================================================================

const DATA_URL = 'https://raw.githubusercontent.com/buhbbl/punk-records/main';
const PRICE_URL = 'https://optcgapi.com/api';
const IMAGE_BASE = 'https://en.onepiece-cardgame.com/cardlist/'; // pour les adresses relatives
const PAGE_SIZE = 24;
const CACHE_KEY = 'tcg:onepiece:catalog:v1';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 jours

// ---------- Utilitaires ----------

const norm = (s) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const asList = (json) => (Array.isArray(json) ? json : Object.values(json ?? {}));

async function getJson(path) {
  const res = await fetch(`${DATA_URL}/${path}`);
  if (!res.ok) {
    const err = new Error(`Punk Records : erreur ${res.status} (${path})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ---------- Vocabulaire français ----------

const CATEGORY_ORDER = ['Leader', 'Character', 'Event', 'Stage', 'Don'];
const CATEGORY_FR = { Leader: 'Leader', Character: 'Personnage', Event: 'Évènement', Stage: 'Lieu', Don: 'DON!!' };

const COLOR_ORDER = ['Red', 'Green', 'Blue', 'Purple', 'Black', 'Yellow'];
const COLOR_FR = { Red: 'Rouge', Green: 'Vert', Blue: 'Bleu', Purple: 'Violet', Black: 'Noir', Yellow: 'Jaune' };

const RARITY_ORDER = ['Common', 'Uncommon', 'Rare', 'SuperRare', 'SecretRare', 'Leader', 'Special', 'TreasureRare', 'Promo'];
const RARITY_FR = {
  Common: 'Commune (C)',
  Uncommon: 'Peu commune (UC)',
  Rare: 'Rare (R)',
  SuperRare: 'Super rare (SR)',
  SecretRare: 'Secrète (SEC)',
  Leader: 'Leader (L)',
  Special: 'Spéciale (SP)',
  TreasureRare: 'Treasure rare (TR)',
  Promo: 'Promo (P)',
};

// ---------- Carte du jeu de données -> format commun à tous les jeux ----------

const number = (value) => {
  const n = Number(value);
  return value != null && value !== '' && Number.isFinite(n) ? n : null;
};

function normalize(c, pack, frNames) {
  const nameFr = frNames.get(c.id);
  const trigger = c.trigger ? (/^\s*\[?trigger\]?/i.test(c.trigger) ? c.trigger : `[Trigger] ${c.trigger}`) : '';
  const desc = [c.effect, trigger].filter(Boolean).join('\n').trim();

  const image =
    c.img_full_url ??
    (c.img_url
      ? (() => {
          try {
            return new URL(c.img_url, IMAGE_BASE).href;
          } catch {
            return null;
          }
        })()
      : null);

  const data = {
    name_en: nameFr && nameFr !== c.name ? c.name : undefined,
    colors: Array.isArray(c.colors) ? c.colors : [],
    cost: number(c.cost),
    power: number(c.power),
    counter: number(c.counter),
    attributes: Array.isArray(c.attributes) && c.attributes.length ? c.attributes : undefined,
    types: Array.isArray(c.types) && c.types.length ? c.types : undefined,
    parallel: /_[a-z]+\d*$/i.test(String(c.id)) ? true : undefined,
    desc: desc || undefined,
  };
  for (const key of Object.keys(data)) {
    if (data[key] === undefined || data[key] === null) delete data[key];
  }

  return {
    game: 'onepiece',
    external_id: String(c.id), // ex. OP01-001 ; OP01-001_p1 pour une version alternative
    name: nameFr ?? c.name,
    card_type: c.category ?? null,
    set_code: pack?.label ?? String(c.pack_id ?? ''),
    set_name: pack?.title ?? null,
    rarity: c.rarity ?? null,
    image_url: image,
    data,
  };
}

// ---------- Téléchargement et cache du catalogue ----------

function describePack(pack) {
  const parts = pack.title_parts ?? {};
  return { id: String(pack.id), label: parts.label ?? null, title: parts.title ?? pack.raw_title ?? null };
}

async function downloadCatalog(onProgress) {
  const packs = asList(await getJson('english/packs.json')).filter((p) => p?.id != null).map(describePack);

  // noms français (un seul fichier, facultatif)
  const frNames = new Map();
  try {
    const fr = await getJson('french/index/cards_by_id.json');
    for (const [id, card] of Object.entries(fr ?? {})) if (card?.name) frNames.set(id, card.name);
  } catch (err) {
    console.warn('One Piece : noms français indisponibles', err);
  }

  const all = new Map();
  const queue = [...packs];
  let done = 0;
  const progress = () => onProgress?.(`Chargement du catalogue One Piece… ${done}/${packs.length}`);
  progress();

  const worker = async () => {
    while (queue.length) {
      const pack = queue.shift();
      try {
        for (const c of asList(await getJson(`english/cards/${pack.id}.json`))) {
          if (c?.id && !all.has(String(c.id))) all.set(String(c.id), normalize(c, pack, frNames));
        }
      } catch (err) {
        console.warn(`One Piece : extension ${pack.id} indisponible`, err); // on continue avec les autres
      }
      done += 1;
      progress();
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
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

// ---------- Filtres : catégorie, couleur, rareté ----------

const byOrder = (order) => (a, b) => {
  const ia = order.indexOf(a);
  const ib = order.indexOf(b);
  if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  return a.localeCompare(b, 'en');
};

// Les valeurs viennent du catalogue lui-même : jamais de valeur « inventée »
function buildGroups({ categories, colors, rarities }) {
  const groups = [];
  for (const v of [...categories].sort(byOrder(CATEGORY_ORDER))) {
    groups.push({ key: `cat:${v}`, label: CATEGORY_FR[v] ?? v, section: 'Catégorie', matches: (c) => c.card_type === v });
  }
  for (const v of [...colors].sort(byOrder(COLOR_ORDER))) {
    groups.push({ key: `color:${v}`, label: COLOR_FR[v] ?? v, section: 'Couleur', matches: (c) => c.data?.colors?.includes(v) });
  }
  for (const v of [...rarities].sort(byOrder(RARITY_ORDER))) {
    groups.push({ key: `rar:${v}`, label: RARITY_FR[v] ?? v, section: 'Rareté', matches: (c) => c.rarity === v });
  }
  return groups;
}

// Liste provisoire tant que le catalogue n'est pas chargé
let groups = buildGroups({ categories: CATEGORY_ORDER, colors: COLOR_ORDER, rarities: RARITY_ORDER });

let catalog = null; // cartes normalisées
let loading = null; // téléchargement en cours

function setCatalog(cards) {
  catalog = cards;
  groups = buildGroups({
    categories: new Set(cards.map((c) => c.card_type).filter(Boolean)),
    colors: new Set(cards.flatMap((c) => c.data?.colors ?? [])),
    rarities: new Set(cards.map((c) => c.rarity).filter(Boolean)),
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
        if (fresh.length < 50) throw new Error('Catalogue One Piece incomplet');
        writeCache(fresh);
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

// ---------- Prix (optcgapi.com, dollars) ----------

const money = (value) => {
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// « OP01 » -> « OP-01 » ; « ST01 » -> « ST-01 » ; « PRB01 » -> « PRB-01 »
const priceSetId = (label) => {
  const m = String(label ?? '').match(/^([A-Za-z]+)-?(\d+)$/);
  return m ? `${m[1].toUpperCase()}-${m[2]}` : null;
};

async function priceRequest(path) {
  const res = await fetch(`${PRICE_URL}${path}`, { headers: { Accept: 'application/json' } });
  if (res.status === 404) return [];
  if (!res.ok) {
    const err = new Error(`optcgapi : erreur ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  return Array.isArray(json) ? json : json?.results ?? json?.data ?? asList(json);
}

// ---------- Fournisseur ----------

export default {
  id: 'onepiece',
  label: 'One Piece',
  idLabel: 'Numéro de carte',
  idPlaceholder: 'ex. OP01-001',
  idInputMode: 'text',
  namePlaceholder: 'ex. Luffy ou Monkey.D.Luffy',

  // Menu des filtres : liste provisoire, puis valeurs réelles du catalogue
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
      if (!query) return 'Entre le numéro de la carte (ex. OP01-001).';
      if (!/^[a-z0-9_-]{2,24}$/i.test(query)) return 'Le numéro ne contient que des lettres, chiffres et tirets (ex. OP01-001).';
      return null;
    }
    if (!query && !type) return 'Entre un nom, un numéro, ou choisis un filtre.';
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
        } else if (!norm(`${c.name} ${c.data?.name_en ?? ''}`).includes(query)) {
          return false;
        }
      }
      return !group || group.matches(c);
    });

    found.sort((a, b) =>
      mode === 'id' || !query
        ? a.external_id.localeCompare(b.external_id)
        : a.name.localeCompare(b.name, 'fr') || a.external_id.localeCompare(b.external_id),
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

  // Prix : optcgapi.com donne les prix TCGplayer (en dollars) par extension.
  // Une requête par extension de tes cartes (pas une par carte), puis on fait la correspondance
  // par numéro de carte. Pas de prix en euros. Renvoie Map(id de carte en base -> { eur, usd }).
  async fetchPrices(cards) {
    const out = new Map();
    const bySet = new Map();
    for (const card of cards) {
      const setId = priceSetId(card.set_code);
      const key = setId ?? '';
      if (!bySet.has(key)) bySet.set(key, []);
      bySet.get(key).push(card);
    }

    for (const [setId, list] of bySet) {
      let rows = [];
      if (setId) {
        const kind = setId.startsWith('ST') ? 'decks' : 'sets';
        rows = await priceRequest(`/${kind}/${setId}/`);
        await sleep(500); // une API personnelle : on ménage le serveur
      }
      const byNumber = new Map();
      for (const row of rows) {
        const id = String(row.card_set_id ?? row.card_id ?? '');
        const price = money(row.market_price) ?? money(row.inventory_price);
        if (id && (!byNumber.has(id) || (price != null && byNumber.get(id) == null))) byNumber.set(id, price);
      }
      for (const card of list) out.set(card.id, { eur: null, usd: byNumber.get(card.external_id) ?? null });
    }
    return out;
  },

  metaLine(card) {
    const d = card.data ?? {};
    const parts = [CATEGORY_FR[card.card_type] ?? card.card_type ?? 'Carte'];
    if (d.colors?.length) parts.push(d.colors.map((c) => COLOR_FR[c] ?? c).join(' / '));
    if (d.cost != null) parts.push(card.card_type === 'Leader' ? `Vie ${d.cost}` : `Coût ${d.cost}`);
    if (d.power != null) parts.push(`Puissance ${d.power}`);
    if (d.counter != null) parts.push(`Counter +${d.counter}`);
    if (d.types?.length) parts.push(d.types.join(' / '));
    if (card.set_code) parts.push(card.set_code);
    if (card.rarity) parts.push(RARITY_FR[card.rarity]?.replace(/^.*\(|\)$/g, '') ?? card.rarity);
    if (d.parallel) parts.push('Version alt.');
    parts.push(card.external_id);
    return parts.join(' · ');
  },
};
