import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compilerPackage = join(repo, "packages/compiler")
const compiler = process.env.VIBELANG_BINARY || join(compilerPackage, "native/vibelang")
const worker = `
import {rolldown} from "rolldown";
import {writeFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
const name=["@fixture","cloud"].join("/");
const {result:runtime}=await import(name);
console.log("RUNTIME "+JSON.stringify(runtime));
let bundle;
try {
 const plugins=process.argv.includes("--adapter") ? [
  (await import(process.env.VIBELANG_TEST_ROLLDOWN_PLUGIN)).default({
   root:process.cwd(),compiler:process.env.VIBELANG_BINARY
  })
 ] : [];
 bundle=await rolldown({input:"entry.ts",plugins,onLog(){}});
 const generated=await bundle.generate({format:"es"});
 writeFileSync("bundle.mjs",generated.output.find(x=>x.type==="chunk").code);
 const {result}=await import(pathToFileURL(process.cwd()+"/bundle.mjs").href);
 console.log("BUNDLE "+JSON.stringify(result));
} catch(error) {
 console.error("BUNDLE_ERROR "+JSON.stringify({codes:error.errors?.map(x=>x.code)}));
 process.exitCode=1;
} finally {if(bundle)await bundle.close()}
`

export function workspaceBarrelFiles(input, extension) {
  const files = {
    "package.json": '{"type":"module","private":true}',
    "packages/cloud/package.json": '{"name":"@fixture/cloud","type":"module","exports":{".":"./src/index.ts"}}',
    "packages/cloud/src/meta.ts": "export interface Meta { readonly name: string; readonly value: number }\n",
    ["packages/cloud/src/" + input.name + "." + extension]:
      'import type { Meta } from "./meta.ts";\nexport const result: Meta = ' +
      JSON.stringify({ name: input.text, value: input.value }) + ";\n",
    "entry.ts": 'export {result} from "@fixture/cloud";\n',
    "worker.mjs": worker,
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext",
        strict: true, skipLibCheck: true, allowImportingTsExtensions: true,
        rewriteRelativeImportExtensions: true, rootDir: ".", outDir: "dist"
      }, include: ["packages/**/*.ts", "packages/**/*.vibe", "entry.ts"]
    })
  }
  for (let i = input.depth - 1; i >= 0; i--) {
    const file = i === 0 ? "index.ts" : "barrel" + i + ".ts"
    const next = i + 1 === input.depth ? input.name + "." + extension : "barrel" + (i + 1) + ".ts"
    files["packages/cloud/src/" + file] = 'export {result} from "./' + next + '";\n'
  }
  return files
}

function run(root, adapter) {
  const env = {
    ...process.env, GOMAXPROCS: "2", NO_COLOR: "1", FORCE_COLOR: "0",
    VIBELANG_BINARY: compiler, VIBELANG_PROJECT: "", VIBELANG_CACHE_DIR: join(root, ".cache"),
    VIBELANG_TEST_ROLLDOWN_PLUGIN: new URL("../src/rolldown.js", import.meta.url).href
  }
  const result = spawnSync("bun", ["--preload", join(compilerPackage, "bun.mjs"), "worker.mjs", ...(adapter ? ["--adapter"] : [])],
    { cwd: root, env, encoding: "utf8", timeout: 120000, maxBuffer: 1 << 20 })
  assert.ifError(result.error)
  assert.equal(result.signal, null)
  return result
}

function fixture(input, extension) {
  const root = mkdtempSync(join(tmpdir(), "vibe-bun-rolldown-barrel-"))
  for (const [name, text] of Object.entries(workspaceBarrelFiles(input, extension))) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), text)
  }
  for (const [name, target] of [
    ["@fixture/cloud", join(root, "packages/cloud")],
    ["rolldown", join(repo, "packages/unplugin/node_modules/rolldown")],
    ["vibelang", compilerPackage],
    ["effect", join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")],
    ["vibelang-runtime", join(repo, "packages/runtime")]
  ]) {
    mkdirSync(dirname(join(root, "node_modules", name)), { recursive: true })
    symlinkSync(target, join(root, "node_modules", name), "dir")
  }
  return root
}

export function inspectWorkspaceBarrel(input, negative = false) {
  const expected = { name: input.text, value: input.value }
  for (const extension of ["ts", "vibe"]) {
    const root = fixture(input, extension)
    try {
      const result = run(root, extension === "vibe")
      const detail = (result.stdout + result.stderr).replaceAll(root, "<fixture>").replaceAll(compiler, "<compiler>").replaceAll(repo, "<repo>")
      assert.equal(result.status, 0, detail)
      const runtime = result.stdout.split("\n").find(line => line.startsWith("RUNTIME "))
      const bundled = result.stdout.split("\n").find(line => line.startsWith("BUNDLE "))
      assert.ok(runtime && bundled, detail)
      assert.deepEqual(JSON.parse(runtime.slice(8)), expected)
      assert.deepEqual(JSON.parse(bundled.slice(7)), expected)
      if (negative && extension === "vibe") {
        // Prove the boundary with the real parser: runtime preload success
        // does not install Rolldown's adapter. Do not accept another failure.
        const raw = run(root, false)
        assert.equal(raw.status, 1, raw.stdout + raw.stderr)
        assert.ok(raw.stdout.includes("RUNTIME " + JSON.stringify(expected)))
        const line = raw.stderr.split("\n").find(line => line.startsWith("BUNDLE_ERROR "))
        assert.ok(line, raw.stderr)
        assert.deepEqual(JSON.parse(line.slice(13)).codes, ["PARSE_ERROR"])
      }
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
}
