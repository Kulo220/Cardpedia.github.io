// =====================================================================
// Configuration Supabase - le seul fichier à modifier
//
// Supabase > Project Settings > API (ou "API Keys") :
//   - URL du projet        -> SUPABASE_URL
//   - clé publique         -> SUPABASE_KEY ("anon" ou "publishable")
//
// ⚠️ N'utilise JAMAIS la clé "service_role" / "secret" ici :
// ce fichier est public sur GitHub Pages.
// La clé publique est faite pour ça : ce sont les règles RLS
// de la base qui protègent les données.
// =====================================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://aaygwesvsklgjkfzqasb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_t8p4Bw2kTCmM6qPvW0GUIw_CJl4SluD';

export const isConfigured =
  !SUPABASE_URL.includes('VOTRE-PROJET') && !SUPABASE_KEY.includes('VOTRE_CLE');

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Email interne : l'utilisateur ne tape que son pseudo.
// Doit être le même domaine que celui utilisé pour créer les comptes.
const EMAIL_DOMAIN = 'cardpedia.local';

export const PSEUDO_REGEX = /^[A-Za-z0-9_]{3,20}$/;

export function pseudoToEmail(pseudo) {
  return `${pseudo.trim().toLowerCase()}@${EMAIL_DOMAIN}`;
}
