// run-seconds: 120
// A separate VibeLang consumer reads the emitted declaration as a package: in
// effect code a call to the @throws {never} function needs no wrapping, and
// the same declaration without the tag is a foreign call that may throw.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const declaration = readFileSync(new URL("./out/main.d.ts", import.meta.url), "utf8")
function consume(text) {
  const dir = mkdtempSync(join(tmpdir(), "witness07-throws-"))
  try {
    writeFileSync(join(dir, "package.json"), "{\"type\":\"module\"}")
    mkdirSync(join(dir, "node_modules/witness-pkg"), { recursive: true })
    symlinkSync(join(process.env.EFFECT_NODE_MODULES, "effect"), join(dir, "node_modules/effect"))
    symlinkSync(process.env.VIBELANG_RUNTIME, join(dir, "node_modules/vibelang-runtime"))
    writeFileSync(join(dir, "node_modules/witness-pkg/package.json"), JSON.stringify({ name: "witness-pkg", type: "module", exports: { types: "./main.d.ts", default: "./main.js" } }))
    writeFileSync(join(dir, "node_modules/witness-pkg/main.d.ts"), text)
    cpSync(new URL("./out/main.js", import.meta.url), join(dir, "node_modules/witness-pkg/main.js"))
    writeFileSync(join(dir, "consumer.vibe"), "import { add } from \"witness-pkg\"\nexport effect function main() { return add(1, 2) }\n")
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "es2022", module: "nodenext", strict: true, types: [], skipLibCheck: true, noEmit: true }, files: ["consumer.vibe"] }))
    const r = spawnSync(process.env.VIBELANG_BINARY, ["-p", ".", "--pretty", "false"], { cwd: dir, encoding: "utf8", timeout: 60000 })
    return { status: r.status, codes: [...(r.stdout + r.stderr).matchAll(/error ((?:TS|EK)\d+):/g)].map(m => m[1]), text: r.stdout + r.stderr }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
const tagged = consume(declaration)
assert.equal(tagged.status, 0, tagged.text)
const untagged = consume(declaration.replace(/\n \* @throws \{never\}\n/, "\n"))
assert.deepEqual(untagged.codes, ["EK0403"], untagged.text)
console.log("consumers see never for the generated tag and unknown without it")
