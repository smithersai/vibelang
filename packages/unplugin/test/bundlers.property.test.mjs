// Run via sh test/run.sh. FC_BUNDLERS can select additional nightly adapters.
// Normal runs always cover webpack, Rollup and esbuild, including deferred Rollup.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import module, { SourceMap } from "node:module"
import { dirname, join, parse, relative, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { createUnplugin } from "unplugin"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { projectArbitrary, projectArtifacts, projectFiles } from "../../../scripts/testing/projects.mjs"
import { unplugin } from "../src/index.js"

const here = fileURLToPath(new URL(".", import.meta.url))
const self = fileURLToPath(import.meta.url)
const compiler = process.env.VIBELANG_BINARY
const bundlers = (process.env.FC_BUNDLERS || "webpack,rollup,esbuild").split(",")
assert.ok(bundlers.every(name => ["webpack", "rollup", "esbuild", "rspack", "rolldown", "vite", "bun"].includes(name)), "unsupported FC_BUNDLERS adapter")
const integration = "docs/design/history/src/428-part4-ch28-tooling.md: Packages and versions, Building and testing; docs/design/history/src/326-part3-ch26-compiled.md: Modules (D364/D365/D403)"
const mapping = "docs/design/history/src/428-part4-ch28-tooling.md: Debugging (original .vibe positions)"
const errors = "docs/design/history/src/428-part4-ch28-tooling.md: Diagnostics (D61: errors at .vibe spans, nonzero exit)"
const regressions = new URL("./property-regressions/", import.meta.url)
let diagnostics = ""
let failureDiagnostics = ""
const trace = text => { diagnostics = (diagnostics + text + "\n").slice(-12000) }

function run(command, args, root, stage) {
  trace(stage)
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout: 60000, maxBuffer: 2 << 20,
    env: { ...process.env, VIBELANG_UNPLUGIN_DEBUG: "1" } })
  const stdout = result.stdout?.split("\n").filter(line => !line.startsWith("bundled:///")).join("\n")
  trace(`${stage}: status=${result.status} signal=${result.signal}\n${stdout}\n${result.stderr}`)
  assert.ifError(result.error)
  return result
}

function write(root, files) {
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), source)
  }
}

function options(root, input) {
  return input.options ? { root: root + "/.", project: "./tsconfig.json", compiler } : { root }
}

// Independently invoke the native compiler with the loader backend's documented
// flags. Do not use vibelang/project as the oracle for its own plugin.
function emit(root) {
  const out = join(root, ".emit"), filesystem = parse(root).root
  rmSync(out, { recursive: true, force: true })
  const result = run(compiler, [
    "--project", join(root, "tsconfig.json"), "--loader-root", root,
    "--pretty", "false", "--listFiles", "true", "--rootDir", filesystem,
    "--outDir", out, "--sourceMap", "true", "--inlineSources", "true",
    "--inlineSourceMap", "false", "--sourceRoot", filesystem,
    "--declaration", "false", "--declarationMap", "false", "--noEmit", "false",
    "--emitDeclarationOnly", "false", "--noEmitOnError", "true",
    "--rewriteRelativeImportExtensions", "true", "--incremental", "false"
  ], root, "direct compiler emit")
  return { ...result, directory: join(out, relative(filesystem, root)) }
}

function normalizedMap(map, directory, root) {
  return { ...map, sourceRoot: "", sources: map.sources.map(source =>
    relative(root, resolve(directory, map.sourceRoot || "", source))) }
}

function assertMappings(code, payload, project, label) {
  const map = new SourceMap(payload), lines = code.split("\n")
  for (const probe of project.probes) {
    const line = lines.findIndex(text => text.includes(probe.marker))
    assert.ok(line >= 0, `${label}: missing executable token ${probe.marker}`)
    const column = lines[line].indexOf(probe.marker) - 1 // start of its string token
    const entry = map.findEntry(line, column)
    assert.ok(entry.originalSource && decodeURI(entry.originalSource).endsWith(probe.file), `${label}: ${probe.marker} maps to ${JSON.stringify(entry)}`)
    assert.deepEqual([entry.originalLine, entry.originalColumn], [probe.line, probe.column], `${label}: ${probe.marker}`)
    const index = payload.sources.findIndex(source => decodeURI(source).endsWith(probe.file))
    assert.equal(payload.sourcesContent[index], project.files[probe.file], `${label}: original source content`)
  }
}

async function hooks(root, input, project, direct, framework) {
  const plugin = unplugin.raw(options(root, input), { framework })
  await plugin.buildStart()
  let resolveId = plugin.resolveId, load = plugin.load
  if (framework === "bun") {
    // Bun's native hooks return JavaScript alone (README.md, Limitations).
    plugin.bun.setup({
      onResolve(_options, callback) { resolveId = (path, importer) => callback({ path, importer, kind: "import-statement" })?.path },
      onLoad(_options, callback) { load = async path => ({ code: (await callback({ path })).contents }) }
    })
  }
  const context = { addWatchFile() {}, warn() {}, error(error) { throw new Error(error.message) } }
  for (const [file] of Object.entries(project.files).filter(([file]) => file.endsWith(".vibe"))) {
    const source = join(root, file)
    const directory = join(direct.directory, dirname(file))
    const outputs = readdirSync(directory).filter(name => name === file.split("/").at(-1).replace(/\.vibe$/, ".js") || name.startsWith(file.split("/").at(-1) + ".") && name.endsWith(".js"))
    assert.ok(outputs.length, `${framework}: missing direct emit for ${file}`)
    assert.equal(resolveId("./" + file.split("/").at(-1) + input.query, join(dirname(source), "importer.ts")), source + input.query)
    for (const name of outputs) {
      const id = name.endsWith(".vibe.text.js") ? join(dirname(source), name) : source
      const query = input.query
      // Relative, rewritten .js and queried ids all resolve to the same source.
      const specifier = "./" + name
      assert.equal(resolveId(specifier + query, join(dirname(source), "importer.vibe")), id + query)
      const loaded = await load.call(context, id + query)
      const emitted = join(directory, name)
      assert.equal(loaded.code, readFileSync(emitted, "utf8").replace(/\/\/# sourceMappingURL=.*$/m, ""), `${framework}: ${name} emit`)
      if (framework !== "bun") assert.deepEqual(normalizedMap(loaded.map, dirname(source), root),
        normalizedMap(JSON.parse(readFileSync(emitted + ".map", "utf8")), directory, root), `${framework}: ${name} map`)
    }
  }
}

// Each real bundler runs in a bounded child, including its compiler process.
async function bundle(bundler, root, input, deferred) {
  const adapter = deferred
    ? (await import("../src/deferred.js")).deferred(bundler, options(root, input))
    : (await import(`../src/${bundler}.js`)).default(options(root, input))
  const entry = join(root, "src/main.ts"), out = join(root, "out")
  const strip = createUnplugin(() => ({ name: "strip-types", transformInclude: id => id.endsWith(".ts"),
    transform: code => ({ code: module.stripTypeScriptTypes(code), map: null }) }))
  const external = id => /^(?:effect|vibelang-runtime)(?:\/|$)/.test(id)
  if (bundler === "webpack" || bundler === "rspack") {
    const create = bundler === "webpack" ? (await import("webpack")).default : (await import("@rspack/core")).rspack
    const build = create({ mode: "none", context: root, target: "node", entry, devtool: "source-map",
      output: { path: out, filename: "main.cjs" }, plugins: [strip[bundler](), adapter], infrastructureLogging: { level: "error" } })
    await new Promise((accept, reject) => build.run((error, stats) => build.close(() =>
      error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : accept())))
  } else if (bundler === "rollup" || bundler === "rolldown") {
    const api = await import(bundler)
    const build = await api[bundler]({ input: entry, external, plugins: [strip[bundler](), adapter], onwarn() {} })
    try { await build.write({ dir: out, format: "es", sourcemap: true, entryFileNames: "main.js" }) }
    finally { await build.close() }
  } else if (bundler === "esbuild") {
    await (await import("esbuild")).build({ absWorkingDir: root, entryPoints: [entry], bundle: true,
      platform: "node", format: "esm", sourcemap: true, outfile: join(out, "main.js"), plugins: [adapter], logLevel: "silent" })
  } else if (bundler === "vite") {
    await (await import("vite")).build({ root, configFile: false, logLevel: "silent", plugins: [adapter],
      build: { ssr: entry, outDir: out, sourcemap: true, emptyOutDir: true,
        rolldownOptions: { output: { entryFileNames: "main.js" } } } })
  } else if (bundler === "bun") {
    const built = await Bun.build({ entrypoints: [entry], outdir: out, target: "bun", format: "esm",
      sourcemap: "external", naming: "main.js", plugins: [adapter] })
    assert.ok(built.success, built.logs.map(String).join("\n"))
  } else throw new Error(`unsupported FC_BUNDLERS adapter: ${bundler}`)
}

async function checkProject(input, mode) {
  assert.ok(compiler, "property setup: test/run.sh must supply VIBELANG_BINARY")
  const root = mkdtempSync(join(here, ".fixtures/property-"))
  diagnostics = ""
  const selected = input.bundlers || bundlers // Saved regressions retain their adapter lane.
  try {
    for (const edited of mode === "invalid" ? [false] : [false, true]) {
      const project = projectFiles(input, edited, mode === "invalid")
      trace(`${mode}: ${edited ? "dependency edit" : "initial"} ${JSON.stringify(input)}`)
      write(root, project.files)
      const direct = emit(root)
      if (mode === "invalid") {
        assert.notEqual(direct.status, 0)
        const file = join(root, `${input.directory}/n0.vibe`)
        const line = project.files[`${input.directory}/n0.vibe`].trimEnd().split("\n").length
        assert.ok(direct.stdout.includes(`${relative(root, file)}(${line},14): error TS2322:`), direct.stdout + direct.stderr)
        for (const bundler of selected) {
          const built = run(bundler === "bun" ? "bun" : process.execPath, [self, "--bundle", bundler, root, JSON.stringify(input)], root, `${bundler}: invalid build`)
          assert.notEqual(built.status, 0)
          assert.ok((built.stdout + built.stderr).includes(`${file}:${line}:14 - error TS2322:`), built.stdout + built.stderr)
        }
        continue
      }
      assert.equal(direct.status, 0, direct.stdout + direct.stderr)
      if (mode === "emit") {
        for (const framework of selected) await hooks(root, input, project, direct, framework)
        continue
      }
      const oracle = run(process.execPath, [join(direct.directory, "src/main.js")], root, "execute direct emit")
      assert.equal(oracle.status, 0, oracle.stderr)
      assert.deepEqual(JSON.parse(oracle.stdout), project.expected)
      for (const bundler of selected) for (const deferred of bundler === "rollup" ? [false, true] : [false]) {
        const label = `${bundler}${deferred ? " deferred" : ""}`
        const built = run(bundler === "bun" ? "bun" : process.execPath, [self, "--bundle", bundler, root, JSON.stringify(input), deferred ? "deferred" : "direct"], root, `${label}: build`)
        assert.equal(built.status, 0, built.stdout + built.stderr)
        const output = join(root, "out", /^(?:webpack|rspack)$/.test(bundler) ? "main.cjs" : "main.js")
        const observed = run(bundler === "bun" ? "bun" : process.execPath, [output], root, `${label}: execute`)
        assert.equal(observed.status, 0, observed.stderr)
        assert.equal(observed.stdout, oracle.stdout, `${label}: observations agree with direct emit`)
        assertMappings(readFileSync(output, "utf8"), JSON.parse(readFileSync(output + ".map", "utf8")), project, label)
      }
    }
  } catch (error) {
    // Shrinking may finish with a passing candidate; retain the last *failure's* stages.
    failureDiagnostics = diagnostics
    throw error
  } finally { rmSync(root, { recursive: true, force: true }) }
}

if (process.argv[2] === "--bundle") {
  await bundle(process.argv[3], process.argv[4], JSON.parse(process.argv[5]), process.argv[6] === "deferred")
} else {
  for (const [mode, numRuns, rule] of [["emit", 10, integration], ["build", 2, integration + "; " + mapping], ["invalid", 2, errors]]) {
    test(`bundlers-${mode}`, async () => {
      await checkProperty(fc, { name: `bundlers-${mode}`, rule,
        command: `FC_BUNDLERS=${bundlers.join(",")} node --test test/bundlers.property.test.mjs`,
        arbitrary: projectArbitrary(fc).map(input => ({ ...input, bundlers })), numRuns, regressions, check: input => checkProject(input, mode),
        artifacts: input => mode === "invalid" ? projectFiles(input, false, true).files : projectArtifacts(input), diagnostics: () => failureDiagnostics })
    })
  }
}
