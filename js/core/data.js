// Chargement des données statiques (exercices) + programme (IDB avec fallback JSON).

import { getProgrammeActif, putProgrammeActif } from './db.js';

let cacheExercices = null;
let cacheProgramme = null;

async function chargerJSON(chemin) {
  const url = new URL(chemin, import.meta.url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Impossible de charger ${chemin} (${res.status})`);
  return res.json();
}

export async function chargerExercices() {
  if (cacheExercices) return cacheExercices;
  const data = await chargerJSON('../../data/exercices.json');
  cacheExercices = data.exercices || {};
  return cacheExercices;
}

// Charge le programme : d'abord IDB, sinon seed JSON et le stocke.
export async function chargerProgramme() {
  if (cacheProgramme) return cacheProgramme;

  let prog = await getProgrammeActif();

  if (!prog) {
    // Premier lancement : on seed depuis le JSON du repo.
    const seed = await chargerJSON('../../data/programme.json');
    prog = {
      ...seed,
      source: 'seed',
      imported_at: new Date().toISOString(),
    };
    await putProgrammeActif(prog);
  }

  cacheProgramme = prog;
  return prog;
}

// Force le rechargement (après un import par exemple).
export function invaliderCacheProgramme() {
  cacheProgramme = null;
}

export async function getExercice(ref) {
  const exos = await chargerExercices();
  return exos[ref] || null;
}

export async function getProgrammeJour(date) {
  const prog = await chargerProgramme();
  const jour = prog.jours && prog.jours[date];
  if (!jour) return null;

  const typeRef = jour.seance_type;
  const template = prog.seances_types && prog.seances_types[typeRef];
  if (!template) return null;

  return {
    date: jour.date,
    jour_semaine: jour.jour_semaine,
    seance_type_ref: typeRef,
    nom: template.nom,
    type: template.type,
    duree_estimee_min: template.duree_estimee_min,
    blocs: jour.override?.blocs || template.blocs,
    notes: jour.notes,
  };
}

// --- Nouveau : infos sur la plage du programme ---

export async function getPlageProgramme() {
  const prog = await chargerProgramme();
  const dates = Object.keys(prog.jours || {}).sort();
  if (dates.length === 0) return null;
  return {
    debut: dates[0],
    fin: dates[dates.length - 1],
    nb_jours: dates.length,
    source: prog.source || 'inconnu',
    imported_at: prog.imported_at || null,
  };
}

// --- Nouveau : import d'un programme (fusion par date et par id de template) ---

export async function importerProgramme(importe) {
  if (!importe || typeof importe !== 'object') {
    throw new Error('Format invalide : objet attendu.');
  }
  if (!importe.jours && !importe.seances_types) {
    throw new Error('Le fichier doit contenir "jours" et/ou "seances_types".');
  }

  const actuel = await chargerProgramme();

  const fusion = {
    schema_version: 2,
    seances_types: { ...(actuel.seances_types || {}), ...(importe.seances_types || {}) },
    jours:         { ...(actuel.jours || {}),         ...(importe.jours || {}) },
    source: 'import',
    imported_at: new Date().toISOString(),
  };

  await putProgrammeActif(fusion);
  cacheProgramme = fusion;
  return {
    jours_ajoutes: Object.keys(importe.jours || {}).length,
    templates_ajoutes: Object.keys(importe.seances_types || {}).length,
  };
}

// --- Nouveau : export du programme actif ---

export async function exporterProgramme() {
  const prog = await chargerProgramme();
  return {
    schema_version: 2,
    exported_at: new Date().toISOString(),
    seances_types: prog.seances_types || {},
    jours: prog.jours || {},
  };
}
