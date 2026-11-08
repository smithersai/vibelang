// run-seconds: 600
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dir = path.dirname(fileURLToPath(import.meta.url))
const compiler = process.env.VIBELANG_REWRITE_BINARY || fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const evidence = path.join(dir, "out/migration-evidence")
fs.rmSync(evidence, { recursive: true, force: true })

let sample = 0
function probe(form, variant, id = "x", n = 7) {
    const work = path.join(evidence, form.replace(" ", "-") + "-" + variant + "-" + sample++)
    fs.mkdirSync(work, { recursive: true })
    for (const name of ["package.json", "tsconfig.json"]) fs.copyFileSync(path.join(dir, name), path.join(work, name))
    fs.symlinkSync(path.join(dir, "node_modules"), path.join(work, "node_modules"))
    const source = path.join(work, "main.vibe")
    const family = variant.includes("family")
    const abstract = variant === "abstract-family" ? "abstract " : ""
    const tag = family ? "string" : '"E"'
    const field = variant === "trivia" ? `_tag /* key */: /* type */ ${tag}` : `_tag: ${tag}`
    fs.writeFileSync(source, `export ${abstract}${form} E { ${field}; id: string }
${family ? `export ${form} Child extends E { n: number }` : ""}
export effect function main() {
  const e = new ${family ? "Child({ id: " + JSON.stringify(id) + ", n: " + n + " })" : "E({ id: " + JSON.stringify(id) + " })"}
  return [e._tag, e.id, match (e) { when E: "family"; default: "miss"; }, e instanceof E]
}
`)
    function command(stage, bin, args, status = 0) {
      const result = spawnSync(bin, args, { cwd: work, encoding: "utf8", timeout: 30_000, env: { ...process.env, NO_COLOR: "1" } })
      fs.writeFileSync(path.join(work, stage + ".json"), JSON.stringify({ status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr }, null, 2))
      assert.equal(result.status, status, `${form}/${variant}: ${stage}\n${result.stdout}${result.stderr}`)
      return result.stdout + result.stderr
    }
    const compileArgs = ["-p", ".", "--pretty", "false"]
    const before = command("before", compiler, [...compileArgs, "--noEmitOnError", "false"], 2)
    // VIP-13/VIP-29 reject the reserved field and inheritance independently.
    const expectedDiagnostics = family ? ["EK2117", "EK2117"] : ["EK2117"]
    assert.deepEqual([...before.matchAll(/error ((?:EK|TS)\d+)/g)].map(m => m[1]), expectedDiagnostics)
    assert.match(before, /member name _tag is reserved/)
    if (family) assert.match(before, /cannot have an extends clause/)
    const declaration = fs.readFileSync(path.join(work, "out/main.d.ts"), "utf8")
    const runArgs = ["--input-type=module", "-e", `import { Effect } from "effect";
import { main } from "./out/main.js";
process.stdout.write(JSON.stringify(await Effect.runPromiseExit(main())));
`]
    const originalExit = JSON.parse(command("run-before", process.execPath, runArgs))
    assert.equal(originalExit._tag, "Success")
    // An error's matcher tests its tag, then instanceof its class, so every
    // legacy family root, concrete or abstract, matches its child (D278).
    assert.deepEqual(originalExit.value, [family ? "Child" : "E", id, "family", true])
}
for (const form of ["error", "schema error"]) {
  for (const variant of ["literal", "family", "abstract-family", "trivia"]) probe(form, variant)
}
const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const fc = require("fast-check")
fc.assert(fc.property(fc.constantFrom("error", "schema error"),
  fc.constantFrom("literal", "family", "abstract-family", "trivia"),
  fc.string({ maxLength: 8 }), fc.integer({ min: 0, max: 100 }), probe),
  { seed: 71329, numRuns: 16 })
process.stdout.write("reserved error payload migration preserves the program\n")
