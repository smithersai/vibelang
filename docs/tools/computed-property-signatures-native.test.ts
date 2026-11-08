import { expect, test } from "bun:test"
import fc from "fast-check"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { block, chapter } from "./spec-witness.mjs"
import { defaultCompiler, extract, linkModules } from "./check-snippets"
import { stage } from "./first-run-stage"

const repo = resolve(import.meta.dir, "../..")
const text = chapter("006-data")
const twin = block(text, "const duplicateKeyExit")
const native = extract(text).find(b => b.language === "vibe" && b.source.includes("effect function readRepeated"))!.source
const corpus = join(repo, "typescript/vibelang/cases/computed-payload-incompatible.fail")
const diagnosticCodes = (output: string) => [...new Set([...output.matchAll(/error ((?:TS|EK)\d+)/g)].map(m => m[1]))].sort()
test("computed signatures follow TypeScript acceptance, runtime values and incompatible-type diagnostics", async () => {
  await fc.assert(fc.asyncProperty(fc.stringMatching(/^[a-z]{1,8}$/), fc.integer({ min: -100, max: 100 }), async (key, value) => {
    const temp = mkdtempSync(join(tmpdir(), "computed-signature-comparison-"))
    try {
      linkModules(temp)
      writeFileSync(join(temp, "package.json"), '{"type":"module","private":true}')
      const variant = (source: string) => source.replace(/\b7\b/g, String(value)).replace(/\bx\b/g, key)
      writeFileSync(join(temp, "comparison.ts"), variant(twin) + "\nexport { duplicateKeyExit }\n")
      writeFileSync(join(temp, "program.vibe"), variant(native) + "\nexport { readRepeated }\n")
      const config = (file: string, outDir: string) => ({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true, types: [], rootDir: ".", outDir }, files: [file] })
      const run = (args: string[]) => stage(args, { cwd: temp })
      const stock = ["node", join(repo, "experiments/node_modules/typescript/bin/tsc")]
      for (const [label, compiler, source] of [
        ["stock", stock, "comparison.ts"],
        ["vibe", [defaultCompiler()], "program.vibe"],
        ["native-ts", [defaultCompiler()], "comparison.ts"],
      ] as const) {
        writeFileSync(join(temp, label + ".json"), JSON.stringify(config(source, label)))
        const result = await run([...compiler, "-p", label + ".json", "--pretty", "false"])
        expect({ compiler: label, exitCode: result.exitCode, output: result.stdout + result.stderr }).toEqual({ compiler: label, exitCode: 0, output: "" })
      }
      const executed = await run(["node", "--input-type=module", "-e",
        'import assert from "node:assert/strict"; import {Effect} from "effect"; import {readRepeated} from "./vibe/program.js"; import {duplicateKeyExit as stock} from "./stock/comparison.js"; import {duplicateKeyExit as native} from "./native-ts/comparison.js"; assert.equal(Effect.runSync(readRepeated()), ' + value + '); for(const exit of[stock,native]){assert.equal(exit._tag,"Success"); assert.equal(exit.value,' + value + ')} console.log("checked")'])
      expect(executed.exitCode).toBe(0)
      expect(executed.stdout.trim().endsWith("checked")).toBe(true)
      for (const [label, compiler, file, original] of [
        ["negative-vibe", [defaultCompiler()], "negative.vibe", join(corpus, "main.vibe")],
        ["negative-stock", stock, "negative.ts", join(corpus, "typescript/main.ts")],
      ] as const) {
        writeFileSync(join(temp, file), readFileSync(original, "utf8").replace(/\bx\b/g, key))
        writeFileSync(join(temp, label + ".json"), JSON.stringify({ ...config(file, label), compilerOptions: { ...config(file, label).compilerOptions, noEmit: true } }))
        const rejected = await run([...compiler, "-p", label + ".json", "--pretty", "false"])
        expect(rejected.exitCode).not.toBe(0)
        expect({ compiler: label, codes: diagnosticCodes(rejected.stdout + rejected.stderr) }).toEqual({ compiler: label, codes: ["TS2717"] })
      }
    } finally { rmSync(temp, { recursive: true, force: true }) }
  }), { numRuns: 8, examples: [["x", 7], ["field", 0]] })
}, 180_000)
