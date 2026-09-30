# Companion Gym

Application personnelle de suivi d'entraînement. Fonctionne en local
(IndexedDB) et est servie via GitHub Pages.

## Utilisation sur Android

1. Ouvrir l'URL : https://<ton-user>.github.io/companion-gym/
2. Menu Chrome → **Ajouter à l'écran d'accueil**
3. L'app se lance comme une app classique, plein écran.

## Données

- Les **exercices** et le **programme** vivent dans `data/*.json`.
  Éditables directement sur GitHub (crayon → commit) : l'app rechargera
  la nouvelle version au prochain lancement.
- Les **séances loguées** sont stockées dans IndexedDB, sur ton téléphone.
  Elles ne sont **jamais** envoyées sur Internet.
- Sauvegarde manuelle via **Paramètres → Exporter**. Fais-le régulièrement.

## Modifier le programme

Édite `data/programme.json` : les exercices d'un jour sont dans
`jours["YYYY-MM-DD"].seance_type`, qui référence un template de
`seances_types`.

## Structure

- `index.html` — page unique
- `css/style.css` — styles
- `data/` — données statiques (JSON)
- `js/core/` — IndexedDB, chargement des données
- `js/ui/` — chrono, helpers
- `js/app.js` — bootstrap, vues, routage
