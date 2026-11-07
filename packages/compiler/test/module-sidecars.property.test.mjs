import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { createRequire } from "node:module"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const binary = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const modules = process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules")
const ts = createRequire(import.meta.url)(join(modules, "typescript"))
const stock = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "typescript/bin/tsc")
// Accepted VIP-40, "Declarations": "When the file's VIP-27 sidecar
// main.d.vibe.ts refers to the body, main.vibe.parse.d.ts is also written
// beside that sidecar, so stock tsc resolves the sidecar's relative import
// from the sidecar's actual location: beside main.vibe by default, or at the
// mirrored path under vibe.sidecarDir."
const rule = "VIP-40: a body's TypeScript declaration and JSDoc are available beside its sidecar to stock tsc"
let diagnostics = ""

function check(input, { cli = false } = {}) {
  const stages = []
  const started = performance.now()
  const run = (stage, command, args, root) => {
    const start = performance.now()
    const result = spawnSync(command, args, {cwd:root, encoding:"utf8", timeout:60000})
    stages.push({stage, elapsedMs:Math.round(performance.now() - start), status:result.status,
      signal:result.signal, error:result.error?.code, stdoutChars:result.stdout?.length ?? 0,
      stderrChars:result.stderr?.length ?? 0})
    diagnostics = JSON.stringify({input, typescript:ts.version, stages})
    if (result.error) throw new Error("module sidecar stage failed: " + diagnostics, {cause:result.error})
    assert.equal(result.status, 0, diagnostics + "\n" + result.stdout + result.stderr)
    return result
  }
  const root = mkdtempSync(join(tmpdir(), "vibelang-module-sidecars-"))
  try {
    const sourceDir = join(root, "src")
    mkdirSync(sourceDir)
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    writeFileSync(join(sourceDir, "main.vibe"), [
      "module " + input.name + " {",
      "  /** @throws {RangeError} */",
      input.arrow ? "  export const port = (raw: string): number => Number(raw)" :
      "  export function port(raw: string): number { return Number(raw) }",
      "  export interface Port { readonly value: number }",
      "}",
      input.form === "namespace" ? "export * as ports from " + input.name :
        input.form === "star" ? "export * from " + input.name :
        "export { port, type Port } from " + input.name,
      ""
    ].join("\n"))
    const options = {
      strict: true, skipLibCheck: false, target: "esnext", module: "esnext",
      moduleResolution: "bundler", allowArbitraryExtensions: true, types: [],
      declaration: true, rootDir: ".", ...(input.inPlace ? {} : {outDir: "out"}), noEmit: input.noEmit
    }
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: options, ...(input.discovery ? { include:["src/**/*"] } : { files:["src/main.vibe"] }),
      vibe: { effectGlobals: false, effectModules: false, ...(input.layout ? {sidecarDir: input.layout} : {}) }
    }))
    run("emit", binary, ["-p", "tsconfig.json", "--pretty", "false"], root)
    // Names here use lowercase ASCII, whose generated filenames VIP-40 keeps.
    // The sidecar sits beside the source, or at its mirrored path under sidecarDir.
    const sidecarDir = input.layout ? join(root, input.layout, "src") : sourceDir
    const declaration = join(sidecarDir, "main.vibe." + input.name + ".d.ts")
    assert.ok(existsSync(declaration), "missing declaration beside sidecar: " + input.name)
    assert.match(readFileSync(declaration, "utf8"), /@throws \{RangeError\}/)
    run("repeat-emit", binary, ["-p", "tsconfig.json", "--pretty", "false"], root)
    // A consumer names the source; stock TypeScript finds its sidecar through
    // allowArbitraryExtensions and, for a mirrored layout, rootDirs.
    const sidecar = "./src/main.vibe"
    const rootDirs = input.layout ? [".", input.layout] : undefined
    const access = input.form === "namespace" ? "ports.port" : "port"
    writeFileSync(join(root, "consumer.ts"), [
      input.form === "namespace" ? 'import { ports } from "' + sidecar + '"' : 'import { port } from "' + sidecar + '"',
      "const n: number = " + access + '("80")',
      "// @ts-expect-error the re-export must not become any",
      "const bad: string = " + access + '("80")',
      "// @ts-expect-error parameter type survives the module boundary",
      access + "(80)",
      ""
    ].join("\n"))
    writeFileSync(join(root, "consumer.json"), JSON.stringify({
      compilerOptions:{...options, noEmit:true, declaration:false, allowImportingTsExtensions:true, ...(rootDirs ? {rootDirs} : {})},
      files:["consumer.ts"]
    }))
    // Exercise the stock command once; generated layouts use the same stock
    // checker in-process, including all diagnostics and @ts-expect-error checks.
    if (cli) run("stock-cli", process.execPath, [stock, "-p", "consumer.json", "--pretty", "false"], root)
    const parsed = ts.getParsedCommandLineOfConfigFile(join(root, "consumer.json"), {}, {
      ...ts.sys, onUnRecoverableConfigFileDiagnostic: diagnostic => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
      }
    })
    assert.ok(parsed)
    const checkStarted = performance.now()
    const program = ts.createProgram(parsed.fileNames, parsed.options)
    const errors = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)]
    stages.push({stage:"stock-checker", elapsedMs:Math.round(performance.now() - checkStarted),
      diagnostics:errors.length})
    diagnostics = JSON.stringify({input, typescript:ts.version, stages})
    assert.ok(stages.at(-1).elapsedMs < 60000, "stock checker exceeded its 60-second budget: " + diagnostics)
    assert.deepEqual(errors.map(error => ({code:error.code,
      message:ts.flattenDiagnosticMessageText(error.messageText, "\n")})), [], diagnostics)
    if (cli) {
      // A failing consumer proves that the API path checks types rather than
      // merely loading declarations or inspecting their JSDoc.
      const consumer = join(root, "consumer.ts")
      const source = readFileSync(consumer, "utf8")
      writeFileSync(consumer, source.replace('const n: number = ' + access + '("80")',
        "const n: number = " + access + "(80)"))
      const invalid = ts.createProgram(parsed.fileNames, parsed.options)
      assert.ok(ts.getPreEmitDiagnostics(invalid).some(error => error.code === 2345),
        "stock checker must reject a number passed to the declared string parameter")
      writeFileSync(consumer, source)
    }
    const checker = program.getTypeChecker()
    let signature
    const visit = node => {
      if (!signature && ts.isCallExpression(node)) signature = checker.getResolvedSignature(node)
      ts.forEachChild(node, visit)
    }
    visit(program.getSourceFile(join(root, "consumer.ts")))
    assert.ok(signature?.getJsDocTags().some(tag => tag.name === "throws" && tag.text?.some(part => part.text.includes("RangeError"))),
      "stock TypeScript must see the foreign @throws tag through the re-export")
    process.stderr.write("module-sidecars " + JSON.stringify({input, stages,
      elapsedMs:Math.round(performance.now() - started)}) + "\n")
  } finally { rmSync(root, {recursive:true, force:true}) }
}

test("stock TypeScript reads a module body's re-export and throws contract", () => {
  check({name:"parse", form:"named", layout:"", noEmit:true}, {cli:true})
})

test("module declarations accompany sidecars across layouts and re-export forms", async () => {
  await checkProperty(fc, {
    name:"module-source-sidecars", rule,
    command:"node --test test/module-sidecars.property.test.mjs",
    arbitrary:fc.record({
      name:fc.constantFrom("parse", "ports", "parser_2"),
      form:fc.constantFrom("named", "star", "namespace"),
      layout:fc.constantFrom("", "types", ".vibe/declarations"),
      noEmit:fc.boolean(), discovery:fc.boolean(), inPlace:fc.boolean(), arrow:fc.boolean()
    }),
    regressions:new URL("./property-regressions/", import.meta.url),
    numRuns:40, diagnostics:()=>diagnostics, check:input => check(input)
  })
})
