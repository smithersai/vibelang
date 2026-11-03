import assert from "node:assert/strict"
import { test } from "node:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, realpathSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const require = createRequire(new URL("../../runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const binary = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const modules = process.env.EFFECT_NODE_MODULES || join(repo, "packages/runtime/node_modules")
const corpus = JSON.parse(readFileSync(new URL("./property-regressions/opencode-explicit-sidecar-namespace.json", import.meta.url)))
const nativeOptions = { skip: !existsSync(binary) && "build the native compiler or set VIBELANG_BINARY" }
if (process.env.VIBELANG_FUZZ_REQUIRE === "1") assert.ok(existsSync(binary), "required native compiler")
const hash = text => createHash("sha256").update(text).digest("hex")
let evidence = ""

test("explicit-sidecar resolution oracle quotes the current tooling rule", () => {
  assert.ok(readFileSync(join(repo, corpus.spec), "utf8").includes(corpus.rule))
})

function verify(input, literal = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "opencode-sidecar-namespace-")))
  try {
    symlinkSync(realpathSync(modules), join(root, "node_modules"), "dir")
    const suffixes = input.suffix === "platform" ? [".native", ""] : input.suffix === "migration" ? ["", ".d.vibe"] : undefined
    const suffix = input.suffix === "platform" ? ".native" : ""
    const directory = input.nested ? "decl/deep" : "decl"
    const sidecar = directory + "/tool.d." + input.extension + suffix + ".ts"
    const selected = input.kind === "string" ? "name.length" : input.kind === "number" ? "name.toFixed().length" : "Number(name)"
    const expression = input.invalid ? "name.thisPropertyDoesNotExist" : selected
    const declaration = literal ? corpus.declaration :
      'export * as ' + input.namespace + ' from "./tool.' + input.extension + '";\n' +
      'export declare const create: (execute: (name: ' + input.kind + ', index: number) => number) => number;\n'
    const consumer = literal ? corpus.consumer :
      'import { ' + input.namespace + ' } from "@fixture/core/tool";\n' +
      'export const answer = ' + input.namespace + '.create((name, index) => ' + expression + ' + index);\n'
    const config = {
      compilerOptions: { strict: true, noImplicitAny: !input.invalid, noEmit: true,
        skipLibCheck: input.skipLibCheck, module: "NodeNext", moduleResolution: "NodeNext",
        allowArbitraryExtensions: true, moduleSuffixes: suffixes, types: [] },
      files: ["consumer.ts"],
    }
    const files = {
      "package.json": JSON.stringify({ name: "@fixture/core", type: "module", exports: {
        "./tool": { types: "./" + sidecar, default: "./dist/tool.js" },
      } }),
      "tsconfig.json": JSON.stringify(config),
      [sidecar]: declaration,
      "consumer.ts": consumer,
    }
    if (input.nativeHomonym) files[directory + "/tool.ts"] = "export declare const create: never;\n"
    if (input.ordinaryDeclaration) files[directory + "/tool.d.ts"] = "export declare const create: never;\n"
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, name)), { recursive: true })
      writeFileSync(join(root, name), text)
    }
    const hashes = Object.fromEntries(Object.entries(files).map(([name, text]) => [name, hash(text)]))
    const parsed = ts.parseJsonConfigFileContent(config, ts.sys, root)
    assert.deepEqual(parsed.errors, [])
    let program = ts.createProgram(parsed.fileNames, parsed.options)
    const stock = ts.getPreEmitDiagnostics(program).map(d => d.code)
    program = null
    assert.deepEqual([...new Set(stock)], input.invalid ? [2339] : [], "stock TypeScript oracle")
    const native = spawnSync(binary, ["-p", join(root, "tsconfig.json"), "--pretty", "false"], {
      cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: 2 << 20,
      env: { ...process.env, NO_COLOR: "1" },
    })
    assert.ifError(native.error)
    assert.equal(native.signal, null)
    const output = native.stdout + native.stderr
    const codes = [...new Set([...output.matchAll(/\berror (TS\d+|EK\d+)\b/g)].map(m => m[1]))].sort()
    evidence = JSON.stringify({ input, stock, native: { status: native.status, codes, output: output.replaceAll(root, "<project>") } })
    assert.equal(native.status, input.invalid ? 2 : 0, evidence)
    assert.deepEqual(codes, input.invalid ? ["TS2339"] : [], evidence)
    for (const [name, expected] of Object.entries(hashes))
      assert.equal(hash(readFileSync(join(root, name))), expected, "consumer and declaration inputs remain unchanged")
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("opencode: a companion self-namespace retains callback context", nativeOptions, () => verify(corpus.input, true))
test("opencode: the same namespace reports a real callback type error even without noImplicitAny", nativeOptions,
  () => verify({ ...corpus.input, invalid: true }))
for (const skipLibCheck of [true, false])
  for (const suffix of ["none", "migration", "platform"])
    test("namespace companion with " + suffix + " suffixes, skipLibCheck " + skipLibCheck, nativeOptions,
      () => verify({ ...corpus.input, suffix, skipLibCheck, ordinaryDeclaration: true, nativeHomonym: true }))

test("property: explicit companion imports preserve contextual types and reject real mistakes", nativeOptions, async () => {
  await checkProperty(fc, {
    name: corpus.property, rule: corpus.rule,
    command: "node --test test/explicit-sidecar-namespace.property.test.mjs",
    arbitrary: fc.record({
      namespace: fc.constantFrom("CodeModeTool", "Tool", "Runtime"),
      kind: fc.constantFrom("string", "number", "boolean"),
      extension: fc.constantFrom("vibe", "vibex"), nested: fc.boolean(),
      suffix: fc.constantFrom("none", "migration", "platform"), skipLibCheck: fc.boolean(),
      nativeHomonym: fc.boolean(), ordinaryDeclaration: fc.boolean(), invalid: fc.boolean(),
    }),
    numRuns: 80, diagnostics: () => evidence, check: input => { verify(input) },
    regressions: new URL("./property-regressions/", import.meta.url),
  })
})
