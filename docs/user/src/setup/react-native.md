# React Native and Metro

Add VibeLang to a React Native or Expo app bundled with Metro. Complete [Add VibeLang to an existing project](existing-project.md) first.

## 1. Configure Metro

Wrap the exported Metro config in `withVibeLang`. Save it as `metro.config.cjs` (renaming an existing CommonJS `metro.config.js`), because `"type": "module"` in `package.json` makes Node load `.js` as ESM and fail on `require`:

```js
// metro.config.cjs
const { getDefaultConfig } = require("expo/metro-config")
const { withVibeLang } = require("vibelang/metro")

module.exports = withVibeLang(getDefaultConfig(__dirname))
```

`withVibeLang` accepts a config object, promise, or factory function. It adds `vibe` to `resolver.sourceExts`, resolves emitted relative imports (`./a.js` -> `./a.ts`) beside `.vibe` files, and inserts `vibelang/metro` ahead of the app's Babel transformer so Babel receives compiled JavaScript while bundle source maps point to `.vibe` lines.

- **Metro cache:** Because `.vibe` output depends on imported modules, restart with `npx expo start --clear` or `--reset-cache` after changes that alter how importers compile.
- **Inline `module` declarations:** Each `module` declaration compiles to a virtual module (e.g., `main.vibe.text.js` for `module text` in `main.vibe`). `withVibeLang` scans `.vibe`/`.vibex` files under the project root and `watchFolders` and writes stand-ins under `node_modules/.cache/vibelang-metro` before Metro starts. Restart Metro after adding a new `module` declaration.

## 2. Configure Babel

List `vibelang/babel` last in Babel presets for tools that invoke Babel directly (such as Jest or React Compiler coverage tests; Metro does not need it). Save as `babel.config.cjs` under `"type": "module"`:

```js
// babel.config.cjs
module.exports = function (api) {
  api.cache(true)
  return { presets: ["babel-preset-expo", "vibelang/babel"] }
}
```

## 3. Check

Run `npx expo export --platform ios` and verify zero errors. With the React Compiler enabled, hooks in `.vibe` modules are memoized identically to `.ts`.
