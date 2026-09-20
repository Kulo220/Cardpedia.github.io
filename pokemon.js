// =====================================================================
// Pokémon - fournisseur de données (API TCGdex, gratuite, sans clé)
// https://tcgdex.dev
//
// Pourquoi TCGdex : les cartes existent EN FRANÇAIS (Dracaufeu, pas
// Charizard), les images sont fournies par l'API, et elle est faite pour
// être appelée depuis un site web.
//
// Particularité : la liste de résultats ne contient que nom, numéro et
// image. Les détails (type, PV, rareté, attaques...) sont récupérés au
// moment où tu ajoutes la carte à ta collection (1 requête).
// =====================================================================

const API = 'https://api.tcgdex.net/v2';
const PAGE_SIZE = 24;
const LANG = 'fr'; // langue principale ; repli automatique sur l'anglais pour une recherche par nom
const TTL = 7 * 24 * 60 * 60 * 1000; // listes de types / extensions : 7 jours

const enc = encodeURIComponent;

// ---------- Cache navigateur ----------

function cacheGet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    return { v, fresh: Date.now() - t < TTL };
  } catch {
    return null;
  }
}

function cacheSet(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify({ t: Date.now(), v }));
  } catch {
    /* stockage plein ou indisponible : pas grave */
  }
}

async function getJson(path) {
  const res = await fetch(`${API}/${path}`);
  if (res.status === 404) return []; // « rien trouvé »
  if (!res.ok) {
    const err = new Error(`TCGdex : erreur ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ---------- Extensions (pour afficher le nom de l'extension et « 136/189 ») ----------

const setsByLang = new Map();

async function getSets(lang) {
  if (setsByLang.has(lang)) return setsByLang.get(lang);

  const key = `tcg:pokemon:sets:${lang}`;
  const cached = cacheGet(key);
  let list = cached?.fresh ? cached.v : null;

  if (!list) {
    try {
      const raw = await getJson(`${lang}/sets`);
      list = raw.map((s) => [s.id, s.name, s.cardCount?.official ?? s.cardCount?.total ?? null]);
      cacheSet(key, list);
    } catch (err) {
      // facultatif : la recherche fonctionne sans le nom des extensions
      console.warn('Pokémon : liste des extensions indisponible', err);
      list = cached?.v ?? [];
    }
  }
  const map = new Map(list.map(([id, name, official]) => [id, { name, official }]));
  setsByLang.set(lang, map);
  return map;
}

// ---------- Menu Type : valeurs exactes fournies par l'API ----------
// (catégories, types, raretés : on ne les invente pas, l'API les liste)

let groups = [];

function applyFacets({ categories = [], types = [], rarities = [] }) {
  const clean = (list) => (Array.isArray(list) ? list.filter((v) => typeof v === 'string' && v) : []);
  groups = [
    ...clean(categories).map((v) => ({
      key: `cat:${v}`,
      label: v,
      section: 'Catégorie',
      param: `category=eq:${enc(v)}`,
      matches: (c) => c.data?.category === v || c.card_type === v,
    })),
    ...clean(types).map((v) => ({
      key: `type:${v}`,
      label: v,
      section: 'Type',
      param: `types=${enc(v)}`,
      matches: (c) => Array.isArray(c.data?.types) && c.data.types.includes(v),
    })),
    ...clean(rarities).map((v) => ({
      key: `rar:${v}`,
      label: v,
      section: 'Rareté',
      param: `rarity=eq:${enc(v)}`,
      matches: (c) => c.rarity === v,
    })),
  ];
}

async function loadFacets() {
  const key = `tcg:pokemon:facets:${LANG}`;
  const cached = cacheGet(key);
  try {
    const [categories, types, rarities] = await Promise.all(
      ['categories', 'types', 'rarities'].map((name) => getJson(`${LANG}/${name}`)),
    );
    const facets = { categories, types, rarities };
    cacheSet(key, facets);
    applyFacets(facets);
  } catch (err) {
    if (!cached) throw err;
    applyFacets(cached.v);
  }
}

// ---------- Carte de l'API -> format commun à tous les jeux ----------

// Résultat de liste : nom, numéro, image seulement
function normalizeBrief(b, sets, lang) {
  const localId = String(b.localId ?? '');
  const setId = localId ? b.id.slice(0, b.id.length - localId.length - 1) : b.id.split('-')[0];
  const set = sets.get(setId);
  return {
    game: 'pokemon',
    external_id: b.id, // ex. swsh3-136 : identique dans toutes les langues
    name: b.name,
    card_type: null,
    set_code: setId,
    set_name: set?.name ?? null,
    rarity: null,
    image_url: b.image ?? null, // adresse sans extension : voir thumbUrl / fullUrl
    data: { lang, number: localId, ...(set?.official ? { official: set.official } : {}) },
  };
}

// Texte de la carte : talents, attaques, effet, faiblesse...
function buildText(d, lang) {
  const fr = lang === 'fr';
  const lines = [];

  for (const ability of d.abilities ?? []) {
    lines.push(`${ability.type ?? (fr ? 'Talent' : 'Ability')} — ${ability.name}${ability.effect ? ` : ${ability.effect}` : ''}`);
  }
  for (const attack of d.attacks ?? []) {
    const cost = (attack.cost ?? []).join(' ');
    const damage = attack.damage != null && attack.damage !== '' ? ` (${attack.damage})` : '';
    lines.push(`${cost ? `${cost} ` : ''}${attack.name}${damage}${attack.effect ? ` : ${attack.effect}` : ''}`);
  }
  if (d.effect) lines.push(d.effect);
  if (d.weaknesses?.length) {
    lines.push(`${fr ? 'Faiblesse' : 'Weakness'} : ${d.weaknesses.map((w) => `${w.type} ${w.value ?? ''}`.trim()).join(', ')}`);
  }
  if (d.resistances?.length) {
    lines.push(`${fr ? 'Résistance' : 'Resistance'} : ${d.resistances.map((r) => `${r.type} ${r.value ?? ''}`.trim()).join(', ')}`);
  }
  if (d.retreat != null) lines.push(`${fr ? 'Retraite' : 'Retreat'} : ${d.retreat}`);
  if (d.description) lines.push(d.description);
  return lines.join('\n');
}

// ---------- Fournisseur ----------

export default {
  id: 'pokemon',
  label: 'Pokémon',
  idLabel: 'Code de la carte',
  idPlaceholder: 'ex. base1-4',
  idInputMode: 'text',
  namePlaceholder: 'ex. Dracaufeu',

  get typeGroups() {
    return groups;
  },

  // Appelé à l'arrivée sur le jeu : menu Type instantané depuis le cache,
  // puis mise à jour réseau si besoin (renvoie une promesse)
  init() {
    const cached = cacheGet(`tcg:pokemon:facets:${LANG}`);
    if (cached) applyFacets(cached.v);
    if (cached?.fresh) return undefined;
    return loadFacets();
  },

  validate({ mode, text, type }) {
    const query = text.trim();
    if (mode === 'id') {
      if (!query) return 'Entre le code de la carte (ex. base1-4).';
      if (!/^[a-z0-9.\-]{2,20}$/i.test(query)) return 'Le code ne contient que des lettres, chiffres, points et tirets (ex. sv03.5-025).';
      return null;
    }
    if (!query && !type) return 'Entre un nom, un code, ou choisis un type.';
    if (query && query.length < 2 && !type) return 'Entre au moins 2 caractères.';
    return null;
  },

  async search({ mode, text, type, offset = 0, lang = null }) {
    const query = text.trim();
    const group = type ? groups.find((g) => g.key === type) : null;
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    // Repli sur l'anglais seulement pour une recherche par nom sans filtre
    // (les valeurs des filtres sont dans la langue principale)
    const langs = lang ? [lang] : mode === 'id' || group ? [LANG] : [LANG, 'en'];

    for (const l of langs) {
      const parts = [];
      if (query) parts.push(`${mode === 'id' ? 'id' : 'name'}=${enc(query)}`);
      if (group) parts.push(group.param);
      parts.push(`pagination:page=${page}`, `pagination:itemsPerPage=${PAGE_SIZE}`);

      const list = await getJson(`${l}/cards?${parts.join('&')}`);
      if (!Array.isArray(list)) continue;
      if (!list.length && l !== langs[langs.length - 1]) continue;

      const sets = await getSets(l);
      return {
        cards: list.map((b) => normalizeBrief(b, sets, l)),
        total: null, // l'API ne donne pas le nombre total de résultats
        hasMore: list.length === PAGE_SIZE,
        nextOffset: offset + list.length,
        lang: l,
      };
    }
    return { cards: [], total: null, hasMore: false, nextOffset: offset, lang: langs[langs.length - 1] };
  },

  // Complète la fiche au moment de l'ajout (1 requête) : type, PV, rareté, attaques...
  async enrich(card) {
    const lang = card.data?.lang ?? LANG;
    try {
      const res = await fetch(`${API}/${lang}/cards/${enc(card.external_id)}`);
      if (!res.ok) return card;
      const d = await res.json();
      if (!d || Array.isArray(d)) return card;

      const data = {
        lang,
        number: String(d.localId ?? card.data?.number ?? ''),
        official: d.set?.cardCount?.official ?? card.data?.official,
        category: d.category,
        types: d.types,
        hp: d.hp,
        stage: d.stage,
        trainerType: d.trainerType,
        energyType: d.energyType,
        illustrator: d.illustrator,
        desc: buildText(d, lang),
      };
      for (const key of Object.keys(data)) {
        if (data[key] === undefined || data[key] === null || data[key] === '') delete data[key];
      }
      return {
        ...card,
        name: d.name ?? card.name,
        card_type: d.category ?? null,
        set_code: d.set?.id ?? card.set_code,
        set_name: d.set?.name ?? card.set_name,
        rarity: d.rarity ?? null,
        image_url: d.image ?? card.image_url,
        data,
      };
    } catch (err) {
      console.warn('Pokémon : détails indisponibles, carte ajoutée sans détails', err);
      return card;
    }
  },

  // Images : l'API donne une adresse sans extension, on choisit la taille
  thumbUrl(url) {
    return url ? `${url}/low.webp` : url; // 245 x 337
  },
  fullUrl(url) {
    return url ? `${url}/high.webp` : url; // 600 x 825
  },

  metaLine(card) {
    const d = card.data ?? {};
    const parts = [];
    if (card.card_type) parts.push(card.card_type);
    if (d.types?.length) parts.push(d.types.join(' / '));
    if (d.stage) parts.push(d.stage);
    if (d.hp != null) parts.push(`${d.lang === 'en' ? 'HP' : 'PV'} ${d.hp}`);
    if (card.set_name || card.set_code) parts.push(card.set_name ?? card.set_code);
    if (d.number) parts.push(d.official ? `${d.number}/${d.official}` : `n°${d.number}`);
    if (card.rarity) parts.push(card.rarity);
    parts.push(card.external_id);
    return parts.join(' · ');
  },
};
