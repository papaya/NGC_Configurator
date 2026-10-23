# Audit du dépôt matériel

Audit effectué à partir des fichiers présents localement dans `NGC_NGR/` et du dépôt de référence cloné dans `reference/MB_ModulBox_NG/`. Les fichiers de configuration originaux n'ont pas été modifiés.

## Inventaire

### Workspace préexistant

- `NGC_NGR/All_in_V2/` contient les fichiers de référence `KSBOX.NGC`, `KSBOX.NGR`, `KSBOX.NGL`, ainsi que plusieurs autres configurations, exports BIN, tableurs et un lien vers le manuel MIDIbox NG.
- `NGC_NGR/AllIn/` contient une autre copie des trois fichiers KSBOX et plusieurs projets NGC/NGR.
- `NGC_NGR/Default/`, `NGC_NGR/krispi box 2/` et `NGC_NGR/molubox xxl fil /` contiennent des fichiers MIDIbox NG supplémentaires.
- La racine du workspace ne contenait pas d'application préexistante.

Les fichiers nommés `._*`, les fichiers Excel temporaires `~$*` et les exports binaires ne sont pas traités comme sources de vérité pour les définitions de modules.

### Dépôt matériel

Le dépôt `papaya/MB_ModulBox_NG` a été cloné dans `reference/MB_ModulBox_NG/` sans remplacer les contenus préexistants. Il comprend notamment :

- `standard-modules/` : Core, DIN, DOUT, AIN et IO.
- `custom-frontends/` : faders, boutons, potentiomètres, encodeurs RGB, clavier, pads, OLED, alimentation et surface-control.
- `Mes_Librairies_KiCad/` : bibliothèques personnalisées KiCad.
- `common-docs/` : documentation des bus et schémas de principe.
- Des README, schémas et PCB KiCad, ressources de fabrication, images, rendus et modèles 3D selon le module.

Les images de la bibliothèque applicative sont référencées dans le dépôt de référence, et non redessinées. Les modules sans image ou sans détails suffisants sont identifiés comme tels.

## Modules et faits relevés

| Module | Faits documentés utiles | Statut / prudence |
|---|---|---|
| Core32F4 | STM32F4 ; `J9` DIN, `J8` DOUT, `J19` AIN/SPI, `J4A/J4B` quatre lignes WS2812, `J10A/J10B` GPIO/SCS. | Documentation du dépôt ; vérification du montage réel requise. |
| DIN4_R5_KS | Quatre 74HC165, 32 entrées ; `J1` entrée de chaîne/Core, `J2` sortie vers le DIN suivant ; `J3`–`J6` vers front-ends. | Chaînage DIN documenté. La carte porte les pull-ups décrits. |
| DOUT | Sorties à registres 74HC595 ; les LED standard des front-ends sont rattachées au bus DOUT. | Les WS2812 ne sont pas sur DOUT. |
| AINSER64 | Entrées analogiques via MCP3208 et CD4051 ; interface série du module sur `J2` vers `J19` du Core ; groupes d'entrées analogiques sur `J6`–`J13`. | Le README indique qu'aucun schéma KiCad exploitable n'est fourni ; la page s'appuie sur la documentation ucapps.de. À vérifier. |
| 8x-pots | Huit potentiomètres, huit voies analogiques, référence +3V0. | La variante `Pot-X2` est explicitement signalée comme incomplète/non vérifiée. |
| 4x-faders | Quatre curseurs analogiques par PCB ; les fichiers décrivent des variantes complémentaires Fad_1/Fad_2 et un passage de signaux sur J4. | Vérifier les affectations de voies du schéma de la variante utilisée. |
| 8x-buttons | Huit boutons et huit sorties LED ; `J1` DIN et `J2` DOUT ; les résistances de pull-up et limitation sont sur les modules DIN/DOUT, pas sur ce front-end. | Documenté ; polarité à configurer/vérifier. |
| encoders-led-rgb | Huit encodeurs PEC16 avec poussoirs et 128 WS2812 ; 24 signaux DIN et une cascade LED. | Le README cite une conception marquée « ne fonctionne pas » sur le blog et des violations DRC ; ne pas la considérer comme validée. |
| keysw-4x2 | Huit touches DIN et huit LED RGB SK6812 en cascade. | La compatibilité exacte de la ligne SK6812 avec les sorties du Core reste à confirmer. |
| pad-rgb | Huit contacts DIN et huit WS2812 en cascade. | Vérifier les connecteurs et le mappage DIN complet dans le schéma de la variante choisie. |
| OLED, carte puissance, surface-control, IO-Midi | Ressources et documentation présentes ; SCS associé à J10A/J10B dans le README Core. | Plusieurs limites et détails firmware restent à confirmer ; pas d'affectation logique automatique. |

Les définitions de la bibliothèque sont dans `data/modules.json`. Leur statut est volontairement distinct de l'existence d'un PCB ou d'une image.

## Connexions confirmées par les documents

- DIN et DOUT utilisent des sorties distinctes du Core (`J9` et `J8`) et des modules d'extension à registres ; les cartes DIN/DOUT documentent leurs connecteurs d'entrée et de chaînage. Le validateur vérifie désormais les topologies série Core → extension pour ces deux bus.
- Le DIN4_R5_KS se raccorde au Core ou au module précédent via J1, puis fournit J2 au module DIN suivant.
- Les front-ends de boutons, encodeurs et pads présentent des entrées au bus DIN. Le Core n'est donc pas nécessairement leur point de raccordement direct.
- Les contrôles analogiques des cartes de potentiomètres et faders entrent dans les connecteurs analogiques AINSER64; son interface série `J2` relie le Core `J19` via SPI. Le câblage détaillé des front-ends reste à vérifier.
- Les LED RGB WS2812 se raccordent aux sorties dédiées du Core, séparément de DOUT. La documentation avertit qu'une alimentation 5 V dédiée et une masse commune sont nécessaires pour les ensembles à forte consommation.
- Les signaux WS2812, bus DIN, bus DOUT, AIN, SPI, SCS et alimentation sont traités comme des catégories distinctes dans le configurateur.

L'interface permet de déclarer les connexions, valide les ports documentés lorsqu'ils sont modélisés et signale les liaisons dont les connecteurs restent inconnus. La commande « Créer la chaîne DIN documentée » ne crée que la chaîne de registres Core → DIN ; les chaînes DOUT se déclarent par connexions explicites. Les liaisons front-end doivent être ajoutées séparément.

## Ressources graphiques réutilisables

Les images disponibles sont dans `reference/MB_ModulBox_NG/**/assets/` et `docs/assets/`. La bibliothèque réutilise les images frontales ou rendus présents pour Core, DIN, DOUT, faders, boutons, potentiomètres, encodeurs RGB, clavier, pads, OLED, alimentation et surface-control. L'application conserve leurs chemins relatifs au dépôt.

Les schémas KiCad et fichiers de fabrication restent les sources matérielles à consulter ; une image de PCB ne vaut pas une certification de conception.

## Incertitudes à résoudre

1. Valider la version exacte de firmware MIOS32/MIDIbox NG et les directives permises par celle-ci.
2. Construire un mapping exhaustif des contrôles de chaque front-end vers les indices DIN/AIN/DOUT après choix des cartes d'extension, ordre de chaîne et câblage.
3. Confirmer les paramètres de banques supportés par le firmware et automatiser les scripts NGR associés. Le modèle KSBOX utilise `RunSection` et `set ^bank`.
4. Valider les variantes de cartes et les ressources analogiques exactes pour les front-ends complémentaires.
5. Vérifier les quantités simultanées, adresses de contrôleurs et limites de chaque bus pour un assemblage complet.
6. Le dépôt contient des cartes avec des avertissements de conception, dont le front-end encodeur RGB ; l'application ne doit pas les afficher comme « testées ».

## Conséquences pour l'application et le générateur

- La définition de carte reste distincte des instances et des contrôles logiques.
- Les connexions sont des entités explicites, modifiables indépendamment du placement graphique.
- Les ressources qui ne peuvent pas être déduites sont des champs configurables, jamais une contrainte fabriquée.
- La validation porte sur le modèle déclaré : références, valeurs MIDI, identifiants et compatibilités de bus/ports répertoriées. Les règles exactes d'adressage `hw_id` des registres DIN et des bancs ne sont pas complètes; aucun ID n'est inféré.
- La génération inclut les sous-ensembles NGC/NGR/NGL couverts par tests et documentés dans `GENERATION_RULES.md`. Les directives avancées sont préservées avec détection limitée de collisions.
- Ni le modèle ni le rapport ne certifient une installation physique, la conception électrique ou la compatibilité firmware.
