// =====================================================================
// Liste des jeux de cartes
// Un jeu sans "provider" s'affiche grisé (« bientôt »).
// Pour ajouter un jeu : créer monjeu.js (même forme que yugioh.js),
// l'importer ici et remplacer provider: null.
// =====================================================================

import yugioh from './yugioh.js?v=10';
import riftbound from './riftbound.js?v=10';
import pokemon from './pokemon.js?v=10';
import magic from './magic.js?v=10';

export const GAMES = [
  { id: 'yugioh', label: 'Yu-Gi-Oh!', provider: yugioh },
  { id: 'riftbound', label: 'Riftbound', provider: riftbound },
  { id: 'magic', label: 'Magic', provider: magic },
  { id: 'pokemon', label: 'Pokémon', provider: pokemon },
];

export function getGame(id) {
  const game = GAMES.find((g) => g.id === id);
  return game && game.provider ? game : null;
}
