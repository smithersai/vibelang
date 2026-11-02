import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { pathAliases, renameBatch, rewriteImports } from "../lib/codemod.mjs"

// codemod-gap:nonrelative-ts-extension (drive-t3code-apps 2026-11-02T04:38Z):
// a migrated t3code web module imported a module that stays TypeScript as
// `~/state/filesystem`, and the codemod wrote `~/state/filesystem.ts`, which
// native TS2877 rejects under rewriteRelativeImportExtensions. 23 of 160 web
// modules reverted on it.

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const compiler = process.env.VIBELANG_BINARY
const write = (root, files) => {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
}
// apps/web/tsconfig.json's resolution options, reduced to what resolution reads.
const web = (flag) => ({
  target: "ESNext", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, rootDir: "./src",
  allowImportingTsExtensions: flag !== true, noEmit: flag !== true, paths: { "~/*": ["./src/*"] },
  ...(flag === undefined ? {} : { rewriteRelativeImportExtensions: flag }),
})
const assetUrls = readFileSync(new URL("./corpus/t3code-alias-retained-typescript.ts", import.meta.url), "utf8")
function t3code(flag = true) {
  const root = mkdtempSync(join(tmpdir(), "t3code-alias-retained-"))
  write(root, {
    "tsconfig.json": JSON.stringify({ compilerOptions: web(flag), include: ["src/**/*"] }),
    "package.json": '{"type":"module"}',
    "src/state/filesystem.ts": "export type ReadAccess = { readonly granted: boolean }\nexport function readAccess(): ReadAccess { return { granted: true } }\n",
    "src/assets/base.ts": 'export const assetBase = "/assets/"\n',
    "src/assets/assetUrls.ts": assetUrls,
  })
  return root
}
const options = (root) => ts.getParsedCommandLineOfConfigFile(join(root, "tsconfig.json"), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} }).options
const resolve = (root, specifier, importer) => ts.resolveModuleName(specifier, join(root, importer), options(root), ts.sys).resolvedModule?.resolvedFileName

test("t3code web: a migrated module's alias to a module that stays TypeScript keeps its spelling", () => {
  const root = t3code()
  try {
    const aliases = pathAliases(ts, root)
    const renamed = renameBatch(root, ["src/assets/assetUrls.ts", "src/assets/base.ts"])
    const scope = ["src/state/filesystem.ts", ...renamed.map((r) => r.to)]
    const edits = rewriteImports(root, scope, renamed.map((r) => r.to), aliases)
    // The batch's own module still gets its source name; the native one keeps `~/state/filesystem`.
    assert.deepEqual(edits, [{ file: "src/assets/assetUrls.vibe", from: "~/assets/base", to: "./base.vibe" }])
    const text = readFileSync(join(root, "src/assets/assetUrls.vibe"), "utf8")
    assert.equal(text, assetUrls.replace('"~/assets/base"', '"./base.vibe"'))
    assert.equal(resolve(root, "~/state/filesystem", "src/assets/assetUrls.vibe"), join(root, "src/state/filesystem.ts"))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

const spelling = fc.record({
  flag: fc.constantFrom(true, false, undefined),
  prefix: fc.constantFrom("~/", "@/", "#app/"),
  name: fc.constantFrom("leaf", "state/filesystem", "lib/composer.context"),
  form: fc.constantFrom("", ".js", ".ts", "dir", "dir/"),
  kind: fc.constantFrom(".ts", ".mts"),
})
function generated({ flag, prefix, name, form, kind }) {
  const root = mkdtempSync(join(tmpdir(), "alias-retained-"))
  const directory = form.startsWith("dir")
  const module = "src/" + name + (directory ? "/index" : "") + ".ts"
  // A `.ts` name in the TypeScript original is valid only without extension rewriting (TS2877 there too).
  const ext = directory || (form === ".ts" && flag === true) ? "" : form
  const specifier = prefix + name + ext + (form === "dir/" ? "/" : "")
  const importer = "src/app/view" + kind
  const original = `import { x } from "${specifier}"\nimport { y } from "${prefix}moved"\nexport const answer: number = x + y\n`
  write(root, {
    "tsconfig.json": JSON.stringify({ compilerOptions: { ...web(flag), paths: { [prefix + "*"]: ["./missing/*", "./src/*"] } }, include: ["src/**/*"] }),
    "package.json": '{"type":"module"}',
    [module]: "export const x = 1\n",
    "src/moved.ts": "export const y = 2\n",
    [importer]: original,
  })
  return { root, module, importer, specifier, original }
}

test("a .vibe importer keeps every alias spelling of a module that stays TypeScript, and still renames migrated ones", () => {
  let checked = 0
  fc.assert(fc.property(spelling, (input) => {
    const g = generated(input)
    try {
      const before = resolve(g.root, g.specifier, g.importer)
      assert.equal(before, join(g.root, g.module), "the original resolves")
      const aliases = pathAliases(ts, g.root)
      const renamed = renameBatch(g.root, [g.importer, "src/moved.ts"])
      const vibe = renamed.find((r) => r.from === g.importer).to
      const moved = renamed.find((r) => r.from === "src/moved.ts").to
      const edits = rewriteImports(g.root, [g.module, vibe, moved], [vibe, moved], aliases)
      assert.equal(edits.length, 1, JSON.stringify(edits))
      assert.ok(edits[0].from === input.prefix + "moved" && edits[0].to.endsWith("moved.vibe"))
      const text = readFileSync(join(g.root, vibe), "utf8")
      assert.equal(text, g.original.replace(`"${input.prefix}moved"`, `"${edits[0].to}"`))
      // Same module from the renamed importer; a relative name is the only non-alias spelling written.
      assert.equal(resolve(g.root, g.specifier, vibe), before)
      checked++
    } finally { rmSync(g.root, { recursive: true, force: true }) }
  }), { seed: 2026110205, numRuns: 240 })
  assert.equal(checked, 240)
})

function emitTypeScript(root) {
  const parsed = ts.getParsedCommandLineOfConfigFile(join(root, "tsconfig.json"), { noEmit: false, declaration: true, emitDeclarationOnly: true, outDir: join(root, "ts-out"), allowImportingTsExtensions: false }, { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} })
  const program = ts.createProgram(parsed.fileNames, parsed.options)
  const emitted = program.emit()
  assert.deepEqual([...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics].map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [])
}

test("t3code web: the codemod's output compiles natively and keeps the module's declaration", { skip: !compiler && "set VIBELANG_BINARY" }, () => {
  const root = t3code()
  try {
    emitTypeScript(root)
    const original = readFileSync(join(root, "ts-out/assets/assetUrls.d.ts"), "utf8")
    const aliases = pathAliases(ts, root)
    const renamed = renameBatch(root, ["src/assets/assetUrls.ts"])
    rewriteImports(root, ["src/state/filesystem.ts", "src/assets/base.ts", renamed[0].to], [renamed[0].to], aliases)
    const result = spawnSync(compiler, ["-p", "tsconfig.json", "--noEmit", "false", "--declaration", "--outDir", "out", "--pretty", "false", "--singleThreaded"], { cwd: root, encoding: "utf8" })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const sidecar = join(root, "src/assets/assetUrls.d.vibe.ts")
    const declaration = existsSync(sidecar) ? sidecar : join(root, "out/assets/assetUrls.d.ts")
    assert.equal(readFileSync(declaration, "utf8"), original)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("the README states the retained-TypeScript alias rule", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes("A migrated module's paths alias to a module that stays TypeScript keeps its authored spelling"))
})

