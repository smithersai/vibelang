// Which file each existing tool reads (007-tooling.md, Formatting and
// existing tools): stock TypeScript type-checks through x.d.vibe.ts; the
// linter parser, the Knip compiler, the Vite plugin and Node's test runner
// read x.vibe itself.
import assert from "node:assert/strict"
import { rmSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { project, baseOptions, codes } from "../_tooling-witness.mjs"

process.env.VIBELANG_DISABLE_CACHE = "1"
const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const compilerPackage = join(repo, "packages/compiler")
const lib = 'import { tag } from "./tag.ts"\n/** Doubles n. */\nexport function double(n: number): number { return n * 2 }\nexport function label(s: string): string { return tag(s) }\n'
const node = (run, ...args) => run(process.execPath, args)
const json = r => { assert.equal(r.status, 0, r.text); return JSON.parse(r.stdout.trim().split("\n").at(-1)) }

project(({ dir, put, read, exists, invoke, stock, run }) => {
  put("tsconfig.json", { compilerOptions: { ...baseOptions(), rewriteRelativeImportExtensions: true }, include: ["*.vibe", "*.ts"], exclude: ["consumer.ts"] })
  put("lib.vibe", lib)
  put("tag.ts", 'export const tag = (s: string) => "<" + s + ">"\n')
  const build = invoke("-p", ".", "--pretty", "false")
  assert.equal(build.status, 0, build.text)

  // Type checkers: stock tsc resolves ./lib.vibe to the compiler's
  // lib.d.vibe.ts and checks the consumer against its types.
  assert.ok(exists("lib.d.vibe.ts"))
  assert.match(read("lib.d.vibe.ts"), /export declare function double\(n: number\): number;/)
  put("consumer.ts", 'import { double, label } from "./lib.vibe"\nexport const n: number = double(2)\nexport const s: string = label("x")\nexport const bad: string = double(2)\n')
  put("tsconfig.stock.json", { compilerOptions: { ...baseOptions(), noEmit: true, allowArbitraryExtensions: true }, files: ["consumer.ts"] })
  const typed = stock("-p", "tsconfig.stock.json", "--pretty", "false")
  assert.deepEqual(typed.text.trim().split("\n"), ["consumer.ts(4,14): error TS2322: Type 'number' is not assignable to type 'string'."])
  // Without the sidecar, stock tsc has nothing to read: the .vibe source is
  // not a type-checker input.
  rmSync(join(dir, "lib.d.vibe.ts"))
  assert.deepEqual(codes(stock("-p", "tsconfig.stock.json", "--pretty", "false").text), ["TS2307"])

  // Linters: the ESLint parser reads the .vibe source's own declarations.
  const tree = json(node(run, "--input-type=module", "-e",
    `import { parseESTree } from ${JSON.stringify(join(compilerPackage, "eslint.mjs"))}\nimport { readFileSync } from "node:fs"\n` +
    `const ast = parseESTree(readFileSync("lib.vibe", "utf8"), "lib.vibe")\n` +
    `console.log(JSON.stringify(ast.body.map(s => [s.type, s.source?.value ?? s.declaration?.id?.name])))`))
  assert.deepEqual(tree, [["ImportDeclaration", "./tag.ts"], ["ExportNamedDeclaration", "double"], ["ExportNamedDeclaration", "label"]])

  // Knip: its compiler returns the .vibe module's imports and exports.
  const surface = json(node(run, "--input-type=module", "-e",
    `import compile from ${JSON.stringify(join(compilerPackage, "knip.mjs"))}\nimport { readFileSync } from "node:fs"\n` +
    `console.log(JSON.stringify(compile(readFileSync("lib.vibe", "utf8"), "lib.vibe")))`))
  for (const line of ['import { tag } from "./tag.ts"', "export function double() {}", "export function label() {}"]) assert.ok(surface.includes(line), surface)

  // Bundlers: Vite with vibelang-vite bundles the .vibe module's code.
  symlinkSync(compilerPackage, join(dir, "node_modules/vibelang"))
  symlinkSync(join(repo, "docs/tools/node_modules/vite"), join(dir, "node_modules/vite"))
  symlinkSync(join(repo, "packages/vite"), join(dir, "node_modules/vibelang-vite"))
  put("entry.ts", 'import { double, label } from "./lib.vibe"\nconsole.log(JSON.stringify([double(21), label("v")]))\n')
  put("vite.config.mjs", 'import vibelang from "vibelang-vite"\nexport default { plugins: [vibelang()], logLevel: "silent", build: { ssr: "entry.ts", outDir: "bundle", rollupOptions: { output: { entryFileNames: "entry.mjs" } } } }\n')
  const bundled = node(run, join(dir, "node_modules/vite/bin/vite.js"), "build")
  assert.equal(bundled.status, 0, bundled.text)
  assert.match(read("bundle/entry.mjs"), /\/\/#region lib\.vibe/)
  assert.deepEqual(json(node(run, "bundle/entry.mjs")), [42, "<v>"])

  // Test runners: node --test with vibelang/register loads the .vibe module.
  rmSync(join(dir, "out"), { recursive: true, force: true })
  put("lib.test.mjs", 'import test from "node:test"\nimport assert from "node:assert/strict"\nimport { double, label } from "./lib.vibe"\ntest("lib", () => { assert.equal(double(21), 42); assert.equal(label("t"), "<t>") })\n')
  const tested = node(run, "--import", join(compilerPackage, "register.mjs"), "--test", "--test-reporter=tap", "lib.test.mjs")
  assert.equal(tested.status, 0, tested.text)
  assert.match(tested.stdout, /^# pass 1$/m)
})

console.log("type checkers read x.d.vibe.ts; linter, Knip, bundler and test runner read x.vibe")
