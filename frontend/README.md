# Destidle — front

Front Vue 3 de Destidle (Vite, TypeScript, Tailwind v4, vue-i18n). Prérequis, lancement de l'API, tests et production : voir le [README racine](../README.md).

```sh
npm ci                       # installation (Node 22 ≥ 22.22.2 ou 24 ≥ 24.15)
npm run dev                  # http://localhost:5173, proxy /api → http://localhost:5058
npm run test:unit -- --run   # Vitest, exécution unique
npm run build                # type-check vue-tsc + build Vite → dist/
```
