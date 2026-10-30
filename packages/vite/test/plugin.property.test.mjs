// Run through test/run.sh: each generated project executes in a bounded child.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { SourceMap } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, parse, relative, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import fc from "fast-check"
import { build, createServer } from "vite"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { projectArbitrary, projectArtifacts, projectFiles } from "../../../scripts/testing/projects.mjs"
import vibelang from "../src/index.js"

const here = fileURLToPath(new URL(".", import.meta.url))
const self = fileURLToPath(import.meta.url)
const compiler = process.env.VIBELANG_BINARY
const tooling = "docs/design/history/src/428-part4-ch28-tooling.md"
const integration = `${tooling}: Building and testing; docs/user/src/setup/vite.md: 1, 2, 5; docs/design/history/src/326-part3-ch26-compiled.md: Modules (D364/D365/D403)`
const mapping = `${tooling}: Debugging (original .vibe positions)`
const hot = `${tooling}: Building and testing (every loaded .vibe module and its importers); Diagnostics (D61)`
const register = "docs/user/src/setup/vite.md: 4. Test with Vitest (register, inherited NODE_OPTIONS)"
const regressions = new URL("./property-regressions/", import.meta.url)
let diagnostics = ""
const trace = text => process.stderr.write(`V1 ${text}\n`)

function run(command, args, root, stage, env = process.env) {
  trace(stage)
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", env,
    timeout: 60000, maxBuffer: 2 << 20 })
  assert.ifError(result.error)
  assert.equal(result.signal, null, `${stage}: ${result.signal}`)
  return result
}

function write(root, files) {
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), source)
  }
}

// Independent native emit, with the documented whole-project loader settings.
// The plugin's own vibelang/project backend is deliberately not the oracle.
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

function outputs(root, project, direct) {
  return Object.keys(project.files).filter(file => file.endsWith(".vibe")).flatMap(file => {
    const base = file.split("/").at(-1), directory = join(direct.directory, dirname(file))
    const names = readdirSync(directory).filter(name => name === base.replace(/\.vibe$/, ".js") ||
      name.startsWith(base + ".") && name.endsWith(".js"))
    assert.ok(names.length, `missing compiler output for ${file}`)
    return names.map(name => ({ file, source: join(root, file), emitted: join(directory, name),
      id: name === base.replace(/\.vibe$/, ".js") ? join(root, file) : join(root, dirname(file), name) }))
  })
}

function normalizedMap(map, directory, root) {
  return { ...map, sourceRoot: "", sources: map.sources.map(source =>
    relative(root, resolve(directory, map.sourceRoot || "", source))) }
}

function assertMappings(code, payload, project, label, required = project.probes, directory) {
  if (directory) payload = { ...payload, sourceRoot: "", sources: payload.sources.map(source =>
    resolve(directory, payload.sourceRoot || "", source)) }
  const map = new SourceMap(payload), lines = code.split("\n")
  for (const probe of required) {
    const line = lines.findIndex(text => text.includes(probe.marker))
    assert.ok(line >= 0, `${label}: missing ${probe.marker}`)
    const entry = map.findEntry(line, lines[line].indexOf(probe.marker) - 1)
    assert.ok(entry.originalSource && decodeURI(entry.originalSource).endsWith(probe.file),
      `${label}: ${probe.marker} maps to ${JSON.stringify(entry)}`)
    assert.deepEqual([entry.originalLine, entry.originalColumn], [probe.line, probe.column], label)
    const index = payload.sources.findIndex(source => decodeURI(source).endsWith(probe.file))
    assert.equal(payload.sourcesContent[index], project.files[probe.file], `${label}: source content`)
  }
}

function pluginFor(input) {
  return vibelang(input.options ? { project: "./tsconfig.json", compiler } : {})
}

function assertEmit(result, output, root, project) {
  assert.equal(result.code, readFileSync(output.emitted, "utf8").replace(/\/\/# sourceMappingURL=.*$/m, ""), output.id)
  assert.deepEqual(normalizedMap(result.map, dirname(output.id), root),
    normalizedMap(JSON.parse(readFileSync(output.emitted + ".map", "utf8")), dirname(output.emitted), root))
  assertMappings(result.code, result.map, project, output.id,
    project.probes.filter(probe => result.code.includes(probe.marker)))
}

const hookContext = { addWatchFile() {}, error(error) { throw Object.assign(new Error(error.message || error), error) } }

async function hooks(root, input) {
  const plugin = pluginFor(input)
  plugin.configResolved({ root, logger: { warn() {} } })
  try {
    for (const edited of [false, true]) {
      const project = projectFiles(input, edited)
      write(root, project.files)
      if (edited) plugin.watchChange(join(root, Object.keys(project.files).find(file =>
        file.startsWith(`${input.directory}/n${input.modules.length - 1}.`))))
      const direct = emit(root)
      assert.equal(direct.status, 0, direct.stdout + direct.stderr)
      for (const output of outputs(root, project, direct)) {
        const id = output.id + input.query
        const result = output.id === output.source
          ? await plugin.transform.call(hookContext, project.files[output.file], id)
          : await plugin.load.call(hookContext, id)
        assertEmit(result, output, root, project)
        assert.equal(plugin.resolveId("./" + output.emitted.split("/").at(-1) + input.query,
          join(dirname(output.source), "importer.ts")), id)
      }
    }
  } finally { await plugin.closeBundle() }
}

async function coldBuild(root, input, project, oracle) {
  trace("cold Vite build")
  const built = await build({ root, configFile: false, logLevel: "silent", plugins: [pluginFor(input)],
    build: { write: false, sourcemap: true, minify: false,
      lib: { entry: join(root, input.directory, "n0.vibe"), formats: ["es"] } } })
  const chunk = (built.output || built[0].output).find(file => file.type === "chunk" && file.isEntry)
  assertMappings(chunk.code, chunk.map, project, "Vite build")
  const file = join(root, "bundle.mjs")
  writeFileSync(file, chunk.code)
  const observed = run(process.execPath, ["--input-type=module", "-e",
    `console.log(JSON.stringify((await import(${JSON.stringify(pathToFileURL(file).href)})).result))`], root, "execute Vite bundle")
  assert.equal(observed.status, 0, observed.stderr)
  assert.equal(observed.stdout, oracle.stdout)
}

async function buildDev(root, input) {
  const plugin = pluginFor(input), messages = []
  const server = await createServer({ root, configFile: false, logLevel: "silent", plugins: [plugin],
    server: { middlewareMode: true, watch: null }, optimizeDeps: { noDiscovery: true } })
  server.ws.send = message => messages.push(message)
  const entry = join(root, input.directory, "n0.vibe")
  async function update(file) {
    trace(`HMR ${relative(root, file)}`)
    return plugin.handleHotUpdate({ file, modules: [...(server.moduleGraph.getModulesByFile(file) || [])], server })
  }
  try {
    for (const edited of [false, true]) {
      const project = projectFiles(input, edited)
      write(root, project.files)
      if (edited) await update(join(root, Object.keys(project.files).find(file =>
        file.startsWith(`${input.directory}/n${input.modules.length - 1}.`))))
      const direct = emit(root)
      assert.equal(direct.status, 0, direct.stdout + direct.stderr)
      const oracle = run(process.execPath, [join(direct.directory, "src/main.js")], root, "execute direct emit")
      assert.equal(oracle.status, 0, oracle.stderr)
      assert.deepEqual(JSON.parse(oracle.stdout), project.expected)
      for (const output of outputs(root, project, direct)) {
        // Vite's full transform rewrites imports; its pre-transform must be the
        // compiler's exact emit, and its composed map must retain source tokens.
        const raw = output.id === output.source
          ? await plugin.transform.call(hookContext, project.files[output.file], output.id + input.query)
          : await plugin.load.call(hookContext, output.id + input.query)
        assertEmit(raw, output, root, project)
        // transformRequest receives the decoded URL used by Vite's middleware.
        // Module declarations are requested at the URL in the compiler's import,
        // which has no query. Queried virtual ids are also checked above as hooks.
        const url = "/" + relative(root, output.id) + (output.id === output.source ? input.query : "")
        const transformed = await server.transformRequest(url)
        assertMappings(transformed.code, transformed.map, project, "dev transform",
          project.probes.filter(probe => raw.code.includes(probe.marker)), dirname(output.id))
      }
      const served = await server.ssrLoadModule("/" + relative(root, entry))
      assert.deepEqual(served.result, project.expected, "dev observations match direct emit")
      await coldBuild(root, input, project, oracle)
    }
    write(root, projectFiles(input, true, true).files)
    const broken = emit(root)
    assert.notEqual(broken.status, 0)
    const source = projectFiles(input, true, true).files[relative(root, entry)]
    const line = source.trimEnd().split("\n").length
    assert.ok(broken.stdout.includes(`${relative(root, entry)}(${line},14): error TS2322:`), broken.stdout + broken.stderr)
    await update(entry)
    const overlay = messages.find(message => message.type === "error")?.err
    assert.ok(overlay, "missing compiler overlay")
    assert.deepEqual(overlay.loc, { file: entry, line, column: 13 })
    assert.ok(overlay.message.includes(`${entry}:${line}:14 - error TS2322:`), overlay.message)
    await assert.rejects(server.transformRequest("/" + relative(root, entry)), error =>
      error.message.includes(`${entry}:${line}:14 - error TS2322:`))
    write(root, projectFiles(input, true).files)
    await update(entry)
    assert.deepEqual((await server.ssrLoadModule("/" + relative(root, entry))).result,
      projectFiles(input, true).expected, "repaired dev observations match cold build")
  } finally { await server.close() }
}

async function hotGraph(root, input) {
  const project = projectFiles(input)
  const plugin = pluginFor(input)
  plugin.configResolved({ root, logger: { warn() {} } })
  const files = Object.keys(project.files).filter(file => /\.(vibe|ts)$/.test(file))
  const nodes = [...files, "unrelated.js", "importer.js"].map(file =>
    ({ file: join(root, file), importers: new Set(), transformResult: {} }))
  for (const [from, to] of input.edges) nodes[from % nodes.length].importers.add(nodes[to % nodes.length])
  // Always exercise a cycle; generated edges also connect disconnected importers.
  nodes.at(-1).importers.add(nodes[0])
  nodes[0].importers.add(nodes.at(-1))
  const changed = nodes.find(node => node.file.endsWith("n0.vibe")), invalidated = new Set()
  const graph = { idToModuleMap: new Map(nodes.map(node => [node.file, node])),
    invalidateModule(node) { invalidated.add(node); node.transformResult = null } }
  const expected = new Set(nodes.filter(node => node.file.endsWith(".vibe")))
  expected.add(changed)
  // Independent fixed-point oracle for transitive importer reachability.
  for (let size = -1; size !== expected.size;) {
    size = expected.size
    for (const node of nodes) if (nodes.some(source => expected.has(source) && source.importers.has(node))) expected.add(node)
  }
  try {
    const affected = await plugin.handleHotUpdate({ file: changed.file, modules: [changed],
      server: { moduleGraph: graph, config: { logger: { error: assert.fail } }, ws: { send: assert.fail } } })
    assert.deepEqual(new Set(affected), expected)
    assert.deepEqual(invalidated, expected)
    for (const node of nodes) assert.equal(node.transformResult === null, expected.has(node))
    for (const method of ["defineCacheKeyGenerator", "experimental_defineCacheKeyGenerator"]) {
      let key
      plugin.configureVitest({ [method](generate) { key = generate } })
      for (const node of nodes) assert.equal(key({ id: node.file + input.query }), node.file.endsWith(".vibe") ? false : undefined)
    }
  } finally { await plugin.closeBundle() }
}

function registerCase(root, input) {
  const inherited = input.nodeOptions.join(" ")
  process.env.NODE_OPTIONS = input.environmentOptions.join(" ")
  const config = { root, test: { env: input.configOptions ? { NODE_OPTIONS: inherited } : {} } }
  const plugin = vibelang({ register: input.register })
  const result = plugin.config(config)
  const original = input.configOptions ? inherited : process.env.NODE_OPTIONS
  const value = result?.test?.env.NODE_OPTIONS ?? original
  // Every config gains .vibe in resolve.extensions; only register adds NODE_OPTIONS.
  assert.deepEqual(result.resolve, { extensions: [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json", ".vibe"] })
  if (!input.register) assert.equal(result.test, undefined)
  else {
    assert.ok(value.startsWith(original))
    const flag = value.split(" ").filter(option => option.startsWith("--import="))
    assert.equal(flag.length, 1)
    assert.equal(plugin.config({ ...config, test: { env: { NODE_OPTIONS: value } } }).test, undefined, "register is idempotent")
  }
  const file = join(root, input.directory, "n0.vibe")
  const spawned = run(process.execPath, ["--input-type=module", "-e",
    `console.log(JSON.stringify((await import(${JSON.stringify(pathToFileURL(file).href)})).result))`], tmpdir(),
    "spawn source import outside project", { ...process.env, NODE_OPTIONS: value, VIBELANG_PROJECT: join(root, "tsconfig.json") })
  if (input.register) {
    assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr)
    assert.deepEqual(JSON.parse(spawned.stdout), projectFiles(input).expected)
  } else {
    assert.notEqual(spawned.status, 0)
    assert.match(spawned.stderr, /ERR_UNKNOWN_FILE_EXTENSION/)
  }
}

async function scenario(input, mode) {
  assert.ok(compiler, "property setup: test/run.sh must supply VIBELANG_BINARY")
  mkdirSync(join(here, ".fixtures"), { recursive: true })
  const root = mkdtempSync(join(here, ".fixtures/property-"))
  try {
    write(root, projectFiles(input).files)
    trace(`${mode}: ${JSON.stringify(input)}`)
    await ({ emit: hooks, "build-dev": buildDev, hmr: hotGraph, register: registerCase })[mode](root, input)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

if (process.argv[2] === "--case") {
  await scenario(JSON.parse(process.argv[4]), process.argv[3])
} else {
  const flags = fc.uniqueArray(fc.constantFrom("--no-warnings", "--enable-source-maps", "--stack-trace-limit=20"), { maxLength: 3 })
  const arbitrary = projectArbitrary(fc).chain(project => fc.record({
    edges: fc.array(fc.tuple(fc.integer({ min: 0, max: 7 }), fc.integer({ min: 0, max: 7 })), { maxLength: 16 }),
    register: fc.boolean(), configOptions: fc.boolean(), nodeOptions: flags, environmentOptions: flags
  }).map(extra => ({ ...project, ...extra })))
  for (const [mode, numRuns, rule] of [["emit", 10, integration + "; " + mapping],
    ["build-dev", 2, integration + "; " + mapping + "; " + hot], ["hmr", 10, hot], ["register", 10, register]]) {
    test(`vite-${mode}`, async () => {
      await checkProperty(fc, { name: `vite-${mode}`, rule, arbitrary, numRuns, regressions,
        command: "node --test test/plugin.property.test.mjs", artifacts: projectArtifacts, diagnostics: () => diagnostics,
        check(input) {
          const child = spawnSync(process.execPath, [self, "--case", mode, JSON.stringify(input)], {
            cwd: here, encoding: "utf8", timeout: 90000, maxBuffer: 2 << 20,
            env: { ...process.env, VIBELANG_VITE_DEBUG: "1" } })
          const output = `${mode}: status=${child.status} signal=${child.signal}\n${child.error || ""}\n${child.stdout}\n${child.stderr}`.slice(-12000)
          if (child.status !== 0 || child.error) diagnostics = output
          assert.equal(child.status, 0, output)
        } })
    })
  }
}
