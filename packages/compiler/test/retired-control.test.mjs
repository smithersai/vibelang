import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { parseESTree } from "../eslint.mjs"

const repo = process.env.RELIC_TEST_REPO || fileURLToPath(new URL("../../../", import.meta.url))
const binary = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const modules = process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules")
const samples = [
  ["legacy Control class", "abstract class Ask extends Control { abstract ask(x: number): number!! }; export const old = Ask", "EK3501"],
  ["legacy handle binding", "export const old = handle", "EK3501"],
  ["runtime Control class", 'import {Control as Key} from "vibelang-runtime"; export const old=Key', "EK3501"],
  ["control syntax", "control Ask { ask(): number!! }", "EK3501"],
  ["handle syntax", "export effect function probe(){ try { return 1 } handle Ask.ask(x){ return try resume(x) } }", "EK3501"],
  ["nocheck control syntax", "// @ts-nocheck\ncontrol Ask { ask(): number!! }", "EK3501"],
  ["select syntax", "export effect function probe(){ select { default: return 1 } }", "EK4607"],
  ["nocheck select syntax", "// @ts-nocheck\nexport effect function probe(){ select { default: return 1 } }", "EK4607"],
  ["runtime aliases", 'import { resume as r, abandon as a, handle as h, Control as C, resumeWith as rw } from "vibelang-runtime"; export const old=[r,a,h,C,rw]', "EK3501"],
  ["computed runtime export", 'import * as Old from "vibelang-runtime"; const key="resume" as const; export const old=Old[key]', "EK3501"],
  ["shorthand runtime export", "export const old={resume}", "EK3501"],
  ["runtime re-export", 'export {resume as old} from "vibelang-runtime"', "EK3501"],
  ["runtime star re-export", 'export * from "vibelang-runtime"', "EK3501"],
  ["runtime union key", 'import * as Old from "vibelang-runtime"; const key=Math.random()>0.5?"resume":"abandon"; export const old=Old[key]', "EK3501"],
  ["runtime union destructure", 'import * as Old from "vibelang-runtime"; const key=Math.random()>0.5?"resume":"abandon"; const {[key]:r}=Old; export const old=r', "EK3501"],
  ["runtime computed destructure", 'import * as Old from "vibelang-runtime"; const key="resume" as const; const {[key]:r}=Old; export const old=r', "EK3501"],
  ["runtime destructure", 'import * as Old from "vibelang-runtime"; const {resume:r}=Old; export const old=r', "EK3501"],
]
for (const [name, source, code] of samples) test("first release rejects " + name, t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "relic-rejection-")))
  t.after(() => rmSync(root, {recursive:true, force:true}))
  mkdirSync(join(root, "node_modules"))
  symlinkSync(realpathSync(join(modules, "effect")), join(root, "node_modules/effect"))
  symlinkSync(join(repo, "packages/runtime"), join(root, "node_modules/vibelang-runtime"))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  writeFileSync(join(root, "main.vibe"), source)
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({compilerOptions:{target:"es2022",module:"nodenext",strict:true,skipLibCheck:true,types:[],noEmit:true},files:["main.vibe"]}))
  const r = spawnSync(binary, ["-p", ".", "--pretty", "false"], {cwd:root,encoding:"utf8",timeout:120000})
  assert.ifError(r.error)
  const output=r.stdout+r.stderr
  assert.notEqual(r.status, 0, "retired source compiled successfully")
  assert.match(output, new RegExp(code), output)
  assert.match(output, /outside the first release/, output)
})

for (const [name,source] of samples.filter(([name])=>["control syntax","handle syntax","select syntax"].includes(name))) {
  test("ESLint rejects "+name+" as outside the first release",()=>assert.throws(()=>parseESTree(source,"retired.vibe"),/outside the first release/))
}
test("ESLint keeps native control/handle/resume/abandon/select parameter names",()=>{
 const names=["control","handle","resume","abandon","select"]
 const ast=parseESTree("function native("+names.join(",")+"){return ["+names.join(",")+"]}","native.vibe")
 assert.deepEqual(ast.body[0].params.map(p=>p.name),names)
})
