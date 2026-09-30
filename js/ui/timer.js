// Timer polyvalent : compte à rebours simple OU séquence de phases.
// Un seul timer actif. Basé sur timestamps pour rester juste même si
// l'onglet est throttled en arrière-plan.

import { formatMMSS } from './helpers.js';

let etat = null; // { phases, index, finPhase, enPause, resteEnPause, onFin }
let intervalId = null;
let audioCtx = null;
let lastBeepSec = null;

function element()    { return document.getElementById('chrono'); }
function elTemps()    { return document.getElementById('chrono-temps'); }
function elLabel()    { return document.getElementById('chrono-label'); }
function elPause()    { return document.getElementById('chrono-pause'); }
function elSkip()     { return document.getElementById('chrono-skip'); }

// --- Bip via Web Audio (pas de fichier externe) ---
function bip(frequence = 880, duree = 0.15, volume = 0.15) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = frequence;
    osc.type = 'sine';
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    gain.gain.setValueAtTime(volume, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duree);
    osc.start();
    osc.stop(audioCtx.currentTime + duree);
  } catch {}
}

function vibrer(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

// --- API publique ---

// Compte à rebours simple (repos entre séries, minuteur libre).
export function demarrerSimple(secondes, options = {}) {
  etat = {
    phases: [{
      duree_sec: secondes,
      label: options.label || 'Repos',
      type: options.type || 'repos',
    }],
    index: 0,
    finPhase: Date.now() + secondes * 1000,
    enPause: false,
    resteEnPause: null,
    onFin: options.onFin || null,
    autoFermer: options.autoFermer !== false,
  };
  lastBeepSec = null;
  afficher();
  boucler();
}

// Séquence de phases : [{ duree_sec, label, type }]
// type : 'travail' | 'repos' | 'transition'
export function demarrerSequence(phases, options = {}) {
  if (!phases || !phases.length) return;
  etat = {
    phases: phases.map(p => ({ ...p })),
    index: 0,
    finPhase: Date.now() + phases[0].duree_sec * 1000,
    enPause: false,
    resteEnPause: null,
    onFin: options.onFin || null,
    autoFermer: options.autoFermer !== false,
  };
  lastBeepSec = null;
  afficher();
  boucler();
}

export function pause() {
  if (!etat || etat.enPause) return;
  etat.resteEnPause = Math.max(0, etat.finPhase - Date.now());
  etat.enPause = true;
  afficher();
}

export function reprendre() {
  if (!etat || !etat.enPause) return;
  etat.finPhase = Date.now() + etat.resteEnPause;
  etat.enPause = false;
  etat.resteEnPause = null;
  afficher();
}

export function basculerPause() {
  if (!etat) return;
  etat.enPause ? reprendre() : pause();
}

export function arreter() {
  etat = null;
  clearInterval(intervalId);
  intervalId = null;
  element()?.classList.add('hidden');
}

export function ajouter(secondes) {
  if (!etat) return;
  if (etat.enPause) {
    etat.resteEnPause = Math.max(0, (etat.resteEnPause || 0) + secondes * 1000);
  } else {
    etat.finPhase = Math.max(Date.now(), etat.finPhase + secondes * 1000);
  }
  afficher();
}

export function passerPhase() {
  if (!etat) return;
  phaseSuivante();
}

export function enCours() {
  return etat !== null;
}

// --- Interne ---

function tempsRestant() {
  if (!etat) return 0;
  if (etat.enPause) return (etat.resteEnPause || 0) / 1000;
  return Math.max(0, (etat.finPhase - Date.now()) / 1000);
}

function phaseCourante() {
  return etat ? etat.phases[etat.index] : null;
}

function phaseSuivante() {
  if (!etat) return;

  if (etat.index + 1 >= etat.phases.length) {
    const onFin = etat.onFin;
    const autoFermer = etat.autoFermer;
    const dernier = phaseCourante();
    const labelFin = (dernier && dernier.labelFin) || 'Terminé';
    arreter();
    bip(1200, 0.35, 0.25);
    vibrer([300, 100, 300, 100, 300]);
    afficherToastFin(labelFin);
    if (onFin) onFin();
    return;
  }

  etat.index += 1;
  const phase = phaseCourante();
  etat.finPhase = Date.now() + phase.duree_sec * 1000;
  etat.enPause = false;
  etat.resteEnPause = null;
  lastBeepSec = null;

  // Signal de transition
  bip(phase.type === 'travail' ? 880 : 440, 0.2, 0.2);
  vibrer(phase.type === 'travail' ? [200, 100, 200] : [150]);
  afficher();
}

function afficher() {
  const el = element();
  if (!el || !etat) return;
  el.classList.remove('hidden');

  const phase = phaseCourante();
  const reste = tempsRestant();

  const t = elTemps();
  if (t) t.textContent = formatMMSS(reste);

  const lbl = elLabel();
  if (lbl) {
    let texte = phase.label || '';
    if (etat.phases.length > 1) {
      texte = `Phase ${etat.index + 1}/${etat.phases.length} · ${texte}`;
    }
    if (etat.enPause) texte = '⏸ ' + texte;
    lbl.textContent = texte;
  }

  el.style.borderColor =
    phase.type === 'travail' ? 'var(--accent)' :
    phase.type === 'repos'   ? 'var(--warn)' :
                               'var(--border)';

  const btnPause = elPause();
  if (btnPause) btnPause.textContent = etat.enPause ? '▶' : '⏸';

  const btnSkip = elSkip();
  if (btnSkip) btnSkip.classList.toggle('hidden', etat.phases.length <= 1);
}

function boucler() {
  clearInterval(intervalId);
  intervalId = setInterval(() => {
    if (!etat) { clearInterval(intervalId); return; }
    const reste = tempsRestant();

    // Bips des 3 dernières secondes
    const secEntiere = Math.ceil(reste);
    if (!etat.enPause && secEntiere <= 3 && secEntiere > 0 && secEntiere !== lastBeepSec) {
      lastBeepSec = secEntiere;
      bip(660, 0.08, 0.15);
    }
    if (secEntiere > 3) lastBeepSec = null;

    if (reste <= 0.05 && !etat.enPause) {
      phaseSuivante();
      return;
    }
    afficher();
  }, 200);
}

let toastTimer = null;
function afficherToastFin(message) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = message;
  t.className = 'toast ok';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast hidden'; }, 2500);
}

export function initTimer() {
  const el = element();
  if (!el) return;
  el.querySelector('#chrono-stop')?.addEventListener('click', arreter);
  el.querySelector('#chrono-moins')?.addEventListener('click', () => ajouter(-15));
  el.querySelector('#chrono-plus')?.addEventListener('click', () => ajouter(15));
  el.querySelector('#chrono-pause')?.addEventListener('click', basculerPause);
  el.querySelector('#chrono-skip')?.addEventListener('click', passerPhase);
}

// Rétrocompat avec l'ancien nom
export const start = demarrerSimple;
export const stop = arreter;
export const initChrono = initTimer;
