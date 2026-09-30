// Chrono de repos. Basé sur un timestamp de fin pour rester juste
// même si l'onglet est throttled en arrière-plan.

import { formatMMSS } from './helpers.js';

let finTimestamp = null;
let intervalId = null;

function element() { return document.getElementById('chrono'); }
function elementTemps() { return document.getElementById('chrono-temps'); }

function afficher() {
  if (!finTimestamp) return;
  const reste = Math.max(0, (finTimestamp - Date.now()) / 1000);
  const elTemps = elementTemps();
  if (elTemps) elTemps.textContent = formatMMSS(reste);
  if (reste <= 0.5) {
    stop();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  }
}

export function start(secondes) {
  finTimestamp = Date.now() + secondes * 1000;
  const el = element();
  if (el) el.classList.remove('hidden');
  afficher();
  clearInterval(intervalId);
  intervalId = setInterval(afficher, 250);
}

export function stop() {
  finTimestamp = null;
  clearInterval(intervalId);
  intervalId = null;
  const el = element();
  if (el) el.classList.add('hidden');
}

export function ajouter(secondes) {
  if (!finTimestamp) return;
  finTimestamp = Math.max(Date.now(), finTimestamp + secondes * 1000);
  afficher();
}

export function initChrono() {
  const el = element();
  if (!el) return;
  el.querySelector('#chrono-stop')?.addEventListener('click', stop);
  el.querySelector('#chrono-moins')?.addEventListener('click', () => ajouter(-15));
  el.querySelector('#chrono-plus')?.addEventListener('click', () => ajouter(15));
}
