// =====================================================================
// Page collection
//  1. on choisit un jeu
//  2. onglet « Ma collection » : les cartes possédées (filtrables)
//  3. onglet « Ajouter des cartes » : recherche via l'API du jeu
// =====================================================================

import { supabase } from './config.js';
import { GAMES, getGame } from './games/index.js';

const $ = (id) => document.getElementById(id);

const ui = {
  games: $('games'),
  hint: $('hint'),
  workspace: $('workspace'),
  tabMine: $('tab-mine'),
  tabAdd: $('tab-add'),
  count: $('count'),
  form: $('search-form'),
  mode: $('mode'),
  text: $('text'),
  textLabel: $('text-label'),
  type: $('type'),
  searchBtn: $('search-btn'),
  status: $('status'),
  list: $('results'),
  more: $('more'),
};

const state = {
  game: null,
  tab: 'mine', // 'mine' | 'add'
  owned: new Map(), // external_id -> { itemId, quantity, card }
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
  };
}

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

function setStatus(message, isError = false) {
  ui.status.textContent = message;
  ui.status.classList.toggle('is-error', isError);
}

function friendlyError(err) {
  const text = `${err?.code ?? ''} ${err?.message ?? ''}`;
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
    return localStorage.getItem('tcg:game');
  } catch {
    return null;
  }
}
function saveGame(id) {
  try {
    localStorage.setItem('tcg:game', id);
  } catch {
    /* stockage indisponible : pas grave */
  }
}

// ---------- Choix du jeu ----------

function renderGames() {
  ui.games.replaceChildren();
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

async function selectGame(id) {
  const game = getGame(id);
  if (!game || game === state.game) return;

  state.game = game;
  state.results = [];
  state.search = freshSearch();
  state.forms = freshForms();
  state.owned = new Map();
  saveGame(id);

  renderGames();
  ui.hint.hidden = true;
  ui.workspace.hidden = false;

  // Menu des types propre au jeu
  ui.type.replaceChildren(new Option('Tous types', ''));
  for (const group of game.provider.typeGroups) ui.type.append(new Option(group.label, group.key));
  ui.mode.options[1].textContent = game.provider.idLabel;

  state.tab = 'mine';
  loadFormValues();
  updateTabs();

  setStatus('Chargement de ta collection…');
  ui.list.replaceChildren();
  try {
    await loadOwned();
  } catch (err) {
    console.error(err);
    setStatus(friendlyError(err), true);
    return;
  }
  renderList();
}

// ---------- Collection (Supabase) ----------

async function loadOwned() {
  const rows = [];
  const step = 1000; // Supabase renvoie 1000 lignes au maximum par requête
  for (let from = 0; ; from += step) {
    const { data, error } = await supabase
      .from('collection_items')
      .select('id, quantity, cards!inner(id, game, external_id, name, card_type, image_url, data)')
      .eq('cards.game', state.game.id)
      .order('id')
      .range(from, from + step - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < step) break;
  }
  state.owned = new Map(
    rows.map((r) => [r.cards.external_id, { itemId: r.id, quantity: r.quantity, card: r.cards }]),
  );
}

// Retrouve la carte dans le catalogue partagé, ou l'y ajoute
async function ensureCard(card) {
  const find = () =>
    supabase
      .from('cards')
      .select('id')
      .eq('game', card.game)
      .eq('external_id', card.external_id)
      .maybeSingle();

  let { data, error } = await find();
  if (error) throw error;
  if (data) return data.id;

  const inserted = await supabase
    .from('cards')
    .insert({
      game: card.game,
      external_id: card.external_id,
      name: card.name,
      card_type: card.card_type,
      image_url: card.image_url,
      data: card.data,
      source: 'api',
    })
    .select('id')
    .single();
  if (!inserted.error) return inserted.data.id;

  // Quelqu'un vient de l'ajouter en même temps : on la relit
  if (inserted.error.code === '23505') {
    ({ data, error } = await find());
    if (data) return data.id;
  }
  throw inserted.error;
}

async function addOne(card) {
  const existing = state.owned.get(card.external_id);
  if (existing) return setQuantity(existing, existing.quantity + 1);

  const cardId = await ensureCard(card);
  const { data, error } = await supabase
    .from('collection_items')
    .insert({ card_id: cardId, quantity: 1 })
    .select('id, quantity')
    .single();
  if (error) throw error;
  state.owned.set(card.external_id, {
    itemId: data.id,
    quantity: data.quantity,
    card: { ...card, id: cardId },
  });
}

async function setQuantity(entry, quantity) {
  if (quantity <= 0) {
    const { error } = await supabase.from('collection_items').delete().eq('id', entry.itemId);
    if (error) throw error;
    state.owned.delete(entry.card.external_id);
    return;
  }
  const { error } = await supabase
    .from('collection_items')
    .update({ quantity })
    .eq('id', entry.itemId);
  if (error) throw error;
  entry.quantity = quantity;
}

// ---------- Formulaire ----------

function bindEvents() {
  ui.tabMine.addEventListener('click', () => switchTab('mine'));
  ui.tabAdd.addEventListener('click', () => switchTab('add'));

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
  const provider = state.game.provider;
  const byId = ui.mode.value === 'id';
  ui.textLabel.textContent = byId ? provider.idLabel : 'Nom de la carte';
  ui.text.placeholder = byId ? provider.idPlaceholder : provider.namePlaceholder;
  ui.text.inputMode = byId ? 'numeric' : 'text';
}

function updateTabs() {
  ui.tabMine.setAttribute('aria-pressed', String(state.tab === 'mine'));
  ui.tabAdd.setAttribute('aria-pressed', String(state.tab === 'add'));
  ui.searchBtn.hidden = state.tab === 'mine';
}

function switchTab(tab) {
  if (tab === state.tab || !state.game) return;
  saveFormValues();
  state.tab = tab;
  loadFormValues();
  updateTabs();
  renderList();
}

function onFilterChange() {
  if (state.tab === 'mine') renderList(); // filtre instantané sur ta collection
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
      if (!String(card.external_id).startsWith(text)) return false;
    } else if (!normalize(card.name).includes(normalize(text))) {
      return false;
    }
  }
  if (filters.type) {
    const group = state.game.provider.typeGroups.find((g) => g.key === filters.type);
    if (group && !group.types.includes(card.card_type)) return false;
  }
  return true;
}

function shownOwned() {
  const filters = readForm();
  return [...state.owned.values()]
    .filter((entry) => matchesLocal(entry.card, filters))
    .sort((a, b) => a.card.name.localeCompare(b.card.name, 'fr'));
}

function updateMineStatus() {
  const total = state.owned.size;
  ui.count.textContent = total ? ` (${total})` : '';
  if (state.tab !== 'mine') return;

  const shown = shownOwned();
  if (!total) {
    setStatus("Ta collection est vide pour l'instant. Va dans « Ajouter des cartes » pour commencer.");
  } else if (!shown.length) {
    setStatus('Aucune carte de ta collection ne correspond.');
  } else {
    const copies = shown.reduce((sum, e) => sum + e.quantity, 0);
    setStatus(`${plural(shown.length, 'carte')} · ${plural(copies, 'exemplaire')}`);
  }
}

function renderList() {
  ui.list.replaceChildren();
  ui.more.hidden = true;

  if (state.tab === 'mine') {
    for (const entry of shownOwned()) ui.list.append(cardRow(entry.card));
    updateMineStatus();
    return;
  }

  updateMineStatus(); // met à jour le compteur de l'onglet
  if (!state.results.length) {
    setStatus(
      state.search.done
        ? "Aucune carte trouvée. Essaie un autre nom (le français et l'anglais fonctionnent)."
        : 'Cherche par nom, par code ou par type pour ajouter une carte.',
    );
    return;
  }
  setStatus(`${state.results.length} sur ${plural(state.search.total, 'résultat')}`);
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

function cardRow(card) {
  const entry = state.owned.get(card.external_id);
  const quantity = entry?.quantity ?? 0;

  const row = el('li', 'card-row');
  row.dataset.id = card.external_id;

  const info = el('div', 'card-info');
  info.append(el('strong', 'card-name', card.name));
  info.append(el('span', 'card-meta', state.game.provider.metaLine(card)));
  if (card.data?.desc) {
    const details = el('details', 'card-desc');
    details.append(el('summary', null, 'Texte de la carte'), el('p', null, card.data.desc));
    info.append(details);
  }

  const actions = el('div', 'card-actions');
  if (state.tab === 'mine') {
    actions.append(
      stepButton('−', 'Retirer un exemplaire', 'minus', (e) => changeQuantity(card, -1, e.currentTarget)),
      el('span', 'qty', String(quantity)),
      stepButton('+', 'Ajouter un exemplaire', 'plus', (e) => changeQuantity(card, +1, e.currentTarget)),
    );
  } else {
    if (quantity) actions.append(el('span', 'badge', `Possédée ×${quantity}`));
    const add = el('button', 'btn-small', quantity ? '+ 1 exemplaire' : 'Ajouter');
    add.type = 'button';
    add.dataset.action = 'add';
    add.addEventListener('click', (e) => changeQuantity(card, +1, e.currentTarget));
    actions.append(add);
  }

  row.append(info, actions);
  return row;
}

// Met à jour une seule ligne (sans reconstruire toute la liste)
function patchRow(externalId, focusAction) {
  const old = ui.list.querySelector(`[data-id="${CSS.escape(externalId)}"]`);
  if (!old) return;

  const card =
    state.tab === 'mine'
      ? state.owned.get(externalId)?.card
      : state.results.find((c) => c.external_id === externalId);

  if (!card) {
    // carte retirée de la collection : on déplace le focus sur la ligne voisine
    const neighbour = old.nextElementSibling ?? old.previousElementSibling;
    old.remove();
    neighbour?.querySelector('button')?.focus();
  } else {
    const fresh = cardRow(card);
    old.replaceWith(fresh);
    fresh.querySelector(`[data-action="${focusAction}"]`)?.focus();
  }
  updateMineStatus();
}

async function changeQuantity(card, delta, button) {
  const entry = state.owned.get(card.external_id);
  const action = button.dataset.action;
  const row = button.closest('li');

  if (delta < 0 && entry?.quantity === 1 && !confirm('Retirer cette carte de ta collection ?')) return;

  row.querySelectorAll('button').forEach((b) => (b.disabled = true));
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
    row.querySelectorAll('button').forEach((b) => (b.disabled = false));
    return;
  }
  patchRow(card.external_id, action);
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

async function start(session) {
  const fallback = session.user.email?.split('@')[0] ?? '';
  const { data: profile } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', session.user.id)
    .maybeSingle();
  $('username').textContent = profile?.username ?? fallback;

  bindEvents();
  renderGames();
  document.body.hidden = false;

  const saved = readSavedGame();
  if (saved && getGame(saved)) await selectGame(saved);
}
