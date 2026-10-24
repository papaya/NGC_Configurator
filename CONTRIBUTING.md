# Contribuer au ModulBox NGC Configurateur

## Démarrage

Ce projet est une application vanilla HTML/JS sans dépendance de build.

```sh
# Lancer localement
python3 -m http.server 8000
# puis ouvrir http://localhost:8000

# Tests
npm test

# Lint
npm run lint

# Formatage
npm run format
```

## Conventions

- Code en français pour l'interface, noms de fonctions/variables en anglais
- Prettier (2 espaces, guillemets simples, point-virgule)
- ESLint recommandé + Prettier
- Chaque modification de comportement doit s'accompagner d'un test unitaire dans `tests/`
- Les fichiers de référence sous `NGC_NGR/` et `reference/` ne sont pas modifiés

## Tests

Les tests utilisent le runner intégré à Node.js (`node --test`). Lancez `npm test` avant toute proposition de modification.
