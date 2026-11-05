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

function check({ depth, rootConfig, leafConfig, directory, count, mode, explicitFiles, jsonc }) {
  const cwd = mkdtempSync(join(tmpdir(), "lint-references-"))
  const write = (file, text) => { const path = join(cwd, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) }
  try {
    write(".oxlintrc.json", "{}")
    const files = Array.from({ length: count }, (_, i) => directory + "/src/input_" + i + ".vibe")
    for (const file of files) write(file, "export const value = 42\n")
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
    const args = ["lint", "-c", ".oxlintrc.json"]
    if (mode === "file") args.push("-p", rootConfig)
    if (mode === "directory") args.push("-p", ".")
    const result = spawnSync(resolve(binary), args, { cwd, encoding: "utf8", timeout: 90000 })
    const output = result.stdout + result.stderr
    assert.equal(result.status, 0, output)
    assert.match(output, new RegExp("in " + count + " \\.vibe file\\(s\\)\\."), output)
    assert.doesNotMatch(output, /not linted/)
    for (const file of files) assert.equal(existsSync(join(cwd, file.replace(/\.vibe$/, ".js"))), false)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
}

test("solution-referenced native files are linted through configured projects", { skip: !existsSync(binary) }, () => {
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
