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
// Accepted VIP-40, "Emit, declarations, source maps":
// "When the file's VIP-27 sidecar main.d.vibe.ts refers to the body,
// main.vibe.parse.d.ts is also written beside main.vibe, so stock tsc resolves it."
const rule = "VIP-40: a body's TypeScript declaration and JSDoc are available beside the source to stock tsc"
let diagnostics = ""

function check(input) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-module-sidecars-"))
  try {
    const sourceDir = join(root, "src")
    mkdirSync(sourceDir)
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    writeFileSync(join(sourceDir, "main.vibe"), [
      "module " + input.name + " {",
      "  /** @throws {RangeError} */",
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
    const compile = spawnSync(binary, ["-p", "tsconfig.json", "--pretty", "false"], {cwd:root, encoding:"utf8", timeout:60000})
    diagnostics = compile.stdout + compile.stderr
    assert.ifError(compile.error)
    assert.equal(compile.status, 0, diagnostics)
    // Names here use lowercase ASCII, whose generated filenames VIP-40 keeps.
    const declaration = join(sourceDir, "main.vibe." + input.name + ".d.ts")
    assert.ok(existsSync(declaration), "missing declaration beside source: " + input.name)
    assert.match(readFileSync(declaration, "utf8"), /@throws \{RangeError\}/)
    const repeated = spawnSync(binary, ["-p", "tsconfig.json", "--pretty", "false"], {cwd:root, encoding:"utf8", timeout:60000})
    assert.ifError(repeated.error)
    assert.equal(repeated.status, 0, repeated.stdout + repeated.stderr)
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
    // Stock tsc reads only declarations, without the VibeLang source in its program.
    const result = spawnSync(process.execPath, [stock, "-p", "consumer.json", "--pretty", "false"], {cwd:root, encoding:"utf8", timeout:60000})
    diagnostics = result.stdout + result.stderr
    assert.ifError(result.error)
    assert.equal(result.status, 0, diagnostics)
    const program = ts.createProgram([join(root, "consumer.ts")], {
      strict:true, noEmit:true, allowArbitraryExtensions:true, allowImportingTsExtensions:true,
      target:ts.ScriptTarget.ESNext, module:ts.ModuleKind.ESNext, moduleResolution:ts.ModuleResolutionKind.Bundler,
      types:[], ...(rootDirs ? {rootDirs:rootDirs.map(dir => join(root, dir))} : {})
    })
    const checker = program.getTypeChecker()
    let signature
    const visit = node => {
      if (!signature && ts.isCallExpression(node)) signature = checker.getResolvedSignature(node)
      ts.forEachChild(node, visit)
    }
    visit(program.getSourceFile(join(root, "consumer.ts")))
    assert.ok(signature?.getJsDocTags().some(tag => tag.name === "throws" && tag.text?.some(part => part.text.includes("RangeError"))),
      "stock TypeScript must see the foreign @throws tag through the re-export")
  } finally { rmSync(root, {recursive:true, force:true}) }
}

test("stock TypeScript reads a module body's re-export and throws contract", () => {
  check({name:"parse", form:"named", layout:"", noEmit:true})
})

test("module declarations accompany sidecars across layouts and re-export forms", async () => {
  await checkProperty(fc, {
    name:"module-source-sidecars", rule,
    command:"node --test test/module-sidecars.property.test.mjs",
    arbitrary:fc.record({
      name:fc.constantFrom("parse", "ports", "parser_2"),
      form:fc.constantFrom("named", "star", "namespace"),
      layout:fc.constantFrom("", "types", ".vibe/declarations"),
      noEmit:fc.boolean(), discovery:fc.boolean(), inPlace:fc.boolean()
    }),
    regressions:new URL("./property-regressions/", import.meta.url),
    numRuns:40, diagnostics:()=>diagnostics, check
  })
})
