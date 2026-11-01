import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

export function sidecarIdentity(extension,nodeModules,binary) {
 const dir=mkdtempSync(join(tmpdir(),"sidecar-identity-"))
 try {
  mkdirSync(join(dir,"pkg"));mkdirSync(join(dir,"node_modules"))
  symlinkSync(join(nodeModules,"effect"),join(dir,"node_modules/effect"),"dir")
  symlinkSync(join(dir,"pkg"),join(dir,"node_modules/lib"),"dir")
  writeFileSync(join(dir,"package.json"),'{"type":"module"}')
  writeFileSync(join(dir,"main.vibe"),'import { Stage as Source } from "./pkg/Stage.'+extension+'";\nimport { Stage as Alias } from "lib/Stage";\nexport const value: Alias = new Source();\n')
  writeFileSync(join(dir,"pkg/Stage."+extension),"export class Stage { private n = 0 }\n")
  writeFileSync(join(dir,"pkg/Stage.d."+extension+".ts"),"export declare class Stage { private n }\n")
  writeFileSync(join(dir,"pkg/package.json"),JSON.stringify({name:"lib",type:"module",exports:{"./Stage":{types:"./Stage.d."+extension+".ts"}}}))
  writeFileSync(join(dir,"tsconfig.json"),JSON.stringify({compilerOptions:{strict:true,target:"es2022",module:"nodenext",moduleResolution:"nodenext",types:[],jsx:"preserve",declaration:true,rewriteRelativeImportExtensions:true,skipLibCheck:true,outDir:"out"},files:["main.vibe"]}))
  return spawnSync(binary,["-p",dir,"--pretty","false"],{encoding:"utf8",timeout:60000})
 } finally {rmSync(dir,{recursive:true,force:true})}
}
