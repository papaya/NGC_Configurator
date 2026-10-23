# Règles de génération actuelles

1. Vérifier les valeurs et références du projet.
2. En cas d'erreur bloquante, ne produire aucun fichier.
3. Émettre `RESET_HW`, les déclarations `EVENT_RGBLED` et les déclarations `ENC` structurées, puis recopier les directives NGC avancées.
4. Produire les événements structurés déclarés avec un `hw_id` manuel : `EVENT_ENC`, `EVENT_BUTTON` ou `EVENT_AINSER` en CC; `EVENT_BUTTON` peut également générer le type NoteOn documenté avec `key`. Les événements CC bankés vont sous `#BANK n`, les événements explicitement globaux restent hors des blocs.
5. Générer aussi les champs Meta `RunSection:n`, `SetBank:n`, `IncBank`, `DecBank`, `CycleBank`; émettre `button_mode` uniquement sur les événements bouton; générer les paramètres LED observés (`fwd_id`, `rgbled_pattern`, `hsv`) et des IDs d'événements sans collision numérique connue.
6. Les contrôles sans `hw_id` ne génèrent pas d'événement. Le mapping `ENC` est toujours explicite et doit être cohérent avec le `hw_id`.
7. Générer un NGL avec un label stable pour chaque affectation générée; recopier et vérifier les labels avancés.
8. Générer un NGR si un script avancé existe ou si une couleur HSV de script est déclarée; la forme structurée ne génère que les sections `set_hsv` / `set ^bank` / `exit`.

Les syntaxes listées ci-dessus ont des tests automatisés contre les formes observées dans KSBOX et le manuel NGC; elles ne sont pas certifiées par le firmware installé. Les blocs avancés sont conservés et l'import les ajoute sans remplacement. Une prévisualisation diff est disponible entre générations avant téléchargement. La détection de conflits reste partielle; les types MIDI hors CC, NoteOn bouton et Meta, `SetBankOfHwId`, les conditions, maps, ports, commandes LCD et scripts NGR complets restent manuels et ne sont pas validés sémantiquement.
