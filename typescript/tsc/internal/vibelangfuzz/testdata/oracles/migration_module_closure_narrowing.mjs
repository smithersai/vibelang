import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join,resolve } from "node:path"
import { splitPlatformToModule } from "../../../../../../.smithers/flows/migrate/lib/platform.mjs"
const ts=createRequire(join(process.cwd(),"packages/runtime/package.json"))("typescript")
const [key,rawMode]=process.argv.slice(2),mode=Number(rawMode)&15
const fixture=JSON.parse(readFileSync(new URL("../corpus/t3code-preview-bridge-module-narrowing.json",import.meta.url),"utf8"))
let source=fixture.source,ambient=fixture.ambient
if(key==="direct")source=source.replace("? { capture: () => nativePreviewBridge.n }","? nativePreviewBridge.n")
if(key==="nested")source=source.replace("() => nativePreviewBridge.n","() => [1].map(() => nativePreviewBridge.n)")
if(key==="async")source=source.replace("() => nativePreviewBridge.n","async () => nativePreviewBridge.n")
if(key==="multiple")source+="\nconst otherBridge: { readonly n: number } | null = window.value ?? null\nexport const other = otherBridge ? () => otherBridge.n : null\n"
if(key==="shadow") {
 source="const window = { value: { n: 1 } }\nconst nativePreviewBridge = window.value\nexport const previewBridge = () => nativePreviewBridge.n\nexport const stable = 1\n"
 ambient=""
}
if(mode&1)source="// capture comment: café 😀\n"+source
if(mode&4)source=source.replaceAll("nativePreviewBridge","nativeBridgeΔ")
if(mode&2) {source=source.replaceAll("\n","\r\n");ambient=ambient.replaceAll("\n","\r\n")}
const file=mode&8?"src/nested/space δ/bridge.ts":"src/bridge.ts"
const options={strict:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,lib:["lib.es2022.d.ts"],types:[],skipLibCheck:true,noEmit:true}
const nativeFiles=new Map([[resolve(file),source],[resolve("ambient.d.ts"),ambient]])
const host=ts.createCompilerHost(options),original=host.getSourceFile.bind(host)
host.getSourceFile=(name,version,onError,create)=>nativeFiles.has(resolve(name))?ts.createSourceFile(name,nativeFiles.get(resolve(name)),version,true):original(name,version,onError,create)
const program=ts.createProgram([...nativeFiles.keys()],options,host)
const errors=ts.getPreEmitDiagnostics(program).filter(d=>d.category===ts.DiagnosticCategory.Error)
assert.deepEqual(errors.map(d=>d.code),[],errors.map(d=>ts.flattenDiagnosticMessageText(d.messageText,"\n")).join("\n"))
const result=splitPlatformToModule(source,file,ts,{globals:["window"]})
if(key!=="shadow")assert.ok(result&&!result.refused,result?.refused??"expected a module-body split")
else assert.equal(result,null)
console.log(JSON.stringify({key,mode,file,source,ambient,candidate:result?.module??source,split:result?.name??null,stockCodes:[]}))
