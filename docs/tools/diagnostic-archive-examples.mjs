// Appendix-linked legacy witnesses are read independently of the compiler registry.
import {readFileSync} from "node:fs"
import {resolve,sep,dirname,basename} from "node:path"
import {appendixCategory} from "./diagnostic-identity.mjs"

export function archiveFiles(text) {
  if(text.startsWith("go test fuzz v1\n")) {
    const encoded=/^go test fuzz v1\nstring\((.+)\)\s*$/.exec(text)
    if(!encoded) throw Error("diagnostic example must contain one fuzz string")
    try {text=JSON.parse(encoded[1])}
    catch {throw Error("unsupported Go fuzz string encoding in diagnostic example")}
  }
  const headers=[...text.matchAll(/^-- (.+) --\n/gm)], files={}
  if(!headers.length) throw Error("diagnostic example has no archive files")
  for(const [i,h] of headers.entries()) {
    const name=h[1]
    if(name.startsWith("/") || name.includes("\\") || name.split("/").some(p=>!p || p==="." || p===".."))
      throw Error("unsafe diagnostic example path")
    if(Object.hasOwn(files,name)) throw Error("duplicate diagnostic example file")
    files[name]=text.slice(h.index+h[0].length,headers[i+1]?.index??text.length)
  }
  return files
}
export function archiveExamples(appendix,root) {
  const result=[]
  const corpus=resolve(root,"typescript/tsc/internal/vibelangfuzz/testdata/fuzz")+sep
  const cases=resolve(root,"typescript/vibelang/cases")+sep
  for(const [code,row] of appendix) {
    const count=(row.match(/\[example:/g)??[]).length
    let matched=0
    for(const m of row.matchAll(/\[example: ([^:;\]]+):(\d+):(\d+)(?:; (error|warning|suggestion))?(?:; also ((?:EK|TS)\d+(?:, (?:EK|TS)\d+)*))?\]\(([^)]+)\)/g)) {
      matched++
      const path=resolve(root,"docs/design/src",m[6])
      if(!path.startsWith(corpus) && !path.startsWith(cases)) throw Error(code+": example must name a compiler corpus archive or native case source")
      let files,project
      try {
        if(path.startsWith(cases)) {
          if(!/\.(?:vibe|vibex|ts)$/.test(path) || basename(path)!==m[1]) throw Error("case example must name its located source")
          project=dirname(path)
          files={[m[1]]:readFileSync(path,"utf8"),"tsconfig.json":readFileSync(resolve(project,"tsconfig.json"),"utf8")}
        } else files=archiveFiles(readFileSync(path,"utf8"))
      }
      catch(error) {throw Error(code+": "+error.message)}
      if(!Object.hasOwn(files,m[1]) || +m[2]<1 || +m[3]<1) throw Error(code+": invalid example location")
      const configName=["vibe.config.json","tsconfig.json"].find(n=>Object.hasOwn(files,n))
      const config=configName?JSON.parse(files[configName]):{}
      let configured=config.vibe?.severities?.[code]??config.compilerOptions?.vibelang?.diagnostics?.[code]??config.vibelang?.diagnostics?.[code]
      for(const [index,line] of files[m[1]].split("\n").entries()) {
        if(index+1>=+m[2]) break
        const directive=/^\s*\/\/\s*@vibelang-diagnostics(-next-line)?\s+(.+)$/.exec(line)
        if(!directive || (directive[1] && index+2!==+m[2])) continue
        const value=new RegExp("\\b"+code+":(error|warning|suggestion|off)\\b").exec(directive[2])
        if(value) configured=value[1]
      }
      if(configured!==m[4]) throw Error(code+": document the example's configured severity exactly")
      result.push({code,name:"appendix-archive-"+code,source:files[m[1]],files,configName,...(project?{project}:{}),also:m[5]?.split(", ")??[],
        at:{file:m[1],line:+m[2],column:+m[3],category:configured??appendixCategory(row)},...(configured?{exampleCategory:configured}:{})})
    }
    if(matched!==count) throw Error(code+": malformed Appendix example link")
  }
  return result
}
