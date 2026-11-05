import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { fixProgramFiles } from "../lib/fix-scope.mjs"
import { fixToFixedPoint } from "../lib/codemod.mjs"
import { parseDiagnostics } from "../lib/diagnostics.mjs"

const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const runtime = join(repo, "packages/runtime")
const compiler = process.env.VIBELANG_BINARY ?? join(repo, "packages/compiler/native/vibelang")
export async function verifyThrowCommaMigration(scope) {
  assert.ok(existsSync(compiler), "build the native compiler for this regression")
  const root = mkdtempSync(join(tmpdir(), "throw-comma-fix-"))
  try {
    const source = "error Missing\nexport effect function f(ok: boolean) { return { value: ok ? 1 : throw new Missing(), tail: 2 }; }\n"
    writeFileSync(join(root, "main.vibe"), source)
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({compilerOptions:{target:"ES2022",module:"NodeNext",moduleResolution:"NodeNext",strict:true,skipLibCheck:true,types:[],lib:["ESNext"]},files:["main.vibe"]}))
    mkdirSync(join(root, "node_modules"))
    symlinkSync(dirname(createRequire(join(runtime, "package.json")).resolve("effect/package.json")), join(root, "node_modules/effect"), "dir")
    symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"), "dir")
    const check = () => spawnSync(compiler, ["-p", "tsconfig.json", "--pretty", "false", "--noEmit"], {cwd:root,encoding:"utf8",env:{...process.env,VIBELANG_RUNTIME:runtime}})
    const before = check()
    assert.ok(parseDiagnostics(before.stdout+"\n"+before.stderr).some(d=>d.code==="EK1010" && d.category==="error"), before.stdout+before.stderr)
    assert.deepEqual(await fixProgramFiles({compiler,tsconfig:"tsconfig.json",cwd:root}), [join(root,"main.vibe")])
    if (scope) {
      const result=spawnSync(compiler,["-p","tsconfig.json","--fix",scope,"--pretty","false","--noEmit"],{cwd:root,encoding:"utf8",env:{...process.env,VIBELANG_RUNTIME:runtime}})
      assert.equal(result.status,0,result.stdout+result.stderr)
    } else {
      const result = await fixToFixedPoint({compiler,tsconfig:"tsconfig.json",cwd:root,root,only:["main.vibe"],log:join(root,"receipts","fix"),timeoutMs:60000})
      assert.equal(result.settled, true)
    }
    assert.equal(readFileSync(join(root,"main.vibe"),"utf8"), source.replace("throw new Missing()","(throw new Missing())"))
    const after=check()
    assert.equal(after.status,0,after.stdout+after.stderr)
    writeFileSync(join(root,"main.vibe"),"export const broken = ;\n")
    const broken=check()
    assert.notEqual(broken.status,0)
    assert.ok(parseDiagnostics(broken.stdout+"\n"+broken.stderr).some(d=>d.code==="TS1109"),broken.stdout+broken.stderr)
    await fixToFixedPoint({compiler,tsconfig:"tsconfig.json",cwd:root,root,only:["main.vibe"],timeoutMs:60000})
    assert.equal(readFileSync(join(root,"main.vibe"),"utf8"),"export const broken = ;\n")
    assert.notEqual(check().status,0)
  } finally { rmSync(root,{recursive:true,force:true}) }
}

test("native throw-comma discovery reaches the preserving fix and retains unrelated syntax failures", () => verifyThrowCommaMigration())
