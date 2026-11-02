import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dir = path.dirname(fileURLToPath(import.meta.url))
const compiler = process.env.VIBELANG_REWRITE_BINARY || fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const evidence = path.join(dir, "out/migration-evidence")
fs.rmSync(evidence, { recursive: true, force: true })
const tick = String.fromCharCode(96), dollar = String.fromCharCode(36)
const runScript = [
  'import { Effect } from "effect"; import { E } from "./out/main.js";',
  'const exit = Effect.runSyncExit(Effect.sync(() => new E({ id: "x" })));',
  'console.log(JSON.stringify({tag:exit._tag,reasons:exit._tag==="Failure"?exit.cause.reasons.map(r=>({tag:r._tag,name:r._tag==="Die"?r.defect?.name:undefined})):[]}));'
].join("\n")

for (const [variant, prefix, suffix, raw] of [
  ["whole", "", "", "_tag"],
  ["prefix", "_", "", "tag"],
  ["suffix", "", "tag", "_"]
]) {
  for (const [mode, flags] of [
    ["ordinary", ["--fix"]],
    ["vip", ["--fix", "--fix-vip-only"]],
    ["migration", ["--fix", "--fix-migration-only"]]
  ]) {
    const work = path.join(evidence, variant + "-" + mode)
    fs.mkdirSync(work, { recursive: true })
    for (const file of ["package.json", "tsconfig.json"]) fs.copyFileSync(path.join(dir, file), path.join(work, file))
    fs.symlinkSync(path.join(dir, "node_modules"), path.join(work, "node_modules"))
    const source = path.join(work, "main.vibe")
    fs.writeFileSync(source, [
      'const Brand = Schema.String.pipe(Schema.brand("Key"))',
      'const branded = Schema.decodeUnknownSync(Brand)(' + JSON.stringify(raw) + ')',
      'const field: ' + tick + prefix + dollar + '{typeof branded}' + suffix + tick +
        ' = ' + tick + prefix + dollar + '{branded}' + suffix + tick,
      'export schema error E { id: string; get [field](): number { return 1 } }',
      ''
    ].join("\n"))
    function command(stage, bin, args, status = 0) {
      const result = spawnSync(bin, args, { cwd: work, encoding: "utf8", timeout: 30_000, env: { ...process.env, NO_COLOR: "1" } })
      fs.writeFileSync(path.join(work, stage + ".json"), JSON.stringify({ status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr }, null, 2))
      assert.equal(result.status, status, variant + "/" + mode + " " + stage + "\n" + result.stdout + result.stderr)
      return result.stdout + result.stderr
    }
    const args = ["-p", ".", "--pretty", "false"]
    const before = command("before", compiler, [...args, "--noEmitOnError", "false"], 2)
    assert.deepEqual([...before.matchAll(/error ((?:EK|TS)\d+)/g)].map(m => m[1]), ["EK2117"])
    const declaration = fs.readFileSync(path.join(work, "out/main.d.ts"), "utf8")
    const originalExit = JSON.parse(command("run-before", process.execPath, ["--input-type=module", "-e", runScript]))
    assert.deepEqual(originalExit, { tag: "Failure", reasons: [{ tag: "Die", name: "TypeError" }] })
    command("fix", compiler, [...args, ...flags])
    const fixed = fs.readFileSync(source, "utf8")
    assert.ok(fixed.includes("class E extends"), "missing explicit-class repair")
    assert.equal(fs.readFileSync(path.join(work, "out/main.d.ts"), "utf8"), declaration, "declaration changed")
    assert.deepEqual(JSON.parse(command("run-after", process.execPath, ["--input-type=module", "-e", runScript])), originalExit, "Exit changed")
    command("fix-again", compiler, [...args, ...flags])
    assert.equal(fs.readFileSync(source, "utf8"), fixed, "second repair changed source")
  }
}
console.log("nominal schema-error key migrations preserve Exits and declarations")
