// An Appendix replay that names a failing case must name a diagnostic the case still expects.
// This needs no compiler, so a case edit that strands a replay fails before the executable examples run.
import assert from "node:assert/strict"
import {existsSync,readFileSync} from "node:fs"
import {join} from "node:path"
import {test} from "node:test"
import {appendixCodes,repository} from "./diagnostic-identity.mjs"
import {archiveExamples} from "./diagnostic-archive-examples.mjs"

const stale=(example,diagnostics)=>{
  const {file,line,column}=example.at,place=`${file}(${line},${column}): `
  return !diagnostics.split("\n").some(text=>text.startsWith(place)&&new RegExp(`\\b${example.code}\\b`).test(text))
}
const appendix=appendixCodes(readFileSync(join(repository,"docs/design/src/900-appendices.md"),"utf8"))
const replays=archiveExamples(appendix,repository).flatMap(example=>{
  const expected=example.project&&join(example.project,"expected/diagnostics.txt")
  return expected&&existsSync(expected)?[{example,diagnostics:readFileSync(expected,"utf8")}]:[]
})

test("every Appendix replay of a failing case names a diagnostic the case expects",()=>{
  assert.ok(replays.length>=10,"only "+replays.length+" case replays discovered")
  assert.deepEqual(replays.filter(({example,diagnostics})=>stale(example,diagnostics)).map(({example})=>
    example.code+" at "+example.at.file+":"+example.at.line+":"+example.at.column),[])
})

test("a moved line, a moved column and another code all strand a replay",()=>{
  const example={code:"EK3207",at:{file:"main.vibe",line:7,column:11}}
  assert.equal(stale(example,"main.vibe(7,11): error EK3207\n"),false)
  for(const diagnostics of ["main.vibe(3,11): error EK3207\n","main.vibe(7,12): error EK3207\n","main.vibe(7,11): error EK3208\n","other.vibe(7,11): error EK3207\n",""])
    assert.equal(stale(example,diagnostics),true,diagnostics)
})
