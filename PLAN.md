# Plan d'audit et d'amélioration — ModulBox NGC Configurator

## État initial (audit)

- 50 tests unitaires, tous verts (`node --test`)
- Vanilla JS/HTML/CSS, pas de dépendance de build, `type: module`
- `app.js` (954 lignes) sans aucun test unitaire
- Pas de lint, pas de formatage, pas de CI, pas de licence, pas d'`.editorconfig`
- README référence `examples/generated/` qui n'existe pas
- Pas de `PLAN.md`, pas de `CONTRIBUTING.md`

## Phases

- [x] **Phase 1 — Outillage qualité** : ESLint + Prettier, GitHub Actions (test + lint), `.editorconfig`, `LICENSE` (MIT), `CONTRIBUTING.md`. Lint propre, Prettier OK, 50 tests verts.
- [x] **Phase 2 — Couverture de tests** : +7 tests (removeModule, removeBank, duplicateModule maxInstances, addBank Meta→CC, hw_id doublon, conflit label NGL). Total 57 tests verts, lint et format propres.
- [x] **Phase 3 — Corrections document & exemple** : `examples/generated/` existe et est synchronisé avec le générateur (test de synchronisation passe). Référence README valide.
- [ ] **Phase 4 — Qualité du code** : revue du code mort/cohérences dans `app.js`, vérification des imports, cohérence noms FR/EN
- [x] **Phase 5 — Validation finale** : 57 tests verts, lint propre, format Prettier OK, app servie en HTTP 200 sur toutes les ressources. Plan terminé.
- [x] **Phase 6 — Fusion des pages** : bibliothèque + connexions intégrées dans une page "Projet" unifiée, page-modules/page-hardware supprimées, nav et data-go redirigés, app.js ajusté. 57 tests verts.
- [ ] **Phase 7 — Refonte interface dockable** : panneaux latéraux repliables à gauche/droite avec onglets (Bibliothèque / Contrôles MIDI / Banques / Génération / Fichiers), zone centrale = plan de câblage + composition matérielle unifiée, bascule dynamique du contenu des docks, CSS dock/onglet, re-test complet.
- [ ] **Phase 8 — Validation finale** : tests, lint, format, chargement HTTP.
