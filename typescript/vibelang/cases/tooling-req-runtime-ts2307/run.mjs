// When emitted JavaScript needs vibelang-runtime and the package does not
// resolve, the project reports one TS2307 naming the package and no
// unresolved names for the helpers the lowering generates.
import assert from "node:assert/strict"
import { unlinkSync } from "node:fs"
import { join } from "node:path"
import { project, baseOptions, diagnostics } from "../_tooling-witness.mjs"

const scenarios = [
  // [name, files, needs the runtime, independent errors kept]
  ["error declaration", { "main.vibe": "export error Missing { id: string }" }, true, []],
  ["producer", { "main.vibe": "export effect function* values() { yield 1 }" }, true, []],
  ["catch", { "main.vibe": 'export effect function value() { return Effect.fail("bad") catch (_e) => 0 }' }, true, []],
  ["runtime value", { "main.vibe": "export const value = Experimental" }, true, []],
  ["two files", { "main.vibe": "import './other.js'\nexport error Missing { id: string }", "other.vibe": "export effect function* values() { yield 1 }" }, true, []],
  ["written import", { "main.vibe": 'import { Experimental as Existing } from "vibelang-runtime"\nexport error Missing { id: string }\nexport const e = Existing' }, true, []],
  ["written subpath imports in two files", { "main.vibe": 'import * as A from "vibelang-runtime/experimental"\nimport "./other.js"\nexport const a = A', "other.vibe": 'import * as B from "vibelang-runtime/experimental"\nexport const b = B' }, true, []],
  ["independent error", { "main.vibe": "export error Missing { id: string }\nexport const x: number = 'bad'" }, true, ["error TS2322"]],
  ["independent missing package", { "main.vibe": 'import { absent } from "missing-other-package"\nexport error Missing { id: string }\nexport const a = absent' }, true, ["error TS2307"]],
  ["independent callback error", { "main.vibe": "export effect function value() { return Effect.fail(0) catch (_e) => { const inner = (x): number => 1; return inner(0) } }" }, true, ["error TS7006"]],
  // Controls: nothing needs the runtime.
  ["plain function", { "main.vibe": "export function value(): number { return 1 }" }, false, []],
  ["effect function without helpers", { "main.vibe": "export effect function value() { return 1 }" }, false, []],
]

for (const [name, files, needs, independent] of scenarios) for (const installed of [false, true]) project(({ dir, put, invoke }) => {
  if (!installed) unlinkSync(join(dir, "node_modules/vibelang-runtime"))
  for (const [file, text] of Object.entries(files)) put(file, text + "\n")
  put("tsconfig.json", { compilerOptions: { ...baseOptions(), noEmit: true }, files: Object.keys(files) })
  const r = invoke("-p", ".", "--pretty", "false")
  const got = diagnostics(r.text).filter(d => !d.startsWith("warning") && !d.startsWith("suggestion"))
  const runtimeErrors = [...r.text.matchAll(/error TS2307: Cannot find module '([^']+)'/g)].filter(m => m[1].startsWith("vibelang-runtime"))
  const label = name + (installed ? " (installed)" : " (missing)")
  const want = [...independent]
  if (needs && !installed) {
    want.push("error TS2307")
    assert.equal(runtimeErrors.length, 1, label + ": one TS2307 for the runtime\n" + r.text)
    assert.equal(runtimeErrors[0][1], "vibelang-runtime", label + ": it names the package\n" + r.text)
  } else assert.equal(runtimeErrors.length, 0, label + "\n" + r.text)
  assert.deepEqual(got.sort(), want.sort(), label + "\n" + r.text)
  // No generated helper name leaks into a message.
  assert.doesNotMatch(r.text, /\$|Cannot find name/, label + "\n" + r.text)
})
console.log("a missing vibelang-runtime is one TS2307 naming the package, never unresolved helper names")
