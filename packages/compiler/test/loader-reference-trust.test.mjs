import fc from "fast-check"
import { loaderScope } from "../loader-scope.mjs"
import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { compileProjectSync, parseOutput } from "../project.mjs"

// A loader's compile reads a referenced project's TypeScript sources where the
// project compile reads its declaration output, so a call into the reference
// must be classified the same from either: the loader reports exactly the
// project compile's errors in the .vibe sources it serves. The receivers
// cover a method read from what try gave (examples/cloudflare-durable-object-sql
// Api.vibe's users.getByName), through a member, parentheses, an alias, a let
// and Effect.succeed, a direct call and a const, each calling an untagged
// method and one declared @throws {never}.
const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const runtime = join(repo, "packages/runtime")
const options = { strict: true, module: "Preserve", moduleResolution: "Bundler", target: "ESNext", types: [], skipLibCheck: true }

// Each receiver form calls the untagged method and the method declared
// @throws {never}; a function's line is its index plus three.
const receivers = [
  ["throughTry", "const objects = try users; return objects.METHOD(\"a\")"],
  ["throughTryMember", "const objects = try holder.users; return objects.METHOD(\"a\")"],
  ["throughTryParenthesized", "const objects = try (users); return objects.METHOD(\"a\")"],
  ["throughTryAlias", "const objects = try users; const alias = objects; return alias.METHOD(\"a\")"],
  ["throughLet", "let objects = try users; return objects.METHOD(\"a\")"],
  ["throughSucceed", "const objects = try Effect.succeed(namespace); return objects.METHOD(\"a\")"],
  ["direct", "return namespace.METHOD(\"a\")"],
  ["throughConst", "const objects = namespace; return objects.METHOD(\"a\")"]
]
const functionsFor = (forms) => forms.flatMap(([name, body]) => [
  [name, body.replaceAll("METHOD", "getByName")],
  [name + "Tagged", body.replaceAll("METHOD", "idFromName")]
])
function main(functions) {
  return [...functions.map(([name, body]) => `export const ${name} = effect { ${body} }`), ""]
}

function filesFor(functions, outDir, declarationDir) {
  return {
    "lib/package.json": JSON.stringify({ name: "lib", type: "module", exports: { ".": { types: "./" + (declarationDir || outDir) + "/index.d.ts", default: "./" + outDir + "/index.js" } } }),
    "lib/tsconfig.json": JSON.stringify({ compilerOptions: { ...options, composite: true, declaration: true, rootDir: "src", outDir, ...(declarationDir ? { declarationDir } : {}) }, include: ["src"] }),
    "lib/src/index.ts": [
      'import * as Effect from "effect/Effect"',
      "export interface Namespace {",
      "  getByName: (name: string) => string",
      "  /** @throws {never} */",
      "  idFromName(name: string): string",
      "}",
      "const make = (): Namespace => ({ getByName: (name) => name, idFromName: (name) => name })",
      "export const users: Effect.Effect<Namespace> = Effect.sync(make)",
      "export const namespace: Namespace = make()",
      "export const holder: { readonly users: Effect.Effect<Namespace> } = { users }",
      ""
    ].join("\n"),
    "app/package.json": JSON.stringify({ name: "app", type: "module", dependencies: { lib: "*" } }),
    "app/tsconfig.json": JSON.stringify({ compilerOptions: { ...options, noEmit: true }, include: ["src"], references: [{ path: "../lib" }] }),
    "app/src/main.vibe": ['import * as Effect from "effect/Effect"', 'import { holder, namespace, users } from "lib"', ...main(functions)].join("\n")
  }
}

const located = (diagnostic) => `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} ${diagnostic.code}`

function checkReference({ forms = receivers, outDir = "out", declarationDir } = {}) {
  const functions = functionsFor(forms)
  const files = filesFor(functions, outDir, declarationDir)
  const root = mkdtempSync(join(tmpdir(), "vibelang-loader-reference-"))
  try {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, name)), { recursive: true })
      writeFileSync(join(root, name), text)
    }
    for (const project of ["lib", "app"]) {
      mkdirSync(join(root, project, "node_modules"), { recursive: true })
      symlinkSync(effect, join(root, project, "node_modules/effect"), "dir")
      symlinkSync(runtime, join(root, project, "node_modules/vibelang-runtime"), "dir")
    }
    symlinkSync("../../lib", join(root, "app/node_modules/lib"), "dir")
    const build = spawnSync(compiler, ["-b", join(root, "lib/tsconfig.json"), "--pretty", "false"], { encoding: "utf8" })
    assert.equal(build.status, 0, build.stdout + build.stderr)
    const app = join(root, "app")
    const project = join(app, "tsconfig.json")
    const full = spawnSync(compiler, ["-p", project, "--pretty", "false"], { cwd: app, encoding: "utf8", maxBuffer: 1 << 28 })
    assert.equal(full.signal, null, full.stderr)
    assert.ok([0, 1, 2].includes(full.status), full.stdout + full.stderr)
    const expected = parseOutput(full.stdout + full.stderr, app).diagnostics.filter((d) => d.category === "error").map(located).sort()
    const loaded = compileProjectSync({ [loaderScope]: true, project, compiler, cache: false })
    assert.deepEqual(loaded.errors.map(located).sort(), expected, `project compile:\n${full.stdout}${full.stderr}\nloader: ${JSON.stringify(loaded.errors)}`)
    // Calls the project compile already reports stay reported: a direct call,
    // a let receiver and an alias; no method declared @throws {never} is.
    const main = join(app, "src/main.vibe")
    const reported = (name) => expected.some((d) => d.startsWith(`${main}:${functions.findIndex(([n]) => n === name) + 3}:`) && d.endsWith("EK0403"))
    for (const [name] of functions.filter(([name]) => ["direct", "throughConst", "throughLet", "throughTryAlias"].includes(name))) assert.ok(reported(name), `${name}: ${expected}`)
    for (const [name] of functions.filter(([name]) => name.endsWith("Tagged"))) assert.ok(!reported(name), `${name}: ${expected}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("a loader's compile reports the project compile's errors for calls into a referenced project", () => {
  checkReference()
})

test("referenced foreign receivers agree across generated forms and declaration layouts", () => {
  fc.assert(fc.property(
    fc.record({
      forms: fc.shuffledSubarray(receivers, { minLength: 1 }),
      outDir: fc.constantFrom("out", "build/js", ".generated"),
      declarationDir: fc.option(fc.constantFrom("types", "build/types"), { nil: undefined })
    }),
    (scenario) => checkReference(scenario)
  ), { seed: 403, numRuns: 8 })
})

test("the Alchemy referenced-service corpus agrees in loader and project compilation", () => {
  const corpus = JSON.parse(readFileSync(new URL("./fixtures/alchemy-durable-object-sql-referenced-users.json", import.meta.url), "utf8"))
  checkReference({ ...corpus, forms: corpus.receivers.map((key) => receivers.find(([name]) => name === key)) })
})
