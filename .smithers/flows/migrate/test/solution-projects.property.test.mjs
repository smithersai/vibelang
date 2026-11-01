import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { projectsOf, addVibeIncludes } from "../lib/wire.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")
const compiler = fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const contract = readFileSync(new URL("../README.md", import.meta.url), "utf8")
const corpus = JSON.parse(readFileSync(new URL("corpus/alchemy-solution-project-coverage.json", import.meta.url), "utf8"))

function check(input) {
  const root = mkdtempSync(join(tmpdir(), "migrate-solution-"))
  const put = (name, text) => {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), text)
  }
  const compile = (project) => {
    const r = spawnSync(compiler, ["-p", project, "--noEmit", "--pretty", "false"], {
      cwd: root, encoding: "utf8", timeout: 120000, env: { ...process.env, GOMAXPROCS: "2" }
    })
    assert.equal(r.error, undefined, "the real compiler must run")
    assert.equal(r.signal, null, "the real compiler must finish")
    return { status: r.status, output: r.stdout + r.stderr }
  }
  try {
    put("package.json", '{"type":"module"}\n')
    const expected = [], references = []
    for (let i = 0; i < input.leaves.length; i++) {
      const leaf = input.leaves[i], dir = "p" + i + "/" + leaf.name
      const config = dir + "/tsconfig.json"
      expected.push(config)
      references.push({ path: "./" + (leaf.directory ? dir : config) })
      put(config, JSON.stringify({
        compilerOptions: { target: "ES2022", types: [], strict: leaf.strict, skipLibCheck: true },
        include: ["src/**/*.ts"]
      }))
      put(dir + "/src/value.ts", 'export const value: number = "must be checked";\n')
    }
    if (input.reverse) references.reverse()
    const solution = JSON.stringify({ files: [], references }, null, input.pretty ? 2 : undefined)
    put("tsconfig.json", (input.comments ? "// solution configuration\n" : "") + solution)
    put("unused/tsconfig.json", '{"include":["src/**/*.ts"]}')
    put("unused/src/value.vibe", 'export const unrelated: number = "unreferenced";\n')
    const selected = projectsOf(ts, root, "tsconfig.json")
    assert.deepEqual([...selected].sort(), expected.sort(), "check every referenced project, with no unrelated one")
    for (const config of selected) {
      const before = compile(config)
      assert.notEqual(before.status, 0)
      assert.match(before.output, /TS2322/, "native TypeScript control must find the witness")
      const dir = dirname(config)
      put(config, addVibeIncludes(readFileSync(join(root, config), "utf8"), ts))
      const source = join(root, dir, "src/value.ts"), original = readFileSync(source, "utf8")
      rmSync(source)
      put(dir + "/src/value.vibe", original)
      const after = compile(config)
      assert.notEqual(after.status, 0, "migration cannot pass by checking zero files")
      assert.match(after.output, /TS2322/, "the real renamed implementation remains checked")
      const wired = readFileSync(join(root, config), "utf8")
      assert.equal(addVibeIncludes(wired, ts), wired, "wiring is idempotent")
    }
    assert.equal(compile("tsconfig.json").status, 0, "control: a solution alone checks no implementation")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("the solution coverage oracle retains the flow's project contract", () => {
  assert.ok(contract.includes("setup wires each of them, and every check,"), "update the quoted flow contract")
})
test("alchemy-53: both referenced implementations stay checked after a rename", () => check(corpus.input))
test("solution wiring retains errors across directory/file references", () => {
  fc.assert(fc.property(fc.record({
    leaves: fc.array(fc.record({
      name: fc.constantFrom("runtime", "node", "browser-app"),
      directory: fc.boolean(), strict: fc.boolean()
    }), { minLength: 1, maxLength: 3 }),
    reverse: fc.boolean(), pretty: fc.boolean(), comments: fc.boolean()
  }), check), { seed: 531101, numRuns: 16 })
})
