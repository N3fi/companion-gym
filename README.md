# Companion Gym

Application personnelle de suivi d'entraînement en salle. Fonctionne
**hors ligne** sur mobile, servie via GitHub Pages, avec stockage local
dans IndexedDB (rien n'est jamais envoyé sur Internet).

URL de production : `https://n3fi.github.io/companion-gym/`

---

## Fonctionnalités

### Vue « Aujourd'hui »
- Affiche la séance du jour pré-remplie depuis le programme actif.
- Bandeau d'alerte quand le programme se termine dans moins de 7 jours,
  ou quand aucun programme n'est chargé.
- Fiche de chaque exercice avec technique, erreurs à éviter, lien vidéo.
- Saisie série par série : reps, charge (kg), RPE, bouton de validation.
- Boutons de ressenti pour la musculation : **douleur** (aucune / légère /
  gênante / forte) et **difficulté** (facile / ok / difficile / échec).
- Boutons de ressenti pour la mobilité : **bien / tension / inconfort / douleur**.
- Chronomètre de repos automatique après validation d'une série (bip +
  vibration à la fin).
- Notes par exercice et notes générales de séance.

### Minuteurs intégrés
- **Repos entre séries** : démarrage automatique à la validation.
- **Exercices en durée** (planche, gainage, étirements) : bouton
  `⏱ Démarrer N sec`.
- **Rounds** (sac de frappe) : alternance travail/repos automatique,
  marquage auto de la séance à la fin.
- **Séquences de phases** (tapis) : enchaînement des phases du programme.
- **Minuteur libre** : icône `⏱` dans la barre du haut, presets 30 s à 10 min.

### Vue Historique
- Liste chronologique des séances enregistrées.
- Suppression individuelle d'une séance.

### Vue Paramètres
- **Gestion du programme** : période couverte, nombre de jours, source
  (par défaut ou importé), bouton d'export, bouton d'import.
- **Stockage** : espace utilisé, quota, état de persistance.
- **Export / import des séances** au format JSON.
- **Effacement total** des séances.

---

## Utilisation sur Android

1. Ouvrir l'URL : `https://n3fi.github.io/companion-gym/?v=N`
   (voir section « Cache » plus bas pour le `N`).
2. Menu Chrome → **Ajouter à l'écran d'accueil**.
3. Lancer depuis l'icône : plein écran, sans barre d'adresse.

---

## Données

| Type | Emplacement | Éditable depuis GitHub |
|---|---|---|
| Exercices (technique, vidéo…) | `data/exercices.json` | Oui |
| Programme initial (seed) | `data/programme.json` | Oui, mais utilisé une seule fois |
| Programme actif | IndexedDB (local) | Non — via Paramètres → Import |
| Séances loguées | IndexedDB (local) | Non — via Paramètres → Export |

**Le programme initial ne sert qu'au tout premier lancement.** Ensuite,
le programme vit dans IndexedDB et se pilote via l'import/export dans
Paramètres. C'est ce qui permet d'importer une nouvelle semaine ou un
nouveau cycle sans passer par Git.

**Tes données ne sortent jamais de ton téléphone.** Les exports JSON
sont ta seule sauvegarde : fais-en un par mois, garde-le dans ton cloud
ou envoie-le-toi par mail.

---

## Modifier le programme

### Cas simple : patch d'une semaine future

Crée un fichier `programme-semaine-N.json` (voir exemple ci-dessous),
et importe-le depuis **Paramètres → Programme → Importer**.

La fusion est **additive** :
- Les `jours` et `seances_types` du fichier importé **s'ajoutent** au
  programme actif.
- Si un jour ou un template porte le même `id`/date, il est **remplacé**.

Tu peux donc :
- Envoyer un patch qui couvre uniquement la semaine prochaine sans
  toucher au reste.
- Envoyer un programme complet qui écrase tout l'ancien (fournir toutes
  les dates et tous les templates).

### Cas avancé : repartir de zéro

1. **Paramètres → Programme → Exporter** pour sauvegarder l'actuel.
2. Édite le JSON : remplace `jours` et `seances_types` par le nouveau contenu.
3. **Importer** le fichier modifié.

---

## Format d'import du programme

Un fichier d'import contient **au moins un** des deux champs `jours` ou
`seances_types`. Les deux sont recommandés si tu ajoutes un nouveau type
de séance, sinon `jours` seul suffit pour réutiliser un template existant.

### Règles de fusion
- Un template (`seances_types.<id>`) écrase l'ancien si même `id`.
- Un jour (`jours.<YYYY-MM-DD>`) écrase l'ancien si même date.
- Le reste du programme actif est conservé.

### Exemple minimal : ajouter une semaine avec le template existant `full_body`

```json
{
  "schema_version": 2,
  "jours": {
    "2026-10-07": {
      "date": "2026-10-07",
      "jour_semaine": "mercredi",
      "seance_type": "repos_actif",
      "override": null,
      "notes": null
    },
    "2026-10-08": {
      "date": "2026-10-08",
      "jour_semaine": "jeudi",
      "seance_type": "full_body",
      "override": null,
      "notes": null
    },
    "2026-10-09": {
      "date": "2026-10-09",
      "jour_semaine": "vendredi",
      "seance_type": "repos_actif_plus",
      "override": null,
      "notes": null
    },
    "2026-10-10": {
      "date": "2026-10-10",
      "jour_semaine": "samedi",
      "seance_type": "full_body",
      "override": null,
      "notes": null
    },
    "2026-10-11": {
      "date": "2026-10-11",
      "jour_semaine": "dimanche",
      "seance_type": "repos_actif",
      "override": null,
      "notes": null
    }
  }
}
