import assert from "node:assert/strict"
import { readFileSync,writeFileSync,mkdtempSync,symlinkSync,rmSync } from "node:fs"
import { createRequire } from "node:module"
import { join,resolve } from "node:path"
import { tmpdir } from "node:os"
import { lostWrappers } from "../../../../../../.smithers/flows/migrate/lib/lost-wrapper.mjs"
const ts=createRequire(join(process.cwd(),"packages/runtime/package.json"))("typescript")
const input=JSON.parse(readFileSync(0,"utf8"))
const root=mkdtempSync(join(tmpdir(),"curried-wrapper-audit-"))
try {
 writeFileSync(join(root,"package.json"),'{"type":"module"}\n')
 symlinkSync(resolve("packages/runtime/node_modules"),join(root,"node_modules"),"dir")
 writeFileSync(join(root,"original.ts"),input.original)
 const options={strict:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,skipLibCheck:true,noEmit:true,types:[]}
 const program=ts.createProgram([join(root,"original.ts")],options)
 const errors=ts.getPreEmitDiagnostics(program).filter(d=>d.category===ts.DiagnosticCategory.Error)
 assert.deepEqual(errors.map(d=>d.code),[],errors.map(d=>ts.flattenDiagnosticMessageText(d.messageText,"\n")).join("\n"))
 const result=lostWrappers({ts,original:input.original,emitted:input.emitted})
 const control='import * as Effect from "effect/Effect";\nexport const factory = () => Effect.succeed(1);\n'
 const negative=lostWrappers({ts,original:control,emitted:'export const factory = () => 1;\n'})
 const identity=lostWrappers({ts,original:control,emitted:control})
 console.log(JSON.stringify({...result,stockCodes:[],stockVersion:ts.version,negativeFlags:negative.flags.length,identityFlags:identity.flags.length,identityUnpaired:identity.unpaired.length}))
} finally {rmSync(root,{recursive:true,force:true})}
