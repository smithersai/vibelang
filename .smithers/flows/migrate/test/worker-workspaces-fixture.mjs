import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const repo=fileURLToPath(new URL("../../../../",import.meta.url))
const require=createRequire(join(repo,"packages/runtime/package.json"))
const write=(root,file,text)=>{mkdirSync(dirname(join(root,file)),{recursive:true});writeFileSync(join(root,file),text)}
export function fixture(input) {
 const base=join(repo,"packages/vite/test/.fixtures")
 mkdirSync(base,{recursive:true})
 const root=mkdtempSync(join(base,"opencode-worker-"))
 mkdirSync(join(root,"node_modules"))
 symlinkSync(dirname(require.resolve("effect/package.json")),join(root,"node_modules/effect"))
 symlinkSync(join(repo,"packages/vite"),join(root,"node_modules/vibelang-vite"))
 symlinkSync(join(repo,"packages/compiler"),join(root,"node_modules/vibelang"))
 write(root,"package.json",JSON.stringify({private:true,type:"module",workspaces:["packages/*"]}))
 const count=input.depth??1
 for(let i=0;i<=count;i++) {
  const dir=i===0?"app":"dep"+i
  const next=i<count?{["dep"+(i+1)]:(input.spec??"workspace:*")}:{}
  if(input.cycle&&i===count) next.app="workspace:*"
  write(root,"packages/"+dir+"/package.json",JSON.stringify({name:dir,type:"module",[input.field??"dependencies"]:next}))
 }
 write(root,"packages/app/vite.config.ts",'import { defineConfig } from "vite"\nimport vibelang from "vibelang-vite"\nexport default defineConfig({ plugins: [vibelang()], worker: { format: "es" } })\n')
 const dir="packages/dep"+count
 write(root,dir+"/src/presentation.tsx",'export const makeWorker = () => new Worker(new URL("./presentation.worker.ts", import.meta.url), { type: "module", name: "PowerPoint preview" })\n'.replace("new Worker(",input.kind==="shared"?"new SharedWorker(":"new Worker("))
 if(input.kind==="query")write(root,dir+"/src/presentation.tsx",'import Preview from "./presentation.worker.ts?worker&inline"\nexport const makeWorker = () => new Preview()\n')
 write(root,dir+"/src/presentation.worker.ts",'import { slideText } from "./slide-text.vibe"\nself.postMessage(slideText({text:"PowerPoint preview"}))\n')
 write(root,dir+"/src/slide-text.vibe",'import type { Slide } from "./types.ts"\nexport function slideText(slide: Slide): string { return slide.text }\n')
 write(root,dir+"/src/types.ts","export interface Slide { text: string }\n")
 write(root,dir+"/tsconfig.json",JSON.stringify({compilerOptions:{target:"ES2022",module:"NodeNext",moduleResolution:"NodeNext",types:[],lib:["ES2022","WebWorker"],skipLibCheck:true,rewriteRelativeImportExtensions:true},include:["src/**/*"]}))
 write(root,"packages/app/index.html",'<script type="module" src="/main.ts"></script>')
 write(root,"packages/app/main.ts",'import { makeWorker } from "../dep'+count+'/src/presentation.tsx"; globalThis.worker = makeWorker()\n')
 // A disconnected package and protected test/fixture graphs must not cause wiring.
 write(root,"packages/unrelated/package.json",JSON.stringify({name:"unrelated",type:"module"}))
 write(root,"packages/unrelated/src/a.ts",'new Worker(new URL("./x.ts", import.meta.url))')
 return {root,dir}
}
export const remove=root=>rmSync(root,{recursive:true,force:true})
