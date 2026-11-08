// run-seconds: 300
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"

export function checkErrorKeyMigration(dir, fieldless = false) {
  const compiler = process.env.VIBELANG_REWRITE_BINARY || path.resolve(dir, "../../../built/local/tsc")
  const evidence = path.join(dir, "out/migration-evidence")
  fs.rmSync(evidence, { recursive: true, force: true })
  const tick = String.fromCharCode(96), dollar = String.fromCharCode(36)
  const variants = fieldless ? [["fieldless", "", "", "_tag", false]] : [
    ["whole", "", "", "_tag", true],
    ["prefix", "_", "", "tag", true],
    ["suffix", "", "tag", "_", true]
  ]
  const modes = [
    ["ordinary", ["--fix"]],
    ["vip", ["--fix", "--fix-vip-only"]],
    ["migration", ["--fix", "--fix-migration-only"]]
  ]
  const require = createRequire(new URL("../../docs/tools/package.json", import.meta.url))
  const fastCheck = pathToFileURL(require.resolve("fast-check")).href
  const probe = [
    'import assert from "node:assert/strict"; import { Effect } from "effect";',
    'import fc from ' + JSON.stringify(fastCheck) + ';',
    ...variants.map(([name], index) => 'import { E as E' + index + ' } from "./out/' + name + '.js";'),
    'const classes = [' + variants.map(([name, , , , fields], index) =>
      '[' + JSON.stringify(name) + ', E' + index + ', ' + fields + ']').join(",") + '];',
    'const observations = [];',
    'function check(id) { for (const [name, E, fields] of classes) {',
    '  const exit = Effect.runSyncExit(Effect.sync(() => fields ? new E({ id }) : new E()));',
    '  const observed = { tag: exit._tag, value: exit._tag === "Success" ? {',
    '    tag: exit.value._tag, getter: typeof Object.getOwnPropertyDescriptor(E.prototype, "_tag")?.get === "function",',
    '    ...(fields ? { id: exit.value.id } : {}) } : undefined };',
    '  assert.deepEqual(observed, { tag: "Success", value: { tag: "E", getter: true, ...(fields ? { id } : {}) } }, name);',
    '  observations.push([name, observed]);',
    '} }',
    'check("x");',
    'fc.assert(fc.property(fc.string(), id => { check(id); return true }), { numRuns: 128, seed: 2117 });',
    'console.log(JSON.stringify(observations));'
  ].join("\n")
  const args = ["-p", ".", "--pretty", "false"]
  let compilerStarts = 0
  function project(name) {
    const work = path.join(evidence, name)
    fs.mkdirSync(work, { recursive: true })
    for (const file of ["package.json", "tsconfig.json"]) fs.copyFileSync(path.join(dir, file), path.join(work, file))
    fs.symlinkSync(path.join(dir, "node_modules"), path.join(work, "node_modules"))
    return work
  }
  function command(work, stage, bin, commandArgs, status = 0) {
    const label = path.basename(work) + "/" + stage
    process.stderr.write("error-key-migration: start " + label + "\n")
    const started = performance.now()
    if (bin === compiler) compilerStarts++
    const result = spawnSync(bin, commandArgs, { cwd: work, encoding: "utf8", timeout: 30_000, env: { ...process.env, NO_COLOR: "1" } })
    const elapsedMs = Math.round(performance.now() - started)
    process.stderr.write("error-key-migration: end " + label + " " + elapsedMs + "ms status=" + result.status + " signal=" + (result.signal || "none") + "\n")
    fs.writeFileSync(path.join(work, stage + ".json"), JSON.stringify({
      stage: label, elapsedMs, status: result.status, signal: result.signal,
      error: result.error?.message, stdout: result.stdout, stderr: result.stderr
    }, null, 2))
    assert.equal(result.status, status, label + "\n" + result.stdout + result.stderr)
    return result.stdout + result.stderr
  }
  // Independent source modules share a program so every mode checks every
  // key shape without repeatedly loading the compiler and Effect declarations.
  for (const [mode, flags] of modes) {
    const work = project(mode)
    for (const [name, prefix, suffix, raw, fields] of variants) {
      fs.writeFileSync(path.join(work, name + ".vibe"), [
        'const Brand = Schema.Literal(' + JSON.stringify(raw) + ').pipe(Schema.brand("Key"))',
        'const branded = Schema.decodeUnknownSync(Brand)(' + JSON.stringify(raw) + ')',
        'const field: ' + tick + prefix + dollar + '{typeof branded}' + suffix + tick +
          ' = ' + tick + prefix + dollar + '{branded}' + suffix + tick,
        'export error E { ' + (fields ? 'id: string; ' : '') + 'get [field](): number { return 1 } }',
        ''
      ].join("\n"))
    }
    const before = command(work, "before", compiler, [...args, "--noEmitOnError", "false"], 2)
    assert.deepEqual([...before.matchAll(/error ((?:EK|TS)\d+)/g)].map(m => m[1]), variants.map(() => "EK2117"))
    const declarations = new Map(variants.map(([name]) => {
      assert.ok(before.includes(name + ".vibe("), "missing diagnostic for " + name)
      return [name, fs.readFileSync(path.join(work, "out", name + ".d.ts"), "utf8")]
    }))
    const originalExit = JSON.parse(command(work, "run-before", process.execPath, ["--input-type=module", "-e", probe]))
    command(work, "fix", compiler, [...args, ...flags])
    const fixed = new Map(variants.map(([name]) => {
      const text = fs.readFileSync(path.join(work, name + ".vibe"), "utf8")
      assert.ok(text.includes("class E extends"), name + ": missing explicit-class repair")
      assert.equal(fs.readFileSync(path.join(work, "out", name + ".d.ts"), "utf8"), declarations.get(name), name + ": declaration changed")
      return [name, text]
    }))
    assert.deepEqual(JSON.parse(command(work, "run-after", process.execPath, ["--input-type=module", "-e", probe])), originalExit, "Exit changed")
    command(work, "fix-again", compiler, [...args, ...flags])
    for (const [name, text] of fixed) assert.equal(fs.readFileSync(path.join(work, name + ".vibe"), "utf8"), text, name + ": second repair changed source")

    // Native-resolved accessors override the base property, so no valid class
    // repair exists. All fix modes retain both error declarations and EK2117.
    if (!fieldless) {
      const rawWork = project("raw-" + mode)
      const originals = new Map(["error", "schema error"].map(form => {
        const name = form.replace(" ", "-")
        const source = 'export ' + form + ' E { id: string; get ["_tag"](): "E" { return "E" } }\n'
        fs.writeFileSync(path.join(rawWork, name + ".vibe"), source)
        return [name, source]
      }))
      const refused = command(rawWork, "refusal", compiler, [...args, ...flags], 2)
      for (const [name, source] of originals) {
        assert.ok(refused.split("\n").some(line => line.startsWith(name + ".vibe(") && line.includes("error EK2117")), name + ": missing reserved-key diagnostic")
        assert.equal(fs.readFileSync(path.join(rawWork, name + ".vibe"), "utf8"), source, name + ": invalid class repair applied")
      }
    }
  }
  assert.equal(compilerStarts, fieldless ? 9 : 12, "compiler startup budget changed")
  process.stderr.write("error-key-migration: complete " + compilerStarts + " compiler starts\n")
  console.log(fieldless ? "fieldless plain-error key migrations preserve Exits and declarations" : "nominal plain-error key migrations preserve Exits and declarations")
}
