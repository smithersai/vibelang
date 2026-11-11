# React Native and Metro

Add VibeLang to a React Native or Expo app that bundles with Metro. Install the packages with [Add VibeLang to an existing project](existing-project.md) first.

## 1. Configure Metro

Wrap the config that the Metro config file exports in `withVibeLang`, keeping everything else. Save it as `metro.config.cjs` because `package.json` has `"type": "module"`: Node loads a `metro.config.js` that uses `require` and `module.exports` as an ES module and fails with `require is not defined in ES module scope`. Rename an existing CommonJS `metro.config.js`:

```js
// metro.config.cjs
const { getDefaultConfig } = require("expo/metro-config")
const { withVibeLang } = require("vibelang/metro")

module.exports = withVibeLang(getDefaultConfig(__dirname))
```

`withVibeLang` adds `vibe` to `resolver.sourceExts`, resolves the emitted names of a `.vibe` module's relative imports (`./a.js` for `./a.ts`) to the sources beside it, and puts `vibelang/metro` in front of the app's Babel transformer. That transformer still transforms every module. For a `.vibe` module it receives the module's JavaScript, and the bundle's source maps name `.vibe` lines. The config can also be a promise of a config, or a function that returns one.

Metro caches a transformed module by its own text, but a `.vibe` module's JavaScript also depends on the modules it imports. After a change that alters how an importer compiles, restart Metro with `npx expo start --clear` or `--reset-cache`.

Each `module` declaration compiles to a module of its own, such as `main.vibe.text.js` for `module text` in `main.vibe`. That file is not on disk, so `withVibeLang` writes a stand-in for each declaration under `node_modules/.cache/vibelang-metro` before Metro starts, and the app's Babel transformer reads the declaration's JavaScript as it would a `.ts` file beside the `.vibe` file. It finds the declarations in the `.vibe` and `.vibex` files under the project root and `watchFolders`, so wrap the config that Metro runs. If you add a declaration while Metro runs, Metro names it in an error: restart Metro.

## 2. Configure Babel

Add `vibelang/babel` after the app's presets. Metro does not need it, but any tool that runs Babel on a file directly does, such as a Jest suite or a React Compiler coverage test. Save CommonJS Babel configuration as `babel.config.cjs` because `package.json` has `"type": "module"`. Rename an existing `babel.config.js` that uses `module.exports`:

```js
// babel.config.cjs
module.exports = function (api) {
  api.cache(true)
  return { presets: ["babel-preset-expo", "vibelang/babel"] }
}
```

## 3. Check

Run `npx expo export --platform ios` and expect it to finish without errors. With the React Compiler on, a hook in a `.vibe` module is memoized as it was in its `.ts` module.
