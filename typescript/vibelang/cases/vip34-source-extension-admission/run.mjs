// run-seconds: 120
// rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#decision
// rule-evidence: docs/design/src/007-tooling.md#config-files
// Compiles one VibeLang project and its all-TypeScript twin under each
// extension-flag setting and requires the same diagnostics and JavaScript.
// TypeScript 5.9.3 reports the twin's codes listed below.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "VIBELANG_BINARY must name the tested compiler")
const local = fileURLToPath(new URL(".", import.meta.url))
const root = realpathSync(mkdtempSync(join(tmpdir(), "vip34-extension-admission-")))
const main = 'import { user } from "./user.vibe"\nexport { plain } from "./plain.ts"\nexport const name = user("a").name\n'
const leaf = "export const user = (name: string) => ({ name })\n"
const sources = {
  vibe: { "main.vibe": main, "user.vibe": leaf, "plain.ts": "export const plain = 1\n" },
  ts: { "main.ts": main.replaceAll("./user.vibe", "./user.ts"), "user.ts": leaf, "plain.ts": "export const plain = 1\n" }
}
const compile = (kind, options) => {
  const dir = join(root, kind)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, "node_modules"), { recursive: true })
  symlinkSync(realpathSync(join(local, "node_modules/effect")), join(dir, "node_modules/effect"))
  writeFileSync(join(dir, "package.json"), '{"type":"module"}')
  for (const [name, text] of Object.entries(sources[kind])) writeFileSync(join(dir, name), text)
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    target: "es2022", module: "esnext", moduleResolution: "bundler", strict: true, types: [], skipLibCheck: true,
    outDir: "out", rootDir: ".", ...options
  } }))
  const r = spawnSync(binary, ["-p", ".", "--pretty", "false"], { cwd: dir, encoding: "utf8", timeout: 30000 })
  assert.ifError(r.error)
  const output = r.stdout + r.stderr
  const codes = [...output.matchAll(/\berror ((?:TS|EK)\d+)/g)].map(m => m[1])
  const js = join(dir, "out/main.js")
  return { status: r.status, codes, js: existsSync(js) ? readFileSync(js, "utf8") : null, output }
}
let checks = 0
try {
  // rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#ef0ae173a442cb70 | With `rewriteRelativeImportExtensions`, relative specifiers `./x.vibe` in emitted JavaScript are rewritten to `./x.js`, as for `.ts`; source-extension admission follows the same tsconfig checks as the native twin ([chapter 7](../src/007-tooling.md#config-files)).
  for (const [options, codes] of [
    [{}, ["TS5097", "TS5097"]],
    [{ allowImportingTsExtensions: true }, ["TS5096"]],
    [{ allowImportingTsExtensions: true, noEmit: true }, []],
    [{ rewriteRelativeImportExtensions: true }, []],
    [{ allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true }, []]
  ]) {
    const label = JSON.stringify(options)
    const vibe = compile("vibe", options)
    const twin = compile("ts", options)
    assert.deepEqual(twin.codes, codes, label + " twin\n" + twin.output)
    assert.deepEqual(vibe.codes, twin.codes, label + "\n" + vibe.output)
    assert.equal(vibe.status, twin.status, label + "\n" + vibe.output)
    // JavaScript rewriting needs rewriteRelativeImportExtensions; otherwise the
    // written source extension stays, as ./user.ts does in the twin.
    assert.equal(vibe.js, twin.js === null ? null : twin.js.replaceAll("./user.ts", "./user.vibe"), label)
    if (options.rewriteRelativeImportExtensions) assert.match(vibe.js, /from "\.\/user\.js"/, label)
    checks++
  }
} finally { rmSync(root, { recursive: true, force: true }) }
assert.equal(checks, 5)
console.log("VIP-34 source-extension admission: 5 checks passed")
