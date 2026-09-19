// =====================================================================
// Yu-Gi-Oh! - fournisseur de données (API YGOPRODeck v7)
//
// Règles de l'API à respecter :
//  - 20 requêtes/seconde maximum (on ne fait qu'une requête par recherche)
//  - ne pas afficher les images en direct depuis leur serveur : on garde
//    seulement l'adresse en base, pour les héberger nous-mêmes plus tard
// =====================================================================

const API_URL = 'https://db.ygoprodeck.com/api/v7/cardinfo.php';
const PAGE_SIZE = 24;

// --- Types proposés dans le menu -> valeurs exactes attendues par l'API
const TYPE_GROUPS = [
  { key: 'spell', label: 'Magie', types: ['Spell Card'] },
  { key: 'trap', label: 'Piège', types: ['Trap Card'] },
  { key: 'normal', label: 'Monstre normal', types: ['Normal Monster', 'Normal Tuner Monster'] },
  {
    key: 'effect',
    label: 'Monstre à effet',
    types: [
      'Effect Monster', 'Flip Effect Monster', 'Flip Tuner Effect Monster', 'Gemini Monster',
      'Spirit Monster', 'Toon Monster', 'Tuner Monster', 'Union Effect Monster',
    ],
  },
  { key: 'ritual', label: 'Rituel', types: ['Ritual Monster', 'Ritual Effect Monster', 'Pendulum Effect Ritual Monster'] },
  { key: 'fusion', label: 'Fusion', types: ['Fusion Monster', 'Pendulum Effect Fusion Monster'] },
  { key: 'synchro', label: 'Synchro', types: ['Synchro Monster', 'Synchro Pendulum Effect Monster', 'Synchro Tuner Monster'] },
  { key: 'xyz', label: 'Xyz', types: ['XYZ Monster', 'XYZ Pendulum Effect Monster'] },
  { key: 'link', label: 'Lien (Link)', types: ['Link Monster'] },
  {
    key: 'pendulum',
    label: 'Pendule',
    types: [
      'Pendulum Effect Monster', 'Pendulum Normal Monster', 'Pendulum Flip Effect Monster',
      'Pendulum Tuner Effect Monster', 'Pendulum Effect Ritual Monster', 'Pendulum Effect Fusion Monster',
      'Synchro Pendulum Effect Monster', 'XYZ Pendulum Effect Monster',
    ],
  },
];

// --- Traductions d'affichage (l'API renvoie ces valeurs en anglais)
const TYPE_FR = {
  'Effect Monster': 'Monstre à effet',
  'Flip Effect Monster': 'Monstre Réversible à effet',
  'Flip Tuner Effect Monster': 'Monstre Syntoniseur Réversible à effet',
  'Gemini Monster': 'Monstre Gémeau',
  'Normal Monster': 'Monstre normal',
  'Normal Tuner Monster': 'Monstre Syntoniseur normal',
  'Pendulum Effect Monster': 'Monstre Pendule à effet',
  'Pendulum Effect Ritual Monster': 'Monstre Pendule Rituel à effet',
  'Pendulum Flip Effect Monster': 'Monstre Pendule Réversible à effet',
  'Pendulum Normal Monster': 'Monstre Pendule normal',
  'Pendulum Tuner Effect Monster': 'Monstre Pendule Syntoniseur à effet',
  'Ritual Effect Monster': 'Monstre Rituel à effet',
  'Ritual Monster': 'Monstre Rituel',
  'Spell Card': 'Carte Magie',
  'Spirit Monster': 'Monstre Spirit',
  'Toon Monster': 'Monstre Toon',
  'Trap Card': 'Carte Piège',
  'Tuner Monster': 'Monstre Syntoniseur',
  'Union Effect Monster': 'Monstre Union à effet',
  'Fusion Monster': 'Monstre Fusion',
  'Link Monster': 'Monstre Lien',
  'Pendulum Effect Fusion Monster': 'Monstre Pendule Fusion à effet',
  'Synchro Monster': 'Monstre Synchro',
  'Synchro Pendulum Effect Monster': 'Monstre Pendule Synchro à effet',
  'Synchro Tuner Monster': 'Monstre Synchro Syntoniseur',
  'XYZ Monster': 'Monstre Xyz',
  'XYZ Pendulum Effect Monster': 'Monstre Pendule Xyz à effet',
  'Skill Card': 'Carte Compétence',
  Token: 'Jeton',
};

const ATTRIBUTE_FR = {
  DARK: 'Ténèbres', LIGHT: 'Lumière', EARTH: 'Terre', WATER: 'Eau',
  FIRE: 'Feu', WIND: 'Vent', DIVINE: 'Divin',
};

const RACE_FR = {
  Aqua: 'Aqua', Beast: 'Bête', 'Beast-Warrior': 'Bête-Guerrier', 'Creator-God': 'Dieu Créateur',
  Cyberse: 'Cyberse', Dinosaur: 'Dinosaure', 'Divine-Beast': 'Bête Divine', Dragon: 'Dragon',
  Fairy: 'Elfe', Fiend: 'Démon', Fish: 'Poisson', Insect: 'Insecte', Machine: 'Machine',
  Plant: 'Plante', Psychic: 'Psychique', Pyro: 'Pyro', Reptile: 'Reptile', Rock: 'Rocher',
  'Sea Serpent': 'Serpent de Mer', Spellcaster: 'Magicien', Thunder: 'Tonnerre',
  Warrior: 'Guerrier', 'Winged Beast': 'Bête Ailée', Wyrm: 'Wyrm', Zombie: 'Zombie',
  // Magies / Pièges
  Normal: 'Normale', Field: 'Terrain', Equip: 'Équipement', Continuous: 'Continue',
  'Quick-Play': 'Jeu-Rapide', Ritual: 'Rituelle', Counter: 'Contre',
};

// --- Appel à l'API : français d'abord, anglais si aucune traduction
async function fetchCards(params, langs) {
  let apiMessage = null;

  for (const lang of langs) {
    const url = new URL(API_URL);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    if (lang === 'fr') url.searchParams.set('language', 'fr');

    const res = await fetch(url);

    if (res.ok) {
      const json = await res.json();
      if (json.data?.length) return { json, lang };
      continue;
    }
    if (res.status !== 400) {
      // 429 (trop de requêtes), 5xx... : vraie panne, pas un « aucun résultat »
      const err = new Error(`API YGOPRODeck : erreur ${res.status}`);
      err.status = res.status;
      throw err;
    }
    // 400 = « aucune carte trouvée » (ou paramètre refusé)
    const body = await res.json().catch(() => null);
    apiMessage = body?.error ?? null;
  }

  if (apiMessage && !/no card matching/i.test(apiMessage)) {
    console.warn('YGOPRODeck :', apiMessage);
  }
  return { json: { data: [], meta: { total_rows: 0 } }, lang: langs[langs.length - 1] };
}

// --- Carte de l'API -> format commun à tous les jeux
function normalize(c) {
  const data = {};
  const keep = ['desc', 'atk', 'def', 'level', 'race', 'attribute', 'archetype', 'linkval', 'scale'];
  for (const key of keep) {
    if (c[key] !== undefined && c[key] !== null) data[key] = c[key];
  }
  return {
    game: 'yugioh',
    external_id: String(c.id),
    name: c.name,
    card_type: c.type,
    // Adresse gardée en base, mais pas affichée pour l'instant (voir en-tête)
    image_url: c.card_images?.[0]?.image_url_small ?? null,
    data,
  };
}

const typeLabel = (type) => TYPE_FR[type] ?? type ?? 'Carte';

export default {
  id: 'yugioh',
  label: 'Yu-Gi-Oh!',
  idLabel: 'Code de la carte',
  idPlaceholder: 'ex. 46986414',
  namePlaceholder: 'ex. Magicien Sombre',
  typeGroups: TYPE_GROUPS,

  // Renvoie un message d'erreur, ou null si la recherche est valide
  validate({ mode, text, type }) {
    const query = text.trim();
    if (mode === 'id') {
      if (!query) return 'Entre le code de la carte (le nombre écrit en bas à gauche).';
      if (!/^\d{3,10}$/.test(query)) return 'Le code de la carte ne contient que des chiffres.';
      return null;
    }
    if (!query && !type) return 'Entre un nom, un code, ou choisis un type.';
    if (query && query.length < 2 && !type) return 'Entre au moins 2 caractères.';
    return null;
  },

  async search({ mode, text, type, offset = 0, lang = null }) {
    const query = text.trim();
    const params = {};

    if (mode === 'id') {
      params.id = query;
    } else {
      if (query) params.fname = query;
      if (type) {
        const group = TYPE_GROUPS.find((g) => g.key === type);
        if (group) params.type = group.types.join(',');
      }
      params.sort = 'name';
      params.num = PAGE_SIZE;
      params.offset = offset;
    }

    const { json, lang: usedLang } = await fetchCards(params, lang ? [lang] : ['fr', 'en']);
    const meta = json.meta ?? {};
    const cards = (json.data ?? []).map(normalize);

    return {
      cards,
      total: meta.total_rows ?? cards.length,
      hasMore: (meta.rows_remaining ?? 0) > 0,
      nextOffset: meta.next_page_offset ?? offset + cards.length,
      lang: usedLang,
    };
  },

  // Ligne de détails affichée sous le nom de la carte
  metaLine(card) {
    const d = card.data ?? {};
    const parts = [typeLabel(card.card_type)];
    const isMonster = /Monster/.test(card.card_type ?? '');

    if (d.race) parts.push(RACE_FR[d.race] ?? d.race);
    if (d.attribute) parts.push(ATTRIBUTE_FR[d.attribute] ?? d.attribute);
    if (d.linkval != null) parts.push(`Lien ${d.linkval}`);
    else if (d.level != null) parts.push(`${/XYZ/.test(card.card_type) ? 'Rang' : 'Niv.'} ${d.level}`);
    if (isMonster && d.atk != null) {
      parts.push(d.def != null ? `ATK ${d.atk} / DEF ${d.def}` : `ATK ${d.atk}`);
    }
    parts.push(`Code ${card.external_id}`);
    return parts.join(' · ');
  },
};
