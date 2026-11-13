import test from "node:test"
import { assert, appendFileSync, readFileSync, symlinkSync, join, repo, output, invoke, temp, put, key, relativeApiFiles } from "./api-inputs-fixture.mjs"

test("real SDK caching reuses API results across Go edits and rejects a changed declaration", t => {
  const root = temp(t, "vibelang-api-inputs-cache-")
  const outside = temp(t, "vibelang-api-inputs-trace-")
  const trace = join(outside, "calls")
  for (const file of ["api-inputs.ts", ".smithers/WORKSPACE.ts", ".smithers/package.json", ".smithers/bun.lock"]) {
    put(root, file, readFileSync(join(repo, file)))
  }
  symlinkSync(join(repo, ".smithers/node_modules"), join(root, ".smithers/node_modules"), "dir")
  put(root, "package.json", '{"name":"api-inputs-real-checker-fixture","private":true,"type":"module"}\n')
  for (const file of relativeApiFiles(["scripts/api-identity.mjs"]))
    put(root, file, readFileSync(join(repo, file)))
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
    'const tree=S.Filegroup({srcs:[...S.glob(["**","!.jj/**"])]})',
    'export const Package=S.Package({targets:{',
    '"whole-tree-consumer":S.Shell.Test({shell:"true",data:[tree],tools:[],sandbox:"none"}),',
    '"api-identity-test":S.Shell.Test({',
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
  const wholeTree = () => key(root, "//:whole-tree-consumer")
  const wholeTreeBefore = wholeTree()
  assert.equal(wholeTree(), wholeTreeBefore, "the whole-tree key is stable without a source change")
  for (let i = 0; i < 64; i++)
    put(root, "typescript/tsc/internal/vibelangfuzz/deep/witness-" + i + ".go", "// unrelated\n")
  assert.notEqual(wholeTree(), wholeTreeBefore, "a whole-tree input must change its consumer's key")
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
