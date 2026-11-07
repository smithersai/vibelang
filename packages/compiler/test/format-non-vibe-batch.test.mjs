import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import fc from "fast-check"
import { formatSource } from "../format.mjs"

const cli = fileURLToPath(new URL("../bin/vibelang-format", import.meta.url))
const kinds = ["vibex", "ts", "tsx", "mts", "cts"]
function project() {
  const root = mkdtempSync(join(tmpdir(), "vibe-format-kinds-"))
  mkdirSync(join(root, ".git"))
  const log = join(root, "starts.jsonl"), hook = join(root, "trace.mjs")
  writeFileSync(hook, `import cp from "node:child_process"; import {appendFileSync} from "node:fs"; import {syncBuiltinESMExports} from "node:module";
const original = cp.spawnSync;
cp.spawnSync = (command, args, options) => {
  if (command === process.execPath && (args[0]?.endsWith("/dprint/bin.cjs") || args.includes("--input-type=module")))
    appendFileSync(${JSON.stringify(log)}, JSON.stringify(args.includes("--stdin") ? "single" : args.includes("output-file-paths") ? "discover" : "batch") + "\\n");
  return original(command, args, options);
}; syncBuiltinESMExports();`)
  const calls = () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : []
  return { root, calls, put(name, text) { const file = join(root, name); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); return file },
    run(...args) { return spawnSync(process.execPath, ["--import", hook, cli, ...args], { cwd: root, encoding: "utf8", env: { ...process.env, VIBELANG_CACHE_DIR: join(root, "cache"), VIBELANG_DISABLE_CACHE: "0" } }) },
    cleanup() { rmSync(root, { recursive: true, force: true }) } }
}
const text = (kind, value, dirty = false) => (kind === "vibex" ? "" : "// @vibe\n") +
  (kind === "vibex" || kind === "tsx" ? `export const view = <div>{${value}}</div>\n` : `export const value = ${value}\n`).replace("const ", dirty ? "const   " : "const ")

for (const kind of kinds) test(`${kind} files batch their cold check and start no backend once clean`, () => {
  const p = project()
  try {
    for (let i = 0; i < 12; i++) p.put(`src/m${i}.${kind}`, text(kind, i))
    const cold = p.run("--check")
    assert.equal(cold.status, 0, cold.stderr)
    const before = p.calls()
    assert.ok(before.includes("batch"), JSON.stringify(before))
    assert.ok(!before.includes("single"), JSON.stringify(before))
    const warm = p.run("--check")
    assert.equal(warm.status, 0, warm.stderr)
    assert.deepEqual(p.calls(), before, "a clean check must start no backend")
  } finally { p.cleanup() }
})

test("mixed source-kind mutations match formatting each original buffer and remain cached", () => {
  fc.assert(fc.property(fc.array(fc.record({ kind: fc.constantFrom(...kinds), value: fc.integer({ min: -1000, max: 1000 }) }), { minLength: 2, maxLength: 8 }), entries => {
    const p = project()
    try {
      const files = entries.map(({ kind, value }, i) => { const input = text(kind, value, true); const file = p.put(`m${i}.${kind}`, input); return { file, expected: formatSource(input, file) } })
      const written = p.run("--write")
      assert.equal(written.status, 0, written.stderr)
      for (const { file, expected } of files) assert.equal(readFileSync(file, "utf8"), expected)
      assert.equal(p.run("--check").status, 0)
      const before = p.calls()
      assert.equal(p.run("--check").status, 0)
      assert.deepEqual(p.calls(), before)
    } finally { p.cleanup() }
  }), { numRuns: 24 })
})

test("a batched JSX syntax error names the original file and never becomes cached", () => {
  const p = project()
  try {
    const invalid = "export const view = <div>\n", file = p.put("broken.vibex", invalid)
    p.put("valid.tsx", text("tsx", 1))
    for (let i = 0; i < 2; i++) {
      const checked = p.run("--check")
      assert.equal(checked.status, 2, checked.stderr)
      assert.match(checked.stderr, /broken\.vibex/)
      assert.match(checked.stderr, /JSX|closing tag/)
      assert.equal(readFileSync(file, "utf8"), invalid)
    }
  } finally { p.cleanup() }
})
