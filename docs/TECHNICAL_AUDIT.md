# Audit technique MIDIbox NG et ModulBox

Audit comparatif du configurateur, du manuel NGC, des sources publiques MIOS32/MIDIbox NG et de la documentation locale des cartes. Références consultées le 23 octobre 2026. Les liens firmware pointent sur `master` : ils sont mobiles et ne remplacent pas l'identification d'une version de firmware installée.

## Sources et niveaux de preuve

- [Manuel NGC MIDIbox NG](https://www.ucapps.de/midibox_ng_manual_ngc.html) : syntaxe publiée, paramètres et limites annoncées par le manuel.
- [Manuel général MIDIbox NG](https://www.ucapps.de/midibox_ng_manual.html) : documentation utilisateur générale. Cette page d'index seule ne spécifie pas davantage les directives NGC.
- [Dépôt MIOS32](https://github.com/midibox/mios32) :
  - [`mbng_event.h`](https://github.com/midibox/mios32/blob/master/apps/controllers/midibox_ng_v1/src/mbng_event.h) énumère les familles de contrôleurs MIDIbox NG, types d'événements et conditions compilés.
  - [`mbng_event.c`](https://github.com/midibox/mios32/blob/master/apps/controllers/midibox_ng_v1/src/mbng_event.c) contient la logique d'événements et les intégrations des pilotes (DIN/DOUT, encodeur, AIN/AINSER, matrice, RGBLED, CV, MF).
  - [`mios32_srio.c`](https://github.com/midibox/mios32/blob/master/mios32/common/mios32_srio.c) montre un pilote SRIO paramétré à la compilation; le nombre de registres est modifiable à l'exécution mais plafonné par `MIOS32_SRIO_NUM_SR`.
  - [`mios32_enc.c`](https://github.com/midibox/mios32/blob/master/mios32/common/mios32_enc.c) montre la configuration et le décodage des encodeurs MIOS32.
- Documentation ModulBox locale : [`Core/README.md`](../reference/MB_ModulBox_NG/standard-modules/Core/README.md), [`DIN/README.md`](../reference/MB_ModulBox_NG/standard-modules/DIN/README.md), [`DOUT/README.md`](../reference/MB_ModulBox_NG/standard-modules/DOUT/README.md), et [`data/modules.json`](../data/modules.json). Ces documents décrivent les cartes de ce projet, pas nécessairement chaque installation MIDIbox NG.
- Les trois fichiers originaux KSBOX sont lus par les tests de caractérisation et ne sont pas modifiés. Ils prouvent une syntaxe d'exemple, pas une compatibilité avec toute version de firmware.

**Interprétation :** le manuel est la référence de syntaxe; le code MIOS32 est une preuve d'implémentation sur la révision consultée; les fichiers ModulBox sont la source du brochage local. Un paramètre documenté mais non vérifié dans la version firmware effectivement déployée n'est pas qualifié ici de certifié.

## Matrice des capacités NGC

| Fonctionnalité documentée | Configurateur actuel | Générateur actuel | Validation disponible | Travail nécessaire / test de confirmation |
|---|---|---|---|---|
| `EVENT_BUTTON` / `EVENT_ENC` / `EVENT_AINSER` en CC; `EVENT_BUTTON` NoteOn | Éditeur CC; NoteOn et `key` sur bouton; `OnOff`, `OnOnly`, `Toggle`; `hw_id` manuel; ENC explicite | Génère les champs CC et la forme NoteOn documentée `chn`, `key`, `range`, `bank` | Plages MIDI, modes bouton, `key=0..127`, NoteOn limité aux boutons, limites `hw_id`, IDs et ENC | Types additionnels (NoteOff, PC, PitchBend, etc.) nécessitent leur propre modèle/test et validation par le chargeur firmware |
| `EVENT_AIN` | Aucun mapping structuré du Core vers AIN direct | Non généré | Non applicable au modèle actuel | Définir le câblage Core AIN documenté avant d'ajouter cette famille; test matériel et sortie NGC |
| `EVENT_LED` standard DOUT | Aucun contrôle LED standard/ressource LED dans le modèle | Non généré | Pas de validation d'affectation DOUT par LED | Relier LED de front-end, carte DOUT et registre/broche explicitement; test de collisions et générateur |
| `EVENT_RGBLED` et champs RGB observés | Déclarations LED explicites, paramètres LED par affectation | Génère déclaration, `fwd_id`, `rgbled_pattern`, `hsv` selon les cas | IDs NGC, plages observées et conflits de cibles; limites électriques non certifiées | Validation firmware et topologie WS2812 physique par ligne toujours requises |
| `EVENT_RECEIVER` / `EVENT_SENDER` | Non modélisés | Non générés | Aucun parseur sémantique | Un modèle de routage/ports MIDI serait nécessaire; tests de conversions et forwarding avant annonce |
| `EVENT_BUTTON_MATRIX` / `EVENT_LED_MATRIX` | Matrices matérielles non modélisées | Non générés | Aucun | Modéliser ressources SR exclusives, offsets d'émulation et topologie réelle; ne pas les déduire des cartes ordinaires |
| `EVENT_MF`, `EVENT_CV`, `EVENT_KB` | Hors périmètre matériel connu du projet | Non générés | Aucun | N'ajouter que si un module concret et son câblage deviennent pris en charge |
| Types MIDI (`Note`, CC, Aftertouch, PitchBend, NRPN, SysEx, etc.) | L'éditeur structuré propose CC, NoteOn pour boutons et Meta | CC/Meta et `EVENT_BUTTON type=NoteOn key=...` seulement | CC et clé NoteOn contrôlés; autres types rejetés/non modélisés | Paramètres spécifiques par type à confirmer dans le manuel/parser avant chaque implémentation |
| Meta : banques et `RunSection` | Champ Meta; commandes `RunSection:n`, `SetBank:n`, `IncBank`, `DecBank`, `CycleBank` validées | Génère l'événement Meta global; le mode bouton n'est émis que pour un bouton | `SetBank:n` doit viser un ordre de banque existant; les banques ciblées ne peuvent pas être supprimées | `SetBankOfHwId` et métas multiples demeurent avancés; test firmware de sélection de banque à effectuer |
| Banques `#BANK`, `bank`, `hw_id` multiples | Banques applicatives séparées, affectations indépendantes; `hw_id` explicite | Génère un bloc par banque configurée | IDs et conflits avancés limités détectés | Les numéros d'ordre et l'état de banque firmware ne sont pas équivalents à l'onglet UI; tester les changements réels sur contrôleurs |
| Conditions `if_*` | Non modélisées | Avancées recopiées sans analyse complète | Seulement collisions simples d'IDs/hw_id/blocs | Parser la grammaire et les sources de valeur avant validation sémantique; conserver le brut |
| Forwarding, `fwd_to_lcd`, ports MIDI | Une cible RGBLED structurée limitée | `fwd_id=RGBLED:n` seulement; pas de `ports` ni de forwarding générique | Cible RGBLED déclarée, conflits partiels | Modéliser la chaîne d'événements et les ports disponibles; tests de cycles et de ports |
| `MAP<n>` / interpolations | Non modélisées | Non générées | Aucun | Définir forme de map et référencements avant d'ajouter; tester nombre de valeurs, bornes et interpolation |
| `ENC` matériel | Formulaire `n`, `sr`, `pins`, `type` | Déclaration générée explicitement | `n=1..128`, `sr=1..16`, paire adjacente, types documentés, doublons et lien `hw_id` | L'ordre de pins inversé présent dans KSBOX est accepté; la correspondance au câblage reste manuelle |
| Commandes hardware (`DIN_MATRIX`, `DOUT_MATRIX`, `AINSER`, `SRIO`, LCD, etc.) | Connexions de modules déclarées; pas d'éditeur de ces commandes NGC | Seul `RESET_HW` et `ENC` structurés | Compatibilité de ports du modèle; directives avancées seulement partiellement examinées | Ajouter commande par commande après confrontation du schéma et du parseur du firmware |
| NGR / NGL | Blocs avancés et couleurs structurées; labels générés | NGR `set_hsv` structuré, NGL labels minimaux; autres contenus avancés recopiés | Collision de section NGR et de labels identifiables | Scripts NGR de banques/LCD restent édités en avancé et ne sont pas interprétés complètement |

Le firmware MIOS32 consulté déclare davantage de types/familles que ceux générés ici. Cela établit qu'ils existent dans cette révision du code, mais pas que toute syntaxe, tout périphérique ou toute version cible est compatible.

## NGC présent dans KSBOX

La référence `KSBOX.NGC` est caractérisée par les tests : 144 `EVENT_BUTTON`, 128 `EVENT_ENC`, 24 `EVENT_AINSER`, 8 `EVENT_RGBLED`, huit `#BANK`, huit blocs de sélection Meta `RunSection`, et des déclarations `ENC`. Les événements visibles utilisent principalement `type=CC` ou Meta; les champs observés incluent `id`, `hw_id`, `type`, `chn`, `cc`, `range`, `bank`, `button_mode`, `fwd_id=RGBLED:n`, `rgbled_pattern`, `hsv` et `label`.

L'import de directives avancées les conserve en texte brut. Il ne signifie pas que chaque champ de KSBOX est modélisé ni que toute interaction entre ces blocs et les événements structurés est détectée.

## Banques : sémantique distincte

- L'application possède des banques logiques et copie les valeurs d'affectation lorsqu'une nouvelle banque est créée; les objets d'affectation sont indépendants.
- Côté NGC, des événements sélectionnés par banque sont groupés sous `#BANK n` et portent `bank=n`.
- Côté firmware, `SetBank`, `IncBank`, `DecBank` et `CycleBank` sélectionnent l'état de banque. `RunSection:n` appelle une section NGR : ce n'est pas une commande de sélection de banque.
- Les commandes `*BankOfHwId` permettent de sélectionner seulement certains contrôleurs d'après le manuel. Elles restent manuelles, car le configurateur ne possède pas encore de modèle de ciblage physique adéquat.
- Supprimer une banque référencée par `SetBank:n` est bloqué. Les sections `RunSection:n` ne sont pas assimilées aux ordres de banque.

## Matériel : confirmé et inconnu

- Les README locaux documentent le bus partagé `J8J9` du Core, avec fonction DIN via J9 et DOUT via J8; DIN4 J1/J2 et DOUT J1/J2 sont présentés comme entrée/sortie de chaîne. Le nouveau modèle enregistre les deux références de connecteurs et autorise seulement les couples sourcés indiqués dans [PHYSICAL_WIRING.md](./PHYSICAL_WIRING.md). Les modules non positionnés ou sans règle restent non raccordables.
- Le manuel MIDIbox NG décrit les IDs de boutons jusqu'à 256, d'encodeurs jusqu'à 128, d'AIN jusqu'à 6 et d'AINSER jusqu'à 128. Les plages d'`hw_id` du modèle sont resserrées par famille; les `hw_id` restent saisis manuellement.
- Les README locaux décrivent quatre registres par carte DIN4/DOUT; le DOUT README annonce jusqu'à huit cartes en chaîne pour 32 registres. Le test couvre la limite de huit cartes par chaîne, mais le configurateur ne certifie pas aujourd'hui le budget total de shift registers consommé par toutes les cartes/ressources simultanées.
- Les contrôles analogiques déclarés sont émis comme AINSER, mais le mapping concret du contrôle physique vers module, puce CS, voie, shift-register ou broche n'est pas résolu depuis les seules liaisons de modules.
- Les quatre lignes WS2812 du Core sont documentées matériellement, mais l'événement/ID RGBLED n'est pas un ID de chaîne ni une preuve du routage à la bonne ligne. SK6812 et alimentations restent à vérifier.
- Les contrôles physiques affichés, les connexions du plan et les IDs MIDI ne partagent pas encore une affectation registre complète. Aucun `hw_id` n'est calculé depuis l'ordre graphique. Les images de cartes ne fournissent pas de dimensions ni de coordonnées cotées : les hotspots de la vue sont schématiques.

## Préservation, aperçu et tests

- Importer un fichier dans un bloc avancé l'ajoute au texte existant au lieu de l'écraser. Les blocs identiques ne sont pas doublés.
- Avant téléchargement, la génération reste affichée; la génération suivante expose un diff ligne à ligne avec la précédente. Le premier résultat est prévisualisé intégralement avant tout téléchargement. Les directives avancées inconnues ne sont pas normalisées.
- La validation ne prétend pas comprendre les conditions, maps et paramètres manuels arbitraires. Les tests mesurent les sorties structurées prises en charge et caractérisent les originaux KSBOX sans les modifier.
- Le modèle physique bloque les interfaces sans règle explicite et conserve les connexions anciennes non résolues comme « à reconfigurer ». Voir l'inventaire documenté et les règles limitées dans [PHYSICAL_WIRING.md](./PHYSICAL_WIRING.md); cette mise à jour ne certifie pas les cartes ni l'installation.
- La compatibilité syntaxique testée reste un test du générateur local, pas l'exécution d'un chargement NGC sur firmware. Tester le fichier sur la version MIDIbox NG cible reste requis.
