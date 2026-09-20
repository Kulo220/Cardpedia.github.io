// =====================================================================
// Moteur commun aux pages « collection » et « wishlist »
// (chaque page indique son rôle avec <body data-page="...">)
//  1. on choisit un jeu (sur la wishlist : ou « Tous les jeux »)
//  2. onglet « Ma collection / Ma wishlist » : tes cartes (filtrables)
//  3. onglet « Ajouter des cartes » : recherche via l'API du jeu
//  4. wishlist seulement : « Toutes les wishlists » (lecture seule)
// =====================================================================

import { supabase } from './config.js';
import { GAMES, getGame } from './games.js?v=9';

// Numéro de version : sert à détecter des fichiers mélangés (anciens/nouveaux)
const APP_VERSION = '9';
window.__tcgVersion = APP_VERSION;

// Affichage des images des cartes, directement depuis le serveur de l'API.
// Passe à false pour tout désactiver d'un coup (ex. si l'API bloque les images).
const SHOW_IMAGES = true;

const $ = (id) => document.getElementById(id);

// ---------- Rôle de la page ----------

const PAGE = document.body.dataset.page === 'wishlist' ? 'wishlist' : 'collection';

const PAGES = {
  collection: {
    table: 'collection_items',
    allGames: false, // un seul jeu à la fois
    community: false,
    notes: false,
    savedKey: 'tcg:game',
    copy: ['exemplaire', 'exemplaires'],
    text: {
      loading: 'Chargement de ta collection…',
      empty: "Ta collection est vide pour l'instant. Va dans « Ajouter des cartes » pour commencer.",
      noMatch: 'Aucune carte de ta collection ne correspond.',
      badge: 'Possédée',
      add: 'Ajouter',
      confirmRemove: 'Retirer cette carte de ta collection ?',
      minus: 'Retirer un exemplaire',
      plus: 'Ajouter un exemplaire',
    },
  },
  wishlist: {
    table: 'wishlist_items',
    allGames: true, // « Tous les jeux » possible
    community: true,
    notes: true,
    savedKey: 'tcg:wish:game',
    copy: ['exemplaire souhaité', 'exemplaires souhaités'],
    text: {
      loading: 'Chargement de ta wishlist…',
      empty: "Ta wishlist est vide pour l'instant. Va dans « Ajouter des cartes » pour commencer.",
      noMatch: 'Aucune carte de ta wishlist ne correspond.',
      badge: 'Dans ta wishlist',
      add: 'Ajouter à la wishlist',
      confirmRemove: 'Retirer cette carte de ta wishlist ?',
      minus: 'Souhaiter un exemplaire de moins',
      plus: 'Souhaiter un exemplaire de plus',
    },
  },
};
const CFG = PAGES[PAGE];

const CARD_COLUMNS = 'id, game, external_id, name, card_type, image_url, data, set_code, set_name, rarity';

const ui = {
  games: $('games'),
  hint: $('hint'),
  workspace: $('workspace'),
  tabMine: $('tab-mine'),
  tabAdd: $('tab-add'),
  tabCommunity: $('tab-community'), // wishlist seulement
  count: $('count'),
  form: $('search-form'),
  mode: $('mode'),
  text: $('text'),
  textLabel: $('text-label'),
  type: $('type'),
  user: $('user'), // wishlist : filtre par utilisateur
  searchBtn: $('search-btn'),
  status: $('status'),
  list: $('results'),
  more: $('more'),
  lightbox: $('lightbox'),
  lightboxImg: $('lightbox-img'),
  lightboxName: $('lightbox-name'),
  lightboxMeta: $('lightbox-meta'),
};

const state = {
  userId: null,
  chosen: false, // un jeu (ou « Tous les jeux ») a été choisi
  game: null, // jeu choisi ; null + chosen = « Tous les jeux » (wishlist)
  tab: 'mine', // 'mine' | 'add' | 'community'
  owned: new Map(), // clé de carte -> { itemId, quantity, note, card }
  community: { entries: [], owned: new Map() }, // toutes les wishlists
  results: [], // résultats de l'API (onglet « Ajouter »)
  search: freshSearch(),
  forms: freshForms(),
  token: 0, // ignore les réponses d'une recherche périmée
};

function freshSearch() {
  return { offset: 0, lang: null, hasMore: false, total: 0, done: false, query: null };
}
function freshForms() {
  return {
    mine: { mode: 'name', text: '', type: '' },
    add: { mode: 'name', text: '', type: '' },
    community: { mode: 'name', text: '', type: '' },
  };
}

// Une carte = un jeu + son identifiant (deux jeux pourraient avoir le même identifiant)
const keyOf = (card) => `${card.game}:${card.external_id}`;
const providerOf = (card) => getGame(card.game)?.provider ?? null;

// ---------- Petits utilitaires ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text; // textContent : jamais de HTML venant d'une API
  return node;
}

const normalize = (s) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const pluralCopy = (n) => `${n} ${CFG.copy[n > 1 ? 1 : 0]}`;

function setStatus(message, isError = false) {
  ui.status.textContent = message;
  ui.status.classList.toggle('is-error', isError);
}

function friendlyError(err) {
  const text = `${err?.code ?? ''} ${err?.message ?? ''}`;
  if (/wishlist_items|PGRST205|42P01/i.test(text)) {
    return "La base n'est pas à jour : exécute wishlist_v1.sql dans le SQL Editor de Supabase.";
  }
  if (/PGRST204|42703|card_type|does not exist/i.test(text)) {
    return "La base n'est pas à jour : exécute collection_v2.sql dans le SQL Editor de Supabase.";
  }
  if (/row-level security|42501/i.test(text)) {
    return "La base refuse l'opération (droits). Vérifie que collection_v2.sql a bien été exécuté.";
  }
  return `Une erreur est survenue : ${err?.message ?? 'inconnue'}`;
}

function readSavedGame() {
  try {
    return localStorage.getItem(CFG.savedKey);
  } catch {
    return null;
  }
}
function saveGame(id) {
  try {
    localStorage.setItem(CFG.savedKey, id);
  } catch {
    /* stockage indisponible : pas grave */
  }
}

// ---------- Choix du jeu ----------

function renderGames() {
  ui.games.replaceChildren();

  if (CFG.allGames) {
    const all = el('button', 'chip', 'Tous les jeux');
    all.type = 'button';
    all.setAttribute('aria-pressed', String(state.chosen && !state.game));
    all.addEventListener('click', () => selectGame('all'));
    ui.games.append(all);
  }

  for (const game of GAMES) {
    const chip = el('button', 'chip', game.label);
    chip.type = 'button';
    if (game.provider) {
      chip.setAttribute('aria-pressed', String(state.game?.id === game.id));
      chip.addEventListener('click', () => selectGame(game.id));
    } else {
      chip.disabled = true;
      chip.append(el('small', null, 'bientôt'));
    }
    ui.games.append(chip);
  }
}

// Le sélecteur de type et le mode « code » n'existent que pour un jeu précis
function toggleGameFields() {
  const hasGame = Boolean(state.game);
  ui.mode.closest('.field').hidden = !hasGame;
  ui.type.closest('.field').hidden = !hasGame;
}

async function selectGame(id) {
  const all = id === 'all' && CFG.allGames;
  const game = all ? null : getGame(id);
  if (!all && !game) return;
  if (state.chosen && game === state.game) return;

  state.chosen = true;
  state.game = game;
  state.results = [];
  state.search = freshSearch();
  state.forms = freshForms();
  state.owned = new Map();
  state.community = { entries: [], owned: new Map() };
  saveGame(id);

  renderGames();
  ui.hint.hidden = true;
  ui.workspace.hidden = false;
  toggleGameFields();

  if (game) {
    // Menu des types propre au jeu
    const ready = game.provider.init?.(); // peut renvoyer une promesse (ex. Pokémon)
    fillTypeSelect();
    if (ready?.then) {
      ready
        .then(() => {
          if (state.game === game) fillTypeSelect();
        })
        .catch((err) => console.warn('Initialisation du jeu :', err));
    }
    ui.mode.options[1].textContent = game.provider.idLabel;
  }

  // on reste sur « Toutes les wishlists » si on y était ; sinon retour à la liste
  if (state.tab !== 'community') state.tab = 'mine';
  loadFormValues();
  updateTabs();

  setStatus(CFG.text.loading);
  ui.list.replaceChildren();
  try {
    await loadOwned();
    if (state.tab === 'community') await loadCommunity();
  } catch (err) {
    console.error(err);
    setStatus(friendlyError(err), true);
    return;
  }
  renderList();
}

// Menu « Type » : options (éventuellement en sections) fournies par le jeu.
// Peut être rappelé quand le jeu affine sa liste (ex. après chargement du catalogue).
function fillTypeSelect() {
  if (!state.game) return;
  const keep = ui.type.value;
  ui.type.replaceChildren(new Option('Tous types', ''));
  const sections = new Map();
  const groups = state.game.provider.typeGroups;

  for (const group of groups) {
    let parent = ui.type;
    if (group.section) {
      if (!sections.has(group.section)) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = group.section;
        ui.type.append(optgroup);
        sections.set(group.section, optgroup);
      }
      parent = sections.get(group.section);
    }
    parent.append(new Option(group.label, group.key));
  }
  ui.type.value = groups.some((g) => g.key === keep) ? keep : '';
}

// ---------- Données (Supabase) ----------

// Supabase renvoie 1000 lignes au maximum par requête : on lit par paquets
async function fetchAll(makeQuery) {
  const rows = [];
  const step = 1000;
  for (let from = 0; ; from += step) {
    const { data, error } = await makeQuery().order('id').range(from, from + step - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < step) break;
  }
  return rows;
}

// Tes cartes (collection ou wishlist), pour le jeu choisi ou pour tous les jeux
async function loadOwned() {
  const columns = `id, quantity${CFG.notes ? ', note' : ''}, cards!inner(${CARD_COLUMNS})`;
  const rows = await fetchAll(() => {
    let query = supabase.from(CFG.table).select(columns).eq('user_id', state.userId);
    if (state.game) query = query.eq('cards.game', state.game.id);
    return query;
  });
  state.owned = new Map(
    rows.map((r) => [keyOf(r.cards), { itemId: r.id, quantity: r.quantity, note: r.note ?? '', card: r.cards }]),
  );
}

// Les wishlists de tous les utilisateurs (lecture seule), regroupées par carte
async function loadCommunity() {
  setStatus('Chargement des wishlists…');
  const rows = await fetchAll(() => {
    let query = supabase
      .from('wishlist_items')
      .select(`id, quantity, note, user_id, cards!inner(${CARD_COLUMNS})`);
    if (state.game) query = query.eq('cards.game', state.game.id);
    return query;
  });

  const { data: profiles, error } = await supabase.from('profiles').select('id, username');
  if (error) throw error;
  const names = new Map((profiles ?? []).map((p) => [p.id, p.username]));

  // ce que TU possèdes déjà (pour repérer ce que tu pourrais offrir ou échanger)
  const mine = await fetchAll(() => supabase.from('collection_items').select('id, card_id, quantity').eq('user_id', state.userId));
  const owned = new Map(mine.map((r) => [r.card_id, r.quantity]));

  const byCard = new Map();
  for (const r of rows) {
    const key = keyOf(r.cards);
    if (!byCard.has(key)) byCard.set(key, { card: r.cards, wanters: [] });
    byCard.get(key).wanters.push({
      userId: r.user_id,
      name: names.get(r.user_id) ?? 'utilisateur inconnu',
      quantity: r.quantity,
      note: r.note ?? '',
    });
  }
  state.community = { entries: [...byCard.values()], owned };
  fillUserSelect();
}

// Menu « Utilisateur » : ceux qui ont au moins une carte dans la wishlist chargée
function fillUserSelect() {
  if (!ui.user) return;
  const keep = ui.user.value;
  const users = new Map();
  for (const entry of state.community.entries) {
    for (const w of entry.wanters) users.set(w.userId, w.name);
  }
  ui.user.replaceChildren(new Option('Tous les utilisateurs', ''));
  [...users]
    .sort((a, b) => a[1].localeCompare(b[1], 'fr'))
    .forEach(([id, name]) => ui.user.append(new Option(id === state.userId ? `${name} (moi)` : name, id)));
  ui.user.value = users.has(keep) ? keep : '';
}

// Retrouve la carte dans le catalogue partagé, ou l'y ajoute.
// Renvoie la ligne enregistrée (avec son id).
async function ensureCard(card) {
  const columns = 'id, game, external_id, name, card_type, image_url, data, set_code, set_name, rarity';
  const find = () =>
    supabase
      .from('cards')
      .select(columns)
      .eq('game', card.game)
      .eq('external_id', card.external_id)
      .maybeSingle();

  let { data, error } = await find();
  if (error) throw error;
  if (data) return data;

  // Le jeu peut compléter la fiche avant l'enregistrement
  // (ex. Pokémon : la recherche ne donne ni type, ni PV, ni rareté)
  const provider = getGame(card.game)?.provider;
  const full = (await provider?.enrich?.(card)) ?? card;

  const inserted = await supabase
    .from('cards')
    .insert({
      game: full.game,
      external_id: full.external_id,
      name: full.name,
      card_type: full.card_type,
      set_code: full.set_code ?? null,
      set_name: full.set_name ?? null,
      rarity: full.rarity ?? null,
      image_url: full.image_url,
      data: full.data,
      source: 'api',
    })
    .select(columns)
    .single();
  if (!inserted.error) return inserted.data;

  // Quelqu'un vient de l'ajouter en même temps : on la relit
  if (inserted.error.code === '23505') {
    ({ data, error } = await find());
    if (data) return data;
  }
  throw inserted.error;
}

async function addOne(card) {
  const existing = state.owned.get(keyOf(card));
  if (existing) return setQuantity(existing, existing.quantity + 1);

  const stored = await ensureCard(card);
  const { data, error } = await supabase
    .from(CFG.table)
    .insert({ card_id: stored.id, quantity: 1 })
    .select('id, quantity')
    .single();
  if (error) throw error;
  state.owned.set(keyOf(card), { itemId: data.id, quantity: data.quantity, note: '', card: stored });

  // la ligne affichée dans les résultats prend la fiche complète
  const index = state.results.findIndex((c) => keyOf(c) === keyOf(card));
  if (index !== -1) state.results[index] = stored;
}

async function setQuantity(entry, quantity) {
  if (quantity <= 0) {
    const { error } = await supabase.from(CFG.table).delete().eq('id', entry.itemId);
    if (error) throw error;
    state.owned.delete(keyOf(entry.card));
    return;
  }
  const { error } = await supabase.from(CFG.table).update({ quantity }).eq('id', entry.itemId);
  if (error) throw error;
  entry.quantity = quantity;
}

// Wishlist : note libre (langue, état, édition souhaitée...)
async function saveNote(card, input) {
  const entry = state.owned.get(keyOf(card));
  if (!entry) return;
  const note = input.value.trim().slice(0, 140);
  if (note === entry.note) return;

  const { error } = await supabase.from(CFG.table).update({ note: note || null }).eq('id', entry.itemId);
  if (error) {
    console.error(error);
    setStatus(friendlyError(error), true);
    input.value = entry.note;
    return;
  }
  entry.note = note;
}

// ---------- Formulaire ----------

function bindEvents() {
  bindLightbox();
  ui.tabMine.addEventListener('click', () => switchTab('mine'));
  ui.tabAdd.addEventListener('click', () => switchTab('add'));
  ui.tabCommunity?.addEventListener('click', () => switchTab('community'));
  ui.user?.addEventListener('change', () => {
    if (state.tab === 'community') renderList();
  });

  ui.form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (state.tab === 'add') runSearch();
  });
  ui.text.addEventListener('input', onFilterChange);
  ui.type.addEventListener('change', onFilterChange);
  ui.mode.addEventListener('change', () => {
    applyModeUi();
    onFilterChange();
  });
  ui.more.addEventListener('click', () => runSearch({ more: true }));
}

const readForm = () => ({ mode: ui.mode.value, text: ui.text.value, type: ui.type.value });

function saveFormValues() {
  state.forms[state.tab] = readForm();
}

function loadFormValues() {
  const values = state.forms[state.tab];
  ui.mode.value = values.mode;
  ui.text.value = values.text;
  ui.type.value = values.type;
  applyModeUi();
}

function applyModeUi() {
  if (!state.game) {
    ui.textLabel.textContent = 'Nom de la carte';
    ui.text.placeholder = 'Filtrer par nom…';
    ui.text.inputMode = 'text';
    return;
  }
  const provider = state.game.provider;
  const byId = ui.mode.value === 'id';
  ui.textLabel.textContent = byId ? provider.idLabel : 'Nom de la carte';
  ui.text.placeholder = byId ? provider.idPlaceholder : provider.namePlaceholder;
  ui.text.inputMode = byId ? provider.idInputMode ?? 'text' : 'text';
}

function updateTabs() {
  ui.tabMine.setAttribute('aria-pressed', String(state.tab === 'mine'));
  ui.tabAdd.setAttribute('aria-pressed', String(state.tab === 'add'));
  ui.tabCommunity?.setAttribute('aria-pressed', String(state.tab === 'community'));
  ui.searchBtn.hidden = state.tab !== 'add';
  if (ui.user) ui.user.closest('.field').hidden = state.tab !== 'community';
}

async function switchTab(tab) {
  if (tab === state.tab || !state.chosen) return;

  // Chercher des cartes demande un jeu précis : on prend le dernier jeu utilisé
  if (tab === 'add' && !state.game) {
    const saved = readSavedGame();
    const fallback = getGame(saved) ? saved : GAMES.find((g) => g.provider)?.id;
    await selectGame(fallback);
    if (!state.game) return;
  }

  saveFormValues();
  state.tab = tab;
  loadFormValues();
  updateTabs();

  if (tab === 'community') {
    try {
      await loadCommunity();
    } catch (err) {
      console.error(err);
      setStatus(friendlyError(err), true);
      return;
    }
  }
  renderList();
}

function onFilterChange() {
  if (state.tab === 'mine' || state.tab === 'community') renderList(); // filtre instantané
}

// ---------- Recherche dans l'API (onglet « Ajouter ») ----------

async function runSearch({ more = false } = {}) {
  const provider = state.game.provider;
  const query = more ? state.search.query : readForm();

  const problem = provider.validate(query);
  if (problem) {
    setStatus(problem, true);
    return;
  }

  const token = ++state.token;
  ui.searchBtn.disabled = true;
  ui.more.disabled = true;
  setStatus('Recherche en cours…');

  try {
    const res = await provider.search({
      ...query,
      offset: more ? state.search.offset : 0,
      lang: more ? state.search.lang : null,
      onProgress: (message) => token === state.token && setStatus(message),
    });
    if (token !== state.token) return;

    state.results = more ? [...state.results, ...res.cards] : res.cards;
    state.search = {
      offset: res.nextOffset,
      lang: res.lang,
      hasMore: res.hasMore,
      total: res.total,
      done: true,
      query,
    };
    fillTypeSelect(); // le jeu a pu affiner sa liste de types (catalogue chargé)
  } catch (err) {
    if (token !== state.token) return;
    console.error(err);
    setStatus('Impossible de joindre la base de cartes. Réessaie dans un instant.', true);
    return;
  } finally {
    if (token === state.token) {
      ui.searchBtn.disabled = false;
      ui.more.disabled = false;
    }
  }

  if (state.tab === 'add') renderList();
}

// ---------- Affichage de la liste ----------

function matchesLocal(card, filters) {
  const text = filters.text.trim();
  if (text) {
    if (filters.mode === 'id') {
      if (!String(card.external_id).toLowerCase().includes(text.toLowerCase())) return false;
    } else if (!normalize(`${card.name} ${card.data?.name_en ?? ''}`).includes(normalize(text))) {
      return false;
    }
  }
  if (filters.type && state.game) {
    const group = state.game.provider.typeGroups.find((g) => g.key === filters.type);
    if (group && !(group.matches ? group.matches(card) : group.types.includes(card.card_type))) return false;
  }
  return true;
}

const byName = (a, b) => a.name.localeCompare(b.name, 'fr');

function shownOwned() {
  const filters = readForm();
  return [...state.owned.values()]
    .filter((entry) => matchesLocal(entry.card, filters))
    .sort((a, b) => byName(a.card, b.card));
}

// Toutes les wishlists : une ligne par carte, avec la liste de ceux qui la veulent
function shownCommunity() {
  const filters = readForm();
  const userId = ui.user?.value ?? '';
  const shown = [];
  for (const entry of state.community.entries) {
    if (!matchesLocal(entry.card, filters)) continue;
    const wanters = userId ? entry.wanters.filter((w) => w.userId === userId) : entry.wanters;
    if (wanters.length) shown.push({ card: entry.card, wanters });
  }
  return shown.sort((a, b) => byName(a.card, b.card));
}

function updateMineStatus() {
  const total = state.owned.size;
  ui.count.textContent = total ? ` (${total})` : '';
  if (state.tab !== 'mine') return;

  const shown = shownOwned();
  if (!total) {
    setStatus(CFG.text.empty);
  } else if (!shown.length) {
    setStatus(CFG.text.noMatch);
  } else {
    const copies = shown.reduce((sum, e) => sum + e.quantity, 0);
    setStatus(`${plural(shown.length, 'carte')} · ${pluralCopy(copies)}`);
  }
}

function renderCommunity() {
  const shown = shownCommunity();
  if (!state.community.entries.length) {
    setStatus(`Personne n'a encore de carte dans sa wishlist${state.game ? ' pour ce jeu' : ''}.`);
  } else if (!shown.length) {
    setStatus('Aucune carte ne correspond.');
  } else {
    const wishes = shown.reduce((sum, e) => sum + e.wanters.length, 0);
    const people = new Set(shown.flatMap((e) => e.wanters.map((w) => w.userId))).size;
    setStatus(`${plural(shown.length, 'carte')} · ${plural(wishes, 'souhait')} de ${plural(people, 'utilisateur')}`);
  }
  for (const entry of shown) ui.list.append(communityRow(entry));
}

function renderList() {
  imageObserver?.disconnect();
  ui.list.replaceChildren();
  ui.more.hidden = true;

  if (state.tab === 'mine') {
    for (const entry of shownOwned()) ui.list.append(cardRow(entry.card));
    updateMineStatus();
    return;
  }

  updateMineStatus(); // met à jour le compteur de l'onglet
  if (state.tab === 'community') {
    renderCommunity();
    return;
  }

  if (!state.results.length) {
    setStatus(
      state.search.done
        ? "Aucune carte trouvée. Essaie un autre nom (le français et l'anglais fonctionnent)."
        : 'Cherche par nom, par code ou par type pour ajouter une carte.',
    );
    return;
  }
  const { total, hasMore } = state.search;
  setStatus(
    total == null
      ? `${plural(state.results.length, 'résultat')}${hasMore ? " (il y en a d'autres)" : ''}`
      : `${state.results.length} sur ${plural(total, 'résultat')}`,
  );
  for (const card of state.results) ui.list.append(cardRow(card));
  ui.more.hidden = !state.search.hasMore;
}

function stepButton(symbol, label, action, handler) {
  const button = el('button', 'step', symbol);
  button.type = 'button';
  button.dataset.action = action;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', handler);
  return button;
}

// Chargement paresseux : une image n'est demandée que lorsqu'elle est
// proche de l'écran (moins de requêtes vers le serveur de l'API).
const imageObserver =
  'IntersectionObserver' in window
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            imageObserver.unobserve(entry.target);
            entry.target.src = entry.target.dataset.src;
          }
        },
        { rootMargin: '300px 0px' },
      )
    : null;

// Miniature de la carte : bouton qui ouvre l'image en grand
// (simple case au dos de carte stylisé si pas d'image)
function thumbnail(card) {
  const url = providerOf(card)?.thumbUrl?.(card.image_url) ?? card.image_url;

  if (!url || !/^https:\/\//.test(url)) return el('div', 'card-thumb is-missing');

  const box = el('button', 'card-thumb');
  box.type = 'button';
  box.setAttribute('aria-label', `Agrandir l'image de ${card.name}`);

  const img = document.createElement('img');
  img.alt = ''; // décorative : le nom de la carte est juste à côté
  img.width = 56;
  img.height = 82;
  img.decoding = 'async';
  img.dataset.src = url;
  img.addEventListener('error', () => {
    // la version réduite a peut-être été refusée : on retente avec l'image d'origine
    const original = card.image_url;
    if (!img.dataset.retried && original && original !== img.dataset.src && /^https:\/\//.test(original)) {
      img.dataset.retried = '1';
      img.src = original;
      return;
    }
    img.remove();
    box.classList.add('is-missing');
    box.disabled = true;
    box.removeAttribute('aria-label');
  });
  box.addEventListener('click', () => openLightbox(card, img));
  box.append(img);

  if (imageObserver) imageObserver.observe(img);
  else img.src = url;
  return box;
}

// ---------- Image en grand ----------

let lightboxToken = 0;

function openLightbox(card, thumbImg) {
  try {
    showLightbox(card, thumbImg);
  } catch (err) {
    // Filet de sécurité : si la fenêtre ne peut pas s'ouvrir, l'image s'ouvre dans un nouvel onglet
    console.error(err);
    const url = thumbImg.currentSrc || thumbImg.src || card.image_url;
    if (url) window.open(url, '_blank', 'noopener');
    else setStatus("Impossible d'agrandir l'image.", true);
  }
}

function showLightbox(card, thumbImg) {
  if (!ui.lightbox || typeof ui.lightbox.showModal !== 'function') {
    throw new Error('Fenêtre d\'agrandissement indisponible (collection.html à mettre à jour ?)');
  }
  const provider = providerOf(card);
  const thumbSrc = thumbImg.currentSrc || thumbImg.src;
  const wanted = ++lightboxToken;

  ui.lightboxImg.classList.toggle('is-landscape', thumbImg.naturalWidth > thumbImg.naturalHeight);
  ui.lightboxImg.alt = card.name;
  ui.lightboxName.textContent = card.name;
  ui.lightboxMeta.textContent = provider?.metaLine?.(card) ?? '';

  // 1) tout de suite : la miniature déjà chargée (floue mais instantanée)
  if (thumbSrc) ui.lightboxImg.src = thumbSrc;
  else ui.lightboxImg.removeAttribute('src');
  if (!ui.lightbox.open) ui.lightbox.showModal();

  // 2) puis la grande version (sinon l'image d'origine), remplacée dès qu'elle est prête
  const candidates = [...new Set([provider?.fullUrl?.(card.image_url) ?? card.image_url, card.image_url])].filter(
    (url) => url && url !== thumbSrc && /^https:\/\//.test(url),
  );
  const tryNext = () => {
    const url = candidates.shift();
    if (!url) {
      if (!thumbSrc && wanted === lightboxToken) {
        ui.lightbox.close();
        setStatus("Impossible de charger cette image.", true);
      }
      return;
    }
    const loader = new Image();
    loader.onload = () => {
      if (wanted === lightboxToken && ui.lightbox.open) ui.lightboxImg.src = url;
    };
    loader.onerror = tryNext;
    loader.src = url;
  };
  tryNext();
}

function bindLightbox() {
  if (!ui.lightbox) return;
  // un clic n'importe où (image, fond, croix) ferme ; Échap aussi (natif)
  ui.lightbox.addEventListener('click', () => ui.lightbox.close());
  ui.lightbox.addEventListener('close', () => {
    lightboxToken += 1; // ignore une grande image encore en chargement
    ui.lightboxImg.removeAttribute('src');
  });
}

function cardRow(card, existingThumb = null) {
  const entry = state.owned.get(keyOf(card));
  const quantity = entry?.quantity ?? 0;

  const row = el('li', 'card-row');
  row.dataset.id = keyOf(card);

  const info = el('div', 'card-info');
  info.append(el('strong', 'card-name', card.name));
  info.append(el('span', 'card-meta', providerOf(card)?.metaLine?.(card) ?? ''));

  // Wishlist : une note libre sur chaque carte (langue, état, édition souhaitée...)
  if (CFG.notes && state.tab === 'mine' && entry) {
    const note = el('input', 'note-input');
    note.type = 'text';
    note.maxLength = 140;
    note.value = entry.note;
    note.placeholder = 'Ajouter une note (langue, état, édition…)';
    note.setAttribute('aria-label', `Note pour ${card.name}`);
    note.addEventListener('change', () => saveNote(card, note));
    info.append(note);
  }

  if (card.data?.desc) {
    const details = el('details', 'card-desc');
    details.append(el('summary', null, 'Texte de la carte'), el('p', null, card.data.desc));
    info.append(details);
  }

  const actions = el('div', 'card-actions');
  if (state.tab === 'mine') {
    actions.append(
      stepButton('−', CFG.text.minus, 'minus', (e) => changeQuantity(card, -1, e.currentTarget)),
      el('span', 'qty', String(quantity)),
      stepButton('+', CFG.text.plus, 'plus', (e) => changeQuantity(card, +1, e.currentTarget)),
    );
  } else {
    if (quantity) actions.append(el('span', 'badge', `${CFG.text.badge} ×${quantity}`));
    const add = el('button', 'btn-small', quantity ? '+ 1 exemplaire' : CFG.text.add);
    add.type = 'button';
    add.dataset.action = 'add';
    add.addEventListener('click', (e) => changeQuantity(card, +1, e.currentTarget));
    actions.append(add);
  }

  const main = el('div', 'card-main');
  if (SHOW_IMAGES) main.append(existingThumb ?? thumbnail(card));
  main.append(info);

  row.append(main, actions);
  return row;
}

// « Toutes les wishlists » : la carte, et qui la veut (avec quantité et note)
function communityRow(entry) {
  const { card, wanters } = entry;
  const row = el('li', 'card-row');
  row.dataset.id = keyOf(card);

  const info = el('div', 'card-info');
  info.append(el('strong', 'card-name', card.name));
  info.append(el('span', 'card-meta', providerOf(card)?.metaLine?.(card) ?? ''));

  const list = el('ul', 'wanters');
  for (const w of [...wanters].sort((a, b) => a.name.localeCompare(b.name, 'fr'))) {
    const item = el('li', w.userId === state.userId ? 'is-me' : null);
    item.append(el('strong', null, w.userId === state.userId ? `${w.name} (moi)` : w.name));
    item.append(el('span', null, ` ×${w.quantity}`));
    if (w.note) item.append(el('em', null, ` — « ${w.note} »`));
    list.append(item);
  }
  info.append(list);

  if (card.data?.desc) {
    const details = el('details', 'card-desc');
    details.append(el('summary', null, 'Texte de la carte'), el('p', null, card.data.desc));
    info.append(details);
  }

  const actions = el('div', 'card-actions');
  const haveIt = state.community.owned.get(card.id) ?? 0;
  if (haveIt) actions.append(el('span', 'badge', `Dans ta collection ×${haveIt}`));

  const main = el('div', 'card-main');
  if (SHOW_IMAGES) main.append(thumbnail(card));
  main.append(info);
  row.append(main, actions);
  return row;
}

// Met à jour une seule ligne (sans reconstruire toute la liste)
function patchRow(key, focusAction) {
  const old = ui.list.querySelector(`[data-id="${CSS.escape(key)}"]`);
  if (!old) return;

  const card =
    state.tab === 'mine'
      ? state.owned.get(key)?.card
      : state.results.find((c) => keyOf(c) === key);

  if (!card) {
    // carte retirée de la liste : on déplace le focus sur la ligne voisine
    const neighbour = old.nextElementSibling ?? old.previousElementSibling;
    old.remove();
    neighbour?.querySelector('button')?.focus();
  } else {
    const fresh = cardRow(card, old.querySelector('.card-thumb')); // on garde l'image déjà chargée
    old.replaceWith(fresh);
    fresh.querySelector(`[data-action="${focusAction}"]`)?.focus();
  }
  updateMineStatus();
}

async function changeQuantity(card, delta, button) {
  const entry = state.owned.get(keyOf(card));
  const action = button.dataset.action;
  const row = button.closest('li');

  if (delta < 0 && entry?.quantity === 1 && !confirm(CFG.text.confirmRemove)) return;

  // on ne bloque que les boutons d'action : la miniature doit rester cliquable
  const actionButtons = row.querySelectorAll('.card-actions button');
  actionButtons.forEach((b) => (b.disabled = true));
  try {
    if (delta > 0) await addOne(card);
    else if (entry) await setQuantity(entry, entry.quantity - 1);
  } catch (err) {
    console.error(err);
    if (err?.code === '23505') {
      // la carte existait déjà (autre onglet) : on recharge l'état réel
      await loadOwned().catch(() => {});
      renderList();
      return;
    }
    setStatus(friendlyError(err), true);
    actionButtons.forEach((b) => (b.disabled = false));
    return;
  }
  patchRow(keyOf(card), action);
}

// ---------- Démarrage : session obligatoire ----------
// (en fin de fichier : tout le reste doit être défini avant de s'exécuter)

document.getElementById('logout').addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.replace('index.html');
});

supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') location.replace('index.html');
});

const {
  data: { session },
} = await supabase.auth.getSession();

if (!session) {
  location.replace('index.html');
} else {
  await start(session);
}

function showStaleWarning() {
  if ($('stale-warning')) return;
  const box = el(
    'p',
    'stale-banner',
    "Certains fichiers du site ne sont pas à jour (cache du navigateur ou dépôt GitHub). Recharge avec Ctrl + Maj + R ; si ce message revient, vérifie que collection.html, wishlist.html, collection.js, games.js, yugioh.js, riftbound.js, pokemon.js et magic.js sont à jour dans ton dépôt.",
  );
  box.id = 'stale-warning';
  box.setAttribute('role', 'alert');
  document.body.prepend(box);
}

async function start(session) {
  if (document.body.dataset.version !== APP_VERSION) showStaleWarning();
  state.userId = session.user.id;
  bindEvents();
  renderGames();
  document.body.hidden = false; // session valide : on affiche la page tout de suite

  const fallback = session.user.email?.split('@')[0] ?? '';
  $('username').textContent = fallback;
  const { data: profile } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', session.user.id)
    .maybeSingle();
  if (profile?.username) $('username').textContent = profile.username;

  // dernier choix mémorisé ; sur la wishlist, « Tous les jeux » par défaut
  const saved = readSavedGame();
  if (saved === 'all' && CFG.allGames) await selectGame('all');
  else if (saved && getGame(saved)) await selectGame(saved);
  else if (CFG.allGames) await selectGame('all');
}
