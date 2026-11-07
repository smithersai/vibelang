// run-seconds: 300
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK3011` | warning: retired root `vibelang.declarationImportStyle` or `compilerOptions.vibelang.declarationImportStyle` is ignored for every value, including invalid values; remove the setting | 30 | [Configuration](007-tooling.md#config-files) |
import assert from "node:assert/strict"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { codes, withProject } from "../_appb-retirement-helpers.mjs"
const here = dirname(fileURLToPath(import.meta.url))
// A declaration that names another module's type: its specifier spelling is
// what declarationImportStyle once chose. Every value, valid or not, in either
// retired location warns and leaves both outputs equal to the settingless build.
const files = {
  "user.vibe": "export type User = { readonly id: string }\n",
  "main.vibe": 'import type { User } from "./user.vibe"\nexport const name = (user: User) => user.id\nexport effect function main() { return name({ id: "u" }) }\n',
}
const compilerOptions = { target: "es2022", lib: ["esnext"], module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], skipLibCheck: true, outDir: "out", declaration: true, rewriteRelativeImportExtensions: true }
const build = (config) => withProject(here, files, ({ tsc, read }) => {
  const r = tsc()
  return { status: r.status, codes: codes(r.text), text: r.text, js: read("out/main.js"), dts: read("out/main.d.ts") }
}, { compilerOptions, include: ["*.vibe"], ...config })
const plain = build({})
assert.deepEqual(plain.codes, [], plain.text)
let checked = 0
for (const value of ["ts", "vibe", "js", "bogus", 42, null]) {
  const configs = {
    root: { vibelang: { declarationImportStyle: value } },
    compilerOptions: { compilerOptions: { ...compilerOptions, vibelang: { declarationImportStyle: value } } },
  }
  for (const [where, config] of Object.entries(configs)) {
    const got = build(config)
    const label = where + " " + JSON.stringify(value)
    assert.deepEqual(got.codes, ["EK3011"], label + ": " + got.text)
    assert.match(got.text, /warning EK3011: declarationImportStyle is deprecated and ignored/)
    assert.equal(got.status, plain.status, label)
    assert.equal(got.js, plain.js, label + ": JavaScript output")
    assert.equal(got.dts, plain.dts, label + ": declaration output")
    checked++
  }
}
console.log("EK3011 warns and ignores declarationImportStyle in " + checked + " configs")
