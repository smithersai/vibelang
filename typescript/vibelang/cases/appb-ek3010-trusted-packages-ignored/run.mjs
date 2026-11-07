// run-seconds: 300
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK3010` | warning: retired `trustedPackages` is ignored in `vibe` and supported legacy sections; remove the key and use the ordinary foreign-callable contract | 4, 30 | [Configuration](007-tooling.md#config-files) |
import assert from "node:assert/strict"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { codes, withProject } from "../_appb-retirement-helpers.mjs"
const here = dirname(fileURLToPath(import.meta.url))
// A .ts helper that may throw: a trusted package list once let effect code
// call such functions directly. The retired key is ignored in every section:
// the warning names it, and the diagnostics and outputs equal the keyless build.
const files = {
  "parse.ts": "export function parse(s: string): number { return JSON.parse(s) }\n",
  "main.vibe": 'import { parse } from "./parse.ts"\nexport effect function main() { return try Effect.try(() => parse("7")) }\n',
}
const compilerOptions = { target: "es2022", lib: ["esnext"], module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], skipLibCheck: true, outDir: "out", declaration: true, allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true }
const build = (config) => withProject(here, files, ({ tsc, read, run }) => {
  const r = tsc()
  return { status: r.status, codes: codes(r.text), text: r.text, js: read("out/main.js"), dts: read("out/main.d.ts"), result: run() }
}, { compilerOptions, include: ["*.vibe", "*.ts"], ...config })
const keyless = build({})
assert.deepEqual(keyless.codes, [], keyless.text)
const sections = {
  vibe: { vibe: { trustedPackages: ["./parse.ts"] } },
  "root vibelang": { vibelang: { trustedPackages: ["./parse.ts"] } },
  "compilerOptions.vibelang": { compilerOptions: { ...compilerOptions, vibelang: { trustedPackages: ["./parse.ts"] } } },
}
for (const [section, config] of Object.entries(sections)) {
  const got = build(config)
  assert.deepEqual(got.codes, ["EK3010"], section + ": " + got.text)
  assert.match(got.text, /warning EK3010: trustedPackages is deprecated and ignored/)
  assert.equal(got.status, keyless.status, section)
  assert.equal(got.js, keyless.js, section + ": JavaScript output")
  assert.equal(got.dts, keyless.dts, section + ": declaration output")
  assert.equal(got.result, keyless.result, section)
}
console.log("EK3010 warns and ignores trustedPackages in 3 sections")
