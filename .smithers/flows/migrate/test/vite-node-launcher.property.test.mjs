import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {test} from "node:test";
import {nativeViteScripts,nativeConfigScripts} from "../lib/vite-config.mjs";
import {candidates,validatePlan,planPrompt} from "../lib/plan.mjs";
const require=createRequire(new URL("../../../../packages/runtime/package.json",import.meta.url));
const fc=require("fast-check"),corpus=JSON.parse(readFileSync(new URL("./corpus/foldkit-website-node-native-config.json",import.meta.url),"utf8"));
function check(command,{name="vite.config.ts"}={}){
 const file=corpus.dir+"/"+name,options={root:"/project",dir:corpus.dir,configs:[file]};
 const result=nativeViteScripts({dev:command},options);
 assert.deepEqual(result.wired,[file],"an explicit Node Vite invocation proves its config");
 assert.equal(result.scripts.dev,command,"already-wired native loader/preload remain byte-identical");
 assert.deepEqual(nativeViteScripts(result.scripts,options),result,"setup is idempotent");
 const record={path:file,effect:"values",effectImports:["effect"],test:false,lines:1,tokens:1,imports:[],dependents:[],testedBy:[],coverage:null};
 const inventory={packages:[corpus.dir],summary:{effectValueFiles:1},files:[record]},plan={version:1,batches:[{files:[file],reason:"native loader already wired"}],deferred:[]};
 assert.deepEqual(candidates(inventory,{nativeConfigs:result.wired}).map(f=>f.path),[file]);
 assert.deepEqual(validatePlan(plan,inventory,undefined,{nativeConfigs:result.wired}).errors,[]);
 assert.doesNotThrow(()=>planPrompt({inventory,draft:plan,output:"answer.json",nativeConfigs:result.wired}));
 const renamed=nativeConfigScripts({dev:command},{root:options.root,dir:options.dir,renames:[{from:file,to:file.replace(/\.m?ts$/,".vibe")}]});
 assert.equal(renamed.edits.length,1);
 assert.equal(renamed.scripts.dev,command.replace(name,name.replace(/\.m?ts$/,".vibe")));
}
test("foldkit website: the original already-wired Node Vite command proves its native config",()=>check(corpus.command));
test("Node Vite neighbours preserve quoting,preload,loader and explicit config spelling",()=>{
 fc.assert(fc.property(fc.constantFrom("--import vibelang/register","--import=vibelang/register"),fc.constantFrom("./node_modules/vite/bin/vite.js","../node_modules/vite/bin/vite.js"),fc.constantFrom("","\"",String.fromCharCode(39)),fc.constantFrom(""," build"," preview"),fc.constantFrom(" --configLoader native"," --configLoader=native"),fc.constantFrom("vite.config.ts","vite.prod.config.mts"),
 (preload,script,q,mode,loader,name)=>check("node "+preload+" "+q+script+q+mode+loader+" --config "+name,{name})),{seed:780211,numRuns:200});
});
test("unrelated Node launchers supply no native-config proof",()=>{
 for(const command of ["node scripts/vite.js --config vite.config.ts","node ./node_modules/not-vite/bin/vite.js --config vite.config.ts","node -e 'console.log(\"vite\")'"]){
  const result=nativeViteScripts({dev:command},{root:"/project",dir:corpus.dir,configs:[corpus.config]});
  assert.deepEqual(result.wired,[]);assert.equal(result.scripts.dev,command);
 }
});
test("an unwired Node Vite launcher gets flags after its script path",()=>{
 const command="node ./node_modules/vite/bin/vite.js build --config vite.config.ts";
 const result=nativeViteScripts({dev:command},{root:"/project",dir:corpus.dir,configs:[corpus.config]});
 assert.deepEqual(result.wired,[corpus.config]);
 assert.match(result.scripts.dev,/node \.\/node_modules\/vite\/bin\/vite\.js --configLoader native build/);
 assert.match(result.scripts.dev,/NODE_OPTIONS=.*--import=vibelang\/register/);
 assert.equal(nativeViteScripts(result.scripts,{root:"/project",dir:corpus.dir,configs:[corpus.config]}).scripts.dev,result.scripts.dev);
});
