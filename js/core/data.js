// Chargement des JSON statiques (exercices + programme).
// Résolution par rapport au fichier courant via import.meta.url.

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

export async function chargerProgramme() {
  if (cacheProgramme) return cacheProgramme;
  cacheProgramme = await chargerJSON('../../data/programme.json');
  return cacheProgramme;
}

// Résout un exercice par son id. Renvoie null si introuvable.
export async function getExercice(ref) {
  const exos = await chargerExercices();
  return exos[ref] || null;
}

// Résout le programme d'un jour donné (YYYY-MM-DD).
// Renvoie { date, jour_semaine, seance_type, blocs, duree_estimee_min } ou null.
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
