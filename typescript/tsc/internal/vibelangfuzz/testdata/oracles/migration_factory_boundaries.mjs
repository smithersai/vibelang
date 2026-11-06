import {createRequire} from "node:module"
import {readFileSync} from "node:fs"
import {join} from "node:path"
import {pathToFileURL} from "node:url"
const root=process.cwd(),require=createRequire(join(root,"docs/tools/package.json")),ts=require("typescript")
const [area,key,modeText]=process.argv.slice(2),rawMode=Number(modeText),mode=rawMode&1
const namespace=mode?"E":"Effect",head=`import * as ${namespace} from "effect/Effect";\n`
const syntax=text=>ts.createSourceFile("input.ts",text,ts.ScriptTarget.Latest,true).parseDiagnostics.map(d=>d.code)
function stockControl(text){
 const file=join(root,"experiments","__migration_factory_control__.ts")
 const options={strict:true,noEmit:true,skipLibCheck:true,target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,types:[]}
 const host=ts.createCompilerHost(options),get=host.getSourceFile.bind(host),read=host.readFile.bind(host),exists=host.fileExists.bind(host)
 host.getSourceFile=(name,...args)=>name===file?ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true):get(name,...args)
 host.readFile=name=>name===file?text:read(name)
 host.fileExists=name=>name===file||exists(name)
 const codes=ts.getPreEmitDiagnostics(ts.createProgram([file],options,host)).map(d=>d.code)
 if(codes.length)throw Error("invalid stock TypeScript original: "+codes.join(","))
 return codes
}
let result
if(area==="home"){
 const {splitPlatformToModule}=await import(pathToFileURL(join(root,".smithers/flows/migrate/lib/platform.mjs")))
 let expression=`${namespace}.succeed(JSON.parse(text))`,prefix="",expected=true
 if(key==="block")expression=`{ const value=JSON.parse(text); return ${namespace}.succeed(value); }`
 else if(key==="literal")expression=`{ if(text.length===0) throw new Error(text); return ${namespace}.succeed(text); }`
 else if(key==="shadow") {prefix='const JSON={ /** @throws {never} */ parse(text:string){return text.length;} };\n';expected=false}
 else if(key==="deferred"){expression=`${namespace}.sync(()=>JSON.parse(text))`;expected=null}
 else if(key==="generator"){expression=`${namespace}.gen(function*(){return JSON.parse(text);})`;expected=false}
 else if(key!=="direct")throw Error("unknown home model")
 let source=head+prefix+`export const decode=(text:string)=>${expression};\nexport const keep=()=>1;\n`
 if(key==="direct"&&!mode)source=readFileSync(join(root,"typescript/tsc/internal/vibelangfuzz/testdata/corpus/alchemy-workflow-encoding-call-home.ts"),"utf8")
 const errors=syntax(source);if(errors.length)throw Error("invalid original syntax: "+errors.join(","))
 const stockDiagnostics=key==="direct"&&!mode?stockControl(source):undefined
 const plan=splitPlatformToModule(source,"source.ts",ts,{throws:true,platform:false,reexports:true})
 const validPlan=Boolean(plan?.module&&plan.moved.includes("decode")&&plan.kept.includes("keep")&&plan.throwing.includes("decode"))
 let ok=expected===true?validPlan:!plan
 if(expected===null&&validPlan){
  const file=ts.createSourceFile("planned.ts",plan.module,ts.ScriptTarget.Latest,true),depths=[]
  const visit=(node,depth)=>{if(ts.isFunctionLike(node))depth++;if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.getText(file)==="JSON.parse")depths.push(depth);ts.forEachChild(node,child=>visit(child,depth))}
  visit(file,0);ok=depths.length===1&&depths[0]===2
 }
 result={ok,stockDiagnostics,expectedPlan:expected,planned:Boolean(plan?.module),refused:plan?.refused,moved:plan?.moved,kept:plan?.kept,source}
}else if(area==="container"){
 const {lostWrappers}=await import(pathToFileURL(join(root,".smithers/flows/migrate/lib/lost-wrapper.mjs")))
 const before=`${namespace}.fnUntraced(function*(){return 1;})`,after=`()=>${namespace}.succeed(1)`
 let original,emitted,expectedFlag=false
 const traced = key.startsWith("traced-")
 const traceLabel = rawMode&4 ? "task.run" : "fixture.load"
 const tracedBefore = `${namespace}.fn(${JSON.stringify(traceLabel)})(function*(){return 1;})`
 const tracedAfter = `()=>${namespace}.succeed(1)`
 if(key==="object"){original=`export const make=()=>({run:${before}});`;emitted=`export const make=()=>({run:${after}});`}
 else if(key==="nested"){original=`export const make=()=>({child:{run:${before}}});`;emitted=`export const make=()=>({child:{run:${after}}});`}
 else if(key==="array"){original=`export const make=()=>[${before}];`;emitted=`export const make=()=>[${after}];`}
 else if(key==="identity"){original=`const Service={of:<A>(value:A)=>value};export const make=()=>Service.of({run:${before}});`;emitted=`const Service={of:value=>value};export const make=()=>Service.of({run:${after}});`}
 else if(key==="class"){original=`class Box {run=${before};} export const make=()=>new Box();`;emitted=`class Box {run=${after};} export const make=()=>new Box();`}
 else if(key==="drop-array"){original=`export const make=()=>${namespace}.succeed([1]);`;emitted='export const make=()=>[1];';expectedFlag=true}
 else if(key==="traced-object"){original=`export function make(){return {load:${tracedBefore}};}`;emitted=`export function make(){return {load:${tracedAfter}};}`;}
 else if(key==="traced-nested"){original=`export function make(){return {child:{load:${tracedBefore}}};}`;emitted=`export function make(){return {child:{load:${tracedAfter}}};}`;}
 else if(key==="traced-direct"){original=`export const make=${tracedBefore};`;emitted=`export const make=${tracedAfter};`;}
 else if(key==="traced-drop-direct"){original=`export const make=${tracedBefore};`;emitted="export const make=()=>1;";expectedFlag=true;}
 else throw Error("unknown container model")
 original=head+original;emitted=head+emitted
 if(key==="object"&&!mode)original=readFileSync(join(root,"typescript/tsc/internal/vibelangfuzz/testdata/corpus/t3code-effect-valued-object-members.ts"),"utf8")
 if(key==="traced-object"&&rawMode===0)original=readFileSync(join(root,"typescript/tsc/internal/vibelangfuzz/testdata/corpus/t3code-traced-effect-fn-record.ts"),"utf8")
 if(traced && rawMode&2){original=original.replaceAll("\n","\r\n");emitted=emitted.replaceAll("\n","\r\n")}
 for(const text of [original,emitted]){const errors=syntax(text);if(errors.length)throw Error("invalid model syntax: "+errors.join(","))}
 const stockDiagnostics=(key==="object"&&!mode)||(key==="traced-object"&&rawMode===0)?stockControl(original):undefined
 const checked=lostWrappers({ts,original,emitted})
 const names=checked.flags.map(f=>f.function)
 const verdict=expectedFlag?names.length===1&&names[0]==="/make":names.length===0
 const expectedPaired=(key==="traced-object"||key==="traced-nested")?2:1
 const pairing=!traced||(checked.paired===expectedPaired&&checked.unpaired.length===0)
 const ok=verdict&&pairing
 result={ok,stockDiagnostics,expectedFlag,pairing,expectedPaired,rawMode,flags:checked.flags,unpaired:checked.unpaired,paired:checked.paired,original,emitted}
}else throw Error("unknown model area")
console.log(JSON.stringify(result))
