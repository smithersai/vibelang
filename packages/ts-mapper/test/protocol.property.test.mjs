// e2e.sh supplies the assembled fixture; the shared helper owns FC_* selection/replay.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { SourceMap } from "node:module"
import { dirname, join, resolve } from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { projectArbitrary, projectFiles } from "../../../scripts/testing/projects.mjs"
import { client, languageServer, offset, position } from "./protocol-client.mjs"

const { M1_WORK: work, M1_MAPPER: mapper, M1_TRACING_MAPPER: tracingMapper, M1_STOCK: stock, VIBELANG_BINARY: compiler } = process.env
const tooling = "docs/design/history/src/428-part4-ch28-tooling.md"
const spansRule = `${tooling}: Diagnostics (D61), The editor; metamorphic verbatim/edit round trips`
const renderRule = "docs/design/history/src/427-part4-ch27-compiler.md: Other renderings (D366/D416); docs/design/history/src/213-part2-ch13-calls.md: Contracts; docs/design/history/src/326-part3-ch26-compiled.md: Modules"
const regressions = new URL("./property-regressions/", import.meta.url)
const arbitrary = fc.record({ project: projectArbitrary(fc),
  form: fc.constantFrom("plain", "contract", "failure", "hatch"),
  identifier: fc.constantFrom("mapperLocal", "café", "雪"),
  eol: fc.constantFrom("\n", "\r\n"), tracing: fc.constantFrom("", "exported", "all"),
  incomplete: fc.constantFrom("function unfinished(", "export const unfinished = (", "function unfinished() { return 1 +") })
let diagnostics = "", failureDiagnostics = ""
const coverage = {}
const trace = stage => { diagnostics = (diagnostics + `\nM1 ${stage}`).slice(-12000); process.stderr.write(`M1 ${stage}\n`) }

function run(binary, args, root, stage) {
  trace(stage)
  const result = spawnSync(binary, args, { cwd: root, encoding: "utf8", timeout: 60000, maxBuffer: 2 << 20 })
  diagnostics = (diagnostics + result.stdout + result.stderr).slice(-12000)
  assert.ifError(result.error)
  assert.equal(result.signal, null, `${stage}: ${result.signal}`)
  return result
}

function write(root, files) {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
}

function project(input) {
  const generated = projectFiles(input.project, input.project.options), files = { ...generated.files }
  const entry = Object.keys(files).find(file => /\/n0\.vibe$/.test(file))
  const effectful = input.form !== "plain", failure = input.form === "failure"
  const contract = effectful ? `number!${failure ? "MapperFailure" : ""}!` : "number"
  // Chapters 10/13/17: explicit contracts, hatch inputs and typed failures.
  files[entry] += `${failure ? "export error MapperFailure { value: number }\n" : ""}export function probe(mapperValue: number): ${contract} {\n` +
    (failure ? "  if (mapperValue < 0) throw new MapperFailure({ value: mapperValue })\n" : "") +
    `  /* 😀${input.project.modules[0].text} */ const ${input.identifier}: number = ` +
    (input.form === "hatch" ? "sync((x: number) => x + 1, mapperValue)" : "mapperValue + 1") +
    `\n  return ${input.identifier}\n}\n`
  const from = JSON.stringify("./" + entry.slice(4))
  const type = effectful ? `Effect.Effect<number, ${failure ? "MapperFailure" : "never"}, never>` : "number"
  // Mutual assignment checks both directions of the TS-facing contract, not declaration spelling.
  files["src/contracts.ts"] = `import { Effect } from "effect"\nimport { probe${failure ? ", MapperFailure" : ""} } from ${from}\n` +
    `const forward: (n: number) => ${type} = probe\nconst backward: typeof probe = forward\n` +
    `const notAny: 0 extends (1 & ReturnType<typeof probe>) ? true : false = false\nvoid backward; void notAny\n`
  const config = JSON.parse(files["tsconfig.json"])
  Object.assign(config.compilerOptions, { declaration: true })
  config.contentMappers = [{ package: "vibelang-ts-mapper", extensions: [".vibe"],
    outputExtensions: { ".vibe": ".js" }, options: { tracing: input.tracing } }]
  files["tsconfig.json"] = JSON.stringify(config)
  const native = { ...config, vibelang: { tracing: input.tracing || "none" } }
  delete native.contentMappers
  files["tsconfig.native.json"] = JSON.stringify(native)
  for (const file of Object.keys(files).filter(file => /\.(vibe|ts)$/.test(file))) files[file] = files[file].replaceAll("\n", input.eol)
  return { ...generated, files, entry }
}

function artifacts(input) {
  const p = project(input)
  return { ...p.files, ["incomplete/" + p.entry]: p.files[p.entry] + input.incomplete }
}

// D61 and metamorphic geometry: inspect the actual wire map in negotiated byte coordinates.
function mappings(source, output) {
  assert.equal(output.extension, ".ts")
  const original = Buffer.from(source), virtual = Buffer.from(output.text)
  let previous = 0
  for (const tuple of output.mappings || []) {
    assert.ok([5, 6].includes(tuple.length) && tuple.every(Number.isSafeInteger), "invalid wire tuple")
    const [v, length, o, size, kind] = tuple
    assert.ok(v >= previous && length >= 0 && v + length <= virtual.length, "unordered virtual range")
    assert.ok(o >= 0 && size >= 0 && o + size <= original.length, "original range outside source")
    assert.ok([0, 1, 2].includes(kind), "unknown span kind")
    previous = v + length
    // Atoms/aliases anchor a containing source span; only verbatim spans support exact edits.
    if (kind === 0) {
      assert.equal(length, size)
      assert.deepEqual(virtual.subarray(v, v + length), original.subarray(o, o + size))
      let delta = 0
      for (const character of original.subarray(o, o + size).toString()) {
        const point = position(output.text, v + delta)
        assert.equal(offset(output.text, point) - v + o, o + delta, "UTF-8/UTF-16 round trip")
        assert.equal(offset(source, position(source, o + delta)), o + delta)
        delta += Buffer.byteLength(character)
      }
    }
  }
  for (const d of output.diagnostics || []) assert.ok(d.start >= 0 && d.length >= 0 && d.start + d.length <= original.length, "diagnostic outside source")
}

async function positions(root, input, p) {
  const rpc = client(mapper, [], root)
  let lsp
  try {
    lsp = await languageServer(stock, root)
    const init = await rpc.request("initialize", { positionEncodings: ["utf-16", "utf-8"] })
    assert.equal(init.positionEncoding, "utf-8")
    await rpc.request("openProject", { projectHandle: "M1", configFileName: join(root, "tsconfig.json"),
      compilerOptions: {}, options: { tracing: input.tracing } })
    trace("wire transforms")
    const transform = (file, content) => rpc.request("transform", { projectHandle: "M1", fileName: join(root, file), content })
    for (const [file, text] of Object.entries(p.files).filter(([file]) => file.endsWith(".vibe"))) mappings(text, await transform(file, text))
    const source = p.files[p.entry], uri = pathToFileURL(join(root, p.entry)).href
    const initial = await transform(p.entry, source)
    lsp.notify("textDocument/didOpen", { textDocument: { uri, languageId: "vibe", version: 1, text: source } })
    const start = Buffer.byteLength(source.slice(0, source.indexOf(`const ${input.identifier}`) + 6))
    const params = { textDocument: { uri }, position: position(source, start) }
    trace("stock hover and rename")
    const initialDiagnostics = (await lsp.request("textDocument/diagnostic", { textDocument: { uri } })).items
    const hover = await lsp.request("textDocument/hover", params)
    assert.ok(hover?.contents, "verbatim identifier has no hover")
    assert.match(hover.contents.value, /number/)
    assert.equal(offset(source, hover.range.start), start)
    assert.equal(offset(source, hover.range.end), start + Buffer.byteLength(input.identifier))
    // D61: a transformed function's hover must remain within its containing original declaration.
    const fn = Buffer.byteLength(source.slice(0, source.indexOf("function probe") + 9))
    const anchor = await lsp.request("textDocument/hover", { ...params, position: position(source, fn) })
    assert.ok(anchor?.range && offset(source, anchor.range.start) <= fn && offset(source, anchor.range.end) >= fn + 5)
    // Metamorphic rename round trip through stock TS: no synthesized helper may produce an edit.
    const renamed = await lsp.request("textDocument/rename", { ...params, newName: "mapperRenamed" })
    const edits = [...Object.entries(renamed?.changes || {}).flatMap(([target, edits]) => {
      assert.equal(target, uri); return edits
    }), ...(renamed?.documentChanges || []).flatMap(change => {
      assert.equal(change.textDocument.uri, uri); return change.edits
    })]
    assert.equal(edits.length, 2, "rename must cover the declaration and use exactly once")
    const bytes = Buffer.from(source)
    for (const edit of edits) assert.equal(bytes.subarray(offset(source, edit.range.start), offset(source, edit.range.end)).toString(), input.identifier)
    let changed = source
    for (const edit of [...edits].sort((a, b) => offset(source, b.range.start) - offset(source, a.range.start))) {
      const content = Buffer.from(changed)
      changed = Buffer.concat([content.subarray(0, offset(source, edit.range.start)), Buffer.from(edit.newText),
        content.subarray(offset(source, edit.range.end))]).toString()
    }
    assert.equal(changed.replaceAll("mapperRenamed", input.identifier), source)
    mappings(changed, await transform(p.entry, changed))
    if (input.form !== "plain") {
      // Metamorphic: rewritten contract punctuation cannot rename a synthesized type/helper.
      const bang = Buffer.byteLength(source.slice(0, source.indexOf(": number!") + 8))
      const synthetic = await lsp.request("textDocument/rename", { ...params, position: position(source, bang), newName: "forbiddenEdit" })
      assert.ok(!synthetic || !Object.values(synthetic.changes || {}).flat().length && !synthetic.documentChanges?.length,
        "synthesized contract text created an editable source location")
    }
    // Incomplete edits must keep parser diagnostics, then disappear after a full-text repair.
    const broken = source + input.incomplete
    trace("incomplete edit and repair")
    mappings(broken, await transform(p.entry, broken))
    writeFileSync(join(root, p.entry), broken)
    const reference = run(compiler, ["-p", "tsconfig.native.json", "--noEmit", "--pretty", "false"], root, "fork syntax reference")
    assert.notEqual(reference.status, 0, "incomplete program accepted by the compiler")
    assert.match(reference.stdout + reference.stderr, /error TS1\d{3}:/, "compiler must report a parser diagnostic")
    lsp.notify("textDocument/didChange", { textDocument: { uri, version: 2 }, contentChanges: [{ text: broken }] })
    const report = await lsp.request("textDocument/diagnostic", { textDocument: { uri } })
    assert.ok(report.items.some(d => d.severity === 1 && /expected|expression|unterminated/i.test(d.message)), "missing parser diagnostic")
    for (const d of report.items) assert.ok(offset(broken, d.range.start) <= offset(broken, d.range.end))
    lsp.notify("textDocument/didChange", { textDocument: { uri, version: 3 }, contentChanges: [{ text: source }] })
    writeFileSync(join(root, p.entry), source)
    assert.deepEqual((await lsp.request("textDocument/diagnostic", { textDocument: { uri } })).items, initialDiagnostics)
    assert.deepEqual(await transform(p.entry, source), initial, "repair must restore the projection")
    await rpc.request("closeProject", { projectHandle: "M1" })
  } finally { diagnostics += rpc.log() + (lsp?.log() || ""); await rpc.close(); await lsp?.close() }
}

// Chapter 28 Debugging: executable token anchors refer to the original .vibe UTF-16 positions.
function sourceMaps(root, p, out) {
  for (const probe of p.probes) {
    const directory = join(root, out, dirname(probe.file)), stem = probe.file.split("/").at(-1).replace(/\.vibe$/, "")
    const candidates = readdirSync(directory).filter(name => name.endsWith(".js") && (name === stem + ".js" || name.startsWith(stem + ".vibe.")))
    const name = candidates.find(name => readFileSync(join(directory, name), "utf8").includes(probe.marker))
    assert.ok(name, `missing emitted ${probe.marker}`)
    const file = join(directory, name)
    const code = readFileSync(file, "utf8"), payload = JSON.parse(readFileSync(file + ".map", "utf8"))
    const map = new SourceMap(payload), lines = code.split("\n")
    const line = lines.findIndex(line => line.includes(probe.marker))
    assert.ok(line >= 0, `missing emitted ${probe.marker}`)
    const entry = map.findEntry(line, lines[line].indexOf(probe.marker) - 1)
    // The --emit --out sourceRoot policy is undocumented; source identity includes its content.
    assert.equal(decodeURI(entry.originalSource || "").split("/").at(-1), probe.file.split("/").at(-1))
    assert.deepEqual([entry.originalLine, entry.originalColumn], [probe.line, probe.column])
    assert.ok(payload.sourcesContent.includes(p.files[probe.file]))
  }
}

function execute(root, p, out) {
  const entry = `./${out}/${p.entry.replace(/\.vibe$/, ".js")}`
  writeFileSync(join(root, "run.mjs"), `import { Effect } from "effect"\nimport { probe, result } from ${JSON.stringify(entry)}\n` +
    `const run = n => { const p = probe(n); return Effect.isEffect(p) ? Effect.runSync(Effect.catch(p, e => Effect.succeed({ tag: e._tag, value: e.value }))) : p }\nconsole.log(JSON.stringify({ result, positive: run(2), negative: run(-1) }))\n`)
  const result = run(process.execPath, ["run.mjs"], root, `execute ${out}`)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  return JSON.parse(result.stdout)
}

async function renderings(root, input, p) {
  const args = ["--pretty", "false", "--sourceMap", "true", "--inlineSources", "true"]
  const native = run(compiler, ["-p", "tsconfig.native.json", "--outDir", "native", ...args], root, "fork reference")
  assert.equal(native.status, 0, native.stdout + native.stderr)
  sourceMaps(root, p, "native")
  const expected = { result: p.expected, positive: 3, negative: input.form === "failure" ? { tag: "MapperFailure", value: -1 } : 0 }
  assert.deepEqual(execute(root, p, "native"), expected)
  const config = JSON.parse(p.files["tsconfig.json"])
  // D34/D366: tracing changes spans, but must retain contracts and observations.
  for (const tracing of new Set(["", input.tracing || "all"])) {
    config.contentMappers[0].options.tracing = tracing
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify(config))
    const check = () => run(stock, ["-p", "tsconfig.json", "--outDir", "stock", "--runExternalCode", ...args], root, `stock check tracing=${tracing || "none"}`)
    let checked = check()
    // Pending D421 (property-regressions/contract-member.json): a pure body with an Effect annotation gains a required $plain
    // member. Keep the strict, shrunk assignment below in the regression; random projects
    // still check both directions of the callable signature and all execution/map laws.
    if (!input.strictKnownFailures && input.form === "contract" && checked.status !== 0 &&
        /error TS2741: Property '\$plain' is missing/.test(checked.stdout)) {
      trace("known contract-member regression; checking the callable signature")
      writeFileSync(join(root, "src/contracts.ts"), p.files["src/contracts.ts"].replace("typeof probe = forward", "(n: number) => ReturnType<typeof probe> = forward"))
      checked = check()
    }
    if (checked.status !== 0) {
      const errors = checked.stdout.split("\n").filter(line => line.includes("error "))
      // Pending D366/D416 (property-regressions/inline-refusal.json): imports from inline modules use
      // this legacy refusal. The strict saved case must XPASS when it becomes EK9100.
      const knownInline = !input.strictKnownFailures && input.project.modules.some((node, i) =>
        node.inline && (!i || !node.typescript)) && errors.length > 0 &&
        errors.every(line => /error EK9001: The TypeScript 7 mapper does not lower this VibeLang form yet;/.test(line))
      if (knownInline) trace("known inline-refusal diagnostic-code regression")
      else assert.match(checked.stdout + checked.stderr, /(?:EK|TS)9100\b/, "fork-accepted input requires stock acceptance or an explicit EK9100 refusal")
      coverage[`${input.form}:refused:${tracing}`] = (coverage[`${input.form}:refused:${tracing}`] || 0) + 1
      continue
    }
    coverage[`${input.form}:accepted:${tracing}`] = (coverage[`${input.form}:accepted:${tracing}`] || 0) + 1
    for (const file of Object.keys(p.files).filter(file => file.endsWith(".vibe"))) {
      const emitted = run(tracing ? tracingMapper : mapper, ["--emit", join(root, file), "--out", join(root, "stock", file.replace(/\.vibe$/, ".js")),
        ...(tracing ? ["--tracing", tracing] : [])], root, `mapper emit ${file} tracing=${tracing || "none"}`)
      assert.equal(emitted.status, 0, emitted.stdout + emitted.stderr)
      assert.doesNotMatch(emitted.stderr, /error EK\d+:/, "the tracing adapter reports semantic diagnostics on stderr")
    }
    sourceMaps(root, p, "stock")
    for (const out of ["native", "stock"]) {
      writeFileSync(join(root, `contract-${out}.ts`), readFileSync(join(root, "src/contracts.ts"), "utf8").replace(/from "\.\/.*"/, `from ${JSON.stringify(`./${out}/${p.entry.replace(/\.vibe$/, ".js")}`)}`))
    }
    const declarations = run(stock, ["--ignoreConfig", "--noEmit", "--strict", "--skipLibCheck", "--module", "nodenext", "--target", "es2022",
      "contract-native.ts", "contract-stock.ts"], root, "emitted declaration contracts")
    assert.equal(declarations.status, 0, declarations.stdout + declarations.stderr)
    assert.deepEqual(execute(root, p, "stock"), expected)
  }
}

for (const [name, rule, check] of [["mapper-positions", spansRule, positions], ["mapper-renderings", renderRule, renderings]]) {
  test(name, async () => {
    for (const [key, value] of Object.entries({ work, mapper, tracingMapper, stock, compiler })) assert.ok(value, `missing ${key}; run bash test/e2e.sh`)
    await checkProperty(fc, { name, rule, arbitrary, numRuns: 10, regressions, artifacts, diagnostics: () => failureDiagnostics || diagnostics,
      command: "bash test/e2e.sh", check: async input => {
        diagnostics = ""
        trace(`${name} form=${input.form} modules=${input.project.modules.length}`)
        const root = mkdtempSync(join(resolve(work), "M1-")), p = project(input)
        try { write(root, p.files); await check(root, input, p) }
        catch (error) {
          failureDiagnostics = diagnostics
          process.stderr.write(`M1 ${name} failed: ${error.message}\n${typeof error.actual === "string" ? error.actual.slice(-3000) : ""}\n`)
          throw error
        }
        finally { rmSync(root, { recursive: true, force: true }) }
      } })
    process.stderr.write(`M1 accepted-form coverage ${JSON.stringify(coverage)}\n`)
  })
}
