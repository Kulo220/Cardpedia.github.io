// =====================================================================
// Liste des jeux de cartes
// Un jeu sans "provider" s'affiche grisé (« bientôt »).
// Pour ajouter un jeu : créer monjeu.js (même forme que yugioh.js),
// l'importer ici et remplacer provider: null.
// =====================================================================

import yugioh from './yugioh.js';
import riftbound from './riftbound.js';

export const GAMES = [
  { id: 'yugioh', label: 'Yu-Gi-Oh!', provider: yugioh },
  { id: 'riftbound', label: 'Riftbound', provider: riftbound },
  { id: 'magic', label: 'Magic', provider: null },
  { id: 'pokemon', label: 'Pokémon', provider: null },
];

export function getGame(id) {
  const game = GAMES.find((g) => g.id === id);
  return game && game.provider ? game : null;
}
