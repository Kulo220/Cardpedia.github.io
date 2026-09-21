// =====================================================================
// Page « Mon compte » : changer son mot de passe
//
// Sécurité : on demande d'abord l'ANCIEN mot de passe, vérifié auprès de
// Supabase par une vraie connexion ; ce n'est qu'après que le nouveau est
// enregistré. Une fois changé, les autres appareils connectés sont déconnectés.
// =====================================================================

import { supabase } from './config.js';
import { $, bootPage, revealPage } from './common.js?v=14';

const APP_VERSION = '14';
const MIN_LENGTH = 8;

const form = $('password-form');
const fields = { current: $('current'), next: $('next'), confirm: $('confirm') };
const message = $('password-msg');
const submit = $('password-submit');

function show(text, kind = 'error') {
  message.textContent = text;
  message.classList.toggle('is-error', kind === 'error');
  message.classList.toggle('is-ok', kind === 'ok');
}

// Message clair pour une erreur renvoyée par Supabase
function explain(error, step) {
  const code = error?.code ?? '';
  if (error?.status === 429 || /rate_limit/i.test(code)) {
    return 'Trop de tentatives. Patiente quelques minutes avant de réessayer.';
  }
  if (step === 'check' && (code === 'invalid_credentials' || error?.status === 400)) {
    return "L'ancien mot de passe est incorrect.";
  }
  if (code === 'same_password') return "Le nouveau mot de passe doit être différent de l'ancien.";
  if (code === 'weak_password') return 'Ce mot de passe est trop faible ou trop courant. Choisis-en un plus long ou plus original.';
  if (code === 'reauthentication_needed' || code === 'session_not_found' || error?.status === 401) {
    return 'Ta session a expiré : déconnecte-toi, reconnecte-toi, puis réessaie.';
  }
  return `Impossible de ${step === 'check' ? 'vérifier ton mot de passe' : 'modifier ton mot de passe'} pour le moment${code ? ` (${code})` : ''}.`;
}

async function start(session) {
  const email = session.user.email;
  $('account-username').value = email?.split('@')[0] ?? '';
  await revealPage(session);

  // afficher / masquer les trois champs
  $('show-passwords').addEventListener('change', (event) => {
    for (const input of Object.values(fields)) input.type = event.target.checked ? 'text' : 'password';
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    show('');

    const current = fields.current.value;
    const next = fields.next.value;
    const again = fields.confirm.value;

    if (!current || !next || !again) return show('Remplis les trois champs.');
    if (next.length < MIN_LENGTH) return show(`Le nouveau mot de passe doit faire au moins ${MIN_LENGTH} caractères.`);
    if (next !== again) return show('Les deux nouveaux mots de passe ne sont pas identiques.');
    if (next === current) return show("Le nouveau mot de passe doit être différent de l'ancien.");

    submit.disabled = true;
    try {
      // 1) l'ancien mot de passe doit être le bon
      const checked = await supabase.auth.signInWithPassword({ email, password: current });
      if (checked.error) {
        fields.current.focus();
        return show(explain(checked.error, 'check'));
      }

      // 2) enregistrement du nouveau
      const { error } = await supabase.auth.updateUser({ password: next, current_password: current });
      if (error) return show(explain(error, 'update'));

      // 3) les autres appareils connectés doivent se reconnecter (facultatif)
      let others = true;
      try {
        const { error: outError } = await supabase.auth.signOut({ scope: 'others' });
        others = !outError;
      } catch {
        others = false;
      }

      form.reset();
      $('show-passwords').checked = false;
      for (const input of Object.values(fields)) input.type = 'password';
      show(
        `Mot de passe modifié. Utilise-le à ta prochaine connexion.${others ? ' Tes autres appareils ont été déconnectés.' : ''}`,
        'ok',
      );
    } catch (err) {
      console.error(err);
      show('Une erreur est survenue. Vérifie ta connexion internet et réessaie.');
    } finally {
      submit.disabled = false;
    }
  });
}

// (en fin de fichier : tout le reste doit être défini avant de s'exécuter)
const session = await bootPage({ version: APP_VERSION, files: 'compte.html, compte.js, common.js et config.js' });
if (session) await start(session);
