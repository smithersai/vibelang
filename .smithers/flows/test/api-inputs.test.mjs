import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { appendFileSync, cpSync, existsSync, globSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, matchesGlob, relative } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const cli = join(repo, ".smithers/node_modules/.bin/smthrs")
const output = result => result.stdout + result.stderr + String(result.error ?? "")
function invoke(root, ...args) {
  return spawnSync(process.execPath, [cli, ...args, "--workspace", root, "--ui", "plain"], {
    encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
  })
}
function temp(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
function put(root, file, text) {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), text)
}
function key(root, label = "//:api-identity-test") {
  const result = invoke(root, "explain", label, "--format", "json")
  assert.equal(result.status, 0, output(result))
  return JSON.parse(result.stdout).cache.key
}
function copyTree(t) {
  const root = temp(t, "vibelang-api-inputs-root-")
  // A private source copy never carries repository stores or installed modules.
  for (const name of readdirSync(repo)) {
    if ([".jj", ".git", ".cache", ".flows", "node_modules"].includes(name)) continue
    cpSync(join(repo, name), join(root, name), { recursive: true, filter(source) {
      const path = relative(repo, source)
      const parts = path.split("/")
      return !parts.some(part => [".jj", ".git", ".cache", ".flows", "node_modules"].includes(part))
        && !["typescript/built", "site/dist", "site/.astro"].some(dir => path === dir || path.startsWith(dir + "/"))
    } })
  }
  for (const dir of [".smithers", "docs/tools"]) {
    mkdirSync(join(root, dir), { recursive: true })
    symlinkSync(join(repo, dir, "node_modules"), join(root, dir, "node_modules"), "dir")
  }
  return root
}

test("the actual root API key ignores unrelated files and retains every input family", t => {
  const root = copyTree(t)
  const before = key(root)
  const releaseBefore = key(root, "//:release")
  // Include additions at several depths: exclusion must not depend on one witness.
  for (let i = 0; i < 64; i++) {
    const dir = ["typescript/tsc/internal/vibelangfuzz", "typescript/vibelang/cases", "docs/user/src", "site/src/pages"][i % 4]
    put(root, dir + "/api-input-neighbour-" + i + [".go", ".vibe", ".md", ".mdx"][i % 4], "// unrelated fixture\n")
  }
  assert.equal(key(root), before, "Go, compiler cases, user prose and generated site output must not invalidate API identity")
  assert.notEqual(key(root, "//:release"), releaseBefore, "other root checks must retain their whole-tree inputs")

  const selected = [
    "scripts/api-identity.mjs",
    "scripts/api-identity-corpus/smithers-canonical-eval-api.json",
    "scripts/testing/property.mjs",
    "scripts/sync-api-identity.mjs",
    ".smithers/flows/migrate/lib/api-identity.mjs",
    "docs/design/src/001-functions.md",
    "docs/tools/bun.lock",
    "experiments/package.json",
    "packages/runtime/package.json",
    ".smithers/bun.lock",
    "api-inputs.ts",
  ]
  for (const file of selected) {
    const original = readFileSync(join(root, file))
    console.error("API_INPUT_SELECTED", file)
    appendFileSync(join(root, file), "\n")
    assert.notEqual(key(root), before, "API key must retain " + file)
    writeFileSync(join(root, file), original)
  }
  // Parent-walking project lookup can see root configs when TMPDIR is in-tree.
  for (const file of ["tsconfig.api-inputs.json", "vibe.config.json", "api-inputs-base.jsonc"]) {
    assert.equal(existsSync(join(root, file)), false)
    console.error("API_INPUT_CONFIG", file)
    put(root, file, JSON.stringify({}) + String.fromCharCode(10))
    assert.notEqual(key(root), before, "API key must retain added root config " + file)
    rmSync(join(root, file))
  }
  assert.equal(key(root), before, "restoring all selected bytes must restore the original API key")
})

test("real SDK caching reuses API results across Go edits and rejects a changed declaration", t => {
  const root = temp(t, "vibelang-api-inputs-cache-")
  const outside = temp(t, "vibelang-api-inputs-trace-")
  const trace = join(outside, "calls")
  for (const file of ["api-inputs.ts", ".smithers/WORKSPACE.ts", ".smithers/package.json", ".smithers/bun.lock"]) {
    put(root, file, readFileSync(join(repo, file)))
  }
  symlinkSync(join(repo, ".smithers/node_modules"), join(root, ".smithers/node_modules"), "dir")
  put(root, "package.json", '{"name":"api-inputs-real-checker-fixture","private":true,"type":"module"}\n')
  for (const name of ["api-identity.mjs", "api-identity-ambient.mjs", "api-identity-nominal.mjs"])
    put(root, "scripts/" + name, readFileSync(join(repo, "scripts", name)))
  put(root, "docs/tools/package.json", readFileSync(join(repo, "docs/tools/package.json")))
  symlinkSync(join(repo, "docs/tools/node_modules"), join(root, "docs/tools/node_modules"), "dir")
  put(root, "scripts/api-inputs-corpus.json", '{"before":"string","after":"string"}\n')
  put(root, "scripts/proof.mjs", [
    'import {appendFileSync,readFileSync,mkdirSync,writeFileSync} from "node:fs"',
    'import {join} from "node:path"',
    'import {compareApiIdentity,loadTypeScript} from "./api-identity.mjs"',
    'appendFileSync(process.env.TRACE,"api\\n")',
    'const corpus=JSON.parse(readFileSync("scripts/api-inputs-corpus.json","utf8"))',
    'const dirs=["before","after"].map(side=>{const dir=join(process.env.PROOF,side);mkdirSync(dir,{recursive:true});writeFileSync(join(dir,"index.d.ts"),"export type X = "+corpus[side]+";");return dir})',
    'const result=compareApiIdentity(loadTypeScript(),...dirs)',
    'console.log(JSON.stringify(result));process.exitCode=result.identical?0:7',
    "",
  ].join("\n"))
  put(root, "PACKAGE.ts", [
    'import {Smithers as S} from "@smthrs/targets"',
    'import {createApiIdentityInputs} from "./api-inputs.ts"',
    'const packages=S.Filegroup({srcs:[S.glob("packages/**")]})',
    'export const Package=S.Package({targets:{"api-identity-test":S.Shell.Test({',
    'shell:"node scripts/proof.mjs",data:[createApiIdentityInputs(S,packages)],tools:[S.Host.bin("node")],sandbox:"none",',
    "env:" + JSON.stringify({ TRACE: trace, PROOF: outside }),
    "})}})",
    "",
  ].join("\n"))
  const run = () => invoke(root, "test", "//:api-identity-test")
  const calls = () => readFileSync(trace, "utf8").trim().split("\n")
  for (let i = 0; i < 2; i++) {
    const result = run()
    assert.equal(result.status, 0, output(result))
    assert.deepEqual(calls(), ["api"], "unchanged successful results replay")
  }
  for (let i = 0; i < 64; i++)
    put(root, "typescript/tsc/internal/vibelangfuzz/deep/witness-" + i + ".go", "// unrelated\n")
  let result = run()
  assert.equal(result.status, 0, output(result))
  assert.deepEqual(calls(), ["api"], "Go edits retain the real checker result")
  appendFileSync(join(root, "scripts/api-identity.mjs"), "\n// selected checker mutation\n")
  result = run()
  assert.equal(result.status, 0, output(result))
  assert.deepEqual(calls(), ["api", "api"], "checker source changes execute the real comparator")
  put(root, "scripts/api-inputs-corpus.json", '{"before":"string","after":"number"}\n')
  result = run()
  assert.notEqual(result.status, 0, output(result))
  assert.equal(result.signal, null, output(result))
  assert.deepEqual(calls(), ["api", "api", "api"], "a changed public declaration must be checked and fail")
  put(root, "scripts/api-identity.mjs", readFileSync(join(repo, "scripts/api-identity.mjs")))
  put(root, "scripts/api-inputs-corpus.json", '{"before":"string","after":"string"}\n')
  result = run()
  assert.equal(result.status, 0, output(result))
  assert.deepEqual(calls(), ["api", "api", "api"], "restored bytes replay the earlier successful result")
})

test("current API entrypoints, imports, corpus and specification reads remain covered", async () => {
  const { apiInputPatterns } = await import("../../../api-inputs.ts")
  const covered = path => path.startsWith("packages/") || apiInputPatterns.some(pattern => matchesGlob(path, pattern))
  const visited = new Set()
  function inspect(file) {
    if (visited.has(file)) return
    visited.add(file)
    assert.ok(covered(file), "declare the API read input " + file)
    const text = readFileSync(join(repo, file), "utf8")
    for (const match of text.matchAll(/(?:from\s*|import\s*\(|new URL\s*\()\s*["'](\.[^"']+)["']/g)) {
      const resolved = relative(repo, join(dirname(join(repo, file)), match[1]))
      if (!existsSync(join(repo, resolved)) || !statSync(join(repo, resolved)).isFile()) continue
      assert.ok(covered(resolved), "declare relative API input " + resolved)
      if (resolved.endsWith(".mjs")) inspect(resolved)
    }
    for (const match of text.matchAll(/SpecPath\(["']([^"']+)["']\)/g))
      assert.ok(covered("docs/design/src/" + match[1]), "declare specification lookup " + match[1])
  }
  for (const name of readdirSync(join(repo, "scripts")))
    if (/^api-identity.*\.mjs$/.test(name)) inspect("scripts/" + name)
  inspect("scripts/sync-api-identity.mjs")
  for (const file of globSync("scripts/api-identity-corpus/**/*.json", { cwd: repo })) {
    const corpus = JSON.parse(readFileSync(join(repo, file), "utf8"))
    if (typeof corpus.spec === "string")
      assert.ok(covered(corpus.spec.split("#")[0]), "declare corpus specification read " + corpus.spec)
  }
  assert.ok(visited.size >= 20, "audit actual API files, not an empty selection")
})
