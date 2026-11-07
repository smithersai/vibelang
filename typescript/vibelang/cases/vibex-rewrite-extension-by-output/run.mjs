// run-seconds: 300
// rewriteRelativeImportExtensions rewrites a relative ./x.vibex specifier to
// the target's actual JavaScript output, as stock TypeScript 5.9.3 rewrites
// ./x.tsx, for .vibe and .vibex importers under every JSX output mode.
// rule-evidence: docs/design/vips/0039-vibex.md#ffaa00d4fe403bc1
// "With `rewriteRelativeImportExtensions`, as VIP-34's amended emit-name rule requires for `./x.vibe`, a relative `./x.vibex` specifier in emitted JavaScript rewrites to `./x.jsx` under `preserve` and `./x.js` otherwise, as TypeScript rewrites `./x.tsx`, decided by the target file's actual output."
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { project, check, nativeCheck } from "../../tests/coverage-tooling.mjs"

const twinName = name => name.replace(/\.vibex$/, ".tsx").replace(/\.vibe$/, ".ts")
const jsxTypes = "declare global { namespace JSX { type Element = unknown; interface IntrinsicElements { div: {} } } }\nexport declare function h(...args: unknown[]): unknown\n"
const targets = { "x.vibex": "export const x = 1\n", "u.vibe": "export const u = 2\n", "t.tsx": "export const t = 3\n", "s.ts": "export const s = 4\n" }
const importer = names => names.map((name, i) => `export { ${Object.values(targets)[i].match(/const (\w)/)[1]} } from "./${name}"`).join("\n") + "\n"
const modes = [["preserve", ".jsx"], ["react-native", ".js"], ["react-jsx", ".js"], ["react", ".js"]]
let cells = 0
for (const [jsx, jsxOutput] of modes) {
  for (const main of ["main.vibe", "main.vibex"]) {
    const compilerOptions = { module: "ESNext", moduleResolution: "Bundler", jsx, jsxFactory: jsx === "react" ? "h" : undefined,
      noEmit: false, rewriteRelativeImportExtensions: true, outDir: "build" }
    const key = jsx + "-" + main.replace(".", "-")
    const vibe = project(import.meta.url, "vibe-" + key, { "globals.ts": jsxTypes, ...targets, [main]: importer(Object.keys(targets)) }, { compilerOptions })
    const twinFiles = Object.fromEntries(Object.entries(targets).map(([name, text]) => [twinName(name), text]))
    const twin = project(import.meta.url, "twin-" + key, { "globals.ts": jsxTypes, ...twinFiles, [twinName(main)]: importer(Object.keys(targets).map(twinName)) }, { compilerOptions })
    if (jsx === "react-jsx") for (const p of [vibe, twin]) {
      fs.rmSync(path.join(p.dir, "node_modules"), { recursive: true, force: true })
      fs.mkdirSync(path.join(p.dir, "node_modules/react"), { recursive: true })
      fs.writeFileSync(path.join(p.dir, "node_modules/react/package.json"), '{"name":"react","exports":{"./jsx-runtime":{"types":"./jsx-runtime.d.ts"}}}')
      fs.writeFileSync(path.join(p.dir, "node_modules/react/jsx-runtime.d.ts"), "export declare function jsx(...a: unknown[]): unknown\n")
    }
    const ours = check(vibe), native = nativeCheck(twin)
    assert.equal(native.status, 0, key + " native\n" + native.output)
    assert.equal(ours.status, 0, key + "\n" + ours.output)
    // The importer's own output name follows its file kind, as the twin's does.
    const output = main.endsWith(".vibex") ? "main" + jsxOutput : "main.js"
    assert.ok(fs.existsSync(path.join(twin.dir, "build", output)), key + " twin output " + output)
    const js = vibe.read("build/" + output)
    assert.equal(js, twin.read("build/" + output), key)
    // Each specifier names the target's actual output, not the importer's kind.
    assert.ok(js.includes('"./x' + jsxOutput + '"'), key + "\n" + js)
    assert.ok(js.includes('"./u.js"'), key + "\n" + js)
    for (const [name, extension] of [["x", jsxOutput], ["u", ".js"]])
      assert.ok(fs.existsSync(path.join(vibe.dir, "build", name + extension)), key + " " + name + extension)
    cells++
  }
}
assert.equal(cells, 8)
console.log("vibex specifiers rewrite to the target's output")
