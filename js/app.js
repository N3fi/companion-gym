// Point d'entrée : bootstrap, routage entre vues.

import { chargerExercices, chargerProgramme, getExercice, getProgrammeJour }
  from './core/data.js';
import { getAllSeances, getSeance, putSeance, deleteSeance,
         demanderPersistance, etatStockage } from './core/db.js';
import { el, vider, toast, aujourdhuiISO, formatDateLongue,
         formatDateCourte, jourSemaine, formatOctets } from './ui/helpers.js';
import { start as chronoStart, stop as chronoStop, initChrono } from './ui/chrono.js';

const vueEl = () => document.getElementById('vue');
const titreEl = () => document.getElementById('titre-vue');
const menuEl = () => document.getElementById('menu');

// ---------- Bootstrap ----------

async function init() {
  initChrono();

  document.getElementById('btn-menu')?.addEventListener('click', () => {
    menuEl()?.classList.toggle('hidden');
  });

  document.querySelectorAll('#menu button').forEach(btn => {
    btn.addEventListener('click', () => {
      menuEl()?.classList.add('hidden');
      router(btn.dataset.vue);
    });
  });

  document.getElementById('btn-export-rapide')?.addEventListener('click', exporter);

  try {
    await Promise.all([chargerExercices(), chargerProgramme()]);
  } catch (err) {
    vider(vueEl());
    vueEl().appendChild(el('p', { class: 'loading' }, 'Erreur de chargement : ' + err.message));
    return;
  }

  // Persistance en arrière-plan, sans bloquer.
  demanderPersistance().then(ok => {
    if (!ok) console.warn('Persistance refusée. Pense à exporter régulièrement.');
  });

  router('aujourdhui');
}

// ---------- Routage ----------

async function router(nom) {
  vider(vueEl());
  const titres = { aujourdhui: "Aujourd'hui", historique: 'Historique', parametres: 'Paramètres' };
  if (titreEl()) titreEl().textContent = titres[nom] || 'Companion Gym';

  if (nom === 'aujourdhui') return vueAujourdhui();
  if (nom === 'historique') return vueHistorique();
  if (nom === 'parametres') return vueParametres();
}

// ---------- Vue Aujourd'hui ----------

async function vueAujourdhui() {
  const date = aujourdhuiISO();
  const prog = await getProgrammeJour(date);
  const seance = await getSeance(date);

  const root = vueEl();

  if (!prog) {
    root.appendChild(el('div', { class: 'carte' }, [
      el('h2', {}, 'Pas de séance planifiée'),
      el('p', { class: 'meta' }, `Aucun programme pour le ${formatDateCourte(date)}.`),
    ]));
    root.appendChild(el('button', {
      class: 'btn secondaire',
      onclick: () => router('historique'),
    }, 'Voir l\'historique'));
    return;
  }

  // En-tête
  root.appendChild(el('div', { class: 'carte' }, [
    el('h2', {}, formatDateLongue(date)),
    el('div', { class: 'meta' }, `${prog.nom} · ~${prog.duree_estimee_min} min`),
    seance?.terminee
      ? el('span', { class: 'badge ok' }, 'Terminée')
      : (seance ? el('span', { class: 'badge warn' }, 'En cours') : null),
  ]));

  // Construction de la séance si première fois
  const seanceActive = seance || creerSeanceVide(date, prog);

  // Rendu des blocs
  for (const bloc of prog.blocs) {
    await rendreBloc(root, bloc, seanceActive);
  }

  // Notes générales
  const notes = el('textarea', {
    class: 'notes',
    rows: 3,
    placeholder: 'Notes générales, sensations…',
    style: 'width:100%;padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--bg-3);color:var(--fg);font-size:1rem;margin-top:8px;',
  });
  notes.value = seanceActive.notes_generales || '';
  notes.addEventListener('input', () => {
    seanceActive.notes_generales = notes.value;
    sauvegarder(seanceActive, { silencieux: true });
  });
  root.appendChild(el('h2', { class: 'section' }, 'Notes'));
  root.appendChild(notes);

  // Bouton terminer / réouvrir
  root.appendChild(el('button', {
    class: seanceActive.terminee ? 'btn secondaire' : 'btn',
    style: 'margin-top:16px;',
    onclick: async () => {
      seanceActive.terminee = !seanceActive.terminee;
      await sauvegarder(seanceActive);
      toast(seanceActive.terminee ? 'Séance enregistrée' : 'Séance réouverte', 'ok');
      router('aujourdhui');
    },
  }, seanceActive.terminee ? 'Réouvrir la séance' : 'Terminer la séance'));
}

function creerSeanceVide(date, prog) {
  return {
    date,
    jour_semaine: jourSemaine(date),
    type: prog.type,
    seance_type_ref: prog.seance_type_ref,
    terminee: false,
    contexte: { forme_du_jour: null, sommeil: null, douleur_dos: null },
    exercices: [],
    cardio: null,
    notes_generales: '',
    updated_at: new Date().toISOString(),
  };
}

async function rendreBloc(root, bloc, seance) {
  if (bloc.type === 'musculation') {
    root.appendChild(el('h2', { class: 'section' }, 'Musculation'));
    for (const exoDef of bloc.exercices) {
      await rendreExerciceMuscu(root, exoDef, seance);
    }
    return;
  }

  if (bloc.type === 'mobilite') {
    root.appendChild(el('h2', { class: 'section' }, 'Mobilité'));
    for (const exoDef of bloc.exercices) {
      await rendreExerciceMobilite(root, exoDef, seance);
    }
    return;
  }

  if (bloc.type === 'cardio') {
    root.appendChild(el('h2', { class: 'section' }, 'Cardio'));
    await rendreCardio(root, bloc.ref, seance);
    return;
  }

  if (bloc.type === 'complement') {
    root.appendChild(el('h2', { class: 'section' }, 'Complément'));
    await rendreExerciceMobilite(root, { ref: bloc.ref }, seance, 'complement');
  }
}

async function rendreExerciceMuscu(root, exoDef, seance) {
  const exo = await getExercice(exoDef.ref);
  if (!exo) {
    root.appendChild(el('div', { class: 'carte' },
      `Exercice introuvable : ${exoDef.ref}`));
    return;
  }

  // Récupère (ou crée) l'entrée séance pour cet exercice
  let entree = seance.exercices.find(e => e.ref === exoDef.ref);
  if (!entree) {
    entree = {
      ref: exoDef.ref,
      nom_snapshot: exo.nom,
      series: initialiserSeries(exoDef, exo),
      notes: '',
    };
    seance.exercices.push(entree);
  }

  const prescription = formaterPrescription(exoDef, exo);
  const body = el('div', { class: 'exo-body hidden' });

  const container = el('div', { class: 'exo' }, [
    el('div', {
      class: 'exo-header',
      onclick: () => body.classList.toggle('hidden'),
    }, [
      el('h3', {}, exo.nom),
      el('span', { class: 'prescription' }, prescription),
    ]),
  ]);

  // Détails techniques
  body.appendChild(el('div', { class: 'detail-row' }, [
    el('span', { class: 'lbl' }, 'Repos'),
    el('span', {}, `${exo.repos_defaut_sec || 60} s`),
  ]));
  if (exo.technique?.length) {
    body.appendChild(el('div', { class: 'detail-row' }, el('span', { class: 'lbl' }, 'Technique')));
    body.appendChild(el('ul', { class: 'technique' },
      exo.technique.map(t => el('li', {}, t))));
  }
  if (exo.erreurs?.length) {
    body.appendChild(el('div', { class: 'detail-row' }, el('span', { class: 'lbl' }, 'À éviter')));
    body.appendChild(el('ul', { class: 'erreurs' },
      exo.erreurs.map(t => el('li', {}, t))));
  }
  if (exo.video_url) {
    body.appendChild(el('a', {
      href: exo.video_url, target: '_blank', rel: 'noopener',
      style: 'display:inline-block;margin-top:8px;color:var(--accent);font-size:0.9rem;',
    }, '▶ Voir la vidéo'));
  }

  // Tableau des séries
  body.appendChild(el('div', { class: 'serie-labels' }, [
    el('span', {}, '#'), el('span', {}, 'Reps'),
    el('span', {}, 'kg'), el('span', {}, 'RPE'), el('span', {}, ''),
  ]));

  entree.series.forEach((serie, idx) => {
    body.appendChild(rendreSerie(serie, idx, exo.repos_defaut_sec || 60, seance));
  });

  // Bouton + série
  body.appendChild(el('button', {
    class: 'btn secondaire petit',
    style: 'margin-top:8px;',
    onclick: async () => {
      const derniere = entree.series[entree.series.length - 1];
      entree.series.push({
        reps: derniere?.reps ?? 10,
        charge_kg: derniere?.charge_kg ?? null,
        rpe: null,
        validee: false,
      });
      await sauvegarder(seance, { silencieux: true });
      router('aujourdhui');
    },
  }, '+ Ajouter une série'));

  // Notes de l'exercice
  const notesExo = el('textarea', {
    rows: 2,
    placeholder: 'Notes sur cet exercice…',
    style: 'width:100%;margin-top:10px;padding:8px;border-radius:8px;border:1px solid var(--border);background:var(--bg-3);color:var(--fg);font-size:0.9rem;',
  });
  notesExo.value = entree.notes || '';
  notesExo.addEventListener('input', () => {
    entree.notes = notesExo.value;
    sauvegarder(seance, { silencieux: true });
  });
  body.appendChild(notesExo);

  container.appendChild(body);
  root.appendChild(container);
}

function initialiserSeries(exoDef, exo) {
  const nb = exoDef.series || 3;
  const charge = exoDef.charge_cible_kg ?? null;
  const reps = exoDef.reps ?? (exo.unite === 'duree_sec' ? null : 10);
  const dureeSec = exoDef.duree_sec ?? (exo.unite === 'duree_sec' ? exo.duree_sec_defaut ?? 30 : null);
  const arr = [];
  for (let i = 0; i < nb; i++) {
    arr.push({
      reps: typeof reps === 'number' ? reps : null,
      duree_sec: Array.isArray(dureeSec) ? dureeSec[1] : dureeSec,
      charge_kg: charge,
      rpe: null,
      validee: false,
    });
  }
  return arr;
}

function formaterPrescription(exoDef, exo) {
  const parts = [];
  if (exoDef.series) parts.push(`${exoDef.series} séries`);
  if (exoDef.reps) parts.push(`${exoDef.reps} reps`);
  if (exoDef.duree_sec) {
    const d = Array.isArray(exoDef.duree_sec)
      ? `${exoDef.duree_sec[0]}-${exoDef.duree_sec[1]} sec`
      : `${exoDef.duree_sec} sec`;
    parts.push(d);
  }
  if (exoDef.charge_cible_kg) parts.push(`${exoDef.charge_cible_kg} kg`);
  return parts.join(' · ');
}

function rendreSerie(serie, idx, reposSec, seance) {
  const inputReps = el('input', {
    type: 'number', inputmode: 'decimal', placeholder: '—',
    value: serie.reps ?? '', min: '0',
  });
  const inputCharge = el('input', {
    type: 'number', inputmode: 'decimal', placeholder: '—',
    value: serie.charge_kg ?? '', min: '0', step: '0.5',
  });
  const inputRpe = el('input', {
    type: 'number', inputmode: 'decimal', placeholder: '—',
    value: serie.rpe ?? '', min: '1', max: '10', step: '0.5',
  });
  const btn = el('button', {
    class: 'icon-btn',
    style: 'font-size:1.1rem;padding:6px;min-width:32px;',
    title: 'Valider la série',
    onclick: async (ev) => {
      ev.stopPropagation();
      serie.validee = !serie.validee;
      if (serie.validee) chronoStart(reposSec);
      else chronoStop();
      await sauvegarder(seance, { silencieux: true });
      router('aujourdhui');
    },
  }, serie.validee ? '✓' : '○');

  const maj = () => {
    serie.reps = inputReps.value === '' ? null : Number(inputReps.value);
    serie.charge_kg = inputCharge.value === '' ? null : Number(inputCharge.value);
    serie.rpe = inputRpe.value === '' ? null : Number(inputRpe.value);
    sauvegarder(seance, { silencieux: true });
  };
  [inputReps, inputCharge, inputRpe].forEach(i => i.addEventListener('change', maj));

  if (serie.validee) {
    inputReps.classList.add('valide');
    inputCharge.classList.add('valide');
  }

  return el('div', { class: 'serie' }, [
    el('span', { class: 'num' }, String(idx + 1)),
    inputReps, inputCharge, inputRpe, btn,
  ]);
}

async function rendreExerciceMobilite(root, exoDef, seance, typeOverride) {
  const exo = await getExercice(exoDef.ref);
  if (!exo) return;

  const type = typeOverride || 'mobilite';
  let entree = seance.exercices.find(e => e.ref === exoDef.ref);
  if (!entree) {
    entree = { ref: exoDef.ref, nom_snapshot: exo.nom, fait: false };
    seance.exercices.push(entree);
  }

  const body = el('div', { class: 'exo-body hidden' });
  if (exo.technique?.length) {
    body.appendChild(el('ul', { class: 'technique' },
      exo.technique.map(t => el('li', {}, t))));
  }
  if (exo.notes) body.appendChild(el('p', { class: 'meta', style: 'margin-top:8px;' }, exo.notes));
  if (exo.video_url) {
    body.appendChild(el('a', {
      href: exo.video_url, target: '_blank', rel: 'noopener',
      style: 'display:inline-block;margin-top:8px;color:var(--accent);font-size:0.9rem;',
    }, '▶ Voir la vidéo'));
  }

  const btn = el('button', {
    class: 'btn ' + (entree.fait ? 'secondaire' : 'petit'),
    style: 'margin-top:10px;',
    onclick: async (ev) => {
      ev.stopPropagation();
      entree.fait = !entree.fait;
      await sauvegarder(seance, { silencieux: true });
      router('aujourdhui');
    },
  }, entree.fait ? '✓ Fait' : 'Marquer comme fait');
  body.appendChild(btn);

  const container = el('div', { class: 'exo' }, [
    el('div', {
      class: 'exo-header',
      onclick: () => body.classList.toggle('hidden'),
    }, [
      el('h3', {}, exo.nom),
      el('span', { class: 'prescription' },
        entree.fait ? '✓' : (exo.duree_sec_defaut ? `${exo.duree_sec_defaut} s` : '')),
    ]),
    body,
  ]);
  root.appendChild(container);
}

async function rendreCardio(root, ref, seance) {
  const exo = await getExercice(ref);
  if (!exo) return;

  if (!seance.cardio || seance.cardio.ref !== ref) {
    seance.cardio = { ref, nom: exo.nom, duree_min: null, fait: false };
    await sauvegarder(seance, { silencieux: true });
  }

  const input = el('input', {
    type: 'number', inputmode: 'decimal',
    placeholder: exo.duree_min_defaut ?? '',
    value: seance.cardio.duree_min ?? exo.duree_min_defaut ?? '',
    style: 'width:100%;padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--bg-3);color:var(--fg);font-size:1rem;',
  });
  input.addEventListener('change', async () => {
    seance.cardio.duree_min = input.value === '' ? null : Number(input.value);
    await sauvegarder(seance, { silencieux: true });
  });

  const infos = [];
  if (exo.vitesse_kmh_defaut) infos.push(`${exo.vitesse_kmh_defaut} km/h`);
  if (exo.inclinaison_pct_defaut) infos.push(`${exo.inclinaison_pct_defaut}%`);

  root.appendChild(el('div', { class: 'exo' }, [
    el('div', { class: 'exo-header' }, [
      el('h3', {}, exo.nom),
      el('span', { class: 'prescription' }, infos.join(' · ')),
    ]),
    el('div', { style: 'padding:0 14px 14px 14px;' }, [
      el('div', { class: 'serie-labels', style: 'grid-template-columns:1fr;' },
        [el('span', {}, 'Durée réelle (min)')]),
      input,
    ]),
  ]));
}

// ---------- Sauvegarde ----------

async function sauvegarder(seance, opts = {}) {
  seance.updated_at = new Date().toISOString();
  try {
    await putSeance(seance);
    if (!opts.silencieux) toast('Enregistré', 'ok');
  } catch (err) {
    toast('Erreur d\'enregistrement : ' + err.message, 'danger');
  }
}

// ---------- Vue Historique ----------

async function vueHistorique() {
  const seances = await getAllSeances();
  seances.sort((a, b) => b.date.localeCompare(a.date));

  const root = vueEl();

  if (seances.length === 0) {
    root.appendChild(el('div', { class: 'carte' },
      el('p', { class: 'meta' }, 'Aucune séance enregistrée pour l\'instant.')));
    return;
  }

  root.appendChild(el('p', { class: 'meta', style: 'margin:0 4px 12px;' },
    `${seances.length} séance${seances.length > 1 ? 's' : ''}`));

  for (const s of seances) {
    const nbExos = (s.exercices || []).length;
    const terminee = s.terminee ? el('span', { class: 'badge ok', style: 'margin-left:8px;' }, 'Terminée') : null;
    const item = el('div', { class: 'carte' }, [
      el('div', { style: 'display:flex;align-items:center;justify-content:space-between;' }, [
        el('h3', {}, formatDateLongue(s.date)),
        terminee,
      ]),
      el('div', { class: 'meta' }, `${s.type} · ${nbExos} exercice${nbExos > 1 ? 's' : ''}`),
      el('div', { style: 'display:flex;gap:8px;margin-top:10px;' }, [
        el('button', {
          class: 'btn secondaire petit',
          onclick: () => { location.hash = `#${s.date}`; /* pas utilisé en v1 */ },
        }, 'Détails'),
        el('button', {
          class: 'btn danger petit',
          onclick: async () => {
            if (!confirm(`Supprimer la séance du ${formatDateCourte(s.date)} ?`)) return;
            await deleteSeance(s.date);
            toast('Séance supprimée', 'ok');
            router('historique');
          },
        }, 'Supprimer'),
      ]),
    ]);
    root.appendChild(item);
  }
}

// ---------- Vue Paramètres ----------

async function vueParametres() {
  const root = vueEl();
  const etat = await etatStockage();

  root.appendChild(el('div', { class: 'carte' }, [
    el('h2', {}, 'Stockage'),
    etat ? el('div', {}, [
      el('div', { class: 'detail-row' }, [
        el('span', { class: 'lbl' }, 'Utilisé'),
        el('span', {}, formatOctets(etat.utilise)),
      ]),
      el('div', { class: 'detail-row' }, [
        el('span', { class: 'lbl' }, 'Quota'),
        el('span', {}, formatOctets(etat.quota)),
      ]),
      el('div', { class: 'detail-row' }, [
        el('span', { class: 'lbl' }, 'Persistant'),
        el('span', { style: etat.persistant ? 'color:var(--ok);' : 'color:var(--warn);' },
          etat.persistant ? 'oui' : 'non'),
      ]),
      !etat.persistant
        ? el('p', { class: 'meta', style: 'margin-top:8px;' },
            'Stockage non persistant : pense à exporter régulièrement.')
        : null,
    ]) : el('p', { class: 'meta' }, 'Information non disponible.'),
  ]));

  root.appendChild(el('button', {
    class: 'btn', onclick: exporter,
  }, 'Exporter mes séances (JSON)'));

  const fileInput = el('input', {
    type: 'file', accept: 'application/json',
    style: 'display:none;',
    onchange: importer,
  });
  root.appendChild(fileInput);
  root.appendChild(el('button', {
    class: 'btn secondaire',
    onclick: () => fileInput.click(),
  }, 'Importer un fichier JSON'));

  root.appendChild(el('button', {
    class: 'btn danger',
    style: 'margin-top:24px;',
    onclick: async () => {
      if (!confirm('Supprimer TOUTES les séances ? Action irréversible.')) return;
      const seances = await getAllSeances();
      for (const s of seances) await deleteSeance(s.date);
      toast('Toutes les séances ont été supprimées', 'ok');
      router('parametres');
    },
  }, 'Tout effacer'));
}

async function exporter() {
  const seances = await getAllSeances();
  const payload = {
    schema_version: 2,
    exported_at: new Date().toISOString(),
    seances,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `companion-gym-${aujourdhuiISO()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Export téléchargé', 'ok');
}

async function importer(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  try {
    const texte = await file.text();
    const payload = JSON.parse(texte);
    const seances = payload.seances || [];
    if (!Array.isArray(seances)) throw new Error('Format invalide');
    for (const s of seances) {
      if (!s.date) continue;
      await putSeance(s);
    }
    toast(`${seances.length} séance(s) importée(s)`, 'ok');
    router('parametres');
  } catch (err) {
    toast('Import impossible : ' + err.message, 'danger');
  }
}

// ---------- Go ----------

init();
