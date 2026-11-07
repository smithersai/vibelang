// A module body's declaration beside its sidecar is an emit output, not an
// input, exactly while its source declares that body.
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { spawnSync } from "node:child_process"

const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "the harness supplies its built compiler")
const root = mkdtempSync(join(tmpdir(), "w02-body-declaration-"))
const withBody = `import { port } from parse
module parse {
  export function port(raw: string): number { return Number(raw) }
}
export const p = port("80")
`
const withoutBody = "export const p = 80\n"
const fresh = "export declare function port(raw: string): number;"
const compile = args => spawnSync(binary, ["-p", "tsconfig.json", "--pretty", "false", ...args], { cwd: root, encoding: "utf8", timeout: 120000 })
const inputs = () => {
  const run = compile(["--listFilesOnly"])
  assert.equal(run.status, 0, run.stdout + run.stderr)
  return run.stdout.split("\n").filter(line => line.startsWith(root)).map(line => relative(root, line)).sort()
}
try {
  mkdirSync(join(root, "src"))
  writeFileSync(join(root, "package.json"), '{"type":"module"}\n')
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "es2022", module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], lib: ["esnext"], skipLibCheck: true, declaration: true },
    include: ["src"]
  }))
  writeFileSync(join(root, "src/main.vibe"), withBody)

  let run = compile([])
  assert.equal(run.status, 0, run.stdout)
  assert.ok(existsSync(join(root, "src/main.d.vibe.ts")), "the sidecar is written beside the source")
  assert.equal(readFileSync(join(root, "src/main.vibe.parse.d.ts"), "utf8").trim(), fresh)
  console.log("first build writes src/main.d.vibe.ts and src/main.vibe.parse.d.ts beside src/main.vibe")

  // Second build: neither output is read back.
  assert.deepEqual(inputs(), ["src/main.vibe"])
  console.log("second build inputs: " + JSON.stringify(inputs()))

  // A stale body declaration yields to its source and is overwritten.
  writeFileSync(join(root, "src/main.vibe.parse.d.ts"), "export declare function port(raw: number): string;\n")
  assert.deepEqual(inputs(), ["src/main.vibe"])
  run = compile([])
  assert.equal(run.status, 0, run.stdout)
  assert.equal(readFileSync(join(root, "src/main.vibe.parse.d.ts"), "utf8").trim(), fresh)
  console.log("stale src/main.vibe.parse.d.ts is left out and rewritten from its source")

  // Neighbour: a declaration for a body the source does not declare is an input.
  writeFileSync(join(root, "src/main.vibe.other.d.ts"), "export declare const other: number;\n")
  assert.deepEqual(inputs(), ["src/main.vibe", "src/main.vibe.other.d.ts"])
  console.log("src/main.vibe.other.d.ts, with no module other, is an input")

  // Once the source stops declaring parse, its old declaration is an input too.
  writeFileSync(join(root, "src/main.vibe"), withoutBody)
  assert.deepEqual(inputs(), ["src/main.vibe", "src/main.vibe.other.d.ts", "src/main.vibe.parse.d.ts"])
  console.log("without module parse, src/main.vibe.parse.d.ts is an input")
} finally {
  rmSync(root, { recursive: true, force: true })
}
