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
- Vue de câblage avec cartes illustrées, ports identifiés, fils colorés par interface, rotation et déplacement libre des cartes avec câbles attachés; les ports sans position documentée sont explicitement schématiques.
- Liaisons physiques persistantes référencées par instance et connecteur; les chaînes DIN/DOUT ainsi que les ports DIN documentés des front-ends 8x-buttons, keyswitch et encodeurs sont raccordables. Les connecteurs sans position établie se sélectionnent dans l’inventaire et leur extrémité n’est pas dessinée arbitrairement.
- Édition manuelle des `hw_id`, des configurations `ENC`, des événements CC, NoteOn bouton et Meta; les commandes Meta de sélection de banque documentées sont contrôlées séparément de `RunSection`.
- Déclarations `EVENT_RGBLED`, paramètres LED vérifiés et génération de sections NGR `set_hsv`.
- Banques indépendantes et vue matricielle.
- Validation des champs, des IDs de ressource manuels, des ports/connexions documentés et des collisions NGC/NGR/NGL modélisées.
- Génération cohérente NGC/NGL et génération NGR lorsqu'un script avancé ou des paramètres `set_hsv` structurés sont présents; aperçu, sauvegarde JSON, chargement et annulation/rétablissement.
- Import append-only et conservation de blocs NGC/NGR/NGL avancés, sans réécrire les fichiers sources; les fichiers multiples de même type sont tous conservés. Pour le NGC, l’import reconstruit aussi les cartes Core/DIN/front-end et les liaisons dont l’adresse est établie par les `hw_id` ou les déclarations `ENC`; les directives inconnues restent conservées comme texte avancé et les inférences sont signalées. Diff entre générations avant téléchargement.

## Limites connues

Cette version reste un configurateur local et n'est pas un validateur officiel MIDIbox NG. Les sorties structurées testées couvrent les CC de `EVENT_ENC`, `EVENT_BUTTON`, `EVENT_AINSER`, NoteOn pour `EVENT_BUTTON`, les commandes Meta sélectionnées, `ENC`, `EVENT_RGBLED`, les champs LED observés, les labels NGL et les sections NGR générées `set_hsv` / `set ^bank` / `exit`. D'autres types et familles d'événements documentés restent avancés ou non structurés : consulter la [matrice d'audit technique](./docs/TECHNICAL_AUDIT.md). Les tests ne certifient pas l'acceptation par le firmware. Les scripts NGR LCD/Meta complets et les connexions dont le brochage reste inconnu demeurent manuels. Aucune validation ne certifie le câblage électrique.

La reconstruction matérielle NGC est partielle : les événements bouton et les `ENC sr` fournissent des adresses DIN; `EVENT_ENC` sans `ENC` crée la carte encodeur mais ne prétend pas connaître son registre DIN. L'association des boutons d'encodeur à `J11` suit la convention KSBOX observée et est signalée comme une inférence. Les `EVENT_AINSER` sont préservés et signalés, mais ne reconstruisent pas encore l'architecture SPI/chip-select AINSER.

Un contrôle affiché comme cohérent ne garantit donc pas que le montage matériel fonctionne. Les images de câblage sont schématiques et les emplacements signalés approximatifs ne sont pas cotés. Consultez [l'inventaire de câblage physique](./docs/PHYSICAL_WIRING.md), [l'audit du dépôt](./docs/REPOSITORY_AUDIT.md), [l'analyse NGC/NGR/NGL](./docs/NGC_FORMAT_ANALYSIS.md) et les README de chaque carte avant toute fabrication ou mise sous tension.

Le dépôt matériel précise des conditions de licence DIY/personnelles/non commerciales pour les cartes et visuels ; vérifiez ces conditions avant toute redistribution ou utilisation commerciale.

## Documentation

- [Audit du dépôt matériel](./docs/REPOSITORY_AUDIT.md)
- [Audit comparatif MIDIbox NG / MIOS32](./docs/TECHNICAL_AUDIT.md)
- [Inventaire et règles de câblage physique](./docs/PHYSICAL_WIRING.md)
- [Analyse du format MIDIbox NG](./docs/NGC_FORMAT_ANALYSIS.md)
- [Modèle de données](./docs/DATA_MODEL.md)
- [Format de projet JSON](./docs/PROJECT_FORMAT.md)
- [Règles de génération](./docs/GENERATION_RULES.md)
- [Exemple de projet](./examples/KSBOX-inspired.project.json)
- [Fichiers générés de l'exemple](./examples/generated/)
