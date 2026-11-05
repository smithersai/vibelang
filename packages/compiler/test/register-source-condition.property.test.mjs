import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
const fc = createRequire(new URL("../../runtime/package.json", import.meta.url))("fast-check")

const register = fileURLToPath(new URL("../register.mjs", import.meta.url))
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-unbuilt-node-export.json", import.meta.url)))
function witness({ name = "leaf", consumer = "import", mode = "exact", condition = "node", built = false }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "native-condition-")))
  const write = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text) }
  try {
    const encoded = encodeURIComponent(name)
    const source = "./src/" + (mode === "pattern" ? "*" : encoded) + ".ts"
    const emitted = "./.vibelang/js/src/" + (mode === "pattern" ? "*" : encoded) + ".js"
    const target = { [condition]: { "vibelang-source": source, default: emitted }, default: "./wrong.mjs" }
    const key = mode === "pattern" ? "./*" : "./leaf"
    write("pkg/package.json", JSON.stringify({ name: "@probe/native", type: "module", exports: { [key]: target }, imports: { "#leaf": target } }))
    write("pkg/src/" + name + ".ts", 'export const token: object = {}; export const value: string = "source"\n')
    if (built) write("pkg/.vibelang/js/src/" + name + ".js", 'export const token = {}; export const value = "stale"\n')
    write("pkg/wrong.mjs", 'throw new Error("existing condition was lost")\n')
    mkdirSync(join(root, "node_modules/@probe"), { recursive: true })
    symlinkSync(join(root, "pkg"), join(root, "node_modules/@probe/native"))
    const specifier = mode === "imports" ? "#leaf" : "@probe/native/" + (mode === "pattern" ? encoded : "leaf")
    const entry = mode === "imports" || mode === "self" ? "pkg/entry" : "entry"
    const suffix = consumer === "import" ? ".mjs" : ".cjs"
    const load = consumer === "import" ? "await import" : consumer === "require" ? "require" : 'require("node:module").createRequire(__filename)'
    const directName = consumer === "import" ? encoded : name
    const direct = mode === "imports" || mode === "self" ? "./src/" + directName + ".ts" : "./pkg/src/" + directName + ".ts"
    write(entry + suffix, `const left = ${load}(${JSON.stringify(specifier)}); const right = ${load}(${JSON.stringify(direct)}); console.log(JSON.stringify({value:left.value,same:left.token===right.token}))\n`)
    const result = spawnSync(process.execPath, ["--conditions=custom-tool", "--import", register, entry + suffix], { cwd: root, encoding: "utf8", timeout: 10000 })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), { value: "source", same: true })
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("an unbuilt migrated package resolves its source export in Node", () => witness(corpus.case))
test("source exports preserve Node conditions, aliases and identity", () => {
  // Node's resolve hook may extend conditions, but must retain the supplied set
  // (node:module, Synchronous resolve). Native TypeScript is the runtime oracle.
  fc.assert(fc.property(fc.record({
    name: fc.constantFrom("leaf", "space name", "hash#name", "percent%name", "é"),
    consumer: fc.constantFrom("import", "require", "createRequire"),
    mode: fc.constantFrom("exact", "pattern", "imports", "self"),
    condition: fc.constantFrom("node", "custom-tool"), built: fc.boolean()
  }), witness), { seed: 511051, numRuns: 48 })
})
