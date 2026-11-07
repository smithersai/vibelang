// run-seconds: 300
// VIP-39's declaration-specifier amendment, compared with the stock TypeScript
// 5.9.3 build of the module's .ts/.tsx twin.
// rule-evidence: docs/design/vips/0039-vibex.md#10d0537ed988bbac
// "**Amended 2026-11-03: declaration specifiers follow the `.tsx` twin.** Ordinary package declarations use the native twin’s relative specifiers: `./user.vibe` is declared as `./user.ts` and `./App.vibex` as `./App.tsx`; written `./user.js`, `./App.jsx`, `./user` and native `./plain.ts` keep their spelling."
// rule-evidence: docs/design/vips/0039-vibex.md#83b28e1d15dc1f66
// "Compatibility sidecars instead keep VibeLang source references such as `./user.vibe` and `./App.vibex`, relocated to the selected compatibility declaration when necessary, to preserve source identity."
// rule-evidence: docs/design/vips/0039-vibex.md#1a67a43edea75cde
// "Neither `allowImportingTsExtensions` nor `rewriteRelativeImportExtensions` rewrites declaration specifiers; JavaScript output rewriting is separate."
// rule-evidence: docs/design/vips/0039-vibex.md#ea622ab9b71222d1
// "The `jsx` options keep their native meanings."
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { project, check, nativeCheck } from "../../tests/coverage-tooling.mjs"

const user = "export interface User { readonly name: string }\nexport const user: User = { name: \"a\" }\nexport const userName = \"a\"\nexport const plainUser = 1\n"
const app = "export interface Shape { readonly n: number }\nexport const makeShape = (): Shape => ({ n: 1 })\nexport const App = 7\nexport const element = <div />\n"
const plain = "export const plainValue = 2\n"
const jsxTypes = "declare global { namespace JSX { type Element = { readonly kind: \"element\" }; interface IntrinsicElements { div: {} } } }\nexport {}\n"
// One importer, spelled for either side: [user source, app source].
const importer = ([userSource, appSource]) => [
  `export { user } from "${userSource}"`,
  `export { userName } from "./user.js"`,
  `export { plainUser } from "./user"`,
  `export { App } from "${appSource}"`,
  `export { element } from "./App.jsx"`,
  `export { plainValue } from "./plain.ts"`,
  `import { makeShape } from "${appSource}"`,
  `export type Named = import("${userSource}").User`,
  `export type Alias = import("${appSource}").Shape`,
  `export const shape = () => makeShape()`,
].join("\n") + "\n"
const vibeMain = importer(["./user.vibe", "./App.vibex"])
const tsMain = importer(["./user.ts", "./App.tsx"])
// The twins' only additions are the nonthrowing contracts VIP-27 generates for .vibe and .vibex callables.
const tsMainTwin = tsMain.replace("export const shape", "/** @throws {never} */\nexport const shape")

const extensions = [
  ["allow", { allowImportingTsExtensions: true, emitDeclarationOnly: true }],
  ["rewrite", { rewriteRelativeImportExtensions: true }],
  ["both", { allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true }],
]
const jsxModes = [["preserve", ".jsx"], ["react-jsx", ".js"], ["react", ".js"]]
let cells = 0
for (const [extTag, extOptions] of extensions) {
  for (const [jsx, appOutput] of jsxModes) {
    if (extTag === "both" && jsx !== "preserve") continue
    const compilerOptions = {
      module: "ESNext", moduleResolution: "Bundler", jsx, noEmit: false, declaration: true,
      allowArbitraryExtensions: true, ...(jsx === "react" ? { jsxFactory: "h" } : {}), ...extOptions,
    }
    const tag = extTag + "-" + jsx
    const factory = jsx === "react" ? "export declare function h(...args: unknown[]): { readonly kind: \"element\" }\n" : ""
    const reactJsx = jsx === "react-jsx"
      ? { "node_modules/react/package.json": '{"name":"react","type":"module","exports":{"./jsx-runtime":{"types":"./jsx-runtime.d.ts","default":"./jsx-runtime.js"}}}',
          "node_modules/react/jsx-runtime.d.ts": "export declare function jsx(...a: unknown[]): JSX.Element\nexport declare function jsxs(...a: unknown[]): JSX.Element\n",
          "node_modules/react/jsx-runtime.js": "export const jsx = () => ({ kind: \"element\" })\nexport const jsxs = jsx\n" }
      : {}
    const appSource = (jsx === "react" ? "import { h } from \"./h.ts\"\n" : "") + app
    const shared = { "globals.ts": jsxTypes, ...(jsx === "react" ? { "h.ts": factory } : {}) }
    const files = list => ({ ...shared, ...list })
    const vibe = project(import.meta.url, "vibe-" + tag, files({ "main.vibe": vibeMain, "user.vibe": user, "App.vibex": appSource, "plain.ts": plain }), { compilerOptions })
    const twin = project(import.meta.url, "twin-" + tag, files({ "main.ts": tsMainTwin, "user.ts": user, "App.tsx": appSource.replace("export const makeShape", "/** @throws {never} */\nexport const makeShape"), "plain.ts": plain }), { compilerOptions })
    if (jsx === "react-jsx") for (const p of [vibe, twin]) {
      fs.rmSync(path.join(p.dir, "node_modules"), { recursive: true, force: true })
      for (const [name, text] of Object.entries(reactJsx)) {
        fs.mkdirSync(path.dirname(path.join(p.dir, name)), { recursive: true })
        fs.writeFileSync(path.join(p.dir, name), text)
      }
    }
    const ours = check(vibe)
    const native = nativeCheck(twin)
    assert.equal(native.status, 0, tag + " native\n" + native.output)
    assert.equal(ours.status, 0, tag + "\n" + ours.output)
    // Ordinary declarations: byte-identical to the twin's, so every specifier is the twin's spelling.
    for (const name of ["main.d.ts", "user.d.ts", "App.d.ts", "plain.d.ts"])
      assert.equal(vibe.read("build/" + name), twin.read("build/" + name), tag + " " + name)
    const declaration = vibe.read("build/main.d.ts")
    assert.match(declaration, /from "\.\/user\.ts"/, tag)
    assert.match(declaration, /from "\.\/App\.tsx"/, tag)
    for (const kept of ['"./user.js"', '"./App.jsx"', '"./user"', '"./plain.ts"']) assert.ok(declaration.includes(kept), tag + " keeps " + kept)
    assert.doesNotMatch(declaration, /\.vibex?"/, tag)
    // Compatibility sidecar: source identity.
    const sidecar = vibe.read("main.d.vibe.ts")
    assert.match(sidecar, /from "\.\/user\.vibe"/, tag)
    assert.match(sidecar, /from "\.\/App\.vibex"/, tag)
    // Every relative reference to a VibeLang module, however it was written, names that
    // module's compatibility declaration, so stock TypeScript resolves the sidecar.
    for (const stale of ['"./user.js"', '"./user"', '"./App.jsx"']) assert.ok(!sidecar.includes(stale), tag + " sidecar keeps " + stale + "\n" + sidecar)
    vibe.write("consumer.ts", 'import { user, userName, plainUser, App, element, plainValue, shape } from "./main.vibe"\nexport const all = [user, userName, plainUser, App, element, plainValue, shape().n]\n')
    vibe.write("consumer.json", JSON.stringify({ compilerOptions: { strict: true, module: "ESNext", moduleResolution: "Bundler", jsx,
      noEmit: true, allowArbitraryExtensions: true, allowImportingTsExtensions: true, skipLibCheck: false, types: [] }, files: ["consumer.ts", "globals.ts"] }))
    const consumer = nativeCheck(vibe, "consumer.json")
    assert.equal(consumer.status, 0, tag + " stock consumer of the sidecar\n" + consumer.output)
    // jsx keeps its native meaning: the App output name and its JavaScript equal the .tsx twin's.
    if (!extOptions.emitDeclarationOnly) {
      // The twin's written contract comments are the only JavaScript difference.
      const untagged = text => text.replaceAll("/** @throws {never} */\n", "")
      assert.equal(vibe.read("build/App" + appOutput), untagged(twin.read("build/App" + appOutput)), tag + " App" + appOutput)
      const js = vibe.read("build/main.js"), nativeJs = untagged(twin.read("build/main.js"))
      // JavaScript rewriting is separate: emitted imports follow the twin's rewritten JavaScript.
      assert.equal(js, nativeJs, tag + " main.js")
      assert.ok(js.includes('"./App' + appOutput + '"'), tag + " rewritten App import\n" + js)
    }
    cells++
  }
}
assert.equal(cells, 7)
console.log("vibex declaration specifiers follow the twin")
