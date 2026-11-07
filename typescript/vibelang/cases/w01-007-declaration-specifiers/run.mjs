// run-seconds: 300
// rule-evidence: docs/design/src/007-tooling.md#config-files | `rewriteRelativeImportExtensions` rewrites JavaScript specifiers, not declaration specifiers ([VIP-27](../vips/0027-declaration-output.md#decision)).
// rule-evidence: docs/design/src/001-functions.md#declaration-output | Ordinary package declarations use the native twin’s relative specifiers: `./user.vibe` is declared as `./user.ts` and `./App.vibex` as `./App.tsx`; written `./user.js`, `./App.jsx`, `./user` and native `./plain.ts` keep their spelling.
//
// The VibeLang project and its TypeScript twin (.ts/.tsx in place of
// .vibe/.vibex) build with rewriteRelativeImportExtensions. The VibeLang
// main.d.ts must equal stock tsc's twin declaration byte for byte, and both
// projects' main.js must import the same rewritten names.
import assert from "node:assert/strict"
import { project, check, nativeCheck } from "../../tests/coverage-tooling.mjs"

const modules = {
  user: "export const user = \"u\"\n",
  other: "export const other = 2\n",
  third: "export const third = 3\n",
}
const components = { App: "export const App = 1\n", App2: "export const App2 = 4\n" }
const main = (source, component) => [
  `export { user } from "./user${source}"`,
  `export { App } from "./App${component}"`,
  `export { other } from "./other.js"`,
  `export { App2 } from "./App2.jsx"`,
  `export { third } from "./third"`,
  `export { plain } from "./plain.ts"`,
].join("\n") + "\n"
const files = (source, component, main) => ({
  ...Object.fromEntries(Object.entries(modules).map(([name, text]) => [name + source, text])),
  ...Object.fromEntries(Object.entries(components).map(([name, text]) => [name + component, text])),
  "plain.ts": "export const plain = 5\n",
  ...main,
})
const specifiers = (text) => [...text.matchAll(/from "([^"]+)"/g)].map(m => m[1])

for (const jsx of ["preserve", "react-jsx"]) {
  const compilerOptions = { module: "ESNext", moduleResolution: "Bundler", jsx, noEmit: false, declaration: true, rewriteRelativeImportExtensions: true }
  const vibe = project(import.meta.url, "vibe-" + jsx, files(".vibe", ".vibex", { "main.vibe": main(".vibe", ".vibex") }), { compilerOptions })
  const native = project(import.meta.url, "native-" + jsx, files(".ts", ".tsx", { "main.ts": main(".ts", ".tsx") }), { compilerOptions })
  const built = check(vibe), reference = nativeCheck(native)
  assert.equal(reference.status, 0, reference.output)
  assert.equal(built.status, 0, built.output)
  const declaration = vibe.read("build/main.d.ts")
  assert.equal(declaration, native.read("build/main.d.ts"), jsx + ": main.d.ts differs from the twin")
  const javascript = specifiers(vibe.read("build/main.js"))
  assert.deepEqual(javascript, specifiers(native.read("build/main.js")), jsx + ": main.js")
  console.log(jsx.padEnd(10), "d.ts", JSON.stringify(specifiers(declaration)))
  console.log(jsx.padEnd(10), "js  ", JSON.stringify(javascript))
}
