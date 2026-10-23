# Analyse du format NGC / NGR / NGL

## Sources observées

L'analyse porte principalement sur `NGC_NGR/All_in_V2/KSBOX.NGC` (839 lignes), `KSBOX.NGR` (281 lignes) et `KSBOX.NGL` (23 lignes). Les fichiers sont conservés tels quels. Les autres copies sous `AllIn/` n'ont pas été utilisées comme base de génération.

## KSBOX.NGC

- Début de fichier : commentaire d'exemple `EVENT`, `RESET_HW`, directive `LCD`, puis boutons `EVENT_BUTTON` de type `Meta` appelant `RunSection:1` à `RunSection:8`.
- La configuration encodeur comprend des lignes `ENC n=... sr=... pins=... type=...`; elles doivent être saisies explicitement et ne sont jamais inférées de l'ordre des modules.
- Types observés : `EVENT_ENC`, `EVENT_BUTTON`, `EVENT_AINSER` et `EVENT_RGBLED`.
- La référence contient 144 déclarations `EVENT_BUTTON`, 128 `EVENT_ENC`, 24 `EVENT_AINSER` et 8 `EVENT_RGBLED`. Les événements AINSER/RGBLED apparaissent hors des blocs de banques.
- Huit blocs `#BANK 1` à `#BANK 8` contiennent chacun des événements bankés avec une valeur `bank=...`. Les IDs d'exemple suivent notamment des plages 101–132, 201–232, etc. ; cela décrit une convention KSBOX, pas une règle universelle du firmware.
- Les événements comportent entre autres `id`, `hw_id`, `type=CC`, `chn`, `cc`, `range`, `fwd_id`, `button_mode`, `rgbled_pattern`, `hsv`, `label` et `meta`.
- Les commentaires, espaces et tabulations sont significatifs pour la lisibilité, mais les exemples n'établissent pas un formatage obligatoire.

Le générateur testé émet les directives suivantes : `EVENT_ENC`, `EVENT_BUTTON` et `EVENT_AINSER` de type CC avec `id`, `hw_id`, `chn`, `cc`, `range`, `bank` (pour les événements bankés), `button_mode` (`OnOff`, `OnOnly`, `Toggle`) et `label`; `EVENT_BUTTON type=NoteOn` utilise `chn`, `key`, `range`, `bank` et un mode de bouton; événements globaux `type=Meta` avec commandes de banque documentées, et boutons `button_mode=OnOnly`; déclarations `ENC n/sr/pins/type`; déclarations `EVENT_RGBLED id/dimmed/range`; et, si configurés, `fwd_id=RGBLED:n`, `rgbled_pattern` et `hsv` dans les événements CC.

Les événements auto-numérotés évitent les IDs numériques présents dans les événements NGC avancés. Les IDs doivent respecter la plage manuelle `1..4095`; les `hw_id` sont validés par famille selon le manuel (`BUTTON` 1..256, `ENC` 1..128, `AINSER` 1..128). Les déclarations `ENC` structurées et importées sont contrôlées pour les champs requis, l'unicité de `n`, `sr=1..16`, les paires de pins adjacentes, les types documentés et la correspondance avec `hw_id`. Les événements Meta structurés comprennent `RunSection:n` et les commandes de sélection de banque `SetBank:n`, `IncBank`, `DecBank`, `CycleBank`; `RunSection` ne désigne pas une banque applicative.

Les tests automatisés vérifient la génération de ces formes observées et les conflits structurés/avancés. Ils ne certifient pas l'acceptation par la version de firmware cible.

## KSBOX.NGR

Le script comporte neuf sections de conditions observées autour de `if ^section == n` / `endif`, des commandes `set_hsv`, des textes `LCD`, des logs/commentaires, des sorties de section et des opérations sur la banque telles que `set ^bank n`. La section 0 contient notamment un `exec_meta RunSection:8`.

Le générateur peut produire un NGR lorsqu'une affectation contient une cible `RGBLED` déclarée et une couleur HSV de script : une condition `if ^section == n`, `set_hsv`, `set ^bank n`, `exit`, `endif` est émise pour cette section. Les sections NGR avancées sont préservées; un conflit avec une section générée correspondante bloque la génération. LCD, logs, `exec_meta` et transitions de banque complètes restent à fournir dans le bloc avancé.

## KSBOX.NGL

Le fichier contient des macros `LABEL` pour boutons (`std_btn`), LED (`std_led`), encodeurs (`std_enc`), entrées AIN (`std_ain`, `std_aser`), motorfaders (`std_mf`) et banques (`std_Bk`, `std_NmBk`). Les libellés utilisent notamment des paramètres de formatage tels que `%3i`, `%3d`, `%b`, `%B`, `%q` et des positions LCD.

Un NGL est généré avec un label minimal stable par affectation, auquel les événements structurés font référence avec `label="^..."`. Le texte avancé est préservé et les doublons de labels détectables entre blocs avancés et modèle bloquent la génération.

## Préservation et limites

- L'import NGC/NGR/NGL met les contenus dans des blocs avancés et ne réécrit jamais le fichier d'origine.
- Les blocs avancés sont recopiés sans modification, pas fusionnés sémantiquement. Les collisions d'IDs d'événements, d'encodeurs et de labels, ainsi que les sections NGR générées en double, sont détectées. Les autres interactions/directives avancées restent à contrôler.
- La validation est bornée aux champs structurés pris en charge et à ces détections de conflits; ce n'est pas un parseur complet des formats NGC/NGR/NGL.
- L'import de blocs avancés les ajoute au texte déjà conservé au lieu de l'écraser. Les prévisualisations incluent un diff entre générations successives avant téléchargement.
- Le validateur actuel contrôle le modèle structuré, pas la grammaire complète MIOS Studio/MIDIbox NG. Les commandes avancées `SetBankOfHwId`, plusieurs champs Meta, les conditions `if_*`, les maps, les ports MIDI et les événements non CC/Meta sont conservés, mais ne sont pas structurés.
- Vérifier les sorties avec l'outil officiel/firmware ciblé avant usage. Les tests unitaires de cette application ne prouvent pas la compatibilité firmware.
