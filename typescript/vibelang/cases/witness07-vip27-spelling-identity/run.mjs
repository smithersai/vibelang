// The public declaration spells the import as the native twin would, and the
// compatibility sidecar keeps the source reference; each still names the same
// module, so a nominal class from that module is the one `make` returns, and a
// structurally identical class from another module is not.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = fileURLToPath(new URL(".", import.meta.url))
const tsc = fileURLToPath(new URL("../../../../experiments/node_modules/typescript/bin/tsc", import.meta.url))
assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(tsc), "../package.json"), "utf8")).version, "5.9.3")
const read = name => fs.readFileSync(path.join(here, name), "utf8")
assert.match(read("out/main.d.ts"), /from "\.\/user\.ts"/, "public declaration spells the native twin")
assert.match(read("main.d.vibe.ts"), /from "\.\/user\.vibe"/, "compatibility sidecar keeps the source reference")

const consumer = (name, files, options) => {
  const dir = path.join(here, "out", name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), text)
  fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "es2022", module: "nodenext", moduleResolution: "nodenext", strict: true, noEmit: true, types: [], ...options },
    files: Object.keys(files),
  }))
  const r = spawnSync(process.execPath, [tsc, "-p", dir, "--pretty", "false"], { encoding: "utf8", timeout: 60000 })
  return { status: r.status, codes: [...(r.stdout + r.stderr).matchAll(/error (TS\d+):/g)].map(m => m[1]), text: r.stdout + r.stderr }
}
const check = (from, ext) => `import { make } from "${from}/main${ext}"
import { User } from "${from}/user${ext}"
import { User as Other } from "${from}/other${ext}"
export const same: User = make("a")
export const different: Other = make("b")
`
// Public declarations: out/main.d.ts imports ./user.ts, which stock TypeScript
// reads as out/user.d.ts, the declaration of the same user.vibe module.
fs.writeFileSync(path.join(here, "out/package.json"), '{"type":"module"}')
const pub = consumer("public-consumer", { "check.ts": check("..", ".js") }, { allowImportingTsExtensions: true })
assert.deepEqual(pub.codes, ["TS2322"], pub.text)
assert.match(pub.text, /check\.ts\(5,/, pub.text)
// Compatibility sidecars: main.d.vibe.ts imports ./user.vibe, read as user.d.vibe.ts.
const compat = consumer("compat-consumer", { "check.ts": check("../..", ".vibe") }, { allowArbitraryExtensions: true })
assert.deepEqual(compat.codes, ["TS2322"], compat.text)
assert.match(compat.text, /check\.ts\(5,/, compat.text)
console.log("spelling keeps module identity")
