import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
const implementation = process.env.MIGRATE_MAPPER_MODULE
  ? await import(process.env.MIGRATE_MAPPER_MODULE) : await import("../lib/preserved-errors.mjs")
const { parseStyleTree, preservedGlobalErrors } = implementation
const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-chart-map-nested-mapper.json", import.meta.url)))
const compiler = process.env.VIBELANG_COMPILER ?? fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const native = { skip: !existsSync(compiler) && "build the native compiler" }

async function decision(before, after, markers = corpus.markers) {
  const diagnostics = []
  for (const marker of markers) {
    let start = 0
    while ((start = after.indexOf(marker, start)) >= 0) {
      const position = start + (marker.startsWith("catch:") ? "catch: ".length : 0)
      const text = after.slice(0, position), lines = text.split("\n")
      diagnostics.push({ file: "main.vibe", line: lines.length, column: lines.at(-1).length + 1,
        category: "warning", code: "EK4804", message: "This failure is a global Error, which has no _tag for a catch or a match to tell it apart by." })
      start += marker.length
    }
  }
  const result = preservedGlobalErrors(await parseStyleTree(compiler, "main.ts", before),
    await parseStyleTree(compiler, "main.vibe", after), after, diagnostics)
  return { ...result, diagnostics }
}

test("foldkit-29: split Chart/Map acquisitions retain their actual original mapper channel and rollback rethrow", native, async () => {
  const r = await decision(corpus.before, corpus.after)
  assert.equal(r.diagnostics.length, 3)
  assert.equal(r.accepted.size, 3, JSON.stringify(r.decisions))
})

test("nested mapper proof refuses changed, mutable, shadowed, unrelated and non-returned contracts", native, async () => {
  for (const [before, after] of [
    [corpus.before, corpus.after.replace('new Error("mount")', 'new Error("changed")')],
    [corpus.before, corpus.after.replace("const toChartMountError", "let toChartMountError")],
    [corpus.before, "class Error {}\n" + corpus.after],
    [corpus.before, corpus.after.replace("observeChart =", "unrelated =")],
    [corpus.before.replace(": Error =>", ": TypeError =>"), corpus.after],
    [corpus.before.replace("() => Effect.acquireRelease", "() => { const ignored = Effect.acquireRelease").replace("Effect.void);", "Effect.void); return Effect.succeed(1); };"), corpus.after],
    [corpus.before, corpus.after.replace("effect () => {\n  const observer", "effect (): number!TypeError => {\n  const observer")],
  ]) {
    const r = await decision(before, after)
    assert.equal(r.accepted.size, 0, JSON.stringify({ before, after, decisions: r.decisions }))
  }
  for (const rethrow of ["throw new Error('different')", "error = new Error('changed'); throw error"]) {
    const after = corpus.after.replace("throw error", rethrow)
    const r = await decision(corpus.before, after)
    assert.equal(r.decisions.at(-1).exempt, false, rethrow)
  }
})

test("generated nested acquire/block and mapper identity variations obey the original Error-channel ruling", native, async () => {
  // 18:45Z ruling: "when the written failure type is the global Error that the original declared".
  await fc.assert(fc.asyncProperty(fc.integer({ min: 0, max: 3 }), fc.boolean(), fc.constantFrom("Chart", "Map"),
    async (depth, changed, name) => {
      const before = corpus.before.replaceAll("Chart", name)
      const call = "Effect.try({ try: (): number => observer, catch: toChartMountError })"
      let nested = call
      for (let i = 0; i < depth; i++) nested = "(effect { return try " + nested + "; })"
      let after = corpus.after.replace("try " + call, "try " + nested).replaceAll("Chart", name)
      if (changed) after = after.replace('new Error("mount")', 'new Error("changed")')
      const r = await decision(before, after)
      assert.equal(r.accepted.size, changed ? 0 : r.diagnostics.length, JSON.stringify({ depth, changed, decisions: r.decisions }))
    }), { seed: 294427, numRuns: 100 })
})

test("the native compiler's actual nested-acquire advisories all have the retained producer proof", native, async () => {
  const { spawnSync } = await import("node:child_process")
  const { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join, dirname } = await import("node:path")
  const { parseDiagnostics } = await import("../lib/diagnostics.mjs")
  const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
  const root = mkdtempSync(join(tmpdir(), "foldkit-nested-mapper-native-"))
  try {
    mkdirSync(join(root, "node_modules"))
    symlinkSync(dirname(require.resolve("effect/package.json")), join(root, "node_modules/effect"))
    symlinkSync(fileURLToPath(new URL("../../../../packages/runtime", import.meta.url)), join(root, "node_modules/vibelang-runtime"))
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    for (const [sample, count] of [[corpus, 3], [mapCorpus, 1]]) {
      let warnings
      for (const [file, text] of [["main.ts", sample.before], ["main.vibe", sample.after]]) {
        writeFileSync(join(root, file), text)
        writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, types: [] }, files: [file] }))
        const r = spawnSync(compiler, ["-p", "tsconfig.json", "--noEmit", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 30000 })
        assert.equal(r.status, 0, file + ": " + r.stdout + r.stderr)
        if (file.endsWith(".vibe")) warnings = parseDiagnostics(r.stdout + r.stderr).filter(d => d.code === "EK4804")
      }
      assert.equal(warnings.length, count)
      const result = preservedGlobalErrors(await parseStyleTree(compiler, "main.ts", sample.before),
        await parseStyleTree(compiler, "main.vibe", sample.after), sample.after, warnings)
      assert.equal(result.accepted.size, warnings.length, JSON.stringify(result.decisions))
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

const mapCorpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-map-destructured-producer.json", import.meta.url)))
test("foldkit-29: Map acquisition destructuring and cached resource bindings retain their original producer owner", native, async () => {
  const result = await decision(mapCorpus.before, mapCorpus.after, [mapCorpus.marker])
  assert.equal(result.diagnostics.length, 1)
  assert.equal(result.accepted.size, 1, JSON.stringify(result.decisions))
})

test("Map producer owners ignore mechanical locals but preserve function and mapper identity", native, async () => {
  await fc.assert(fc.asyncProperty(fc.stringMatching(/^[a-z]{1,8}$/).map(name => "resource_" + name),
    fc.stringMatching(/^[a-z]{1,8}$/).map(name => "mount_" + name), fc.string({ maxLength: 30 }), fc.boolean(), async (local, name, message, changed) => {
      const before = mapCorpus.before.replaceAll("mountMap", name).replace('"mount"', JSON.stringify(message))
      let after = mapCorpus.after.replaceAll("mountMap", name).replaceAll("resource", local)
        .replace('"mount"', JSON.stringify(changed ? message + " changed" : message))
      const r = await decision(before, after, [mapCorpus.marker])
      assert.equal(r.accepted.size, changed ? 0 : 1, JSON.stringify(r.decisions))
    }), { seed: 293437, numRuns: 200 })
  for (const after of [
    mapCorpus.after.replace("mountMap =", "unrelated ="),
    mapCorpus.after.replace("const toMapMountError", "let toMapMountError"),
    "class Error {}\n" + mapCorpus.after,
    mapCorpus.after.replace("const resource =", "try Effect.try({ try: (): number => 0, catch: toMapMountError }); const resource =")
  ]) assert.equal((await decision(mapCorpus.before, after, [mapCorpus.marker])).accepted.size, 0)
})
