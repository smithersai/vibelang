// Read-only inventory: source registrations and Appendix B rows are independent.
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { loadIdentity, appendixCategory, repository } from "../docs/tools/diagnostic-identity.mjs"

const root=resolve(process.argv[2]??repository)
const audit=loadIdentity(root)
const codes=[...new Set([...audit.registered.keys(),...audit.appendix.keys()])].sort()
const identities=codes.map(code=>{
  const row=audit.appendix.get(code)
  return {code,appendix:row??null,expectedCategory:row?appendixCategory(row):null,
    registrations:(audit.registered.get(code)??[]).map(site=>{
      const source=readFileSync(resolve(root,site.path),"utf8")
      return {...site,line:source.slice(0,site.offset).split("\n").length,
        declaration:source.slice(site.offset,source.indexOf("\n",site.offset)<0?source.length:source.indexOf("\n",site.offset))}
    }),emitterCategories:audit.categories.get(code)??[],
    findings:audit.findings.filter(f=>f.code===code)}
})
console.log(JSON.stringify({revision:process.argv[3]??null,
  registered:audit.registered.size,appendix:audit.appendix.size,
  findings:audit.findings,identities},null,2))
