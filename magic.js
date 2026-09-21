// =====================================================================
// Magic : L'Assemblée - fournisseur de données (API Scryfall, gratuite)
// https://scryfall.com/docs/api
//
// Règles de Scryfall respectées :
//  - requêtes de recherche espacées (le site ne dépasse jamais ~2 par seconde)
//  - en-tête Accept envoyé, User-Agent laissé au navigateur (obligatoire côté web)
//  - images : jamais rognées, déformées ni retouchées (affichage « contain »)
//  - le site apporte une vraie fonction (gestion de collection) : pas de simple copie
//
// Une entrée = une impression (extension + numéro + langue) : ta version
// française d'« Éclair » et sa version anglaise sont deux cartes distinctes.
// =====================================================================

const API = 'https://api.scryfall.com';
const PAGE_SIZE = 24; // affichage ; Scryfall renvoie ses résultats par paquets de 175
const MIN_GAP_MS = 500; // délai minimum entre deux recherches

const enc = encodeURIComponent;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- Appels à l'API (espacés) ----------

let nextSlot = 0;

async function scryfallRequest(path, init = {}) {
  // On réserve un créneau : deux appels rapprochés sont automatiquement espacés
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = now + wait + MIN_GAP_MS;
  if (wait) await sleep(wait);

  const res = await fetch(`${API}${path}`, { ...init, headers: { Accept: 'application/json', ...init.headers } });

  if (res.status === 404) return null; // « aucune carte trouvée »
  if (res.status === 400) {
    const body = await res.json().catch(() => null);
    console.warn('Scryfall : recherche refusée', body?.details);
    return null;
  }
  if (!res.ok) {
    const err = new Error(`Scryfall : erreur ${res.status}`);
    err.status = res.status; // 429 = trop de requêtes
    throw err;
  }
  return res.json();
}

const scryfallGet = (path) => scryfallRequest(path);
const scryfallPost = (path, body) =>
  scryfallRequest(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// ---------- Menu de filtres (syntaxe Scryfall) ----------

const TYPES = [
  ['creature', 'Créature', 'Creature'],
  ['instant', 'Éphémère', 'Instant'],
  ['sorcery', 'Rituel', 'Sorcery'],
  ['enchantment', 'Enchantement', 'Enchantment'],
  ['artifact', 'Artefact', 'Artifact'],
  ['planeswalker', 'Planeswalker', 'Planeswalker'],
  ['land', 'Terrain', 'Land'],
  ['battle', 'Bataille', 'Battle'],
  ['legendary', 'Légendaire', 'Legendary'],
];

const COLORS = [
  ['w', 'Blanc', (c) => c.data?.colors?.includes('W')],
  ['u', 'Bleu', (c) => c.data?.colors?.includes('U')],
  ['b', 'Noir', (c) => c.data?.colors?.includes('B')],
  ['r', 'Rouge', (c) => c.data?.colors?.includes('R')],
  ['g', 'Vert', (c) => c.data?.colors?.includes('G')],
  ['c', 'Incolore', (c) => !(c.data?.colors?.length > 0)],
  ['m', 'Multicolore', (c) => c.data?.colors?.length > 1],
];

const RARITIES = [
  ['common', 'Commune'],
  ['uncommon', 'Non commune'],
  ['rare', 'Rare'],
  ['mythic', 'Mythique'],
];
const RARITY_FR = { common: 'Commune', uncommon: 'Non commune', rare: 'Rare', mythic: 'Mythique', special: 'Spéciale', bonus: 'Bonus' };

const groups = [
  ...TYPES.map(([word, label, english]) => ({
    key: `t:${word}`,
    label,
    section: 'Type',
    q: `t:${word}`,
    matches: (c) => (c.data?.type_line ?? c.card_type ?? '').includes(english),
  })),
  ...COLORS.map(([code, label, matches]) => ({ key: `c:${code}`, label, section: 'Couleur', q: `c:${code}`, matches })),
  ...RARITIES.map(([code, label]) => ({
    key: `r:${code}`,
    label,
    section: 'Rareté',
    q: `r:${code}`,
    matches: (c) => c.rarity === code,
  })),
];

// ---------- Carte de l'API -> format commun à tous les jeux ----------

const cleanMana = (mana) => (mana ? mana.replace(/\{([^}]+)\}/g, '$1') : '');

function normalize(c) {
  const faces = Array.isArray(c.card_faces) ? c.card_faces : [];
  const front = faces[0] ?? {};
  const image = c.image_uris?.normal ?? front.image_uris?.normal ?? null;

  const typeLine = c.type_line ?? faces.map((f) => f.type_line).filter(Boolean).join(' // ');
  const printedType = c.printed_type_line ?? faces.map((f) => f.printed_type_line ?? f.type_line).filter(Boolean).join(' // ');
  const text = faces.length
    ? faces.map((f) => f.printed_text ?? f.oracle_text ?? '').filter(Boolean).join('\n//\n')
    : c.printed_text ?? c.oracle_text ?? '';

  const data = {
    lang: c.lang,
    name_en: c.printed_name && c.printed_name !== c.name ? c.name : undefined,
    mana: cleanMana(c.mana_cost ?? front.mana_cost),
    type_line: typeLine,
    printed_type: printedType && printedType !== typeLine ? printedType : undefined,
    colors: c.colors ?? front.colors ?? [],
    power: c.power ?? front.power,
    toughness: c.toughness ?? front.toughness,
    loyalty: c.loyalty ?? front.loyalty,
    number: c.collector_number,
    artist: c.artist,
    faces: faces.length > 1 ? faces.length : undefined,
    desc: text || undefined,
  };
  for (const key of Object.keys(data)) {
    if (data[key] === undefined || data[key] === null || data[key] === '') delete data[key];
  }
  if (!data.colors) data.colors = [];

  return {
    game: 'magic',
    external_id: c.id, // identifiant Scryfall de cette impression (extension + numéro + langue)
    name: c.printed_name ?? c.name,
    card_type: typeLine || null,
    set_code: c.set ?? null,
    set_name: c.set_name ?? null,
    rarity: c.rarity ?? null,
    image_url: image,
    data,
  };
}

// ---------- Recherche avec pagination locale ----------
// Scryfall répond par paquets de 175 cartes ; on en affiche 24 à la fois
// et on ne demande le paquet suivant que si nécessaire.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SET_NUMBER = /^([a-z0-9]{2,6})[\s\-/:]+([a-z0-9★†]{1,8})$/i;

let session = null;

function buildQuery({ mode, text, type, lang }) {
  const parts = [];
  if (mode === 'id') {
    const [, set, number] = text.trim().match(SET_NUMBER);
    parts.push(`s:${set.toLowerCase()}`, `cn:${number.toLowerCase()}`, 'lang:any');
  } else {
    if (text.trim()) parts.push(text.trim());
    const group = type ? groups.find((g) => g.key === type) : null;
    if (group) parts.push(group.q);
    parts.push(lang === 'any' ? 'lang:any' : '(lang:fr or lang:en)');
  }
  parts.push('game:paper'); // cartes physiques seulement
  return `q=${enc(parts.join(' '))}&unique=prints&order=name`;
}

async function fetchNextPage(s) {
  const data = await scryfallGet(`/cards/search?${s.query}&page=${s.nextPage}`);
  s.nextPage += 1;
  if (!data?.data) {
    s.hasMorePages = false;
    return;
  }
  s.cards.push(...data.data.map(normalize));
  s.total = data.total_cards ?? s.cards.length;
  s.hasMorePages = Boolean(data.has_more);
}

async function runSearch(params, offset) {
  const key = JSON.stringify(params);
  if (offset === 0 || !session || session.key !== key) {
    session = { key, query: buildQuery(params), cards: [], nextPage: 1, hasMorePages: true, total: 0 };
  }
  while (session.cards.length < offset + PAGE_SIZE && session.hasMorePages) {
    await fetchNextPage(session);
  }
  const page = session.cards.slice(offset, offset + PAGE_SIZE);
  return {
    cards: page,
    total: session.total,
    hasMore: offset + page.length < session.total,
    nextOffset: offset + page.length,
  };
}

// ---------- Fournisseur ----------

export default {
  id: 'magic',
  label: 'Magic',
  idLabel: 'Extension + numéro',
  idPlaceholder: 'ex. khm-123',
  idInputMode: 'text',
  namePlaceholder: 'ex. Éclair ou Lightning Bolt',

  typeGroups: groups,

  validate({ mode, text, type }) {
    const query = text.trim();
    if (mode === 'id') {
      if (!query) return "Entre l'extension et le numéro (ex. khm-123).";
      if (!UUID.test(query) && !SET_NUMBER.test(query)) {
        return "Format attendu : code de l'extension puis numéro, ex. khm-123 (ou l'identifiant Scryfall).";
      }
      return null;
    }
    if (!query && !type) return 'Entre un nom, un code, ou choisis un type.';
    if (query && query.length < 2 && !type) return 'Entre au moins 2 caractères.';
    return null;
  },

  async search({ mode, text, type, offset = 0, lang = null }) {
    // Identifiant Scryfall complet : une seule carte
    if (mode === 'id' && UUID.test(text.trim())) {
      const card = await scryfallGet(`/cards/${text.trim().toLowerCase()}`);
      const cards = card && card.object === 'card' ? [normalize(card)] : [];
      return { cards, total: cards.length, hasMore: false, nextOffset: cards.length, lang: 'any' };
    }

    // Français + anglais d'abord ; toutes les langues si rien n'est trouvé (ex. nom japonais)
    const langs = lang ? [lang] : mode === 'id' ? ['any'] : ['fren', 'any'];
    for (const l of langs) {
      const res = await runSearch({ mode, text, type, lang: l }, offset);
      if (res.cards.length || l === langs[langs.length - 1]) return { ...res, lang: l };
    }
    return { cards: [], total: 0, hasMore: false, nextOffset: offset, lang: 'any' };
  },

  // Prix : « prices » de Scryfall (€ Cardmarket, $ TCGplayer, mis à jour chaque jour).
  // On prend le prix normal, sinon foil / étched. 75 cartes par requête.
  async fetchPrices(cards) {
    const out = new Map();
    const number = (value) => {
      const n = parseFloat(value);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const put = (card, sc) => {
      const p = sc.prices ?? {};
      out.set(card.id, {
        eur: number(p.eur) ?? number(p.eur_foil) ?? number(p.eur_etched),
        usd: number(p.usd) ?? number(p.usd_foil) ?? number(p.usd_etched),
      });
    };
    const byScryfallId = new Map(cards.map((c) => [c.external_id, c]));

    try {
      for (let i = 0; i < cards.length; i += 75) {
        const part = cards.slice(i, i + 75);
        const data = await scryfallPost('/cards/collection', { identifiers: part.map((c) => ({ id: c.external_id })) });
        for (const sc of data?.data ?? []) {
          const card = byScryfallId.get(sc.id);
          if (card) put(card, sc);
        }
        for (const missing of data?.not_found ?? []) {
          const card = byScryfallId.get(missing.id);
          if (card) out.set(card.id, { eur: null, usd: null });
        }
      }
    } catch (err) {
      if (err.status) throw err; // vraie réponse d'erreur (429...) : on s'arrête
      // Pas de réponse (réseau, ou POST refusé par le navigateur) : repli, une carte à la fois
      for (const card of cards.slice(0, 60)) {
        if (out.has(card.id)) continue;
        const sc = await scryfallGet(`/cards/${card.external_id}`);
        if (sc?.object === 'card') put(card, sc);
        else out.set(card.id, { eur: null, usd: null });
      }
    }
    return out;
  },

  // Images Scryfall : small (146 px), normal (488 px), large (672 px)
  thumbUrl(url) {
    return url ? url.replace('/normal/', '/small/') : url;
  },
  fullUrl(url) {
    return url ? url.replace('/normal/', '/large/') : url;
  },

  metaLine(card) {
    const d = card.data ?? {};
    const parts = [d.printed_type ?? d.type_line ?? card.card_type ?? 'Carte'];
    if (d.mana) parts.push(d.mana);
    if (d.power != null && d.toughness != null) parts.push(`${d.power}/${d.toughness}`);
    else if (d.loyalty != null) parts.push(`Loyauté ${d.loyalty}`);
    if (card.set_name) parts.push(`${card.set_name} (${String(card.set_code ?? '').toUpperCase()})`);
    if (d.number) parts.push(`n°${d.number}`);
    if (card.rarity) parts.push(RARITY_FR[card.rarity] ?? card.rarity);
    if (d.lang) parts.push(d.lang.toUpperCase());
    return parts.join(' · ');
  },
};
