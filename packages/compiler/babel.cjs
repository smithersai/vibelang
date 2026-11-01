"use strict"
// vibelang/babel: Babel reads .vibe modules.
//
//   // babel.config.js
//   presets: [..., "vibelang/babel"]
//
// A preset whose one plugin parses a .vibe module from its project's
// compiled JavaScript (vibelang/emit) instead of its source text, which no
// Babel parser accepts, and moves the syntax tree back to .vibe positions.
// Every other plugin and preset then runs on it as on any JavaScript module:
// the React Compiler checks and memoizes it, and diagnostics and source maps
// name .vibe lines. A .vibe module whose text is not its source on disk, such
// as JavaScript vibelang/metro already compiled, parses as it is.
let emit
const vibelangEmit = () => (emit ??= require("./emit.mjs"))

function plugin() {
  return {
    name: "vibelang",
    parserOverride(code, parserOpts, parse) {
      const file = parserOpts.sourceFileName
      if (typeof file !== "string" || !file.endsWith(".vibe")) return undefined
      const { toolSource, remapLocations } = vibelangEmit()
      const source = toolSource(file, code)
      if (source === undefined) return undefined
      return remapLocations(parse(source.code, parserOpts), source.map)
    }
  }
}

module.exports = function vibelang() {
  return { plugins: [plugin] }
}
