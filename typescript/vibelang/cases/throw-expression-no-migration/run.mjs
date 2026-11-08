// run-seconds: 120
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Effect } from "effect"
const here = path.dirname(fileURLToPath(import.meta.url))
const compiler = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const root = path.join(here, ".cache", "throw-no-migration-" + process.pid)
fs.mkdirSync(root, { recursive: true })
const source = fs.readFileSync(path.join(here, "main.vibe"), "utf8")
const expected = ["coalesce", "compound", "argument", "element", "conditional", 7]
const run = (args, cwd) => {
  const r = spawnSync(compiler, args, { cwd, encoding: "utf8", timeout: 30000 })
  assert.equal(r.error, undefined, r.error?.message)
  return { status: r.status, text: (r.stdout ?? "") + (r.stderr ?? "") }
}
const observe = async (dir, out) => {
  const m = await import(pathToFileURL(path.join(dir, out, "main.js")).href)
  return Effect.runPromise(m.main())
}
try {
  for (const flags of [[], ["--fix-migration-only"], ["--fix-vip-only"]]) {
    const dir = path.join(root, flags.join("").replaceAll("-", "") || "fix")
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, "package.json"), "{\"type\":\"module\"}\n")
    fs.writeFileSync(path.join(dir, "main.vibe"), source)
    const config = { compilerOptions: { target: "es2022", module: "nodenext", strict: true, skipLibCheck: true, types: [], outDir: "before" }, include: ["main.vibe"] }
    fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify(config))
    const before = run(["-p", dir, "--pretty", "false"], dir)
    assert.equal(before.status, 0, before.text)
    assert.doesNotMatch(before.text, /(?:EK|TS)\d+/, before.text)
    assert.deepEqual(await observe(dir, "before"), expected)
    config.compilerOptions.outDir = "after"
    fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify(config))
    const fixed = run(["-p", dir, "--pretty", "false", "--fix", ...flags], dir)
    assert.equal(fixed.status, 0, flags.join(" ") + "\n" + fixed.text)
    assert.doesNotMatch(fixed.text, /(?:EK|TS)\d+/, fixed.text)
    assert.equal(fs.readFileSync(path.join(dir, "main.vibe"), "utf8"), source, "--fix " + flags.join(" ") + " rewrote a throw expression")
    assert.deepEqual(await observe(dir, "after"), expected)
    assert.equal(fs.readFileSync(path.join(dir, "after", "main.js"), "utf8"), fs.readFileSync(path.join(dir, "before", "main.js"), "utf8"))
  }
} finally { fs.rmSync(root, { recursive: true, force: true }) }
console.log("throw expressions need no migration under --fix, --fix-migration-only and --fix-vip-only")
