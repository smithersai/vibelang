import assert from "node:assert/strict"
import { mkdirSync,mkdtempSync,realpathSync,rmSync,writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { devServer } from "./dev-server.mjs"
import vibelang from "../src/index.js"

export const keyOf = input => [input.prefix,input.depth,input.query || "none"].join(":")
export const allInputs = () => ["~","@app"].flatMap(prefix=>[0,1,2].flatMap(depth=>["","?raw"].map(query=>({prefix,depth,query}))))
export async function inspect(input,literal) {
  const root=realpathSync(mkdtempSync(join(tmpdir(),"vibelang-alias-property-")))
  let server
  try {
    const source="src/"+("nested/".repeat(input.depth))
    mkdirSync(join(root,source),{recursive:true})
    const files={
      "package.json":'{"type":"module"}',
      "tsconfig.json":JSON.stringify({compilerOptions:{paths:{[input.prefix+"/*"]:["./"+source+"*"]}}}),
      [source+"value.ts"]:"export const value = 1;\n",
      [source+"main.vibe"]:'import { value } from "'+input.prefix+'/value";\nexport const result = value;\n',
      [source+"main.ts"]:'import { value } from "'+input.prefix+'/value";\nexport const result = value;\n',
      ...literal,
    }
    for(const [file,text] of Object.entries(files))writeFileSync(join(root,file),text)
    server=await devServer({
      root,configFile:false,logLevel:"silent",plugins:[vibelang()],
      resolve:{tsconfigPaths:true},
      optimizeDeps:{noDiscovery:true,include:[]},
      server:{middlewareMode:true,watch:null},
    })
    const container=server.environments.client.pluginContainer
    const specifier=input.prefix+"/value"+input.query
    const expected=join(root,source,"value.ts")+input.query
    const native=await container.resolveId(specifier,join(root,source,"main.ts"))
    assert.equal(native?.id,expected,"invalid native Vite tsconfig-paths control")
    const vibe=await container.resolveId(specifier,join(root,source,"main.vibe"))
    return {key:keyOf(input),expected,resolved:vibe?.id??null}
  } finally {
    await server?.close()
    rmSync(root,{recursive:true,force:true})
  }
}
