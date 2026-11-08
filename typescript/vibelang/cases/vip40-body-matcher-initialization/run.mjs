// run-seconds: 120
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const out = new URL("./out/", import.meta.url)
const host = typeof Symbol.customMatcher
// The emitted file requests the runtime before the body it imports first.
const lines = readFileSync(new URL("main.js", out), "utf8").split("\n").filter((line) => /^import\b/.test(line))
const runtime = lines.findIndex((line) => line.includes("\"vibelang-runtime"))
const body = lines.findIndex((line) => line.includes("\"./main.vibe.parse.js\""))
assert.ok(runtime >= 0 && body > runtime, lines.join("\n"))
// The body emits no initialization of its own.
assert.doesNotMatch(readFileSync(new URL("main.vibe.parse.js", out), "utf8"), /vibelang-runtime/)

// Each observation runs in a fresh process so the key starts as the host left it.
const observe = (specifier, name) => {
  const r = spawnSync(process.execPath, ["--preserve-symlinks", "--input-type=module", "-e",
    `const m = await import(${JSON.stringify(specifier)}); console.log(m.${name})`], { encoding: "utf8" })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout.trim()
}
const parent = observe(new URL("main.js", out).href, "observed")
const alone = observe(new URL("main.vibe.parse.js", out).href, "seen")
// A host with a native key keeps it; otherwise only the runtime defines it.
console.log(JSON.stringify({ parent, aloneSeesHostKey: alone === host }))
