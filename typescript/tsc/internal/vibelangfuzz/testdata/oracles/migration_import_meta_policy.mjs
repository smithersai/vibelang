import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, existsSync } from "node:fs"
import { createRequire } from "node:module"
import { join, dirname, resolve } from "node:path"
import { tmpdir } from "node:os"
import { splitBatchPlatform } from "../../../../../../.smithers/flows/migrate/lib/platform.mjs"
const require = createRequire(join(process.cwd(), "packages/runtime/package.json"))
const ts = require("typescript")
const [key, rawMode, binary] = process.argv.slice(2), mode = Number(rawMode) & 15
const corpus = JSON.parse(readFileSync(new URL("../corpus/t3code-import-meta-dirname-policy.json", import.meta.url), "utf8"))
const member = key.split("-")[0]
const pragma = key.endsWith("-pragma") ? "// @effect-diagnostics nodeBuiltinImport:off -- The existing TypeScript boundary owns its Node operations.\n\n" : ""
const source0 = pragma + corpus.source.replaceAll("import.meta.dirname", "import.meta." + member)
const name = mode & 4 ? "entryδ" : "entry"
const file = (mode & 8 ? "src/space δ/" : "src/") + name + ".ts"
let source = source0
if (mode & 1) source = "// Retain the module metadata at this evaluation point.\n" + source
if (mode & 2) source = source.replaceAll("\n", "\r\n")
const root = mkdtempSync(join(tmpdir(), "migration-import-meta-policy-"))
try {
  mkdirSync(dirname(join(root, file)), {recursive: true})
  writeFileSync(join(root, file), source)
  const packageText = JSON.stringify({name:"policy-fixture",private:key!=="dirname-open",type:"module",...(key==="dirname-open"?{}:{exports:{".":"./"+file}})})+"\n"
  writeFileSync(join(root, "package.json"), packageText)
  const ambient = 'interface ImportMeta { readonly env: { readonly API_URL: string } }\n'
  writeFileSync(join(root, "ambient.d.ts"), ambient)
  writeFileSync(join(root, "sentinel.txt"), "retain\n")
  symlinkSync(resolve("packages/runtime/node_modules"), join(root, "node_modules"), "dir")
  const options = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true,
    noEmit: true, types: ["node"], typeRoots: [resolve("packages/runtime/node_modules/@types")],
  }
  const program = ts.createProgram([join(root, file), join(root, "ambient.d.ts")], options)
  const stockErrors = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error)
  assert.deepEqual(stockErrors.map(d => d.code), [], stockErrors.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n"))
  const original = { [file]: source, "ambient.d.ts": ambient, "package.json": packageText }
  const compile = (files, extra = []) => {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root,name)), {recursive:true})
      writeFileSync(join(root,name),text)
    }
    const config = {compilerOptions:{
      strict:true,target:"ES2022",module:"ESNext",moduleResolution:"Bundler",
      skipLibCheck:true,noEmit:true,allowImportingTsExtensions:true,types:["node"],
      plugins:[{name:"@effect/language-service",diagnosticSeverity:{nodeBuiltinImport:key==="dirname-off"?"off":"error"},
        ...(key==="dirname-ignore-exit"?{ignoreEffectErrorsInTscExitCode:true}:{})}],
    },vibe:{effectGlobals:false,effectModules:false},files:Object.keys(files).filter(n=>/\.(?:ts|vibe)$/.test(n))}
    writeFileSync(join(root,"tsconfig.json"),JSON.stringify(config))
    const p=spawnSync(binary,["-p","tsconfig.json","--singleThreaded","--pretty","false",...extra],{cwd:root,encoding:"utf8",timeout:30000,maxBuffer:4*1024*1024})
    assert.equal(p.error,undefined,String(p.error))
    assert.equal(p.signal,null,p.signal)
    const text=p.stdout+p.stderr
    return {status:p.status,codes:[...text.matchAll(/\berror (?:TS|EK)(\d+):/g)].map(m=>Number(m[1])),text}
  }
  const guard=key==="dirname"?compile({"guard.ts":'import { dirname } from "node:path";\nexport const value = dirname("file");\n'}):null
  const before=compile(original)
  const result = splitBatchPlatform(root, [file], ts, {moduleBodies: true, throwBodies: true})
  const unchanged = readFileSync(join(root, "sentinel.txt"), "utf8") === "retain\n"
  assert.ok(unchanged)
  const candidate = {...original}
  if (result.refused?.length) {
    assert.ok(key==="main" || key==="dirname-open", "the witness must reach its generated helper: "+JSON.stringify(result))
    assert.equal(readFileSync(join(root, file), "utf8"), source, "refusal must retain source")
    assert.equal(readFileSync(join(root,"package.json"),"utf8"),packageText,"refusal must retain the manifest")
    assert.equal(existsSync(join(root,file.replace(/\.ts$/, ".platform.ts"))),false,"refusal must not create its helper")
    console.log(JSON.stringify({key,mode,original,candidate,refused:result.refused,unchanged,stockCodes:[],guard,before,after:null}))
  } else {
    const split = result.splits[0]
    if (member === "url") assert.equal(result.splits.length, 0)
    else assert.ok(split, JSON.stringify(result))
    const native = file.replace(/\.ts$/, ".vibe")
    delete candidate[file]
    candidate[native] = readFileSync(join(root, file), "utf8")
    if (split?.platform) {
      const platform = split.platform
      assert.ok(platform.endsWith(".ts"), JSON.stringify(split))
      candidate[platform] = readFileSync(join(root, platform), "utf8").replaceAll("./" + name + ".ts", "./" + name + ".vibe")
    }
    renameSync(join(root,file),join(root,native))
    const pkg=JSON.parse(candidate["package.json"])
    if(pkg.exports)pkg.exports["."]="./"+native
    candidate["package.json"]=JSON.stringify(pkg)+"\n"
    if(!key.endsWith("-pragma"))for(const [name,text] of Object.entries(candidate))assert.ok(!/@effect-diagnostics[^\n]*nodeBuiltinImport:off/.test(text),"the generated candidate must not introduce a policy suppression: "+name)
    const after=compile(candidate)
    console.log(JSON.stringify({key,mode,original,candidate,refused:[],unchanged,stockCodes:[],guard,before,after}))
  }
} finally { rmSync(root, {recursive: true, force: true}) }
