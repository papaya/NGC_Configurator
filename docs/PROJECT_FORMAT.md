# Format de projet JSON

La version actuelle du projet est `schemaVersion: 1`. Le JSON est lisible, transportable et indépendant du stockage local du navigateur.

Champs principaux :

- `metadata`: nom et date de création.
- `modules`: instances matérielles ; `definitionId` référence `data/modules.json`. `layout` reste la disposition ergonomique; `wiringLayout` et `rotation` stockent séparément la disposition du plan de câblage.
- `connections`: nouvelles liaisons physiques avec `fromModuleId`, `fromConnectorId`, `toModuleId`, `toConnectorId`, `interface`, `role` et `compatibility`. Les références concernent des connecteurs sérigraphiés, pas seulement un type de bus.
- `controls`: contrôles logiques, module parent, type, `hwId` explicite, ressources physiques et configuration `encoderConfig` facultative.
- `banks`: nom et ordre des banques.
- `assignments`: objet indexé par identifiant de banque, puis identifiant de contrôle; inclut CC/Meta pris en charge, portée de banque, labels et paramètres LED structurés.
- `ledEvents`: déclarations `EVENT_RGBLED` indépendantes des identifiants de routage `fwd_id`.
- `advanced`: contenus bruts `ngc`, `ngr`, `ngl` recopiés à la génération; l'import dans un bloc déjà renseigné ajoute le texte au lieu de le remplacer.

Les données inconnues non représentées par le modèle ne sont pas migrées automatiquement. Avant d'ouvrir une version future ou différente, conservez une copie du JSON. Cette version refuse les versions de schéma qu'elle ne reconnaît pas.

La version de schéma reste `1` pour préserver les projets actuels. Les anciennes connexions `{from,to,bus,fromPort,toPort}` sont migrées si les connecteurs peuvent être résolus exactement et qu'une règle documentée existe. Sinon, elles sont conservées avec `needsReconfiguration: true` et exclues du plan comme câbles validés. L'import d'une nouvelle liaison physique interdite ou de compatibilité inconnue est refusé; les erreurs sont présentées à l'utilisateur.
