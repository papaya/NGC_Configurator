# ModulBox NGC Configurator

Configurateur local en français pour composer un contrôleur à partir des modules du dépôt matériel [MB_ModulBox_NG](./reference/MB_ModulBox_NG/README.md), documenter ses connexions, gérer des contrôles MIDI et produire des fichiers NGC/NGR/NGL.

## Lancer sur macOS

Prérequis : macOS récent et Python 3.9+ (aucune dépendance Python ou npm n'est nécessaire pour l'application).

Depuis ce dossier :

```sh
python3 -m http.server 8000
```

Ouvrir ensuite <http://localhost:8000>. Le serveur doit être lancé depuis la racine du projet afin que l'application charge `data/modules.json` et les images du dépôt matériel.

Les projets sont conservés automatiquement dans le stockage local du navigateur. Utilisez **Enregistrer JSON** pour créer une sauvegarde portable. Le navigateur peut demander l'autorisation de télécharger plusieurs fichiers lors de l'export.

Les tests unitaires utilisent le runner intégré à Node.js :

```sh
npm test
```

## Fonctions disponibles

- Bibliothèque de modules alimentée par `data/modules.json`, avec sources et illustrations du dépôt cloné.
- Composition de modules physiques et création de contrôles logiques à partir des familles documentées.
- Connexions explicites ; chaîne DIN Core32F4 (J9) → DIN4_R5_KS et validation des chaînes DOUT Core32F4 (J8) → DOUT selon le brochage documenté.
- Édition manuelle des `hw_id`, des configurations `ENC`, des événements CC, NoteOn bouton et Meta; les commandes Meta de sélection de banque documentées sont contrôlées séparément de `RunSection`.
- Déclarations `EVENT_RGBLED`, paramètres LED vérifiés et génération de sections NGR `set_hsv`.
- Banques indépendantes et vue matricielle.
- Validation des champs, des IDs de ressource manuels, des ports/connexions documentés et des collisions NGC/NGR/NGL modélisées.
- Génération cohérente NGC/NGL et génération NGR lorsqu'un script avancé ou des paramètres `set_hsv` structurés sont présents; aperçu, sauvegarde JSON, chargement et annulation/rétablissement.
- Import append-only et conservation de blocs NGC/NGR/NGL avancés, sans réécrire les fichiers sources; diff entre générations avant téléchargement.

## Limites connues

Cette version reste un configurateur local et n'est pas un validateur officiel MIDIbox NG. Les sorties structurées testées couvrent les CC de `EVENT_ENC`, `EVENT_BUTTON`, `EVENT_AINSER`, NoteOn pour `EVENT_BUTTON`, les commandes Meta sélectionnées, `ENC`, `EVENT_RGBLED`, les champs LED observés, les labels NGL et les sections NGR générées `set_hsv` / `set ^bank` / `exit`. D'autres types et familles d'événements documentés restent avancés ou non structurés : consulter la [matrice d'audit technique](./docs/TECHNICAL_AUDIT.md). Les tests ne certifient pas l'acceptation par le firmware. Les scripts NGR LCD/Meta complets et les connexions dont le brochage reste inconnu demeurent manuels. Aucune validation ne certifie le câblage électrique.

Un contrôle affiché comme cohérent ne garantit donc pas que le montage matériel fonctionne. Consultez [l'audit du dépôt](./docs/REPOSITORY_AUDIT.md), [l'analyse NGC/NGR/NGL](./docs/NGC_FORMAT_ANALYSIS.md) et les README de chaque carte avant toute fabrication ou mise sous tension.

Le dépôt matériel précise des conditions de licence DIY/personnelles/non commerciales pour les cartes et visuels ; vérifiez ces conditions avant toute redistribution ou utilisation commerciale.

## Documentation

- [Audit du dépôt matériel](./docs/REPOSITORY_AUDIT.md)
- [Audit comparatif MIDIbox NG / MIOS32](./docs/TECHNICAL_AUDIT.md)
- [Analyse du format MIDIbox NG](./docs/NGC_FORMAT_ANALYSIS.md)
- [Modèle de données](./docs/DATA_MODEL.md)
- [Format de projet JSON](./docs/PROJECT_FORMAT.md)
- [Règles de génération](./docs/GENERATION_RULES.md)
- [Exemple de projet](./examples/KSBOX-inspired.project.json)
- [Fichiers générés de l'exemple](./examples/generated/)
