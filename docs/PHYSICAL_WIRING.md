# Inventaire et règles de câblage physique

## Portée et niveau de preuve

Les données machine de connecteurs sont dans [`data/physical-connectors.json`](../data/physical-connectors.json). Les noms viennent de la sérigraphie ou des tableaux des README matériels. La vue de câblage reprend les images disponibles; elle n'est ni à l'échelle, ni cotée. Les hotspots « approximatifs » sont placés d'après les rendus de dessus et ne fournissent pas une coordonnée de fabrication. Un connecteur à position inconnue apparaît dans un bandeau de ports schématiques sous sa carte; les fils s'y attachent afin de montrer les extrémités logiques, sans prétendre représenter l'emplacement physique réel. Une liaison n'est possible que si une règle sourcée établit le raccordement.

Les README matériels signalent eux-mêmes que des erreurs sont possibles et qu'il faut contrôler schémas, brochages et alimentation avant fabrication ou mise sous tension. Le configurateur ne certifie donc pas la sécurité électrique.

## Inventaire utilisable dans la vue

| Carte | Connecteurs répertoriés | Caractéristiques établies | Position affichée |
|---|---|---|---|
| Core32F4 | `J8J9`, `J19`, `J4A/B`, `J5A/B`, `J10A/B`, `J15A/B`, `J16`, `J11E`, `J18`, `J17`, `J2`, `J1`, `J15S` | Le README du Core fournit le rôle de chaque interface; notamment `J8J9` IDC 2x05 (DIN/DOUT partagé), `J19` IDC 2x05 (SPI/AIN 5 V), `J4A/B` (WS2812) et `J10A/B` (GPIO/SCS). | `J8J9` et `J19` approximés d'après le rendu. Les autres restent sans position fiable dans cette version. |
| DIN4_R5_KS | `J1` à `J6` | Six IDC 2x05; `J1` entrée de chaîne, `J2` sortie, `J3`–`J6` huit entrées chacun. | Hotspots indicatifs d'après l'image de dessus. |
| DOUT | `J1` à `J6` | Six IDC 2x05; `J1` entrée de chaîne, `J2` sortie, `J3`–`J6` huit sorties chacun. | Hotspots indicatifs d'après l'image de dessus. |
| 8x-buttons | `J1`, `J2` | IDC 2x05; `J1` huit contacts vers DIN, `J2` huit anodes LED vers DOUT. | Hotspots indicatifs d'après l'image de dessus. |
| keysw-4x2 | `J1`–`J4` | `J1` IDC 2x05 pour huit touches DIN, `J2`/`J3` IDC pour la cascade SK6812, `J4` masse. | Positions non déterminées; sélection par inventaire, aucun hotspot de connecteur inventé. |
| pad-rgb | `J1`–`J3` | `J1` IDC 2x05 pour huit contacts de pads DIN, `J2`/`J3` pour la cascade WS2812. | Positions non déterminées; sélection par inventaire. |
| encoders-led-rgb | `J11`–`J13`, `J4`/`J5`, `J44`/`J45` et connecteurs de report listés | `J11` poussoirs, `J12` phases 5–8, `J13` phases 1–4; IDC 2x05 pour les trois entrées DIN. Les positions exactes ne sont pas résolues dans le rendu combiné disponible. | Positions inconnues; sélection par inventaire. |
| AINSER64 | `J1`–`J13` | Les fonctions et certains formats sont listés dans le README. Le format/nombre de broches de `J6`–`J13` et les positions n'y sont pas établis de façon exploitable par l'application. | Toutes inconnues; connexion bloquée. |

Les autres cartes du catalogue sont visibles avec l'inventaire disponible dans leurs README (notamment potentiomètres, faders, OLED, interface MIDI, alimentation et SCS). Leurs connecteurs ne sont pas encore définis avec une géométrie et une règle de compatibilité complètes dans le modèle exécutable; ils sont affichés comme inventaire non raccordable. Les variantes `Fad_1` et `Fad_2` ne sont pas fusionnées en une topologie de connecteurs certifiée.

À l'import d'un NGC, les `hw_id` des boutons permettent de créer les cartes DIN nécessaires et de leur associer des blocs de huit entrées; `ENC sr` peut établir les liaisons DIN des phases d'encodeur. Les événements encodeur sans déclaration `ENC` créent l'instance de carte encodeur mais ne déterminent pas sa liaison DIN. Les cartes keyswitch sont inférées quand un groupe d'événements boutons contient `Meta RunSection`; l'identification de `J11` encodeur repose sur la convention de SR suivante observée dans KSBOX. Ces deux classifications sont des inférences, signalées à l'import, et non des informations explicites du format NGC. Le texte original reste conservé dans les directives avancées et n'est pas remplacé par la reconstruction.

Les dimensions de cartes, leur orientation mécanique de montage, l'emplacement coté des connecteurs et les empreintes exactes ne sont pas exposés par les rendus de référence. La vue de chaque carte reste schématique. Les fils sont colorés selon l'interface (DIN, DIN-control, DOUT, DOUT-control, LED-data et SPI/AIN). Le déplacement libre et la rotation d'une représentation déplacent les extrémités des fils sans modifier les connecteurs référencés dans le projet.

## Règles de connexion actuellement autorisées

Les règles exécutables sont centralisées dans [`src/physical-connectors.js`](../src/physical-connectors.js). Toute liaison conserve `fromModuleId`, `fromConnectorId`, `toModuleId`, `toConnectorId` et `interface`. La règle fixe le sens de données; l'ordre de clic sur le plan ne change pas ce sens.

| Liaison admise | Sens stocké | Source documentaire | Limite |
|---|---|---|---|
| Core32F4 `J8J9` / fonction DIN (`J9`) → DIN4 `J1` | Sortie de chaîne → entrée | [`Core/README.md`](../reference/MB_ModulBox_NG/standard-modules/Core/README.md), [`DIN/README.md`](../reference/MB_ModulBox_NG/standard-modules/DIN/README.md) | Le câble et le brochage réel doivent être vérifiés sur les cartes installées. |
| DIN4 `J2` → DIN4 suivante `J1` | Sortie de chaîne → entrée | [`DIN/README.md`](../reference/MB_ModulBox_NG/standard-modules/DIN/README.md) | Une chaîne linéaire; maximum documenté huit cartes de quatre registres. |
| Core32F4 `J8J9` / fonction DOUT (`J8`) → DOUT `J1` | Sortie de chaîne → entrée | [`Core/README.md`](../reference/MB_ModulBox_NG/standard-modules/Core/README.md), [`DOUT/README.md`](../reference/MB_ModulBox_NG/standard-modules/DOUT/README.md) | Une chaîne linéaire; maximum documenté huit cartes de quatre registres. |
| DOUT `J2` → DOUT suivante `J1` | Sortie de chaîne → entrée | [`DOUT/README.md`](../reference/MB_ModulBox_NG/standard-modules/DOUT/README.md) | Même limite de chaîne. |
| 8x-buttons `J1` → DIN4 `J3`–`J6` | Contacts du front-end → entrées DIN | [`8x-buttons/README.md`](../reference/MB_ModulBox_NG/custom-frontends/8x-buttons/README.md), [`DIN/README.md`](../reference/MB_ModulBox_NG/standard-modules/DIN/README.md) | Le numéro J3–J6 choisi est explicite; le configurateur ne déduit pas les `hw_id`. |
| keysw-4x2 `J1` → DIN4 `J3`–`J6` | Huit touches → huit entrées DIN | [`keysw-4x2/README.md`](../reference/MB_ModulBox_NG/custom-frontends/keysw-4x2/README.md), [`DIN/README.md`](../reference/MB_ModulBox_NG/standard-modules/DIN/README.md) | Compatibilité documentée; la position physique de `J1` n'est pas connue et la liaison n'est pas tracée sur le plan. |
| pad-rgb `J1` → DIN4 `J3`–`J6` | Huit contacts → huit entrées DIN | [`pad-rgb/README.md`](../reference/MB_ModulBox_NG/custom-frontends/pad-rgb/README.md), [`DIN/README.md`](../reference/MB_ModulBox_NG/standard-modules/DIN/README.md) | Compatibilité documentée; la position physique de `J1` n'est pas connue et la liaison n'est pas tracée sur le plan. |
| encoders-led-rgb `J11`, `J12` ou `J13` → DIN4 `J3`–`J6` | Groupe de huit signaux → port huit entrées DIN | [`encoders-led-rgb/README.md`](../reference/MB_ModulBox_NG/custom-frontends/encoders-led-rgb/README.md), [`DIN/README.md`](../reference/MB_ModulBox_NG/standard-modules/DIN/README.md) | Un port DIN ne peut être utilisé qu'une fois; les trois connecteurs front-end doivent donc utiliser trois ports DIN distincts. Le brochage de chaque groupe reste à confirmer sur le matériel réel et le plan n'affiche pas leurs positions. |
| DOUT `J3`–`J6` → 8x-buttons `J2` | Sorties DOUT → LED du front-end | [`8x-buttons/README.md`](../reference/MB_ModulBox_NG/custom-frontends/8x-buttons/README.md), [`DOUT/README.md`](../reference/MB_ModulBox_NG/standard-modules/DOUT/README.md) | Pas de routage individuel LED→ressource DOUT dans ce modèle. |

Chaque connecteur ne porte qu'une liaison enregistrée; aucun répartiteur n'est documenté dans ces règles. En particulier, le connecteur combiné Core `J8J9` ne peut pas recevoir simultanément deux liaisons DIN et DOUT distinctes dans l'application. C'est une restriction conservatrice du configurateur, pas une affirmation que toutes les architectures MIDIbox doivent être câblées ainsi.

Les interfaces SPI/AIN, GPIO/SCS, alimentation, MIDI, matrices, contrôles analogiques et connecteurs de puissance restent sans règle de liaison graphique, même lorsque les README décrivent une relation générale. Le configurateur n'infère pas un câblage depuis le seul nom du bus. En particulier, le raccordement Core `J19` ↔ AINSER64 `J2` est décrit, mais la position du connecteur AINSER et l'affectation explicite des chip-selects ne sont pas encore représentées; l'interface le bloque. La chaîne WS2812/SK6812 documentée est sélectionnable comme `LED-data`; l'import ne certifie pas l'alimentation des LED.

## Incompatibilités et imports

- Les couples qui violent une règle documentée, réutilisent un connecteur ou dépassent la limite de chaîne sont refusés avant mutation du projet.
- Une compatibilité inconnue (connecteur absent du registre ou absence de règle) ne vaut jamais autorisation. Une position inconnue n'autorise pas une liaison à elle seule: il faut une règle de compatibilité explicitement documentée.
- Les connecteurs sans position déterminée (notamment keyswitch `J1` et encodeurs `J11`–`J13`) s'affichent comme ports schématiques en bas de la carte. Les câbles peuvent s'y attacher visuellement, mais leur emplacement exact sur le circuit imprimé reste inconnu.
- L'import NGC reconstruit les cartes et liaisons déductibles des adresses matérielles. Il ne convertit pas les directives en contrôles graphiques et n'infère pas les éléments non explicités; notamment AINSER/SPI reste signalé comme non reconstruit.
- L'import d'un projet JSON valide les nouvelles liaisons et rejette les erreurs physiques. Les anciennes liaisons v1 sont migrées seulement si les deux références et la règle correspondante sont reconnues; sinon elles sont conservées sans ligne de câble, marquées « à reconfigurer ».
- La rotation et le déplacement sur le plan sont des données graphiques distinctes des extrémités de connexion. Les liaisons gardent leur référence après déplacement/rotation et sont incluses dans la sauvegarde JSON.

## Tests

`tests/physical-connectors.test.js` vérifie les noms et données connus, les chemins autorisés, les mauvais sens, les incompatibilités et informations inconnues, le refus sans mutation, les limites et collisions, le maintien des extrémités après mouvement/rotation, l'import invalide et la migration v1. Ces tests valident le modèle du configurateur; ils ne remplacent pas un test de continuité ou une vérification électrique des cartes réelles.
