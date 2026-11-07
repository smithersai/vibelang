import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, posix } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { routeBundledImports } from "../lib/bundled-imports.mjs"
import { loadTypeScript } from "../lib/declarations.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const fc = createRequire(join(repo, "packages/runtime/package.json"))("fast-check")
const ts = loadTypeScript([join(repo, "packages/compiler/test/eslint"), join(repo, ".smithers")])
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-ancestor-sidecars.json", import.meta.url)))
const put = (root, file, text) => {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), text)
}

function exercise({ directories, ancestorDepth, basename = "error", runtime = false }) {
  const root = mkdtempSync(join(tmpdir(), "ancestor-sidecars-"))
  const dir = directories.join("/")
  const ancestor = directories.slice(0, ancestorDepth).join("/") || "."
  const source = `${dir}/src/${basename}.vibe`
  const stem = posix.relative(ancestor, source).replace(/\.vibe$/, "")
  const header = `${dir}/.vibe/declarations/${stem}.d.vibe.ts`
  const output = `${dir}/.vibelang/js/src/${basename}.js`
  const importer = `${dir}/src/use.ts`
  const original = `import * as API from "./${basename}.vibe"\nexport type Failure = API.Failure\nexport const value: number = API.value\n`
  const manifest = JSON.stringify({ name: "@fixture/consumer", type: "module" }, null, 2) + "\n"
  try {
    put(root, `${dir}/package.json`, manifest)
    put(root, `${dir}/tsconfig.json`, JSON.stringify({ compilerOptions: { rootDir: posix.relative(dir, ancestor) || "." }, vibe: { sidecarDir: ".vibe/declarations" } }) + "\n")
    put(root, source, 'export const value = 42\nexport type Failure = { readonly _tag: "Failure" }\n')
    put(root, output, "export const value = 42\n")
    put(root, header, 'export declare const value: number\nexport type Failure = { readonly _tag: "Failure" }\n')
    put(root, importer, original)
    const options = {
      root,
      packages: [{ dir, sources: ["src"] }],
      ts,
      compiler: process.env.VIBELANG_NATIVE_COMPILER,
      native: true,
      outputs: { [source]: output },
    }
    routeBundledImports(options)
    const entry = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")).imports[`#vibelang/emitted/src/${basename}`]
    assert.equal(entry.types, "./" + posix.relative(dir, header), "the types condition must name the physical compatibility declaration")
    const packageFile = join(root, dir, "package.json")
    const stale = JSON.parse(readFileSync(packageFile, "utf8"))
    stale.imports[`#vibelang/emitted/src/${basename}`].types = "./missing.d.vibe.ts"
    writeFileSync(packageFile, JSON.stringify(stale, null, 2) + "\n")
    assert.ok(routeBundledImports(options).changed.includes(`${dir}/package.json`), "an existing route refreshes its declaration target")
    assert.equal(JSON.parse(readFileSync(packageFile, "utf8")).imports[`#vibelang/emitted/src/${basename}`].types, entry.types)
    const program = ts.createProgram([join(root, importer)], {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      noLib: true,
      types: [],
      allowJs: true,
      allowArbitraryExtensions: true,
      skipLibCheck: true,
    })
    const diagnostics = program.getSemanticDiagnostics(program.getSourceFile(join(root, importer)))
    assert.deepEqual(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [], "stock TypeScript retains the namespace's exported type")
    assert.deepEqual(routeBundledImports(options).changed, [], "the route is stable")
    const custom = "./custom/retained.d.ts"
    put(root, `${dir}/${custom}`, readFileSync(join(root, header), "utf8"))
    const authored = JSON.parse(readFileSync(packageFile, "utf8"))
    authored.imports[`#vibelang/emitted/src/${basename}`].types = custom
    writeFileSync(packageFile, JSON.stringify(authored, null, 2) + "\n")
    routeBundledImports(options)
    assert.equal(JSON.parse(readFileSync(packageFile, "utf8")).imports[`#vibelang/emitted/src/${basename}`].types, custom, "an existing custom declaration target is retained")
    if (runtime) {
      const built = spawnSync("bun", ["build", "src/use.ts", "--target=bun", "--format=esm", "--outfile=out.mjs"], { cwd: join(root, dir), encoding: "utf8" })
      assert.equal(built.status, 0, built.stdout + built.stderr)
      const ran = spawnSync("bun", ["-e", 'import { value } from "./out.mjs"; console.log(value)'], { cwd: join(root, dir), encoding: "utf8" })
      assert.equal(ran.status, 0, ran.stderr)
      assert.equal(ran.stdout.trim(), "42")
    }
    rmSync(join(root, header))
    rmSync(join(root, dir, custom))
    const missing = routeBundledImports(options)
    assert.ok(missing.warnings.some(warning => warning.includes(`${dir}/package.json: missing compatibility declaration for ${source}`)), "missing headers produce a located routing warning")
    routeBundledImports({ ...options, restore: true })
    assert.equal(readFileSync(join(root, importer), "utf8"), original)
    assert.equal(readFileSync(join(root, dir, "package.json"), "utf8"), manifest)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("ancestor declaration routes quote the API identity contract", () => {
  assert.ok(readFileSync(SpecPath("001-functions.md"), "utf8").includes(corpus.quote))
})

test("ancestor-root compatibility declarations keep native namespace types and runtime bundling", () => {
  exercise({ ...corpus, runtime: true })
})

test("package routes retain types across every in-repository ancestor source root", async () => {
  const segment = fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/)
  await checkProperty(fc, {
    name: "opencode-ancestor-sidecar-layout",
    rule: corpus.quote,
    command: "node --test .smithers/flows/migrate/test/ancestor-sidecars.property.test.mjs",
    numRuns: 80,
    arbitrary: fc.record({ directories: fc.array(segment, { minLength: 1, maxLength: 5 }), rootChoice: fc.nat(5), basename: segment }),
    check: ({ directories, rootChoice, basename }) => exercise({ directories, ancestorDepth: rootChoice % (directories.length + 1), basename }),
  })
})
