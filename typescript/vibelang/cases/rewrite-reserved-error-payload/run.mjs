import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dir = path.dirname(fileURLToPath(import.meta.url))
const compiler = process.env.VIBELANG_REWRITE_BINARY || fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const evidence = path.join(dir, "out/migration-evidence")
fs.rmSync(evidence, { recursive: true, force: true })

for (const form of ["error", "schema error"]) {
  for (const variant of ["literal", "family", "abstract-family", "trivia"]) {
    const work = path.join(evidence, form.replace(" ", "-") + "-" + variant)
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
  const e = new ${family ? 'Child({ id: "x", n: 7 })' : 'E({ id: "x" })'}
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
    assert.deepEqual([...before.matchAll(/error ((?:EK|TS)\d+)/g)].map(m => m[1]), ["EK2117"])
    const declaration = fs.readFileSync(path.join(work, "out/main.d.ts"), "utf8")
    const runArgs = ["--input-type=module", "-e", `import { Effect } from "effect";
import { main } from "./out/main.js";
process.stdout.write(JSON.stringify(await Effect.runPromiseExit(main())));
`]
    const originalExit = JSON.parse(command("run-before", process.execPath, runArgs))
    assert.equal(originalExit._tag, "Success")
    assert.deepEqual(originalExit.value, [family ? "Child" : "E", "x", "family", true])
    command("fix", compiler, [...compileArgs, "--fix"])
    const fixed = fs.readFileSync(source, "utf8")
    assert.ok(fixed.includes("class E extends"), "the reserved field was not migrated to its class")
    assert.equal(fs.readFileSync(path.join(work, "out/main.d.ts"), "utf8"), declaration, "migration changed exported declarations")
    assert.deepEqual(JSON.parse(command("run-after", process.execPath, runArgs)), originalExit, "migration changed the runtime Exit")
    command("fix-again", compiler, [...compileArgs, "--fix"])
    assert.equal(fs.readFileSync(source, "utf8"), fixed, "the second fix changed the source")
  }
}
process.stdout.write("reserved error payload migration preserves the program\n")
