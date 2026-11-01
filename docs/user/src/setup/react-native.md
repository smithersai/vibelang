# React Native and Metro

Add VibeLang to a React Native or Expo app that bundles with Metro. Install the packages with [Add VibeLang to an existing project](existing-project.md) first.

## 1. Configure Metro

Wrap the config that `metro.config.js` exports in `withVibeLang`, keeping everything else:

```js
// metro.config.js
const { getDefaultConfig } = require("expo/metro-config")
const { withVibeLang } = require("vibelang/metro")

module.exports = withVibeLang(getDefaultConfig(__dirname))
```

`withVibeLang` adds `vibe` to `resolver.sourceExts` and puts `vibelang/metro` in front of the app's Babel transformer. That transformer still transforms every module. For a `.vibe` module it receives the module's JavaScript, and the bundle's source maps name `.vibe` lines. The config can also be a promise of a config, or a function that returns one.

Metro caches a transformed module by its own text, but a `.vibe` module's JavaScript also depends on the modules it imports. After a change that alters how an importer compiles, restart Metro with `npx expo start --clear` or `--reset-cache`.

## 2. Configure Babel

Add `vibelang/babel` after the app's presets. Metro does not need it, but any tool that runs Babel on a file directly does, such as a Jest suite or a React Compiler coverage test:

```js
// babel.config.js
module.exports = function (api) {
  api.cache(true)
  return { presets: ["babel-preset-expo", "vibelang/babel"] }
}
```

## 3. Check

Run `npx expo export --platform ios` and expect it to finish without errors. With the React Compiler on, a hook in a `.vibe` module is memoized as it was in its `.ts` module.
