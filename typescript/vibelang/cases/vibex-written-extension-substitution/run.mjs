// run-seconds: 300
// A written .vibe or .vibex extension substitutes its sibling source kind
// before the declaration fallback, exactly as stock TypeScript 5.9.3
// substitutes .ts and .tsx on the same file sets.
// rule-evidence: docs/design/vips/0039-vibex.md#ecfab8b109f8058e
// "| `./App.vibe` | `App.vibe`, `App.vibex`, `App.d.ts` |"
// rule-evidence: docs/design/vips/0039-vibex.md#bcfc5d23388dc2c0
// "| `./App.vibex` | `App.vibex`, `App.vibe`, `App.d.ts` |"
// rule-evidence: docs/design/vips/0039-vibex.md#117ca11419bd290d
// "**Amended 2026-11-03: a written source extension keeps the `.ts`/`.tsx` substitution.** `./App.vibe` tries `App.vibe`, `App.vibex`, then `App.d.ts`, and `./App.vibex` tries `App.vibex`, `App.vibe`, then `App.d.ts`, as TypeScript 5.9.3 resolves `./App.ts` to `App.tsx` and `./App.tsx` to `App.ts` when only the other exists."
// rule-evidence: docs/design/vips/0039-vibex.md#bac16aa3371bf4f3
// "This corrects the table above to its own rule, \"Resolution treats `.vibex` as `.vibe`'s `.tsx`\", and to the 2026-11-02 resolution amendment that each rule follows TypeScript on the `.ts` twin."
import assert from "node:assert/strict"
import { project, check, nativeCheck } from "../../tests/coverage-tooling.mjs"

const twinName = name => name.replace(/\.vibex$/, ".tsx").replace(/\.vibe$/, ".ts")
const source = kind => `export const kind = "${kind}" as const\n`
// Each row: the files present, then the file each written extension selects.
const rows = [
  [["App.vibe"], "App.vibe", "App.vibe"],
  [["App.vibex"], "App.vibex", "App.vibex"],
  [["App.vibe", "App.vibex"], "App.vibe", "App.vibex"],
  [["App.d.ts"], "App.d.ts", "App.d.ts"],
  [["App.vibe", "App.d.ts"], "App.vibe", "App.vibe"],
  [["App.vibex", "App.d.ts"], "App.vibex", "App.vibex"],
  [["App.vibe", "App.vibex", "App.d.ts"], "App.vibe", "App.vibex"],
]
const compilerOptions = { module: "ESNext", moduleResolution: "Bundler", jsx: "preserve", noEmit: true, allowImportingTsExtensions: true }
let cells = 0
for (const [present, fromVibe, fromVibex] of rows) {
  for (const [written, selected] of [[".vibe", fromVibe], [".vibex", fromVibex]]) {
    const key = present.map(name => name.replace(/^App\./, "").replace(/\./g, "-")).join("-") + "-from" + written.replace(".", "-")
    const files = Object.fromEntries(present.map(name => [name, name.endsWith(".d.ts")
      ? `export declare const kind: "${name}"\n` : source(name)]))
    const main = (specifier, want) => `import { kind } from "${specifier}"\nexport const selected: "${want}" = kind\n`
    const vibe = project(import.meta.url, "vibe-" + key, { ...files, "main.vibe": main("./App" + written, selected) },
      { compilerOptions, files: ["main.vibe"] })
    const result = check(vibe)
    assert.equal(result.status, 0, key + ": ./App" + written + " must select " + selected + "\n" + result.output)
    // The .ts/.tsx twin: rename every VibeLang source to its TypeScript twin.
    const nativeFiles = Object.fromEntries(present.map(name => [twinName(name), name.endsWith(".d.ts")
      ? `export declare const kind: "${twinName(name)}"\n` : source(twinName(name))]))
    const twin = project(import.meta.url, "twin-" + key, { ...nativeFiles, "main.ts": main("./App" + twinName(written), twinName(selected)) },
      { compilerOptions, files: ["main.ts"] })
    const reference = nativeCheck(twin)
    assert.equal(reference.status, 0, key + ": stock ./App" + twinName(written) + " must select " + twinName(selected) + "\n" + reference.output)
    // A wrong selection is a type error, not a silent pass.
    const wrong = present.find(name => name !== selected)
    if (wrong) {
      const control = project(import.meta.url, "wrong-" + key, { ...files, "main.vibe": main("./App" + written, wrong) },
        { compilerOptions, files: ["main.vibe"] })
      assert.notEqual(check(control).status, 0, key + ": control selecting " + wrong + " must fail")
    }
    cells++
  }
}
assert.equal(cells, 14)
console.log("written source extensions substitute as .ts and .tsx do")
