import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { test } from "node:test"
import { wireDeveloperTools } from "../lib/tooling.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")
const specsFor = () => ({ vibelang: "0.0.11", "@smithersai/oxc-vibelang-hooks": "file:hooks.tgz" })
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-oxlint-changed.json", import.meta.url), "utf8"))
function fixture(t, entries) {
  const root = mkdtempSync(join(tmpdir(), "migrate-oxlint-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [file, text] of Object.entries(entries)) {
    mkdirSync(join(root, file, ".."), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  return root
}
test("opencode-8: setup routes an extension-filtered Oxlint runner through ESLint without a fork", t => {
  const root = fixture(t, {
    "package.json": JSON.stringify({ scripts: { "lint:changed": "bun script/lint-changed.ts" }, devDependencies: { oxlint: "1.60.0" } }),
    "script/lint-changed.ts": corpus.source,
    ".oxlintrc.json": JSON.stringify({ overrides: [{ files: ["packages/gui/**/*.ts", "**/*.json"], rules: { "house/rule": "warn" } }] }),
    "unrelated.ts": 'const files = names.filter(file => /\\.(ts|tsx)$/.test(file))\n'
  })
  const result = wireDeveloperTools({ root, specsFor, ts })
  const read = name => readFileSync(join(root, name), "utf8")
  const pkg = JSON.parse(read("package.json"))
  assert.equal(pkg.devDependencies.oxlint, "1.60.0")
  assert.equal(pkg.devDependencies["@smithersai/oxc-vibelang-hooks"], undefined)
  assert.ok(pkg.devDependencies.eslint)
  assert.match(read(".vibelang/oxlint.mjs"), /eslint\.lintFiles/)
  assert.equal(pkg.scripts["lint:changed"], "bun script/lint-changed.ts")
  assert.ok(result.changed.includes("script/lint-changed.ts"))
  const source = read("script/lint-changed.ts")
  assert.match(source, /ts\|tsx\|vibe/)
  assert.match(source, /\.d\.vibe\.ts/)
  assert.ok(source.includes("packages/gui-plugins/"))
  assert.ok(source.includes("./.vibelang/oxlint.mjs --format json"))
  assert.deepEqual(JSON.parse(read(".oxlintrc.json")).overrides[0].files, ["packages/gui/**/*.ts", "**/*.json"])
  assert.equal(read("unrelated.ts"), 'const files = names.filter(file => /\\.(ts|tsx)$/.test(file))\n')
  assert.deepEqual(wireDeveloperTools({ root, specsFor, ts }).changed, [])
})
test("plain oxlint src and nested runners keep the upstream dependency", t => {
  const root = fixture(t, {
    "package.json": JSON.stringify({ workspaces: ["packages/*"], scripts: { lint: "oxlint src", glob: 'oxlint "src/**/*.{ts,tsx}"' } }),
    "packages/a/package.json": JSON.stringify({ scripts: { lint: "node ./tools/check.mjs" }, dependencies: { oxlint: "1.60.0" } }),
    "packages/a/tools/check.mjs": 'import "./lint.mjs"\n',
    "packages/a/tools/lint.mjs": 'const files = names.filter(f => /\\.tsx?$/.test(f))\nspawnSync("oxlint", files)\n',
    "vendor/package.json": JSON.stringify({ scripts: { lint: "oxlint src" }, devDependencies: { oxlint: "1.60.0" } })
  })
  wireDeveloperTools({ root, specsFor, ts })
  const rootPkg = JSON.parse(readFileSync(join(root, "package.json")))
  const nested = JSON.parse(readFileSync(join(root, "packages/a/package.json")))
  assert.equal(rootPkg.devDependencies.oxlint, undefined)
  assert.ok(rootPkg.scripts.lint.startsWith("(oxlint --no-error-on-unmatched-pattern src)"))
  assert.match(rootPkg.scripts.glob, /\{ts,tsx\}/)
  assert.match(rootPkg.scripts.glob, /eslint.*src\/\*\*\/\*\.vibe/)
  assert.equal(nested.dependencies.oxlint, "1.60.0")
  assert.equal(nested.devDependencies, undefined)
  assert.match(readFileSync(join(root, "packages/a/tools/lint.mjs"), "utf8"), /vibe/)
  assert.equal(JSON.parse(readFileSync(join(root, "vendor/package.json"))).devDependencies.oxlint, "1.60.0")
  assert.deepEqual(wireDeveloperTools({ root, specsFor, ts }).changed, [])
})
test("mentions in comments and unexecuted scripts do not select lint wiring", t => {
  const root = fixture(t, {
    "package.json": JSON.stringify({ scripts: { check: "bun script/check.ts" } }),
    "script/check.ts": '// bunx oxlint --format json\nconst files = names.filter(f => /\\.(ts|tsx)$/.test(f))\n',
    "script/unused.ts": 'spawnSync("oxlint", [])\n'
  })
  wireDeveloperTools({ root, specsFor, ts })
  assert.equal(JSON.parse(readFileSync(join(root, "package.json"))).devDependencies, undefined)
})
// The migration tooling contract is quoted from README, not inferred from the
// implementation: every accepted extension keeps the existing path scope.
test("Oxlint selectors keep TS coverage, include VibeLang and skip declaration sidecars", t => {
  const quote = "setup keeps upstream `oxlint` and includes `.vibe` in extension selectors"
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(quote))
  const root = fixture(t, { "package.json": "{}" })
  const patterns = [String.raw`/\.(ts|tsx)$/`, String.raw`/\.(?:ts|tsx)$/`, String.raw`/\.tsx?$/`]
  fc.assert(fc.property(fc.constantFrom(...patterns, 'file.endsWith(".ts") || file.endsWith(".tsx")', '[".ts", ".tsx"].includes(file.slice(file.lastIndexOf(".")))'), fc.stringMatching(/^[a-z][a-z0-9_-]{0,15}$/), (pattern, name) => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { lint: "bun runner.ts" } }))
    const selector = pattern.startsWith("/") ? pattern + ".test(file)" : pattern
    writeFileSync(join(root, "runner.ts"), "const selected = paths.filter(file => (" + selector + ") && file.startsWith('src/'))\nspawnSync('oxlint', selected)\n")
    const result = wireDeveloperTools({ root, specsFor, ts })
    assert.equal(result.warnings.some(warning => warning.includes("source-extension allowlist")), false, "a rewritten selector must not retain its old allowlist warning")
    const text = readFileSync(join(root, "runner.ts"), "utf8")
    const select = new Function("paths", text.split("spawnSync")[0] + "\nreturn selected")
    assert.deepEqual(select(["src/" + name + ".ts", "src/" + name + ".tsx", "src/" + name + ".vibe", "other/" + name + ".vibe", "src/" + name + ".d.vibe.ts", "src/" + name + ".js"]),
      ["src/" + name + ".ts", "src/" + name + ".tsx", "src/" + name + ".vibe"])
    assert.deepEqual(wireDeveloperTools({ root, specsFor, ts }).changed, [])
  }), { seed: 8311008, numRuns: 150 })
})


test("setup reports unsupported block filters and updates a filter that already excludes sidecars", t => {
  const root = fixture(t, {
    "package.json": JSON.stringify({ scripts: { lint: "bun check.ts" } }),
    "check.ts": 'const files = paths.filter(file => { return /\\.(ts|tsx)$/.test(file) })\nspawnSync("oxlint", files)\n'
  })
  const result = wireDeveloperTools({ root, specsFor, ts })
  assert.match(result.warnings[0], /^check.ts: Oxlint's extension filter/)
  writeFileSync(join(root, "check.ts"), 'const files = paths.filter(file => /\\.(ts|tsx)$/.test(file) && !file.endsWith(".d.vibe.ts"))\nspawnSync("oxlint", files)\n')
  wireDeveloperTools({ root, specsFor, ts })
  const text = readFileSync(join(root, "check.ts"), "utf8")
  assert.match(text, /ts\|tsx\|vibe/)
  assert.deepEqual(wireDeveloperTools({ root, specsFor, ts }).changed, [])
})


// The CLI contract is independent of the lint engines: keep the diagnostic
// shape, selected file set, severities and exit status when two engines run.
import { spawnSync } from "node:child_process"
import { existsSync, symlinkSync } from "node:fs"
function adapterFixture(t) {
  const root = fixture(t, {
    "package.json": JSON.stringify({ type: "module", scripts: { lint: "bun runner.ts" } }),
    "runner.ts": 'spawnSync("oxlint", files)\n',
    ".oxlintrc.json": '{"categories":{"correctness":"off"}}',
    "src/main.vibe": "// café\nexport const value = 1\n",
    "src/plain.ts": "export const plain = 2\n",
    ".native.json": '{"diagnostics":[],"number_of_files":1}',
    ".eslint.json": "[]",
    "node_modules/oxlint/package.json": '{"name":"oxlint","bin":{"oxlint":"bin.cjs"}}',
    "node_modules/oxlint/bin.cjs": 'const fs = require("node:fs"); fs.writeFileSync(".native-args.json", JSON.stringify(process.argv.slice(2))); process.stdout.write(fs.readFileSync(".native.json")); process.exitCode = Number(process.env.NATIVE_EXIT ?? 0)\n',
    "node_modules/vibelang/package.json": '{"name":"vibelang","type":"module","exports":{"./eslint":"./eslint.mjs"}}',
    "node_modules/vibelang/eslint.mjs": "export default { parseForESLint() {} }\n",
    "node_modules/eslint/package.json": '{"name":"eslint","type":"module","exports":{".":"./index.mjs","./use-at-your-own-risk":"./risk.mjs"}}',
    "node_modules/eslint/risk.mjs": 'export const builtinRules = new Map([["no-debugger", {}]])',
    "node_modules/eslint/index.mjs": 'import fs from "node:fs"; export class ESLint { constructor(options) { fs.writeFileSync(".eslint-options.json", JSON.stringify(options)) } async lintFiles(paths) { fs.writeFileSync(".eslint-paths.json", JSON.stringify(paths)); return JSON.parse(fs.readFileSync(".eslint.json")) } async loadFormatter() { return { format: () => "" } } }'
  })
  wireDeveloperTools({ root, specsFor, ts })
  const run = (...args) => {
    const result = spawnSync(process.execPath, [join(root, ".vibelang/oxlint.mjs"), "--format", "json", ...args], { cwd: root, encoding: "utf8" })
    assert.equal(result.stderr, "", result.stdout)
    return { ...result, output: JSON.parse(result.stdout) }
  }
  const warning = { filePath: join(root, "src/main.vibe"), errorCount: 0, warningCount: 1, messages: [{ ruleId: "anti-slop/no-unknown-parameters", message: "Unknown parameter", severity: 1, line: 2, column: 8 }] }
  return { root, run, warning }
}
test("adapter merges TS and VibeLang JSON while preserving warning rules and UTF-8 locations", t => {
  const { root, run, warning } = adapterFixture(t)
  writeFileSync(join(root, ".eslint.json"), JSON.stringify([warning]))
  const tsDiagnostic = { code: "eslint(no-debugger)", severity: "error", filename: "src/plain.ts", labels: [{ span: { line: 1, column: 1 } }] }
  writeFileSync(join(root, ".native.json"), JSON.stringify({ diagnostics: [tsDiagnostic], number_of_files: 1 }))
  const result = run("src/main.vibe", "src/plain.ts", "src/main.d.vibe.ts")
  assert.equal(result.status, 1)
  assert.equal(result.output.number_of_files, 2)
  assert.deepEqual(result.output.diagnostics[0], tsDiagnostic)
  const message = result.output.diagnostics[1]
  assert.equal(message.code, "anti-slop(no-unknown-parameters)")
  assert.equal(message.severity, "warning")
  assert.equal(message.filename, "src/main.vibe")
  assert.deepEqual(message.labels[0].span, { offset: Buffer.byteLength("// café\nexport "), length: 1, line: 2, column: 8 })
  assert.deepEqual(JSON.parse(readFileSync(join(root, ".native-args.json"))), ["--format", "json", "--threads", "8", "src/plain.ts"])
  assert.deepEqual(JSON.parse(readFileSync(join(root, ".eslint-paths.json"))), [join(root, "src/main.vibe")])
})
test("adapter warnings stay warnings and fail only when the caller denies them", t => {
  const { root, run, warning } = adapterFixture(t)
  writeFileSync(join(root, ".eslint.json"), JSON.stringify([warning]))
  assert.equal(run("src/main.vibe").status, 0)
  assert.equal(run("--deny-warnings", "src/main.vibe").status, 1)
  assert.equal(run("--max-warnings=0", "src/main.vibe").status, 1)
  assert.equal(run("--max-warnings", "1", "src/main.vibe").status, 0)
})
test("adapter keeps native failures even when native diagnostics are empty", t => {
  const { root } = adapterFixture(t)
  const result = spawnSync(process.execPath, [join(root, ".vibelang/oxlint.mjs"), "--format", "json", "src/plain.ts"], { cwd: root, encoding: "utf8", env: { ...process.env, NATIVE_EXIT: "2" } })
  assert.equal(result.status, 2, result.stderr)
})
test("adapter maps TypeScript globs for the VibeLang pass without broadening explicit file lists", t => {
  const { root, run } = adapterFixture(t)
  run("src/**/*.tsx")
  assert.deepEqual(JSON.parse(readFileSync(join(root, ".eslint-paths.json"))), [join(root, "src/**/*.vibe")])
  rmSync(join(root, ".eslint-paths.json"))
  run("src/plain.ts")
  assert.equal(existsSync(join(root, ".eslint-paths.json")), false)
  // Explicit TS names never invoke ESLint on neighbouring .vibe files.
  assert.deepEqual(JSON.parse(readFileSync(join(root, ".native-args.json"))).at(-1), "src/plain.ts")
})
test("adapter loads an invocation's explicit config and keeps its warning severity", t => {
  const { root, run } = adapterFixture(t)
  writeFileSync(join(root, "custom.json"), '{"categories":{"correctness":"off"},"rules":{"no-debugger":"warn"}}')
  run("--config", "custom.json", "src/main.vibe")
  const options = JSON.parse(readFileSync(join(root, ".eslint-options.json"), "utf8"))
  assert.deepEqual(options.overrideConfig.find(config => config.languageOptions).rules["no-debugger"], ["warn"])
})

const installed = process.env.VIBELANG_OXLINT_NODE_MODULES
test("installed upstream Oxlint and ESLint run opencode-shaped lists and a plain directory script", { skip: !installed && "set VIBELANG_OXLINT_NODE_MODULES" }, t => {
  const root = fixture(t, {
    "package.json": JSON.stringify({ type: "module", scripts: { "lint:changed": "bun runner.ts", lint: "oxlint --threads 8 src" }, devDependencies: { oxlint: "1.60.0" } }),
    "runner.ts": 'import { $ } from "bun"\nconst files = process.argv.slice(2).filter(file => /\\.(ts|tsx)$/.test(file))\nconst output = JSON.parse(await $\x60bunx oxlint --format json ${files}\x60.nothrow().quiet().text())\nconsole.log(JSON.stringify(output))\nprocess.exit(output.diagnostics.length ? 1 : 0)\n',
    ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, jsPlugins: [{ name: "anti-slop", specifier: "./plugin.mjs" }], rules: { "anti-slop/no-unknown-parameters": "warn" } }),
    "plugin.mjs": 'export default {meta:{name:"anti-slop"},rules:{"no-unknown-parameters":{meta:{schema:[]},create(context){return {TSUnknownKeyword(node){context.report({node,message:"Unknown parameter"})}}}}}}',
    "src/main.vibe": "export const value = 1\n",
    "src/plain.ts": "export const value = 2\n"
  })
  symlinkSync(installed, join(root, "node_modules"))
  wireDeveloperTools({ root, specsFor, ts })
  const run = (...args) => spawnSync("bun", args, { cwd: root, encoding: "utf8", env: { ...process.env, PATH: join(installed, ".bin") + ":" + process.env.PATH } })
  const clean = run("runner.ts", "src/main.vibe", "src/plain.ts")
  assert.equal(clean.status, 0, clean.stdout + clean.stderr)
  writeFileSync(join(root, "src/main.vibe"), "// café\nexport function seeded(value: unknown) { return value }\n")
  const seeded = run("runner.ts", "src/main.vibe", "src/plain.ts")
  assert.equal(seeded.status, 1, seeded.stdout + seeded.stderr)
  const diagnostic = JSON.parse(seeded.stdout).diagnostics.find(d => d.filename.endsWith(".vibe"))
  assert.equal(diagnostic.code, "anti-slop(no-unknown-parameters)")
  assert.equal(diagnostic.severity, "warning")
  assert.equal(diagnostic.labels[0].span.line, 2)
  // Once every source is migrated, the native pass has no TS files left.
  rmSync(join(root, "src/plain.ts"))
  // Plain directory commands still run the same JS plugin on source trees.
  const plain = run("run", "lint")
  assert.equal(plain.status, 0, plain.stdout + plain.stderr)
  assert.match(plain.stdout, /anti-slop\/no-unknown-parameters/)
})

test("directory overrides retain every JS rule and its severity on .vibe files", async t => {
  const root = fixture(t, {
    "package.json": '{"scripts":{"lint":"oxlint"}}',
    ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, rules: { "no-debugger": "warn" }, overrides: [{ files: ["src/**"], rules: { "oxc/no-accumulating-spread": "warn" } }] }),
    "node_modules/vibelang/package.json": '{"name":"vibelang","type":"module","exports":{"./eslint":"./eslint.mjs"}}',
    "node_modules/vibelang/eslint.mjs": "export default { parseForESLint() {} }",
  })
  wireDeveloperTools({ root, specsFor, ts })
  const configs = (await import(join(root, ".vibelang/eslint.config.mjs"))).default
  assert.deepEqual(configs.at(-1).files, [["src/**", "**/*.vibe"]])
  assert.deepEqual(configs.at(-1).rules, { "oxc/no-accumulating-spread": ["warn"] })
  assert.ok(configs.find(config => config.plugins)?.plugins.oxc.rules["no-accumulating-spread"])
})

test("the source-tree accumulating-spread rule agrees with upstream Oxlint across reducers, loops and shadowing", { skip: !installed && "set VIBELANG_OXLINT_NODE_MODULES", timeout: 180000 }, async t => {
  const root = fixture(t, {
    "package.json": '{"type":"module","scripts":{"lint":"oxlint"}}',
    ".oxlintrc.json": '{"categories":{"correctness":"off"},"rules":{"oxc/no-accumulating-spread":"warn"}}',
  })
  symlinkSync(installed, join(root, "node_modules"))
  wireDeveloperTools({ root, specsFor, ts })
  const { ESLint } = await import(join(installed, "eslint/lib/api.js"))
  const { configFor } = await import(join(root, ".vibelang/eslint.config.mjs"))
  const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: await configFor() })
  const native = join(installed, "oxlint/bin/oxlint")
  // Oxlint's documented contract: "Prevents using object or array spreads on
  // accumulators in Array.prototype.reduce() and in loops." The same source
  // printed as TS and VibeLang must report the same rule at the same source line.
  await fc.assert(fc.asyncProperty(
    fc.constantFrom("reduce", "reduceRight"),
    fc.constantFrom("array", "object"),
    fc.constantFrom("reduce", "nested", "item", "one-param", "loop", "inner-loop", "write-first", "shadow"),
    fc.constantFrom("", "// café 🙂\n"),
    async (method, kind, form, comment) => {
      const initial = kind === "array" ? "[]" : "{}"
      const spread = name => kind === "array" ? "[..." + name + ", item]" : "({..." + name + ", value: item})"
      const body = form === "nested" ? "() => " + spread("acc") : spread(form === "item" ? "item" : "acc")
      const source = comment + (
        form === "loop" ? "let acc = " + initial + "; for (const item of values) { acc = " + spread("acc") + "; }" :
        form === "inner-loop" ? "for (const item of values) { let acc = " + initial + "; acc = " + spread("acc") + "; }" :
        form === "write-first" ? "let acc = " + initial + "; acc = " + initial + "; for (const item of values) { acc = " + spread("acc") + "; }" :
        form === "shadow" ? "let acc = " + initial + "; for (const item of values) { let acc = " + initial + "; acc = " + spread("acc") + "; }" :
        "values." + method + "((acc" + (form === "one-param" ? "" : ", item") + ") => " + body + ", " + initial + ")") + "\n"
      writeFileSync(join(root, "main.ts"), source)
      const original = spawnSync(process.execPath, [native, "--threads", "8", "--format", "json", "main.ts"], { cwd: root, encoding: "utf8" })
      assert.equal(original.status, 0, original.stdout + original.stderr)
      const expected = JSON.parse(original.stdout).diagnostics.map(diagnostic => diagnostic.labels[0].span.line).sort()
      const [result] = await eslint.lintText(source, { filePath: join(root, "main.vibe") })
      assert.equal(result.messages.some(message => message.fatal), false, JSON.stringify(result.messages))
      const actual = result.messages.filter(message => message.ruleId === "oxc/no-accumulating-spread").map(message => message.line).sort()
      assert.deepEqual(actual, expected, source)
    }
  ), { seed: 83119001, numRuns: 80 })
})
test("an adapter call with only declaration sidecars does not scan the working directory", t => {
  const { root, run } = adapterFixture(t)
  const result = run("src/main.d.vibe.ts")
  assert.equal(result.status, 0)
  assert.deepEqual(result.output.diagnostics, [])
  assert.equal(existsSync(join(root, ".native-args.json")), false)
  assert.equal(existsSync(join(root, ".eslint-paths.json")), false)
})
test("a file-list runner names enabled native rules it cannot carry instead of silently omitting them", t => {
  const { root } = adapterFixture(t)
  writeFileSync(join(root, ".oxlintrc.json"), '{"categories":{"correctness":"off"},"rules":{"oxc/no-unimplemented-rule":"warn"}}')
  const result = spawnSync(process.execPath, [join(root, ".vibelang/oxlint.mjs"), "src/main.vibe"], { cwd: root, encoding: "utf8" })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Oxlint rules unavailable under ESLint: oxc\/no-unimplemented-rule/)
})

test("generated Oxlint passes refresh their configuration and current warning budget", t => {
  fc.assert(fc.property(
    fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/),
    fc.constantFrom("", "--deny-warnings", "--max-warnings 0", "--max-warnings=0"),
    fc.constantFrom("oxlint", "bunx oxlint"),
    fc.constantFrom("src", "packages/gui"),
    fc.boolean(),
    (name, budget, launcher, scope, multiple) => {
      const config = `.oxlintrc.next-${name}.json`
      const other = `.oxlintrc.other-${name}.json`
      const native = `${launcher} -c ${config} ${budget} ${scope}` + (multiple ? ` && oxlint -c ${other} ${budget ? "" : "--deny-warnings"} tests` : "")
      const script = `(${native}) && eslint --config .vibelang/eslint.previous.config.mjs ${scope} --no-error-on-unmatched-pattern --max-warnings 0`
      const root = fixture(t, {
        "package.json": JSON.stringify({ scripts: { lint: script } }),
        [config]: JSON.stringify({ categories: { correctness: "off" }, rules: { "no-debugger": "warn" } }),
        [other]: JSON.stringify({ categories: { correctness: "off" }, rules: { "no-debugger": "warn" } })
      })
      wireDeveloperTools({ root, specsFor, ts })
      const after = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts.lint
      assert.ok(after.includes(`eslint --config .vibelang/eslint.next-${name}.config.mjs`), "refresh the generated pass from the native configuration")
      assert.equal(after.includes("eslint.previous.config.mjs"), false)
      const passes = after.split(" && eslint ").slice(1)
      assert.equal(passes.length, multiple ? 2 : 1)
      assert.equal(passes[0].includes(" --max-warnings 0"), budget !== "", "use the current native warning policy, without retaining a removed budget")
      if (multiple) assert.equal(passes[1].includes(" --max-warnings 0"), budget === "", "each invocation keeps its own warning budget")
      assert.deepEqual(wireDeveloperTools({ root, specsFor, ts }).changed, [])
    }
  ), { seed: 8311037, numRuns: 90 })
})

import { allowEmptyOxlint } from "../lib/oxlint.mjs"
test("native empty-file handling preserves command flags and is idempotent across launcher forms", () => {
  const quote = "A directory containing only `.vibe` files still runs the ESLint pass."
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(quote))
  fc.assert(fc.property(
    fc.array(fc.record({ launcher: fc.constantFrom("", "bunx ", "npx ", "pnpm exec ", "yarn "), wrapped: fc.boolean(), already: fc.boolean() }), { minLength: 1, maxLength: 4 }),
    entries => {
      const command = entries.map(({ launcher, wrapped, already }) => {
        const text = launcher + "oxlint" + (already ? " --no-error-on-unmatched-pattern" : "") + " --threads 8 --format json src"
        return wrapped ? "(" + text + ")" : text
      }).join(" && ")
      const actual = allowEmptyOxlint(command)
      assert.equal(actual.split("--no-error-on-unmatched-pattern").length - 1, entries.length)
      assert.equal(allowEmptyOxlint(actual), actual)
      const strip = text => text.replaceAll(" --no-error-on-unmatched-pattern", "")
      assert.equal(strip(actual), strip(command))
    }
  ), { seed: 8311009, numRuns: 150 })
})

test("installed Oxlint disable and enable comments keep the same meaning in VibeLang", { skip: !installed && "set VIBELANG_OXLINT_NODE_MODULES", timeout: 180000 }, async t => {
  const root = fixture(t, {
    "package.json": '{"type":"module","scripts":{"lint":"oxlint"}}',
    ".oxlintrc.json": '{"categories":{"correctness":"off"},"jsPlugins":[{"name":"anti-slop","specifier":"./plugin.mjs"}],"rules":{"no-unused-vars":"warn","no-debugger":"warn","typescript/no-explicit-any":"warn","anti-slop/no-unknown-parameters":"warn"}}',
    "plugin.mjs": 'export default {rules:{"no-unknown-parameters":{meta:{schema:[]},create(context){return {TSUnknownKeyword(node){context.report({node,message:"Unknown parameter"})}}}}}}',
  })
  symlinkSync(installed, join(root, "node_modules"))
  wireDeveloperTools({ root, specsFor, ts })
  const { ESLint } = await import(join(installed, "eslint/lib/api.js"))
  const config = (await import(join(root, ".vibelang/eslint.config.mjs"))).default
  const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: config })
  const cases = [
    "// oxlint-disable-next-line no-unused-vars -- native alias\nconst unused = 1\n",
    "// oxlint-disable-next-line anti-slop/no-unknown-parameters -- custom plugin\nexport function seeded(value: unknown) { return value }\n",
    "// oxlint-disable-next-line typescript/no-explicit-any -- native TS alias\nexport type Value = any\n",
    "// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ESLint TS alias\nexport type Value = any\n",
    "const unused = 1 // oxlint-disable-line eslint/no-unused-vars -- native alias\n",
    "/* oxlint-disable no-unused-vars */\nconst suppressed = 1\n/* oxlint-enable no-unused-vars */\nconst reported = 2\n",
    "// oxlint-disable-next-line\ndebugger;\n",
    "// oxlint-disable-next-line -- reason-only is not blanket in Oxlint 1.60\ndebugger;\n",
    "// eslint-disable-next-line -- reason-only is not blanket in Oxlint 1.60\ndebugger;\n",
    "/* oxlint-disable */\ndebugger;\n/* oxlint-enable */\ndebugger;\n",
    "// eslint-disable-next-line eslint/no-debugger -- native core alias\ndebugger;\n",
    "// oxlint-disable-next-line no-debugger -- unused suppression stays quiet\nexport const value = 1\n",
  ]
  for (const source of cases) {
    writeFileSync(join(root, "main.ts"), source)
    const native = spawnSync(process.execPath, [join(installed, "oxlint/bin/oxlint"), "--threads", "8", "--format", "json", "main.ts"], { cwd: root, encoding: "utf8" })
    assert.equal(native.status, 0, native.stdout + native.stderr)
    const expected = JSON.parse(native.stdout).diagnostics.map(diagnostic => [diagnostic.labels[0].span.line, diagnostic.labels[0].span.column]).sort()
    const [result] = await eslint.lintText(source, { filePath: join(root, "main.vibe") })
    assert.equal(result.messages.some(message => message.fatal), false, JSON.stringify(result.messages))
    assert.deepEqual(result.messages.map(message => [message.line, message.column]).sort(), expected, source + JSON.stringify(result.messages))
  }
})

import { withOxlintComments } from "../templates/oxlint-comments.mjs"
test("directive mutations preserve source strings, scope identity, reasons and locations", () => {
  const quote = "Oxlint disable and enable comments keep their original scope and source locations."
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(quote))
  const aliases = new Map([
    ["@typescript-eslint/no-unused-vars", "eslint/no-unused-vars"],
    ["@typescript-eslint/no-explicit-any", "typescript/no-explicit-any"]
  ])
  const targets = { "no-unused-vars": "@typescript-eslint/no-unused-vars", "eslint/no-unused-vars": "@typescript-eslint/no-unused-vars", "eslint/no-debugger": "no-debugger", "typescript/no-explicit-any": "@typescript-eslint/no-explicit-any", "house/rule": "house/rule" }
  fc.assert(fc.property(
    fc.constantFrom("oxlint", "eslint"),
    fc.constantFrom("disable", "disable-line", "disable-next-line", "enable"),
    fc.array(fc.constantFrom(...Object.keys(targets)), { maxLength: 3 }),
    fc.constantFrom("", " -- because café", " -- keep eslint/no-debugger unchanged"),
    fc.boolean(),
    (prefix, verb, names, reason, parseOnly) => {
      const value = " " + prefix + "-" + verb + (names.length ? " " + names.join(", ") : "") + reason
      const source = "const literal = 'oxlint-disable-next-line';\n//" + value
      const location = { start: { line: 2, column: 0 }, end: { line: 2, column: value.length + 2 } }
      const ast = { comments: [{ value, range: [41, 43 + value.length], loc: location }] }
      const scopeManager = { scopes: [] }
      const parser = parseOnly
        ? { parse(text) { assert.equal(text, source); return ast } }
        : { parseForESLint(text) { assert.equal(text, source); return { ast, scopeManager } } }
      const result = withOxlintComments(parser, aliases).parseForESLint(source)
      assert.equal(result.ast, ast)
      assert.equal(result.scopeManager, parseOnly ? undefined : scopeManager)
      assert.deepEqual(result.ast.comments[0].range, [41, 43 + value.length])
      assert.equal(result.ast.comments[0].loc, location)
      const expectedPrefix = !names.length && reason ? "oxlint" : "eslint"
      assert.equal(result.ast.comments[0].value, " " + expectedPrefix + "-" + verb + (names.length ? " " + names.map(name => targets[name]).join(", ") : "") + reason)
    }
  ), { seed: 8311010, numRuns: 150 })
})
