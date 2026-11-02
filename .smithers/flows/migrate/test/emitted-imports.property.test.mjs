import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { planEmittedImports, applyEmittedImports } from "../lib/emitted-imports.mjs"
import { wireEmittedProjects, makeConfig } from "../lib/steps.mjs"
import { rewriteExports } from "../lib/codemod.mjs"
import { loadTypeScript } from "../lib/declarations.mjs"

const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const require = createRequire(join(repo, "packages/runtime/package.json"))
const fc = require("fast-check")
const ts = loadTypeScript([join(repo, "packages/compiler/test/eslint"), join(repo, ".smithers")])
const compiler = join(repo, "packages/compiler/native/vibelang")
const oracle = { skip: !process.env.VIBELANG_EMITTED_IMPORTS_ORACLE && "set VIBELANG_EMITTED_IMPORTS_ORACLE=1 (built compiler, installed Vite/Rolldown)" }
const corpus = name => readFileSync(new URL("./corpus/foldkit-rolldown-emitted/" + name, import.meta.url), "utf8")
const put = (root, file, text) => { mkdirSync(join(root, file, ".."), { recursive: true }); writeFileSync(join(root, file), text) }

function fixture({ stem = "rule", native = true, published = false, reexport = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "foldkit-emitted-imports-"))
  const extension = native ? ".vibe" : ".ts"
  const source = "src/" + stem + extension
  put(root, source, "export const answer = (): number => 42\n")
  put(root, "src/entry.ts", reexport ? "export { answer } from './" + stem + extension + "'\n" :
    "import { answer } from './" + stem + extension + "'\nexport const result = answer()\n")
  put(root, "test/original.test.ts", "import { answer } from '../" + source + "'\n")
  put(root, "test/fixtures/config.ts", "export { answer } from '../../" + source + "'\n")
  put(root, "package.json", JSON.stringify({ type: "module", private: !published, exports: { ".": "./dist/entry.js" },
    scripts: { build: "vibelang --project tsconfig.json", test: "node original-tests.mjs" } }))
  put(root, "tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler",
    strict: true, skipLibCheck: true, types: [], rootDir: "src", outDir: "dist", declaration: true, allowArbitraryExtensions: true,
    rewriteRelativeImportExtensions: true }, files: [source, "src/entry.ts"] }))
  put(root, "node_modules/vibelang/package.json", JSON.stringify({ name: "vibelang", type: "module", bin: { vibelang: "bin.mjs" } }))
  put(root, "node_modules/vibelang/bin.mjs", "")
  symlinkSync(compiler, join(root, "node_modules/vibelang/compiler"))
  const packages = [{ dir: ".", sources: ["src"], tsconfig: "tsconfig.json", dtsTsconfig: "tsconfig.json" }]
  return { root, source, packages, projects: ["tsconfig.json"], ts,
    cleanup() { rmSync(root, { recursive: true, force: true }) } }
}
const plan = f => planEmittedImports(f)

test("emitted import setup selects exact source identities, leaving tests, type imports, exports and scripts intact", () => {
  fc.assert(fc.property(fc.constantFrom("rule", "café", "機械", "nested/with space", "prefix-long"), fc.boolean(), (stem, native) => {
    const f = fixture({ stem, native })
    try {
      const pkg = JSON.parse(readFileSync(join(f.root, "package.json")))
      const protectedFiles = ["test/original.test.ts", "test/fixtures/config.ts", "fixtures/config.ts", "__fixtures__/config.ts", "src/schema.spec.cts"]
      for (const file of protectedFiles.slice(2)) put(f.root, file, "export { answer } from '../" + f.source + "'\n")
      const protectedText = protectedFiles.map(file => readFileSync(join(f.root, file), "utf8"))
      put(f.root, "src/types.ts", "import type { answer } from './" + stem + (native ? ".vibe" : ".ts") + "'\nexport type Answer = typeof answer\n")
      put(f.root, "src/examples.ts", [
        "// import('./" + stem + (native ? ".vibe" : ".ts") + "')",
        "export const example = \"import('./" + stem + (native ? ".vibe" : ".ts") + "')\"",
        "export const pattern = /import('./rule.vibe')/"
      ].join("\n"))
      const examples = readFileSync(join(f.root, "src/examples.ts"), "utf8")
      const planned = plan(f)
      assert.equal(planned.modules.length, 1)
      assert.equal(planned.modules[0].source, f.source)
      assert.equal(planned.modules[0].output, "dist/" + stem + ".js")
      applyEmittedImports(planned, f)
      const wired = JSON.parse(readFileSync(join(f.root, "package.json")))
      assert.deepEqual(wired.exports, pkg.exports)
      assert.deepEqual(wired.scripts, pkg.scripts)
      assert.deepEqual(Object.keys(wired.imports), ["#vibelang/emitted/src/" + stem])
      assert.deepEqual(protectedFiles.map(file => readFileSync(join(f.root, file), "utf8")), protectedText)
      assert.ok(readFileSync(join(f.root, "src/types.ts"), "utf8").includes("import type"))
      assert.equal(readFileSync(join(f.root, "src/examples.ts"), "utf8"), examples)
      assert.deepEqual(plan(f).changed, [])
      applyEmittedImports(planned, { ...f, restore: true })
      assert.deepEqual(JSON.parse(readFileSync(join(f.root, "package.json"))), pkg)
    } finally { f.cleanup() }
  }), { seed: 9798, numRuns: 100 })
})

test("emitted imports refuse unbuilt projects, nonemitting projects, aliases that collide and output outside the package", () => {
  for (const change of [
    f => { const pkg = JSON.parse(readFileSync(join(f.root, "package.json"))); pkg.scripts.build = "rolldown src/entry.ts"; put(f.root, "package.json", JSON.stringify(pkg)) },
    f => { const cfg = JSON.parse(readFileSync(join(f.root, "tsconfig.json"))); cfg.compilerOptions.noEmit = true; put(f.root, "tsconfig.json", JSON.stringify(cfg)) },
    f => { const pkg = JSON.parse(readFileSync(join(f.root, "package.json"))); pkg.imports = { "#vibelang/emitted/src/rule": "./unrelated.js" }; put(f.root, "package.json", JSON.stringify(pkg)) },
    f => { const cfg = JSON.parse(readFileSync(join(f.root, "tsconfig.json"))); cfg.compilerOptions.outDir = "../outside"; put(f.root, "tsconfig.json", JSON.stringify(cfg)) }
  ]) {
    const f = fixture()
    try { change(f); assert.throws(() => plan(f)) } finally { f.cleanup() }
  }
})

test("package import type targets follow the ordinary .ts to .vibe rename while JavaScript targets stay emitted", () => {
  const f = fixture({ native: false })
  try {
    applyEmittedImports(plan(f), f)
    rewriteExports(f.root, [{ from: f.source, to: f.source.replace(/\.ts$/, ".vibe") }])
    const pkg = JSON.parse(readFileSync(join(f.root, "package.json")))
    assert.deepEqual(pkg.imports["#vibelang/emitted/src/rule"], { "vibelang-source": "./src/rule.vibe", types: "./src/rule.d.vibe.ts", default: "./dist/rule.js" })
  } finally { f.cleanup() }
})

test("foldkit-97/98: real Rolldown and Vite's bundled config loader consume existing emitted JavaScript with unchanged oracles", oracle, async () => {
  const f = fixture()
  try {
    for (const name of ["rolldown", "vite"]) symlinkSync(resolve(repo, "packages/vite/node_modules", name), join(f.root, "node_modules", name), "dir")
    // The handed-off Foldkit minimized oracle, byte-for-byte. Only product
    // entry specifiers and package imports are wiring; no plugin is added.
    put(f.root, "bundle.mjs", corpus("bundle.mjs"))
    put(f.root, "entry.ts", corpus("entry.before.ts"))
    put(f.root, "foldkit-rolldown-native-rule.vibe", corpus("foldkit-rolldown-native-rule.vibe"))
    const buildOracle = readFileSync(join(f.root, "bundle.mjs"), "utf8")
    // Also exercise the drive's Vite API shape: an unchanged config loader
    // reaches the package's source, before Vite plugins exist.
    put(f.root, "vite.config.ts", "import { result } from './src/entry.ts'\nexport default { define: { answer: String(result) } }\n")
    const viteOracle = "import { resolveConfig } from 'vite'; const c = await resolveConfig({}, 'build'); if (c.define.answer !== '42') throw Error('wrong product value')"
    const run = (args) => spawnSync(process.execPath, args, { cwd: f.root, encoding: "utf8" })
    const beforeVite = run(["--input-type=module", "--eval", viteOracle])
    const beforeRoll = run(["bundle.mjs"])
    assert.notEqual(beforeVite.status, 0, beforeVite.stdout + beforeVite.stderr)
    assert.notEqual(beforeRoll.status, 0, beforeRoll.stdout + beforeRoll.stderr)
    // The real Foldkit corpus source lives at the package root.
    const config = JSON.parse(readFileSync(join(f.root, "tsconfig.json")))
    config.compilerOptions.rootDir = "."
    config.files.push("foldkit-rolldown-native-rule.vibe")
    put(f.root, "tsconfig.json", JSON.stringify(config))
    f.packages[0].sources = ["."]
    const wired = plan(f)
    applyEmittedImports(wired, f)
    const compile = spawnSync(compiler, ["--project", "tsconfig.json"], { cwd: f.root, encoding: "utf8" })
    assert.equal(compile.status, 0, compile.stdout + compile.stderr)
    for (const args of [["bundle.mjs"], ["--input-type=module", "--eval", viteOracle]]) {
      const after = run(args)
      assert.equal(after.status, 0, after.stdout + after.stderr)
    }
    assert.equal(readFileSync(join(f.root, "bundle.mjs"), "utf8"), buildOracle)
    assert.equal(JSON.parse(readFileSync(join(f.root, "package.json"))).scripts.test, "node original-tests.mjs")
    assert.deepEqual(wired.modules.map(m => m.source).sort(), ["foldkit-rolldown-native-rule.vibe", "src/entry.ts", "src/rule.vibe"])
  } finally { f.cleanup() }
})

test("generated Unicode and nested native module paths run through exact emitted aliases without a source hook", oracle, () => {
  fc.assert(fc.property(fc.constantFrom("rule", "café", "機械", "nested/with space", "nested/λ"), stem => {
    const f = fixture({ stem })
    try {
      const wired = plan(f)
      applyEmittedImports(wired, f)
      const compile = spawnSync(compiler, ["--project", "tsconfig.json"], { cwd: f.root, encoding: "utf8" })
      assert.equal(compile.status, 0, compile.stdout + compile.stderr)
      const run = spawnSync(process.execPath, ["--input-type=module", "--eval",
        "const m = await import('./dist/entry.js'); if (m.result !== 42) throw Error('wrong emitted result')"],
        { cwd: f.root, encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } })
      assert.equal(run.status, 0, run.stdout + run.stderr)
      assert.deepEqual(wired.modules.map(m => m.source), [f.source])
    } finally { f.cleanup() }
  }), { seed: 979801, numRuns: 20 })
})

test("native product import edges use the compiler tree and ignore quoted examples", oracle, () => {
  const f = fixture()
  try {
    f.compiler = compiler
    put(f.root, "src/importer.vibe", "import { answer } from './rule.vibe'\nexport const result = answer()\n// import('./rule.vibe')\n")
    const wired = plan(f)
    applyEmittedImports(wired, f)
    const source = readFileSync(join(f.root, "src/importer.vibe"), "utf8")
    assert.ok(source.startsWith("import { answer } from '#vibelang/emitted/src/rule'"))
    assert.ok(source.endsWith("// import('./rule.vibe')\n"))
  } finally { f.cleanup() }
})

test("setup accepts API-identical published declaration aliases", async () => {
  for (const reexport of [true, false]) {
    const f = fixture({ native: false, published: true, reexport })
    try {
      const config = { target: f.root, packages: f.packages, emittedProjects: f.projects, toolchain: { kind: "npm" } }
      mkdirSync(join(f.root, "node_modules/.bin"), { recursive: true })
      symlinkSync(join(repo, "docs/tools/node_modules/typescript/bin/tsc"), join(f.root, "node_modules/.bin/vibelang"))
      const result = await wireEmittedProjects(config, ts, join(f.root, ".logs"))
      assert.equal(result.declarations, "API-identical")
      assert.equal(result.modules.length, 1)
      assert.ok(JSON.parse(readFileSync(join(f.root, "package.json"))).imports)
    } finally { f.cleanup() }
  }
})

test("setup rolls back product aliases when an exported type changes", async () => {
  const f = fixture({ native: false, published: true })
  try {
    const config = { target: f.root, packages: f.packages, emittedProjects: f.projects, toolchain: { kind: "npm" } }
    mkdirSync(join(f.root, "node_modules/.bin"), { recursive: true })
    const wrapper = join(f.root, "api-identity-compiler.cjs")
    writeFileSync(wrapper, [
      "#!/usr/bin/env node",
      "const { spawnSync } = require('node:child_process'); const fs = require('node:fs'); const path = require('node:path');",
      "const args=process.argv.slice(2); const result=spawnSync(process.execPath, ["+JSON.stringify(join(repo,"docs/tools/node_modules/typescript/bin/tsc"))+", ...args], {stdio:'inherit'});",
      "const out=args[args.indexOf('--outDir')+1];",
      "if (result.status === 0 && out && out.includes('/after/')) { const file=path.join(out,'entry.d.ts'); fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('result: number','result: string')); }",
      "process.exit(result.status ?? 1);"
    ].join("\n"), {mode:0o755})
    symlinkSync(wrapper, join(f.root, "node_modules/.bin/vibelang"))
    const before = ["src/entry.ts", "package.json"].map(file => readFileSync(join(f.root,file),"utf8"))
    await assert.rejects(wireEmittedProjects(config, ts, join(f.root,".logs")), /changes published declarations[\s\S]*TS2344/)
    assert.deepEqual(["src/entry.ts", "package.json"].map(file => readFileSync(join(f.root,file),"utf8")),before)
  } finally { f.cleanup() }
})

test("the standalone flow persists explicitly selected emitted projects", () => {
  const f = fixture({ native: false })
  try {
    const config = makeConfig({ target: f.root, test: "unchanged", vibelangVersion: "0.0.11", emittedProjects: ["tsconfig.json"] })
    assert.deepEqual(config.emittedProjects, ["tsconfig.json"])
  } finally { f.cleanup() }
})

test("emitted aliases refuse compiler command overrides of the configured output layout", () => {
  for (const flags of ["--outDir elsewhere", "--rootDir .", "--outFile bundle.js", "--noEmit", "--emitDeclarationOnly"]) {
    const f = fixture()
    try {
      const pkg = JSON.parse(readFileSync(join(f.root, "package.json")))
      pkg.scripts.build += " " + flags
      put(f.root, "package.json", JSON.stringify(pkg))
      assert.throws(() => plan(f), /existing build|output|emit/i)
    } finally { f.cleanup() }
  }
})

test("native product import ranges account for non-ASCII text preceding the import", oracle, () => {
  for (const prefix of ["// café機械\n", "// 😀é\n"]) {
    const f = fixture()
    try {
      f.compiler = compiler
      put(f.root, "src/importer.vibe", prefix + "import { answer } from './rule.vibe'\nexport const result = answer()\n")
      const wired = plan(f)
      applyEmittedImports(wired, f)
      assert.equal(readFileSync(join(f.root, "src/importer.vibe"), "utf8"),
        prefix + "import { answer } from '#vibelang/emitted/src/rule'\nexport const result = answer()\n")
    } finally { f.cleanup() }
  }
})

test("only an actual emitting compiler command establishes the existing build prerequisite", () => {
  for (const script of [
    "echo vibelang --project tsconfig.json",
    "printf tsc --project tsconfig.json",
    "echo ok || vibelang --project tsconfig.json",
    "pnpm run build:js -- --outDir elsewhere",
    "vibelang --project tsconfig.json --project other.json"
  ]) {
    const f = fixture()
    try {
      const pkg = JSON.parse(readFileSync(join(f.root, "package.json")))
      pkg.scripts.build = script
      pkg.scripts["build:js"] = "vibelang -p tsconfig.json"
      put(f.root, "package.json", JSON.stringify(pkg))
      assert.throws(() => plan(f), /existing build/)
    } finally { f.cleanup() }
  }
  for (const script of [
    "pnpm exec vibelang --project tsconfig.json",
    "npm exec -- tsc --project=tsconfig.json",
    "pnpm run build:js",
    "vibelang -p tsconfig.json && rolldown --config"
  ]) {
    const f = fixture()
    try {
      const pkg = JSON.parse(readFileSync(join(f.root, "package.json")))
      pkg.scripts.build = script
      pkg.scripts["build:js"] = "vibelang -p tsconfig.json"
      put(f.root, "package.json", JSON.stringify(pkg))
      assert.equal(plan(f).modules.length, 1)
    } finally { f.cleanup() }
  }
})

test("emitted aliases find runtime imports with whitespace and import options", () => {
  for (const expression of [
    "import ('./rule.vibe')",
    "import('./rule.vibe', { with: { type: 'javascript' } })"
  ]) {
    const f = fixture()
    try {
      put(f.root, "src/entry.ts", "export const load = () => " + expression + "\n")
      const wired = plan(f)
      applyEmittedImports(wired, f)
      assert.ok(readFileSync(join(f.root, "src/entry.ts"), "utf8").includes("#vibelang/emitted/src/rule"))
    } finally { f.cleanup() }
  }
})

test("exact import conditions refuse wildcard and URL metacharacters in output paths", () => {
  for (const stem of ["rule*", "rule#hash", "rule?query", "rule%20"]) {
    const f = fixture({ stem })
    try { assert.throws(() => plan(f), /exact package import targets/) } finally { f.cleanup() }
  }
})

test("rewritten specifiers preserve the original quote style and the cooked alias", () => {
  for (const stem of ["rule'quote", 'rule"quote']) {
    for (const quote of ["'", '"']) {
      const f = fixture({ stem })
      try {
        const specifier = "./" + stem + ".vibe"
        const escaped = JSON.stringify(specifier).slice(1, -1).replace(/'/g, "\\'")
        put(f.root, "src/entry.ts", "import { answer } from " + quote + escaped + quote + "\n")
        const wired = plan(f)
        applyEmittedImports(wired, f)
        const source = ts.createSourceFile("entry.ts", readFileSync(join(f.root, "src/entry.ts"), "utf8"), ts.ScriptTarget.Latest)
        assert.equal(source.parseDiagnostics.length, 0)
        assert.equal(source.statements[0].moduleSpecifier.text, "#vibelang/emitted/src/" + stem)
        assert.equal(wired.modules.length, 1)
      } finally { f.cleanup() }
    }
  }
})

test("foldkit-98: emitted imports recognize the implicit build-mode project", () => {
  const key = JSON.parse(readFileSync(new URL("./corpus/foldkit-emitted-implicit-build.json", import.meta.url), "utf8"))
  fc.assert(fc.property(
    fc.constantFrom("", "exec ", "pnpm exec ", "pnpm exec -- ", "npm exec -- ", "npx ", "bunx "),
    fc.constantFrom("tsc", "vibelang"),
    fc.constantFrom("-b", "--build"),
    fc.boolean(),
    fc.boolean(),
    (prefix, binary, flag, throughScript, cleanFirst) => {
      const f = fixture({ native: false })
      try {
        // TypeScript's own CLI parser is the independent project oracle.
        const command = ts.parseBuildCommand([flag])
        assert.deepEqual(command.errors, [])
        assert.deepEqual(command.projects, ["."])
        const pkg = JSON.parse(readFileSync(join(f.root, "package.json"), "utf8"))
        pkg.scripts.compile = prefix + binary + " " + flag
        pkg.scripts.clean = "node -e 'void 0'"
        pkg.scripts.build = (cleanFirst ? "pnpm run clean && " : "") +
          (throughScript ? "pnpm run compile" : pkg.scripts.compile)
        put(f.root, "package.json", JSON.stringify(pkg))
        const script = pkg.scripts.build
        const planned = plan(f)
        assert.deepEqual(planned.modules.map(module => module.source), [f.source])
        assert.equal(planned.modules[0].output, "dist/rule.js")
        applyEmittedImports(planned, f)
        assert.equal(JSON.parse(readFileSync(join(f.root, "package.json"))).scripts.build, script)
        applyEmittedImports(planned, { ...f, restore: true })
        // The implicit invocation builds tsconfig.json, never a different
        // project just because its output layout happens to be the same.
        put(f.root, "alternate.json", readFileSync(join(f.root, "tsconfig.json"), "utf8"))
        assert.throws(() => planEmittedImports({ ...f, projects: ["alternate.json"] }), /existing build/)
      } finally { f.cleanup() }
    },
  ), { seed: key.seed, numRuns: key.runs })
})

test("foldkit-98: emitted imports exclude declaration sidecars from JavaScript candidates", () => {
  const key = JSON.parse(readFileSync(new URL("./corpus/foldkit-emitted-declaration-sidecars.json", import.meta.url), "utf8"))
  fc.assert(fc.property(
    fc.constantFrom("rule", "café", "機械", "nested/with space"),
    fc.constantFrom(".d.vibe.ts", ".d.vibex.ts", ".d.css.ts", ".d.ts", ".d.mts", ".d.cts"),
    (stem, suffix) => {
      const f = fixture({ native: false })
      try {
        const declaration = "src/" + stem + suffix
        const ordinary = "src/control.vibe.ts"
        assert.equal(ts.isDeclarationFileName(declaration), true)
        assert.equal(ts.isDeclarationFileName(ordinary), false)
        put(f.root, declaration, "export declare const declared: number\n")
        put(f.root, ordinary, "export const live = 7\n")
        const entry = "import { answer } from './rule.ts'\nimport { live } from './control.vibe.ts'\nexport const result = answer() + live\n"
        put(f.root, "src/entry.ts", entry)
        const cfg = JSON.parse(readFileSync(join(f.root, "tsconfig.json"), "utf8"))
        cfg.files.push(declaration, ordinary)
        put(f.root, "tsconfig.json", JSON.stringify(cfg))
        // Real TypeScript emission establishes which files produce JavaScript;
        // arbitrary-extension declaration sidecars never produce an output.
        const parsed = ts.parseJsonConfigFileContent(cfg, ts.sys, f.root)
        assert.deepEqual(parsed.errors, [])
        const outputs = []
        const result = ts.createProgram(parsed.fileNames, parsed.options).emit(undefined, file => outputs.push(file))
        assert.equal(result.emitSkipped, false)
        const javascript = outputs.filter(file => /\.(?:js|mjs|cjs)$/.test(file)).map(file => file.slice(f.root.length + 1)).sort()
        assert.deepEqual(javascript, ["dist/control.vibe.js", "dist/entry.js", "dist/rule.js"])
        const before = readFileSync(join(f.root, declaration), "utf8")
        const planned = plan(f)
        assert.deepEqual(planned.modules.map(module => module.source).sort(), [ordinary, f.source].sort())
        assert.ok(planned.modules.every(module => javascript.includes(module.output)))
        applyEmittedImports(planned, f)
        assert.equal(readFileSync(join(f.root, declaration), "utf8"), before)
        applyEmittedImports(planned, { ...f, restore: true })
        assert.equal(readFileSync(join(f.root, "src/entry.ts"), "utf8"), entry)
      } finally { f.cleanup() }
    },
  ), { seed: key.seed, numRuns: key.runs })
})
