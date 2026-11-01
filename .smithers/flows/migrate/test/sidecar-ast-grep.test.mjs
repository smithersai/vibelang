// Detail 268's opencode-34 addendum: the fixed .d.<ext>.ts name is required
// by stock TypeScript, so moving declarations must also stop tool double scans.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { makeConfig, wireTarget } from "../lib/steps.mjs"
import { must } from "../lib/util.mjs"
import { withoutSidecarIgnore } from "../lib/tooling.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const runtime = join(repo, "packages/runtime")
const native = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const tools = process.env.VIBELANG_TOOLING_NODE_MODULES
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-sidecar-ast-grep.json", import.meta.url), "utf8"))

test("ast-grep/lint scans the same concrete modules once after setup relocates sidecars", { skip: !tools && "set VIBELANG_TOOLING_NODE_MODULES", timeout: 600000 }, async t => {
  const parserRoot = realpathSync(mkdtempSync(join(tmpdir(), "sidecar-ast-parser-")))
  t.after(() => rmSync(parserRoot, { recursive: true, force: true }))
  const parser = join(parserRoot, "vibelang-parser")
  const built = spawnSync(process.execPath, [join(repo, "packages/compiler/bin/vibelang-ast-grep"), parser], { encoding: "utf8" })
  assert.equal(built.status, 0, built.stdout + built.stderr)
  const cli = join(tools, ".bin/ast-grep")
  const help = spawnSync(cli, ["scan", "--help"], { encoding: "utf8" })
  const custom = help.stdout?.includes("--custom-languages") ? ["--custom-languages", "allow"] : []
  await fc.assert(fc.asyncProperty(fc.constantFrom("src", "deep/src", "lib"), fc.constantFrom("item", "payload", "Ω"), fc.boolean(), async (directory, name, quoted) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "sidecar-ast-grep-")))
    const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
    try {
      put("package.json", '{"name":"fixture","type":"module","private":true}')
      put("tsconfig.json", JSON.stringify({ compilerOptions: { noEmit: true, types: [] }, include: [directory] }))
      put(directory + "/" + name + ".vibe", "export type Payload = string\n")
      put(directory + "/plain.ts", "export type Plain = number\n")
      const files = quoted ? '"' + directory + '/**/*.ts"' : directory + "/**/*.ts"
      const original = "id: inspect-alias\nlanguage: TypeScript\nfiles:\n  - " + files + "\nseverity: error\nmessage: inspect alias\nrule:\n  kind: type_alias_declaration\n"
      put("rules/aliases.yml", original)
      put("rules/aliases.vibelang.yml", original.replace("inspect-alias", "inspect-alias-vibelang").replace("language: TypeScript", "language: VibeLang").replaceAll("*.ts", "*.vibe"))
      put("sgconfig.yml", "ruleDirs:\n  - rules\ncustomLanguages:\n  VibeLang:\n    libraryPath: " + parser + "\n    languageSymbol: tree_sitter_vibe\n    extensions: [vibe]\n    expandoChar: µ\n")
      mkdirSync(join(root, "node_modules"))
      symlinkSync(join(runtime, "node_modules/typescript"), join(root, "node_modules/typescript"))
      symlinkSync(join(repo, "packages/compiler"), join(root, "node_modules/vibelang"))
      const scan = () => {
        const run = spawnSync(cli, ["scan", ...custom, "--config", "sgconfig.yml", "--json=compact", "."], { cwd: root, encoding: "utf8" })
        assert.ok(run.status === 0 || run.status === 1, run.stdout + run.stderr)
        return JSON.parse(run.stdout).map(finding => finding.file.replaceAll("\\", "/")).sort()
      }
      const expected = [directory + "/" + name + ".vibe", directory + "/plain.ts"].sort()
      assert.deepEqual(scan(), expected, "baseline must inspect the original implementations")
      const compile = () => {
        const run = spawnSync(native, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: root, encoding: "utf8" })
        assert.equal(run.status, 0, run.stdout + run.stderr)
      }
      compile()
      assert.deepEqual(scan(), [...expected, directory + "/" + name + ".d.vibe.ts"].sort(), "adjacent declarations reproduce the extra lint finding")
      await must("jj git init", { cwd: root })
      const config = makeConfig({ target: root, packages: ["."], test: "true", vibelangVersion: "0.0.11", install: "true" })
      const wired = await wireTarget(config, join(root, ".logs"))
      assert.ok(wired.sidecarDir?.findings.some(finding => finding.tool === "ast-grep"), "the actual setup step must record the tool selector")
      // Do not let an independent rule ignore hide the defect in this fixture.
      put("rules/aliases.yml", withoutSidecarIgnore(readFileSync(join(root, "rules/aliases.yml"), "utf8")))
      compile()
      assert.deepEqual(scan(), expected, "directory mode alone preserves the concrete source findings")
    } finally { rmSync(root, { recursive: true, force: true }) }
  }), { examples: [[corpus.input.directory, corpus.input.name, corpus.input.quoted]], seed: 340268, numRuns: Number(process.env.FC_AST_RUNS || 6) })
})
