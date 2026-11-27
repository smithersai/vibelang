import assert from "node:assert/strict"
import { existsSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"
import { compilerDir, createShimmedProject, runNode, runTsc, skipReason } from "./_helpers.mjs"

const esbuildEntry = join(compilerDir, "node_modules/esbuild/lib/main.js")
const knipBin = join(compilerDir, "node_modules/.bin/knip")

test("esbuild bundles JS emitted by the TypeScript shim from a mixed .ts + // @vibe + .vibe project", {
  skip: skipReason || (!existsSync(esbuildEntry) && "esbuild not installed in packages/compiler/node_modules"),
}, (t) => {
  const root = createShimmedProject(t, {
    "src/core.vibe": 'export effect function greet(name: string) { return `hello ${name}` }\n',
    "src/wrap.ts": '// @vibe\nimport { greet } from "./core.vibe"\nexport effect function shout(name: string) { return (try greet(name)).toUpperCase() }\n',
    "src/index.ts": 'import { Effect } from "effect"\nimport { shout } from "./wrap.js"\nexport const result = await Effect.runPromise(shout("esbuild"))\n',
  }, {
    compilerOptions: { allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true },
  })

  const build = runTsc(root)
  assert.equal(build.status, 0, build.stdout + build.stderr)

  const bundleOut = join(root, "dist/bundle.mjs")
  const bundle = runNode(root, [
    "--input-type=module",
    "-e",
    `import esbuild from ${JSON.stringify(pathToFileURL(esbuildEntry).href)}
     await esbuild.build({
       entryPoints: ["out/index.js"],
       bundle: true,
       format: "esm",
       platform: "node",
       outfile: ${JSON.stringify(bundleOut)},
     })`,
  ])
  assert.equal(bundle.status, 0, bundle.stderr)
  assert.equal(existsSync(bundleOut), true)

  const exec = runNode(root, [
    "--input-type=module",
    "-e",
    `import { result } from ${JSON.stringify(pathToFileURL(bundleOut).href)}; console.log(result)`,
  ])
  assert.equal(exec.status, 0, exec.stderr)
  assert.equal(exec.stdout.trim(), "HELLO ESBUILD")
})

test("esbuild directly parsing raw // @vibe .ts without vibelang-unplugin fails deterministically", {
  skip: !existsSync(esbuildEntry) && "esbuild not installed in packages/compiler/node_modules",
}, (t) => {
  const root = createShimmedProject(t, {
    "src/raw.ts": "// @vibe\nexport error E\nexport effect function f() { return 1 }\n",
  })
  const fail = runNode(root, [
    "--input-type=module",
    "-e",
    `import esbuild from ${JSON.stringify(pathToFileURL(esbuildEntry).href)}
     await esbuild.build({ entryPoints: ["src/raw.ts"], bundle: false, write: false })`,
  ])
  assert.notEqual(fail.status, 0, "raw esbuild without vibelang plugin must fail on Vibe syntax")
})

test("node --import vibelang/register executes // @vibe .ts and .vibe sources in a shimmed project", { skip: skipReason }, (t) => {
  const root = createShimmedProject(t, {
    "src/lib.vibe": 'export effect function value() { return "from-vibe" }\n',
    "src/main.ts": `// @vibe
import { value } from "./lib.vibe"
export effect function run() {
  try Console.log(try value())
}
await runPromise(run())
`,
  })
  const res = runNode(root, ["--import", "vibelang/register", "src/main.ts"])
  assert.equal(res.status, 0, res.stderr)
  assert.equal(res.stdout.trim(), "from-vibe")
})

test("Knip runs unresolved-import resolution cleanly alongside the TypeScript shim", {
  skip: !existsSync(knipBin) && "knip not installed in packages/compiler/node_modules",
}, (t) => {
  const root = createShimmedProject(t, {
    "knip.json": JSON.stringify({
      entry: ["src/index.ts"],
      project: ["src/**/*.ts"],
      ignoreDependencies: [".*"],
    }),
    "src/util.ts": "export const answer = 42\n",
    "src/index.ts": 'import { answer } from "./util.js"\nexport const doubled = answer * 2\n',
  })
  symlinkSync(join(compilerDir, "node_modules/knip"), join(root, "node_modules/knip"))
  const res = runNode(root, [join(compilerDir, "node_modules/knip/bin/knip.js"), "--include", "unresolved", "--config", "knip.json"])
  assert.equal(res.status, 0, res.stdout + res.stderr)
})
