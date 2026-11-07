import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const binary = process.env.VIBELANG_BINARY ?? join(root, "packages/compiler/native/vibelang")
const fc = createRequire(new URL("../package.json", import.meta.url))(process.env.VIBELANG_FAST_CHECK ?? "fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-solution-lint.json", import.meta.url), "utf8"))

// VIP-38: "`vibelang lint` accepts compiler options and files only, never an
// Oxlint config or lint-specific flags", and "compiler builds, the language
// server and `vibelang lint` use the same activation and selection". Over
// generated solution graphs, lint therefore selects exactly the files the
// compiler checks for the same arguments, reports the same diagnostics, exits 1
// where the compiler fails, and writes nothing. A referenced leaf project is
// linted by selecting it, with one error per seeded file.
function check({ depth, rootConfig, leafConfig, directory, count, mode, explicitFiles, jsonc }) {
  const cwd = mkdtempSync(join(tmpdir(), "lint-references-"))
  const write = (file, text) => { const path = join(cwd, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) }
  try {
    const files = Array.from({ length: count }, (_, i) => directory + "/src/input_" + i + ".vibe")
    for (const file of files) write(file, "export const value: string = 42\n")
    const leaf = directory + "/" + leafConfig
    write(leaf, JSON.stringify({
      compilerOptions: { types: [], noEmit: true, skipLibCheck: true },
      ...(explicitFiles ? { files: files.map(f => f.slice(directory.length + 1)) } : { include: ["src/**/*.vibe"] })
    }))
    let reference = leaf
    for (let i = 0; i < depth; i++) {
      const config = "level_" + i + ".json"
      write(config, JSON.stringify({ files: [], references: [{ path: "./" + reference }] }))
      reference = config
    }
    const solution = { files: [], references: [{ path: "./" + reference }] }
    write(rootConfig, jsonc ? '{\n// solution\n"files" :\n[],\n"references": ' + JSON.stringify(solution.references) + ",\n}\n" : JSON.stringify(solution))
    const run = (args) => {
      const result = spawnSync(resolve(binary), [...args, "--pretty", "false"], { cwd, encoding: "utf8", timeout: 90000 })
      assert.ifError(result.error)
      for (const file of files) assert.equal(existsSync(join(cwd, file.replace(/\.vibe$/, ".js"))), false, args.join(" ") + " wrote " + file)
      return { status: result.status, output: result.stdout + result.stderr }
    }
    const selection = mode === "file" ? ["-p", rootConfig] : mode === "directory" ? ["-p", "."] : []
    const compiler = run(["--noEmit", ...selection])
    const lint = run(["lint", ...selection])
    const context = JSON.stringify({ selection, compiler, lint })
    assert.equal(lint.output, compiler.output, context)
    assert.equal(lint.status, compiler.status === 0 ? 0 : 1, context)
    assert.doesNotMatch(lint.output, /TS5023/, context)
    const selected = run(["lint", "-p", leaf])
    assert.equal(selected.status, 1, selected.output)
    assert.equal(selected.output.match(/error TS2322:/g)?.length, count, selected.output)
    for (const file of files) assert.ok(selected.output.includes(file.slice(directory.length + 1).split("/").pop()), file + "\n" + selected.output)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
}

test("lint selects solution-referenced native files as the compiler does", { skip: !existsSync(binary) }, () => {
  for (const mode of ["auto", "file", "directory"]) check({ ...corpus, mode })
})

test("lint project discovery follows generated reference graphs and config spellings", { skip: !existsSync(binary), timeout: 180000 }, () => {
  fc.assert(fc.property(
    fc.record({
      depth: fc.integer({ min: 0, max: 4 }),
      rootConfig: fc.constantFrom("tsconfig.json", "vibe.config.json", "jsconfig.json"),
      leafConfig: fc.constantFrom("tsconfig.node.json", "application.json"),
      directory: fc.constantFrom("runtime", "runtime with spaces", "nested/runtime"),
      count: fc.integer({ min: 1, max: 4 }),
      mode: fc.constantFrom("auto", "file", "directory"),
      explicitFiles: fc.boolean(),
      jsonc: fc.boolean()
    }),
    check
  ), { seed: 561144, numRuns: 64 })
})
