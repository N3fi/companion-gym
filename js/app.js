// Point d'entrée : bootstrap, routage entre vues.

import { chargerExercices, chargerProgramme, getExercice, getProgrammeJour, getPlageProgramme, importerProgramme, exporterProgramme, invaliderCacheProgramme }
  from './core/data.js';
import { getAllSeances, getSeance, putSeance, deleteSeance,
         demanderPersistance, etatStockage,
         getEtatExercice, putEtatExercice } from './core/db.js';
import { el, vider, toast, aujourdhuiISO, formatDateLongue,
         formatDateCourte, jourSemaine, formatOctets } from './ui/helpers.js';
import { demarrerSimple, demarrerSequence, arreter as timerArreter, initTimer } from './ui/timer.js';
const vueEl = () => document.getElementById('vue');
const titreEl = () => document.getElementById('titre-vue');
const menuEl = () => document.getElementById('menu');
// Réfs des exercices dont l'accordéon est ouvert.
// Persiste entre les re-renders (donc entre les clics qui déclenchent router()).
const exosOuverts = new Set();

// ---------- Bootstrap ----------

async function init() {
  initTimer();

  document.getElementById('btn-menu')?.addEventListener('click', () => {
    menuEl()?.classList.toggle('hidden');
  });

  document.querySelectorAll('#menu button').forEach(btn => {
    btn.addEventListener('click', () => {
      menuEl()?.classList.add('hidden');
      router(btn.dataset.vue);
    });
  });
  
  document.getElementById('btn-timer-libre')?.addEventListener('click', ouvrirMinuteurLibre);

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
  const scrollY = window.scrollY;
  vider(vueEl());
  const titres = { aujourdhui: "Aujourd'hui", historique: 'Historique', parametres: 'Paramètres' };
  if (titreEl()) titreEl().textContent = titres[nom] || 'Companion Gym';

  if (nom === 'aujourdhui') {
    await vueAujourdhui();
    requestAnimationFrame(() => window.scrollTo(0, scrollY));
    return;
  }
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

  await afficherBandeauProgramme(root, date);

  // Construction de la séance si première fois
  const seanceActive = seance || creerSeanceVide(date, prog);

  // Migration : ancienne structure cardio → cardios
  if (seanceActive.cardio && !seanceActive.cardios) {
    seanceActive.cardios = { [seanceActive.cardio.ref]: seanceActive.cardio };
    delete seanceActive.cardio;
    await sauvegarder(seanceActive, { silencieux: true });
  }

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
      const vaTerminer = !seanceActive.terminee;
      seanceActive.terminee = vaTerminer;
      await sauvegarder(seanceActive);
      if (vaTerminer) {
        await mettreAJourEtatExercices(seanceActive);
      }
      toast(vaTerminer ? 'Séance enregistrée' : 'Séance réouverte', 'ok');
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

// --- Nouveau : sélecteur de boutons générique ---
// options = [{val:'aucune', lbl:'Aucune', couleur:'ok'}, ...]
function rendreChoixBoutons(options, valeur, onChange) {
  const wrap = el('div', {
    style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;',
  });
  for (const opt of options) {
    const actif = valeur === opt.val;
    const cls = actif ? 'btn petit' : 'btn secondaire petit';
    const btn = el('button', {
      class: cls,
      style: 'flex:1;min-width:0;padding:8px 4px;font-size:0.8rem;'
           + (actif && opt.couleur === 'warn' ? 'background:var(--warn);color:#000;' : '')
           + (actif && opt.couleur === 'danger' ? 'background:var(--danger);' : ''),
      onclick: async (ev) => {
        ev.stopPropagation();
        onChange(actif ? null : opt.val);
      },
    }, opt.lbl);
    wrap.appendChild(btn);
  }
  return wrap;
}

const OPTIONS_DOULEUR = [
  { val: 'aucune',   lbl: 'Aucune',   couleur: 'ok' },
  { val: 'legere',   lbl: 'Légère',   couleur: 'warn' },
  { val: 'genante',  lbl: 'Gênante',  couleur: 'warn' },
  { val: 'forte',    lbl: 'Forte',    couleur: 'danger' },
];

const OPTIONS_DIFFICULTE = [
  { val: 'facile',    lbl: 'Facile' },
  { val: 'ok',        lbl: 'Ok' },
  { val: 'difficile', lbl: 'Difficile', couleur: 'warn' },
  { val: 'echec',     lbl: 'Échec',     couleur: 'danger' },
];

const OPTIONS_RESSENTI = [
  { val: 'bien',      lbl: 'Bien' },
  { val: 'tension',   lbl: 'Tension',   couleur: 'warn' },
  { val: 'inconfort', lbl: 'Inconfort', couleur: 'warn' },
  { val: 'douleur',   lbl: 'Douleur',   couleur: 'danger' },
];

async function rendreBloc(root, bloc, seance) {
  if (bloc.type === 'musculation') {
    root.appendChild(el('h2', { class: 'section' }, 'Musculation'));

    // Enrichit chaque exoDef avec son état "terminé"
    const enrichis = bloc.exercices.map(exoDef => {
      const entree = seance.exercices.find(e => e.ref === exoDef.ref);
      const termine = !!(entree && entree.series?.length > 0
        && entree.series.every(s => s.validee));
      return { exoDef, termine };
    });

    // Trie : non terminés d'abord, terminés ensuite (ordre d'apparition préservé)
    const tries = [
      ...enrichis.filter(e => !e.termine),
      ...enrichis.filter(e => e.termine),
    ];

    for (const { exoDef } of tries) {
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
    return;
  }

  if (bloc.type === 'conditionnement') {
    root.appendChild(el('h2', { class: 'section' }, 'Conditionnement'));
    await rendreConditionnement(root, bloc.ref, seance);
    return;
  }
}

async function rendreExerciceMuscu(root, exoDef, seance) {
  const exo = await getExercice(exoDef.ref);
  if (!exo) {
    root.appendChild(el('div', { class: 'carte' }, `Exercice introuvable : ${exoDef.ref}`));
    return;
  }

  let entree = seance.exercices.find(e => e.ref === exoDef.ref);
  if (!entree) {
    const posId = exoDef.position ?? (exo.positions?.[0]?.id ?? null);
    entree = {
      ref: exoDef.ref,
      nom_snapshot: exo.nom,
      position: posId,
      series: await initialiserSeries(exoDef, exo),
      douleur: null,
      difficulte: null,
      notes: '',
    };
    seance.exercices.push(entree);
  }

  const posId = entree.position;
  const position = exo.positions?.find(p => p.id === posId);
  const prescription = formaterPrescription(exoDef, exo, position);
  const estDuree = exo.unite === 'duree_sec';

  // État "terminé" pour le fond vert
  const termine = entree.series?.length > 0
    && entree.series.every(s => s.validee);

  // Body de l'accordéon : ouvert si mémorisé
  const body = el('div', { class: 'exo-body' });
  if (!exosOuverts.has(exoDef.ref)) body.classList.add('hidden');

  const container = el('div', {
    class: 'exo' + (termine ? ' exo-fait' : ''),
  }, [
    el('div', {
      class: 'exo-header',
      onclick: () => {
        const cache = body.classList.toggle('hidden');
        if (cache) exosOuverts.delete(exoDef.ref);
        else exosOuverts.add(exoDef.ref);
      },
    }, [
      el('h3', {}, exo.nom),
      el('span', { class: 'prescription' },
        (termine ? '✓ ' : '')
        + (entree.douleur && entree.douleur !== 'aucune' ? '⚠ ' : '')
        + (entree.difficulte === 'echec' ? '✗ ' : '')
        + prescription),
    ]),
  ]);

  // --- Dernière perf (uniquement si position identique) ---
  try {
    const etat = await getEtatExercice(exo.id);
    if (etat?.derniere_charge_kg && etat.position_active === posId) {
      body.appendChild(el('div', {
        style: 'font-size:0.8rem;color:var(--fg-dim);text-align:center;padding:8px 0;'
      }, `Dernière fois : ${etat.derniere_charge_kg} kg (${formatDateCourte(etat.derniere_seance)})`));
    }
  } catch {}

  // --- Réglages machine ---
  if (exo.reglages && Object.keys(exo.reglages).length) {
    const ordre = ['siege', 'dossier', 'alignement_pivot', 'coussin_chevilles',
                   'coussin_cuisses', 'coussin_genoux', 'coussin_pectoral',
                   'prise', 'plateforme', 'amplitude'];
    const cles = Object.keys(exo.reglages).sort((a, b) => {
      const ia = ordre.indexOf(a), ib = ordre.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    body.appendChild(el('div', {
      style: 'background:var(--bg-3);padding:10px;border-radius:8px;margin-top:10px;'
    }, [
      el('div', { style: 'font-size:0.75rem;color:var(--fg-dim);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;' },
        'Réglages'),
      ...cles.map(k => el('div', { style: 'font-size:0.85rem;line-height:1.4;margin-bottom:4px;' }, [
        el('span', { style: 'color:var(--fg-dim);' }, k.replace(/_/g, ' ') + ' : '),
        exo.reglages[k],
      ])),
    ]));
  }

  // --- Notes machine ---
  if (exo.notes_machine) {
    body.appendChild(el('div', {
      style: 'background:rgba(76,141,255,0.08);padding:10px;border-radius:8px;margin-top:8px;font-size:0.85rem;line-height:1.4;'
    }, [
      el('div', { style: 'font-size:0.75rem;color:var(--accent);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;' },
        'Machine'),
      exo.notes_machine,
    ]));
  }

  // --- Sélecteur de position ---
  if (exo.positions && exo.positions.length > 0) {
    const posWrap = el('div', { style: 'margin-top:10px;' }, [
      el('div', { style: 'font-size:0.75rem;color:var(--fg-dim);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;' },
        'Position'),
    ]);
    exo.positions.forEach(pos => {
      const active = pos.id === posId;
      posWrap.appendChild(el('div', {
        style: 'padding:8px;border-radius:6px;margin-bottom:4px;font-size:0.85rem;cursor:pointer;'
          + (active ? 'background:var(--accent);color:white;' : 'background:var(--bg-3);'),
        onclick: async (ev) => {
          ev.stopPropagation();
          if (pos.id === posId) return;
          entree.position = pos.id;
          const charge = pos.charge_kg_depart ?? exo.charge_kg_depart ?? null;
          for (const s of entree.series) {
            if (!s.validee) s.charge_kg = charge;
          }
          await sauvegarder(seance, { silencieux: true });
          router('aujourdhui');
        },
      }, [
        el('div', { style: 'font-weight:600;' }, pos.cible || pos.id),
        pos.description ? el('div', { style: 'font-size:0.8rem;opacity:0.9;' }, pos.description) : null,
        pos.charge_kg_depart ? el('div', { style: 'font-size:0.8rem;opacity:0.9;' }, `Départ : ${pos.charge_kg_depart} kg`) : null,
        pos.notes ? el('div', { style: 'font-size:0.75rem;opacity:0.75;margin-top:2px;' }, pos.notes) : null,
      ]));
    });
    body.appendChild(posWrap);
  }

  // --- Technique / erreurs ---
  if (exo.technique?.length) {
    body.appendChild(el('div', { style: 'font-size:0.75rem;color:var(--fg-dim);text-transform:uppercase;letter-spacing:0.05em;margin-top:14px;margin-bottom:4px;' },
      'Technique'));
    body.appendChild(el('ul', { class: 'technique' }, exo.technique.map(t => el('li', {}, t))));
  }
  if (exo.erreurs?.length) {
    body.appendChild(el('div', { style: 'font-size:0.75rem;color:var(--fg-dim);text-transform:uppercase;letter-spacing:0.05em;margin-top:14px;margin-bottom:4px;' },
      'À éviter'));
    body.appendChild(el('ul', { class: 'erreurs' }, exo.erreurs.map(t => el('li', {}, t))));
  }
  if (exo.video_url) {
    body.appendChild(el('a', {
      href: exo.video_url, target: '_blank', rel: 'noopener',
      style: 'display:inline-block;margin-top:8px;color:var(--accent);font-size:0.9rem;',
    }, '▶ Voir la vidéo'));
  }

  // --- Séries ---
  body.appendChild(el('div', { style: 'font-size:0.75rem;color:var(--fg-dim);text-transform:uppercase;letter-spacing:0.05em;margin-top:14px;margin-bottom:4px;' },
    'Séries'));

  const reposSec = exo.repos_defaut_sec || 60;
  const cibleSec = Array.isArray(exoDef.duree_sec)
    ? exoDef.duree_sec[1]
    : (exoDef.duree_sec || exo.duree_sec_defaut || 30);

  if (estDuree) {
    // En-têtes pour durée
    body.appendChild(el('div', { class: 'serie-labels serie-labels-duree' }, [
      el('span', {}, '#'), el('span', {}, 'Durée s'),
      el('span', {}, 'RPE'), el('span', {}, '▶'), el('span', {}, ''),
    ]));
    entree.series.forEach((serie, idx) => {
      body.appendChild(rendreSerieDuree(serie, idx, cibleSec, reposSec, seance, container, exo, entree));
    });
  } else {
    body.appendChild(el('div', { class: 'serie-labels' }, [
      el('span', {}, '#'), el('span', {}, 'Reps'),
      el('span', {}, 'kg'), el('span', {}, 'RPE'), el('span', {}, ''),
    ]));
    entree.series.forEach((serie, idx) => {
      body.appendChild(rendreSerie(serie, idx, reposSec, seance, container, exo, entree));
    });
  }

  // --- Bouton + série ---
  body.appendChild(el('button', {
    class: 'btn secondaire petit',
    style: 'margin-top:8px;',
    onclick: async (ev) => {
      ev.stopPropagation();
      const derniere = entree.series[entree.series.length - 1];
      if (estDuree) {
        entree.series.push({
          duree_sec: derniere?.duree_sec ?? cibleSec,
          rpe: null,
          validee: false,
        });
      } else {
        entree.series.push({
          reps: derniere?.reps ?? 10,
          charge_kg: derniere?.charge_kg ?? null,
          rpe: null,
          validee: false,
        });
      }
      await sauvegarder(seance, { silencieux: true });
      router('aujourdhui');
    },
  }, '+ Ajouter une série'));

  // --- Ressenti douleur ---
  body.appendChild(el('div', { class: 'serie-labels', style: 'grid-template-columns:1fr;margin-top:14px;' },
    [el('span', {}, 'Douleur')]));
  body.appendChild(rendreChoixBoutons(OPTIONS_DOULEUR, entree.douleur, async (val) => {
    entree.douleur = val;
    await sauvegarder(seance, { silencieux: true });
    router('aujourdhui');
  }));

  // --- Ressenti difficulté ---
  body.appendChild(el('div', { class: 'serie-labels', style: 'grid-template-columns:1fr;margin-top:14px;' },
    [el('span', {}, 'Difficulté ressentie')]));
  body.appendChild(rendreChoixBoutons(OPTIONS_DIFFICULTE, entree.difficulte, async (val) => {
    entree.difficulte = val;
    await sauvegarder(seance, { silencieux: true });
    router('aujourdhui');
  }));

  // --- Notes exercice ---
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

async function rendreConditionnement(root, ref, seance) {
  const exo = await getExercice(ref);
  if (!exo) return;

  let entree = seance.exercices.find(e => e.ref === ref);
  if (!entree) {
    entree = {
      ref,
      nom_snapshot: exo.nom,
      rounds: exo.rounds_defaut || 3,
      duree_round_min: exo.duree_round_min_defaut || 2,
      repos_min: exo.repos_entre_rounds_min_defaut || 1,
      fait: false,
    };
    seance.exercices.push(entree);
  }

  const body = el('div', { class: 'exo-body hidden' });
  if (exo.technique?.length) {
    body.appendChild(el('ul', { class: 'technique' },
      exo.technique.map(t => el('li', {}, t))));
  }
  if (exo.erreurs?.length) {
    body.appendChild(el('ul', { class: 'erreurs' },
      exo.erreurs.map(t => el('li', {}, t))));
  }
  if (exo.materiel?.length) {
    body.appendChild(el('p', { class: 'meta', style: 'margin-top:8px;' },
      'Matériel : ' + exo.materiel.join(', ')));
  }

  const totalRounds = entree.rounds;
  const dureeRound = entree.duree_round_min;
  const repos = entree.repos_min;

  body.appendChild(el('button', {
    class: 'btn secondaire',
    style: 'margin-top:12px;',
    onclick: (ev) => {
      ev.stopPropagation();
      const phases = [];
      for (let i = 0; i < totalRounds; i++) {
        phases.push({ duree_sec: dureeRound * 60, label: `Round ${i + 1}`, type: 'travail' });
        if (i < totalRounds - 1) {
          phases.push({ duree_sec: repos * 60, label: `Repos ${i + 1}`, type: 'repos' });
        }
      }
      demarrerSequence(phases, {
        onFin: async () => {
          entree.fait = true;
          await sauvegarder(seance, { silencieux: true });
          router('aujourdhui');
        },
      });
    },
  }, `⏱ Démarrer ${totalRounds} rounds`));

  body.appendChild(el('button', {
    class: 'btn ' + (entree.fait ? 'secondaire' : 'petit'),
    style: 'margin-top:8px;',
    onclick: async (ev) => {
      ev.stopPropagation();
      entree.fait = !entree.fait;
      await sauvegarder(seance, { silencieux: true });
      router('aujourdhui');
    },
  }, entree.fait ? '✓ Fait' : 'Marquer comme fait'));

  const container = el('div', { class: 'exo' }, [
    el('div', {
      class: 'exo-header',
      onclick: () => body.classList.toggle('hidden'),
    }, [
      el('h3', {}, exo.nom),
      el('span', { class: 'prescription' },
        (entree.fait ? '✓ ' : '') + `${totalRounds}×${dureeRound} min`),
    ]),
    body,
  ]);
  root.appendChild(container);
}

async function initialiserSeries(exoDef, exo) {
  const nb = exoDef.series || 3;
  const posId = exoDef.position ?? (exo.positions?.[0]?.id ?? null);
  const position = exo.positions?.find(p => p.id === posId);

  // Priorité 1 : état utilisateur (dernière perf sur cette position)
  let charge = null;
  try {
    const etat = await getEtatExercice(exo.id);
    if (etat?.derniere_charge_kg != null && etat.position_active === posId) {
      charge = etat.derniere_charge_kg;
    }
  } catch {}

  // Priorité 2 : valeur de départ (programme > position > exercice)
  if (charge == null) {
    charge = exoDef.charge_de_depart_kg
          ?? position?.charge_kg_depart
          ?? exo.charge_kg_depart
          ?? null;
  }

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

function formaterPrescription(exoDef, exo, position) {
  const parts = [];
  if (exoDef.series) parts.push(`${exoDef.series} séries`);
  if (exoDef.reps) parts.push(`${exoDef.reps} reps`);
  if (exoDef.duree_sec) {
    const d = Array.isArray(exoDef.duree_sec)
      ? `${exoDef.duree_sec[0]}-${exoDef.duree_sec[1]} sec`
      : `${exoDef.duree_sec} sec`;
    parts.push(d);
  }
  const charge = exoDef.charge_de_depart_kg ?? position?.charge_kg_depart ?? exo.charge_kg_depart;
  if (charge) parts.push(`${charge} kg`);
  return parts.join(' · ');
}

function rendreSerie(serie, idx, reposSec, seance, containerExo, exo, entree) {
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

  const majFond = () => {
    const termine = entree.series.every(s => s.validee);
    if (termine) containerExo.classList.add('exo-fait');
    else containerExo.classList.remove('exo-fait');
  };

  const btn = el('button', {
    class: 'icon-btn',
    style: 'font-size:1.1rem;padding:6px;min-width:32px;',
    title: 'Valider la série',
    onclick: async (ev) => {
      ev.stopPropagation();
      serie.validee = !serie.validee;
      if (serie.validee) demarrerSimple(reposSec, { label: 'Repos' });
      else timerArreter();
      await sauvegarder(seance, { silencieux: true });

      // Mise à jour locale du bouton et des inputs
      ev.target.textContent = serie.validee ? '✓' : '○';
      if (serie.validee) {
        inputReps.classList.add('valide');
        inputCharge.classList.add('valide');
      } else {
        inputReps.classList.remove('valide');
        inputCharge.classList.remove('valide');
      }
      majFond();
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

function rendreSerieDuree(serie, idx, cibleSec, reposSec, seance, exo) {
  const inputDuree = el('input', {
    type: 'number', inputmode: 'numeric',
    placeholder: String(cibleSec || ''),
    value: serie.duree_sec ?? cibleSec ?? '',
    min: '1',
  });
  const inputRpe = el('input', {
    type: 'number', inputmode: 'decimal',
    placeholder: '—', value: serie.rpe ?? '',
    min: '1', max: '10', step: '0.5',
  });

  const btnChrono = el('button', {
    class: 'icon-btn',
    style: 'font-size:1rem;padding:6px;min-width:36px;',
    title: 'Lancer le chrono',
    onclick: (ev) => {
      ev.stopPropagation();
      const duree = Number(inputDuree.value) || cibleSec || 30;
      demarrerSimple(duree, {
        label: exo.nom,
        type: 'travail',
        onFin: async () => {
          serie.validee = true;
          serie.duree_sec = duree;
          await sauvegarder(seance, { silencieux: true });
          router('aujourdhui');
        },
      });
    },
  }, '▶');

  const btn = el('button', {
    class: 'icon-btn',
    style: 'font-size:1.1rem;padding:6px;min-width:36px;',
    title: 'Valider',
    onclick: async (ev) => {
      ev.stopPropagation();
      serie.validee = !serie.validee;
      if (serie.validee) demarrerSimple(reposSec, { label: 'Repos' });
      else timerArreter();
      await sauvegarder(seance, { silencieux: true });
      router('aujourdhui');
    },
  }, serie.validee ? '✓' : '○');

  const maj = () => {
    serie.duree_sec = inputDuree.value === '' ? null : Number(inputDuree.value);
    serie.rpe = inputRpe.value === '' ? null : Number(inputRpe.value);
    sauvegarder(seance, { silencieux: true });
  };
  [inputDuree, inputRpe].forEach(i => i.addEventListener('change', maj));

  if (serie.validee) inputDuree.classList.add('valide');

  return el('div', { class: 'serie serie-duree' }, [
    el('span', { class: 'num' }, String(idx + 1)),
    inputDuree, inputRpe, btnChrono, btn,
  ]);
}

async function rendreExerciceMobilite(root, exoDef, seance, typeOverride) {
  const exo = await getExercice(exoDef.ref);
  if (!exo) return;

  let entree = seance.exercices.find(e => e.ref === exoDef.ref);
  if (!entree) {
    entree = { ref: exoDef.ref, nom_snapshot: exo.nom, fait: false, ressenti: null };
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

  const titre = el('h3', {}, exo.nom);
  const prescription = el('span', { class: 'prescription' }, '');

  const majMarqueur = () => {
    const marqueur = entree.ressenti === 'douleur' ? '⚠ '
                   : entree.ressenti === 'inconfort' ? '! '
                   : entree.fait ? '✓ ' : '';
    titre.textContent = marqueur + exo.nom;
    prescription.textContent = (exo.duree_sec_defaut ? `${exo.duree_sec_defaut} s` : '');
  };

  const btnFait = el('button', {
    class: 'btn ' + (entree.fait ? 'secondaire' : 'petit'),
    style: 'margin-top:10px;',
    onclick: async (ev) => {
      ev.stopPropagation();
      entree.fait = !entree.fait;
      if (entree.fait) container.classList.add('exo-fait');
      else container.classList.remove('exo-fait');
      await sauvegarder(seance, { silencieux: true });
      ev.target.textContent = entree.fait ? '✓ Fait' : 'Marquer comme fait';
      ev.target.className = 'btn ' + (entree.fait ? 'secondaire' : 'petit');
      majMarqueur();
    },
  }, entree.fait ? '✓ Fait' : 'Marquer comme fait');
  body.appendChild(btnFait);

  if (exo.duree_sec_defaut) {
    body.appendChild(el('button', {
      class: 'btn secondaire petit',
      style: 'margin-top:8px;',
      onclick: (ev) => {
        ev.stopPropagation();
        demarrerSimple(exo.duree_sec_defaut, { label: exo.nom, type: 'travail' });
      },
    }, `⏱ Démarrer ${exo.duree_sec_defaut} sec`));
  }

  body.appendChild(el('div', { class: 'serie-labels', style: 'grid-template-columns:1fr;margin-top:14px;' },
    [el('span', {}, 'Ressenti')]));
  body.appendChild(rendreChoixBoutons(OPTIONS_RESSENTI, entree.ressenti, async (val) => {
    entree.ressenti = val;
    await sauvegarder(seance, { silencieux: true });
    majMarqueur();
  }));

  majMarqueur();

  const container = el('div', {
    class: 'exo' + (entree.fait ? ' exo-fait' : ''),
  }, [
    el('div', {
      class: 'exo-header',
      onclick: () => body.classList.toggle('hidden'),
    }, [titre, prescription]),
    body,
  ]);

  root.appendChild(container);
}

async function rendreCardio(root, ref, seance) {
  const exo = await getExercice(ref);
  if (!exo) return;

  if (!seance.cardios) seance.cardios = {};
  if (!seance.cardios[ref]) {
    seance.cardios[ref] = {
      ref,
      nom: exo.nom,
      duree_min: null,
      fait: false,
    };
    await sauvegarder(seance, { silencieux: true });
  }

  const c = seance.cardios[ref];

  const input = el('input', {
    type: 'number', inputmode: 'decimal',
    placeholder: exo.duree_min_defaut ?? '',
    value: c.duree_min ?? exo.duree_min_defaut ?? '',
    style: 'width:100%;padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--bg-3);color:var(--fg);font-size:1rem;',
  });
  input.addEventListener('change', async () => {
    c.duree_min = input.value === '' ? null : Number(input.value);
    await sauvegarder(seance, { silencieux: true });
  });

  const infos = [];
  if (exo.vitesse_kmh_defaut) infos.push(`${exo.vitesse_kmh_defaut} km/h`);
  if (exo.inclinaison_pct_defaut) infos.push(`${exo.inclinaison_pct_defaut}%`);

  const titre = el('h3', {}, (c.fait ? '✓ ' : '') + exo.nom);

  const btnFait = el('button', {
    class: 'btn ' + (c.fait ? 'secondaire' : 'petit'),
    style: 'margin-top:10px;',
    onclick: async (ev) => {
      ev.stopPropagation();
      c.fait = !c.fait;
      await sauvegarder(seance, { silencieux: true });

      const container = ev.target.closest('.exo');
      if (c.fait) {
        container.classList.add('exo-fait');
        titre.textContent = '✓ ' + exo.nom;
        ev.target.textContent = '✓ Fait';
        ev.target.className = 'btn secondaire';
      } else {
        container.classList.remove('exo-fait');
        titre.textContent = exo.nom;
        ev.target.textContent = 'Marquer comme fait';
        ev.target.className = 'btn petit';
      }
    },
  }, c.fait ? '✓ Fait' : 'Marquer comme fait');

  const container = el('div', {
    class: 'exo' + (c.fait ? ' exo-fait' : ''),
  }, [
    el('div', { class: 'exo-header' }, [
      titre,
      el('span', { class: 'prescription' }, infos.join(' · ')),
    ]),
    el('div', { class: 'exo-body-content', style: 'padding:0 14px 14px 14px;' }, [
      el('div', { class: 'serie-labels', style: 'grid-template-columns:1fr;' },
        [el('span', {}, 'Durée réelle (min)')]),
      input,
      btnFait,
    ]),
  ]);
  root.appendChild(container);

  // Séquence de phases (tapis)
  if (Array.isArray(exo.phases) && exo.phases.length > 0) {
    const phases = exo.phases.map(p => {
      const [d1, d2] = p.min;
      return { duree_sec: (d2 - d1) * 60, label: p.note || `${d1}-${d2} min`, type: 'travail' };
    });
    const totalMin = exo.phases.reduce((acc, p) => acc + (p.min[1] - p.min[0]), 0);
    const btn = el('button', {
      class: 'btn secondaire',
      style: 'margin-top:10px;',
      onclick: () => demarrerSequence(phases, {
        onFin: async () => {
          c.duree_min = totalMin;
          await sauvegarder(seance, { silencieux: true });
          toast(`Durée enregistrée : ${totalMin} min`, 'ok');
          input.value = totalMin;
        },
      }),
    }, `⏱ Démarrer la séquence (${totalMin} min)`);
    container.querySelector('.exo-body-content').appendChild(btn);
  }
}

async function afficherBandeauProgramme(root, dateAujourdhui) {
  const plage = await getPlageProgramme();
  if (!plage) {
    root.appendChild(el('div', { class: 'carte', style: 'border-color:var(--danger);' }, [
      el('h3', {}, '⚠ Aucun programme chargé'),
      el('p', { class: 'meta' }, 'Importe un programme depuis Paramètres.'),
    ]));
    return;
  }

  // Programme en cours ?
  const dansPlage = dateAujourdhui >= plage.debut && dateAujourdhui <= plage.fin;
  const jourExiste = await getProgrammeJour(dateAujourdhui);

  // Si aujourd'hui n'est pas dans le programme
  if (!jourExiste) {
    root.appendChild(el('div', { class: 'carte', style: 'border-color:var(--warn);' }, [
      el('h3', {}, 'Pas de séance prévue aujourd\'hui'),
      el('p', { class: 'meta' },
        `Ton programme couvre du ${formatDateCourte(plage.debut)} au ${formatDateCourte(plage.fin)}.`),
      el('button', {
        class: 'btn secondaire petit',
        style: 'margin-top:8px;',
        onclick: () => router('parametres'),
      }, 'Gérer le programme'),
    ]));
    return;
  }

  // Alerte si on approche de la fin (7 jours)
  const [y, m, j] = plage.fin.split('-').map(Number);
  const fin = new Date(y, m - 1, j);
  const [ya, ma, ja] = dateAujourdhui.split('-').map(Number);
  const auj = new Date(ya, ma - 1, ja);
  const joursRestants = Math.round((fin - auj) / (1000 * 60 * 60 * 24));

  if (joursRestants <= 7) {
    root.appendChild(el('div', { class: 'carte', style: 'border-color:var(--warn);' }, [
      el('h3', {}, '⏳ Programme bientôt terminé'),
      el('p', { class: 'meta' },
        joursRestants === 0
          ? 'Dernier jour du programme aujourd\'hui.'
          : `Il reste ${joursRestants} jour${joursRestants > 1 ? 's' : ''} avant la fin du programme.`),
      el('button', {
        class: 'btn secondaire petit',
        style: 'margin-top:8px;',
        onclick: () => router('parametres'),
      }, 'Importer la suite'),
    ]));
  }
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

async function mettreAJourEtatExercices(seance) {
  for (const entree of seance.exercices || []) {
    if (!entree.series || entree.series.length === 0) continue;

    const etat = await getEtatExercice(entree.ref) || {
      ref: entree.ref,
      position_active: entree.position ?? null,
      historique_charges: [],
      restrictions: [],
    };

    // Dernière charge validée sur cette position
    const derniere = [...entree.series].reverse().find(s => s.validee && s.charge_kg != null);
    if (derniere) {
      etat.derniere_charge_kg = derniere.charge_kg;
      etat.derniere_seance = seance.date;
      etat.position_active = entree.position ?? etat.position_active;

      etat.historique_charges = etat.historique_charges || [];
      etat.historique_charges.push({
        date: seance.date,
        kg: derniere.charge_kg,
        position: entree.position ?? null,
      });
      if (etat.historique_charges.length > 50) {
        etat.historique_charges = etat.historique_charges.slice(-50);
      }
    }

    // Restrictions (douleur signalée)
    if (entree.douleur && entree.douleur !== 'aucune') {
      etat.restrictions = etat.restrictions || [];
      const existante = etat.restrictions.find(r => r.type === entree.douleur);
      if (!existante) {
        etat.restrictions.push({
          type: entree.douleur,
          depuis: seance.date,
          note: `Signalée à la séance du ${seance.date}`,
        });
      }
    }

    await putEtatExercice(etat);
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
  const plage = await getPlageProgramme();
  const carteProgramme = el('div', { class: 'carte' }, [
    el('h2', {}, 'Programme'),
  ]);

  if (!plage) {
    carteProgramme.appendChild(el('p', { class: 'meta' }, 'Aucun programme chargé.'));
  } else {
    carteProgramme.appendChild(el('div', { class: 'detail-row' }, [
      el('span', { class: 'lbl' }, 'Période'),
      el('span', {}, `${formatDateCourte(plage.debut)} → ${formatDateCourte(plage.fin)}`),
    ]));
    carteProgramme.appendChild(el('div', { class: 'detail-row' }, [
      el('span', { class: 'lbl' }, 'Jours'),
      el('span', {}, String(plage.nb_jours)),
    ]));
    carteProgramme.appendChild(el('div', { class: 'detail-row' }, [
      el('span', { class: 'lbl' }, 'Source'),
      el('span', {}, plage.source === 'seed' ? 'Par défaut (repo)' : 'Importé'),
    ]));
    if (plage.imported_at) {
      const d = new Date(plage.imported_at);
      carteProgramme.appendChild(el('div', { class: 'detail-row' }, [
        el('span', { class: 'lbl' }, 'Importé le'),
        el('span', {}, d.toLocaleDateString('fr-FR')),
      ]));
    }
  }

  carteProgramme.appendChild(el('button', {
    class: 'btn secondaire petit',
    style: 'margin-top:12px;',
    onclick: exporterProgrammeFichier,
  }, 'Exporter le programme actif'));

  const fileProg = el('input', {
    type: 'file', accept: 'application/json', style: 'display:none;',
    onchange: importerProgrammeFichier,
  });
  carteProgramme.appendChild(fileProg);

  carteProgramme.appendChild(el('button', {
    class: 'btn petit',
    style: 'margin-top:8px;',
    onclick: () => fileProg.click(),
  }, 'Importer un programme (JSON)'));

  root.appendChild(carteProgramme);

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

function ouvrirMinuteurLibre() {
  // Crée un overlay à la volée
  const overlay = el('div', { class: 'modal-overlay', onclick: (e) => {
    if (e.target === overlay) overlay.remove();
  }});
  const presets = [
    { lbl: '30 s',   sec: 30 },
    { lbl: '1 min',  sec: 60 },
    { lbl: '2 min',  sec: 120 },
    { lbl: '3 min',  sec: 180 },
    { lbl: '5 min',  sec: 300 },
    { lbl: '10 min', sec: 600 },
  ];
  const grille = el('div', { class: 'presets' },
    presets.map(p => el('button', {
      onclick: () => {
        overlay.remove();
        demarrerSimple(p.sec, { label: 'Minuteur libre', type: 'travail' });
      },
    }, p.lbl)));
  overlay.appendChild(el('div', { class: 'modal' }, [
    el('h3', {}, 'Minuteur libre'),
    grille,
    el('button', {
      class: 'btn secondaire petit',
      style: 'margin-top:14px;',
      onclick: () => overlay.remove(),
    }, 'Annuler'),
  ]));
  document.body.appendChild(overlay);
}

async function exporterProgrammeFichier() {
  const payload = await exporterProgramme();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `programme-${aujourdhuiISO()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Programme exporté', 'ok');
}

async function importerProgrammeFichier(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  try {
    const texte = await file.text();
    const payload = JSON.parse(texte);
    const res = await importerProgramme(payload);
    invaliderCacheProgramme();
    toast(`Programme importé : ${res.jours_ajoutes} jour(s), ${res.templates_ajoutes} template(s)`, 'ok');
    router('parametres');
  } catch (err) {
    toast('Import impossible : ' + err.message, 'danger');
  }
}

// ---------- Go ----------

init();
