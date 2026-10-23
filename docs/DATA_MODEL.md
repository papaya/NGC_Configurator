# Modèle de données

Le domaine applicatif est distinct de l'interface et du texte généré. Les définitions communes des cartes sont chargées depuis `data/modules.json`.

- **ModuleDefinition** : type matériel, catégorie, bus, connecteurs, contrôles générables, statut, source documentaire et image.
- **ModuleInstance** : instance du module, nom, position ergonomique et ordre de chaîne lorsqu'il est pertinent.
- **PhysicalConnection** : instance source/destination, bus, rôle (`chain` ou `peripheral`) et ports déclarés. Les ports existants sont vérifiés contre les capacités des connecteurs; une liaison n'est pas créée par le seul déplacement graphique.
- **ControlInstance** : identité stable, type de contrôle, module parent, `hwId` manuel, ressources/connecteurs physiques documentés et, si nécessaire, configuration explicite `encoderConfig` (`n`, `sr`, `pins`, `type`).
- **Bank** : identifiant stable, nom et ordre.
- **ControlAssignment** : événement CC ou Meta pris en charge, paramètres MIDI, portée de banque, label, champs LED d'événement (`forwardId`, `pattern`, `eventHsv`) et couleur de script (`scriptTargetId`, `hsv`), indépendants par banque.
- **LedEvent** : déclaration explicite `EVENT_RGBLED` (`id`, `dimmed`, `rangeMin`, `rangeMax`); son ID est distinct de `forwardId`.
- **Project** : version du format, métadonnées, instances, connexions, contrôles, banques, affectations, déclarations LED et blocs avancés bruts.

Les `hw_id` restent vides à l'ajout et ne sont jamais calculés depuis l'ordre graphique. Les contrôles de front-end n'ont de ressource physique structurée que si le brochage précis est documenté; la validation signale les inconnues au lieu d'inventer un mapping firmware.
