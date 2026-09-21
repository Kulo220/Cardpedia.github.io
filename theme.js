// =====================================================================
// Thème clair / sombre
//  - sans choix : on suit le réglage de l'appareil (mode sombre ou clair)
//  - avec le bouton : ton choix est mémorisé et remplace le réglage de l'appareil
// Ce script est chargé dans le <head> AVANT l'affichage : pas d'éclair de la
// mauvaise couleur au chargement de la page.
// =====================================================================
(function () {
  var KEY = 'tcg:theme';
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  var SUN =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  function stored() {
    try {
      var value = localStorage.getItem(KEY);
      return value === 'dark' || value === 'light' ? value : null;
    } catch (e) {
      return null;
    }
  }

  function effective() {
    return stored() || (media && media.matches ? 'dark' : 'light');
  }

  function paintButtons() {
    var dark = root.getAttribute('data-theme') === 'dark';
    var buttons = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].innerHTML = dark ? SUN : MOON; // l'icône montre le thème vers lequel on bascule
      var label = dark ? 'Passer en mode clair' : 'Passer en mode sombre';
      buttons[i].setAttribute('aria-label', label);
      buttons[i].setAttribute('title', label);
    }
  }

  function apply() {
    root.setAttribute('data-theme', effective());
    paintButtons();
  }

  function choose(theme) {
    try {
      localStorage.setItem(KEY, theme);
    } catch (e) {
      /* stockage indisponible : le choix vaut pour cette page seulement */
    }
    root.setAttribute('data-theme', theme);
    paintButtons();
  }

  // Suit le réglage de l'appareil tant que rien n'a été choisi
  if (media) {
    var onChange = function () {
      if (!stored()) apply();
    };
    if (media.addEventListener) media.addEventListener('change', onChange);
    else if (media.addListener) media.addListener(onChange);
  }

  root.setAttribute('data-theme', effective());
  window.__tcgThemeReady = true; // les pages vérifient que ce fichier est bien chargé

  // Si style.css n'est pas à jour, le mode sombre ne peut pas s'afficher : on le dit
  function warn(text) {
    if (document.getElementById('theme-warning') || !document.body) return;
    var box = document.createElement('p');
    box.id = 'theme-warning';
    box.className = 'stale-banner';
    box.setAttribute('role', 'alert');
    box.textContent = text;
    document.body.insertBefore(box, document.body.firstChild);
  }
  function cssIsCurrent() {
    return getComputedStyle(root).getPropertyValue('--surface').trim() !== '';
  }
  var CSS_WARNING =
    "Le style du site (style.css) n'est pas à jour : le mode sombre ne peut pas s'afficher. Remplace style.css dans ton dépôt, puis recharge avec Ctrl + Maj + R.";
  window.addEventListener('load', function () {
    setTimeout(function () {
      if (!cssIsCurrent()) warn(CSS_WARNING);
    }, 500);
  });

  document.addEventListener('DOMContentLoaded', function () {
    var buttons = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function () {
        choose(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
        if (!cssIsCurrent()) warn(CSS_WARNING);
      });
    }
    paintButtons();
  });
})();
