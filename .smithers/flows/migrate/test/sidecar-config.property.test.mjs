import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { addSidecarDir, sidecarDirectory } from "../lib/enumerations.mjs"
import { removeSupersededSidecars, sidecarSettings } from "../lib/sidecar-config.mjs"
import { rewriteExports } from "../lib/codemod.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-sidecar-setup-cleanup.json", import.meta.url), "utf8"))
const put = (root, file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
const compiler = (root, args) => spawnSync(native, args, { cwd: root, encoding: "utf8" })
const pathValue = fc.constantFrom("../types", "types", "", "${configDir}/types", "./decl/out")

test("property: setup roots and package types agree with the native effective sidecar config", { timeout: 600000 }, () => {
  // VIP-27 directory amendment; detail 271 requires declaring-file path
  // inheritance, selected-project configDir, and present-child precedence.
  fc.assert(fc.property(fc.record({
    left: pathValue, right: pathValue, own: fc.option(pathValue, { nil: undefined }),
    config: fc.constantFrom("tsconfig.json", "vibe.config.json")
  }), input => {
    const root = mkdtempSync(join(tmpdir(), "sidecar-effective-config-property-"))
    try {
      put(root, "lib/package.json", '{"name":"fixture","type":"module","types":"./src/x.ts"}')
      put(root, "lib/src/x.vibe", "export type X = number\n")
      put(root, "lib/config/left.json", JSON.stringify({ vibe: { sidecarDir: input.left } }))
      put(root, "lib/config/right.json", JSON.stringify({ vibe: { sidecarDir: input.right } }))
      const config = join(root, "lib", input.config)
      const before = JSON.stringify({ extends: ["./config/left.json", "./config/right.json"], compilerOptions: { noEmit: true, rootDirs: ["src"] }, include: ["src"], ...(input.own === undefined ? {} : { vibe: { sidecarDir: input.own } }) })
      writeFileSync(config, before)
      const shown = compiler(root, ["-p", config, "--showConfig"])
      assert.equal(shown.status, 0, shown.stdout + shown.stderr)
      const directory = resolve(root, "lib", JSON.parse(shown.stdout).vibe.sidecarDir)
      assert.equal(sidecarSettings(config, ts).directory, directory)
      const after = addSidecarDir(before, ts, sidecarDirectory, config)
      writeFileSync(config, after)
      const parsed = ts.parseConfigFileTextToJson(config, after).config
      const wanted = relative(join(root, "lib"), directory).replaceAll("\\", "/") || "."
      assert.deepEqual(parsed.compilerOptions.rootDirs, [...new Set(["src", ".", wanted])])
      const again = compiler(root, ["-p", config, "--showConfig"])
      assert.equal(again.status, 0, again.stdout + again.stderr)
      assert.equal(resolve(root, "lib", JSON.parse(again.stdout).vibe.sidecarDir), directory, "setup changed the effective option")
      rewriteExports(root, [{ from: "lib/src/x.ts", to: "lib/src/x.vibe" }])
      const target = JSON.parse(readFileSync(join(root, "lib/package.json"), "utf8")).types
      assert.equal(resolve(root, "lib", target), join(directory, "src/x.d.vibe.ts"))
      assert.equal(addSidecarDir(after, ts, sidecarDirectory, config), after)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }), { seed: 271268, numRuns: Number(process.env.FC_RUNS || 20) })
})

test("property: setup cleanup matches native mode-switch cleanup and protects selected outputs", { timeout: 600000 }, () => {
  fc.assert(fc.property(fc.record({
    output: fc.constantFrom(".vibe/declarations", "src", "types", "gen/out", ""),
    module: fc.constantFrom("x", "x.y", "Ω"),
    reverse: fc.boolean()
  }), input => {
    const root = mkdtempSync(join(tmpdir(), "sidecar-cleanup-property-"))
    try {
      const sources = [input.module + ".vibe", "src/" + input.module + ".vibe"]
      const files = {
        "package.json": '{"type":"module"}',
        "tsconfig.json": JSON.stringify({ compilerOptions: { noEmit: true }, files: input.reverse ? [...sources].reverse() : sources, vibe: { sidecarDir: input.output } }),
        [sources[0]]: "export type A = string\n",
        [sources[1]]: "export type B = number\n",
        "orphan.d.vibe.ts": "export declare const orphan: 1;\n"
      }
      for (const source of sources) files[source.replace(/\.vibe$/, ".d.vibe.ts")] = "export type Stale = never;\n"
      for (const [file, text] of Object.entries(files)) for (const copy of ["setup", "native"]) put(join(root, copy), file, text)
      const before = compiler(join(root, "native"), ["-p", "tsconfig.json", "--pretty", "false"])
      assert.equal(before.status, 0, before.stdout + before.stderr)
      const removed = removeSupersededSidecars(join(root, "setup"), Object.keys(files), ["tsconfig.json"], ts)
      for (const source of sources) {
        const stale = source.replace(/\.vibe$/, ".d.vibe.ts")
        assert.equal(existsSync(join(root, "setup", stale)), existsSync(join(root, "native", stale)), stale)
      }
      assert.equal(readFileSync(join(root, "setup/orphan.d.vibe.ts"), "utf8"), files["orphan.d.vibe.ts"])
      assert.deepEqual(removeSupersededSidecars(join(root, "setup"), Object.keys(files), ["tsconfig.json"], ts), [])
      assert.equal(new Set(removed).size, removed.length)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }), { examples: [[corpus.input]], seed: 268507, numRuns: Number(process.env.FC_RUNS || 30) })
})
