# Modèle de données

Le domaine applicatif est distinct de l'interface et du texte généré. Les définitions communes des cartes sont chargées depuis `data/modules.json`.

- **ModuleDefinition** : type matériel, catégorie, bus, connecteurs, contrôles générables, statut, source documentaire et image.
- **ModuleInstance** : instance du module, nom, position ergonomique, position indépendante sur le plan de câblage (`wiringLayout`), orientation de représentation (`rotation`) et ordre de chaîne lorsqu'il est pertinent.
- **ConnectorDefinition** : connecteur sérigraphié exact, type/nombre de broches lorsque documentés, fonctions, interfaces, direction, source et coordonnées relatives optionnelles. Une position inconnue ne devient pas un emplacement deviné; les hotspots provenant d'un rendu sont marqués approximatifs.
- **PhysicalConnection** : références explicites `fromModuleId`/`fromConnectorId` et `toModuleId`/`toConnectorId`, interface, rôle, statut documenté. Les règles sourcées sont centralisées dans `src/physical-connectors.js`; une liaison non prouvée n'est pas ajoutée. Les anciennes liaisons v1 restent visibles « à reconfigurer » si les deux connecteurs ne peuvent pas être reconstruits.
- **ControlInstance** : identité stable, type de contrôle, module parent, `hwId` manuel, ressources/connecteurs physiques documentés et, si nécessaire, configuration explicite `encoderConfig` (`n`, `sr`, `pins`, `type`).
- **Bank** : identifiant stable, nom et ordre.
- **ControlAssignment** : événement CC ou Meta pris en charge, paramètres MIDI, portée de banque, label, champs LED d'événement (`forwardId`, `pattern`, `eventHsv`) et couleur de script (`scriptTargetId`, `hsv`), indépendants par banque.
- **LedEvent** : déclaration explicite `EVENT_RGBLED` (`id`, `dimmed`, `rangeMin`, `rangeMax`); son ID est distinct de `forwardId`.
- **Project** : version du format, métadonnées, instances, connexions, contrôles, banques, affectations, déclarations LED et blocs avancés bruts.

Les `hw_id` restent vides à l'ajout et ne sont jamais calculés depuis l'ordre graphique. Les contrôles de front-end n'ont de ressource physique structurée que si le brochage précis est documenté; la validation signale les inconnues au lieu d'inventer un mapping firmware.

Le déplacement ou la rotation d'une carte dans la vue de câblage ne change jamais les références d'extrémité d'une connexion. Les dimensions exactes des cartes et positions cotées des connecteurs ne sont pas présentes pour la plupart des modules; le rendu ne constitue pas un plan de fabrication.
