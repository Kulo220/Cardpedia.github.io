// =====================================================================
// Règles de construction de deck, par jeu
//
// Ce fichier ne touche ni au navigateur ni à la base : il ne fait que
// décider « cette carte peut-elle entrer dans ce deck ? » et « ce deck
// est-il complet et légal ? ».
//
// Sources des règles :
//  - Yu-Gi-Oh!  : 40-60 cartes, Extra Deck et Side Deck de 15 max, 3 exemplaires
//  - Magic      : Constructeur 60+15 / 4 exemplaires ; Commander 100 / singleton
//  - Pokémon    : 60 cartes, 4 exemplaires par nom (sauf Énergies de base)
//  - Riftbound  : règles de construction officielles (Deckbuilding Primer),
//                 side deck de 10 cartes depuis la mise à jour de juillet 2026
//
// Non contrôlé (les données de l'API ne permettent pas de le vérifier) :
//  cartes interdites/limitées (Yu-Gi-Oh!, Magic, Pokémon), identité de couleur
//  en Commander, cartes ACE SPEC/Radieuses en Pokémon, tags de champion
//  en Riftbound.
//
// Un deck = { game, format, cards: [{ zone, quantity, card }] }
// =====================================================================

const normalize = (s) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const pl = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

// ---------- Yu-Gi-Oh! ----------

const YGO_EXTRA_TYPES = new Set([
  'Fusion Monster',
  'Synchro Monster',
  'XYZ Monster',
  'Link Monster',
  'Synchro Tuner Monster',
  'Pendulum Effect Fusion Monster',
  'Synchro Pendulum Effect Monster',
  'XYZ Pendulum Effect Monster',
]);
const ygoExtra = (card) => YGO_EXTRA_TYPES.has(card.card_type);
const ygoPlayable = (card) => !['Token', 'Skill Card'].includes(card.card_type);

// ---------- Magic ----------

const typeLine = (card) => card.data?.type_line ?? card.card_type ?? '';
const isBasicLand = (card) => /Basic Land/i.test(typeLine(card));

// ---------- Pokémon ----------

const isBasicEnergy = (card) =>
  /nergi|energy/i.test(card.card_type ?? '') && !/sp[ée]cia/i.test(card.data?.energyType ?? '');

// ---------- Riftbound ----------

const RB_SPECIAL = new Set(['Legend', 'Rune', 'Battlefield']);
const rbMain = (card) => !RB_SPECIAL.has(card.card_type);
const rbLegend = (deck) => deck.cards.find((row) => row.zone === 'legend')?.card ?? null;

function rbDomainProblem(deck, card) {
  const legend = rbLegend(deck);
  const allowed = legend?.data?.domain ?? [];
  if (!legend || !allowed.length) return null;
  const outside = (card.data?.domain ?? []).filter((d) => !allowed.includes(d));
  return outside.length ? `« ${card.name} » est hors de l'identité de domaine de ta légende (${allowed.join(' / ')}).` : null;
}

// ---------- Définition des jeux ----------
// zone : { key, label, short, min, max, group, auto, accepts(card) }
//  - group : les zones d'un même groupe se partagent la limite d'exemplaires
//  - auto  : la carte peut y être envoyée automatiquement (sinon bouton dédié)

export const RULES = {
  yugioh: {
    formats: null,
    defaultFormat: null,
    notes: "La liste des cartes interdites et limitées n'est pas contrôlée.",
    zones: () => [
      { key: 'main', label: 'Deck principal', short: 'Deck', min: 40, max: 60, group: 'copies', auto: true, accepts: (c) => ygoPlayable(c) && !ygoExtra(c) },
      { key: 'extra', label: 'Extra Deck', short: 'Extra', min: 0, max: 15, group: 'copies', auto: true, accepts: ygoExtra },
      { key: 'side', label: 'Side Deck', short: 'Side', min: 0, max: 15, group: 'copies', auto: false, accepts: ygoPlayable },
    ],
    identity: (c) => String(c.external_id),
    limit: () => 3,
    isBasic: () => false,
  },

  magic: {
    formats: [
      { key: 'constructed', label: 'Constructeur (60 cartes, 4 exemplaires max)' },
      { key: 'commander', label: 'Commander (100 cartes, 1 exemplaire)' },
      { key: 'limited', label: 'Limité (40 cartes minimum)' },
    ],
    defaultFormat: 'constructed',
    notes: "La légalité des cartes par format et l'identité de couleur en Commander ne sont pas contrôlées.",
    zones: (format) => {
      if (format === 'commander') {
        return [
          { key: 'commander', label: 'Commandant', short: 'Commandant', min: 1, max: 2, group: 'copies', auto: false, accepts: (c) => /Legendary/i.test(typeLine(c)) },
          { key: 'main', label: 'Deck (99 cartes avec le commandant)', short: 'Deck', min: 98, max: 99, group: 'copies', auto: true, accepts: () => true },
        ];
      }
      if (format === 'limited') {
        return [
          { key: 'main', label: 'Deck', short: 'Deck', min: 40, max: Infinity, group: 'copies', auto: true, accepts: () => true },
          { key: 'side', label: 'Réserve', short: 'Réserve', min: 0, max: Infinity, group: 'copies', auto: false, accepts: () => true },
        ];
      }
      return [
        { key: 'main', label: 'Deck', short: 'Deck', min: 60, max: Infinity, group: 'copies', auto: true, accepts: () => true },
        { key: 'side', label: 'Réserve', short: 'Réserve', min: 0, max: 15, group: 'copies', auto: false, accepts: () => true },
      ];
    },
    // Commander : le commandant + le deck font exactement 100 cartes
    total: (format) => (format === 'commander' ? { zones: ['commander', 'main'], min: 100, max: 100, label: 'Deck Commander' } : null),
    identity: (c) => normalize(c.data?.name_en ?? c.name),
    limit: (card, group, format) => {
      if (isBasicLand(card)) return Infinity;
      if (format === 'commander') return 1;
      if (format === 'limited') return Infinity;
      return 4;
    },
    isBasic: isBasicLand,
  },

  pokemon: {
    formats: null,
    defaultFormat: null,
    notes: "Les règles particulières (ACE SPEC, Pokémon Radieux, un Pokémon de base obligatoire) ne sont pas contrôlées.",
    zones: () => [{ key: 'main', label: 'Deck', short: 'Deck', min: 60, max: 60, group: 'copies', auto: true, accepts: () => true }],
    identity: (c) => normalize(c.name),
    limit: (card) => (isBasicEnergy(card) ? Infinity : 4),
    isBasic: isBasicEnergy,
  },

  riftbound: {
    formats: null,
    defaultFormat: null,
    notes: "Les tags de champion (champion choisi, cartes Signature) ne sont pas contrôlés, seul le nombre de cartes Signature l'est.",
    zones: () => [
      { key: 'legend', label: 'Légende', short: 'Légende', min: 1, max: 1, group: 'legend', auto: true, accepts: (c) => c.card_type === 'Legend' },
      { key: 'main', label: 'Deck principal', short: 'Deck', min: 40, max: Infinity, group: 'copies', auto: true, accepts: rbMain },
      { key: 'runes', label: 'Runes', short: 'Runes', min: 12, max: 12, group: 'runes', auto: true, accepts: (c) => c.card_type === 'Rune' },
      { key: 'battlefields', label: 'Champs de bataille', short: 'Champ', min: 3, max: 3, group: 'battlefields', auto: true, accepts: (c) => c.card_type === 'Battlefield' },
      { key: 'side', label: 'Side Deck', short: 'Side', min: 0, max: 10, group: 'copies', auto: false, accepts: rbMain },
    ],
    identity: (c) => normalize(String(c.name ?? '').replace(/\s*\([^)]*\)\s*$/, '')), // « Fury Rune (Alternate Art) » = « Fury Rune »
    limit: (card, group) => (group === 'copies' ? 3 : group === 'runes' ? Infinity : 1),
    isBasic: (c) => c.data?.supertype === 'Basic',
    // Règles propres à Riftbound : identité de domaine, cartes Signature
    check(deck, card, zoneKey) {
      if (['main', 'runes', 'side'].includes(zoneKey)) {
        const problem = rbDomainProblem(deck, card);
        if (problem) return problem;
      }
      if (['main', 'side'].includes(zoneKey) && card.data?.supertype === 'Signature') {
        const n = sumQuantity(deck, (row) => ['main', 'side'].includes(row.zone) && row.card.data?.supertype === 'Signature');
        if (n >= 3) return 'Maximum 3 cartes Signature dans le deck.';
      }
      return null;
    },
    issues(deck) {
      const out = [];
      for (const row of deck.cards) {
        if (['main', 'runes', 'side'].includes(row.zone)) {
          const problem = rbDomainProblem(deck, row.card);
          if (problem) out.push(problem);
        }
      }
      const signatures = sumQuantity(deck, (row) => ['main', 'side'].includes(row.zone) && row.card.data?.supertype === 'Signature');
      if (signatures > 3) out.push(`${signatures} cartes Signature (3 maximum).`);
      return out;
    },
  },
};

export const rulesFor = (game) => RULES[game] ?? null;

// ---------- Outils de comptage ----------

function sumQuantity(deck, predicate = () => true) {
  return deck.cards.filter(predicate).reduce((sum, row) => sum + row.quantity, 0);
}

export const countIn = (deck, zoneKey) => sumQuantity(deck, (row) => row.zone === zoneKey);

// Zones du format + zones « orphelines » (cartes restées dans une zone qui n'existe
// plus après un changement de format)
export function zonesOf(deck) {
  const rules = rulesFor(deck.game);
  if (!rules) return [];
  const zones = rules.zones(deck.format);
  const known = new Set(zones.map((z) => z.key));
  const orphans = [...new Set(deck.cards.map((r) => r.zone))]
    .filter((key) => !known.has(key))
    .map((key) => ({
      key,
      label: `Hors format (${key})`,
      short: key,
      min: 0,
      max: 0,
      group: `orphan-${key}`,
      auto: false,
      accepts: () => false,
      orphan: true,
    }));
  return [...zones, ...orphans];
}

const rangeText = (zone) => {
  if (zone.orphan) return 'à retirer';
  if (zone.min === zone.max) return `${zone.min}`;
  if (zone.max === Infinity) return `${zone.min} minimum`;
  return zone.min ? `${zone.min} à ${zone.max}` : `${zone.max} maximum`;
};
export { rangeText };

// ---------- Ajout d'une carte : autorisé ? ----------

export function canAdd(deck, card, zoneKey, quantity = 1) {
  const rules = rulesFor(deck.game);
  if (!rules) return { ok: false, reason: "Ce jeu n'est pas pris en charge." };

  const zones = rules.zones(deck.format);
  const zone = zones.find((z) => z.key === zoneKey);
  if (!zone) return { ok: false, reason: "Cette zone n'existe pas dans ce format." };

  if (!zone.accepts(card, deck)) {
    return { ok: false, reason: `Cette carte ne peut pas aller dans « ${zone.label} ».` };
  }
  if (countIn(deck, zone.key) + quantity > zone.max) {
    return { ok: false, reason: `« ${zone.label} » est complet (${zone.max} maximum).` };
  }

  const total = rules.total?.(deck.format);
  if (total?.zones.includes(zone.key)) {
    const n = sumQuantity(deck, (row) => total.zones.includes(row.zone));
    if (n + quantity > total.max) return { ok: false, reason: `${total.label} : ${total.max} cartes au maximum.` };
  }

  const limit = rules.limit(card, zone.group, deck.format);
  if (limit !== Infinity) {
    const groupZones = zones.filter((z) => z.group === zone.group).map((z) => z.key);
    const identity = rules.identity(card);
    const n = sumQuantity(deck, (row) => groupZones.includes(row.zone) && rules.identity(row.card) === identity);
    if (n + quantity > limit) {
      return {
        ok: false,
        reason: limit === 1 ? 'Un seul exemplaire de cette carte est autorisé.' : `${limit} exemplaires maximum de « ${card.name} ».`,
      };
    }
  }

  const problem = rules.check?.(deck, card, zone.key);
  if (problem) return { ok: false, reason: problem };
  return { ok: true };
}

// Zone choisie automatiquement pour une carte (ou null si aucune ne l'accepte)
export function autoZone(deck, card) {
  const zones = rulesFor(deck.game)?.zones(deck.format) ?? [];
  return zones.find((z) => z.auto && z.accepts(card, deck))?.key ?? null;
}

// Autres zones proposées en bouton séparé (side, commandant...)
export function alternativeZones(deck, card) {
  const zones = rulesFor(deck.game)?.zones(deck.format) ?? [];
  const auto = autoZone(deck, card);
  return zones.filter((z) => z.key !== auto && z.accepts(card, deck)).map((z) => z.key);
}

// ---------- Le deck est-il complet et légal ? ----------

export function evaluate(deck) {
  const rules = rulesFor(deck.game);
  const zones = zonesOf(deck);
  const issues = [];

  const report = zones.map((zone) => {
    const rows = deck.cards.filter((row) => row.zone === zone.key);
    const count = rows.reduce((sum, row) => sum + row.quantity, 0);
    let state = 'ok';

    if (zone.orphan) {
      state = 'bad';
      if (count) issues.push(`${pl(count, 'carte')} dans une zone qui n'existe pas dans ce format : à retirer.`);
    } else if (count < zone.min) {
      state = 'warn';
      issues.push(
        zone.min === zone.max
          ? `${zone.label} : ${pl(count, 'carte')}, il en faut ${zone.min}.`
          : `${zone.label} : ${pl(count, 'carte')}, il en faut au moins ${zone.min}.`,
      );
    } else if (count > zone.max) {
      state = 'bad';
      issues.push(`${zone.label} : ${pl(count, 'carte')} (${zone.max} maximum).`);
    }
    if (!zone.orphan) {
      for (const row of rows) {
        if (!zone.accepts(row.card, deck)) {
          state = 'bad';
          issues.push(`« ${row.card.name} » ne peut pas être dans « ${zone.label} ».`);
        }
      }
    }
    return { zone, rows, count, state };
  });

  // exemplaires par groupe
  if (rules) {
    const seen = new Set();
    for (const row of deck.cards) {
      const zone = zones.find((z) => z.key === row.zone);
      if (!zone || zone.orphan) continue;
      const limit = rules.limit(row.card, zone.group, deck.format);
      if (limit === Infinity) continue;
      const identity = rules.identity(row.card);
      const mark = `${zone.group}|${identity}`;
      if (seen.has(mark)) continue;
      seen.add(mark);
      const groupZones = zones.filter((z) => z.group === zone.group).map((z) => z.key);
      const n = sumQuantity(deck, (r) => groupZones.includes(r.zone) && rules.identity(r.card) === identity);
      if (n > limit) issues.push(`« ${row.card.name} » : ${pl(n, 'exemplaire')} (${limit} maximum).`);
    }

    const total = rules.total?.(deck.format);
    if (total) {
      const n = sumQuantity(deck, (r) => total.zones.includes(r.zone));
      if (n !== total.max) issues.push(`${total.label} : ${pl(n, 'carte')}, il en faut exactement ${total.max}.`);
      // (les doublons éventuels avec un simple manque sont déjà signalés zone par zone)
    }
    issues.push(...(rules.issues?.(deck) ?? []));
  }

  // un message n'est affiché qu'une fois
  const unique = [...new Set(issues)];
  return { zones: report, issues: unique, legal: unique.length === 0 };
}

// ---------- Cartes qui manquent par rapport à ta collection ----------

// owned : Map identité -> exemplaires possédés
export function missingCards(deck, owned, { ignoreBasics = true } = {}) {
  const rules = rulesFor(deck.game);
  const needs = new Map();
  for (const row of deck.cards) {
    if (ignoreBasics && rules.isBasic?.(row.card)) continue;
    const id = rules.identity(row.card);
    const entry = needs.get(id) ?? { identity: id, card: row.card, need: 0 };
    entry.need += row.quantity;
    needs.set(id, entry);
  }
  const lines = [...needs.values()].map((entry) => {
    const have = owned.get(entry.identity) ?? 0;
    return { ...entry, have, missing: Math.max(0, entry.need - have) };
  });
  return {
    lines,
    totalNeeded: lines.reduce((sum, l) => sum + l.need, 0),
    totalMissing: lines.reduce((sum, l) => sum + l.missing, 0),
  };
}

// Ce que tu possèdes, par identité de carte du jeu
export function ownedByIdentity(game, entries) {
  const rules = rulesFor(game);
  const owned = new Map();
  for (const { card, quantity } of entries) {
    const id = rules.identity(card);
    owned.set(id, (owned.get(id) ?? 0) + quantity);
  }
  return owned;
}
