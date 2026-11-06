import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const dir = import.meta.dirname;
const compiler = path.resolve(dir, "../../../built/local/tsc");
const stock = path.resolve(dir, "../../../../docs/tools/node_modules/typescript/bin/tsc");
const base = path.join(dir, "out", "references");
fs.rmSync(base,{recursive:true,force:true});
let oracle;
for (const extension of ["ts", "vibe", "vibex"]) {
 const root = path.join(base, extension);
 const files = {
  "core/package.json": {name:"core",type:"module",exports:{"./*":"./src/*.ts","./Stage":"./src/Stage."+extension}},
  "core/tsconfig.json": {compilerOptions:{target:"ES2022",module:"Preserve",moduleResolution:"Bundler",rootDir:"src",outDir:"lib",composite:true,declaration:true,rewriteRelativeImportExtensions:true,skipLibCheck:true,jsx:"preserve",types:[]},vibe:{effectGlobals:false,effectModules:false},include:["src"]},
  ["core/src/Stage."+extension]: "export class Stage { private marker = 1; }\n",
  "core/src/api.ts": 'import { Stage } from "./Stage.'+extension+'"; export const make = () => new Stage();\n',
  "app/package.json": {type:"module"},
  "app/tsconfig.json": {compilerOptions:{target:"ES2022",module:"Preserve",moduleResolution:"Bundler",outDir:"out",composite:true,declaration:true,rewriteRelativeImportExtensions:true,skipLibCheck:true,types:[]},references:[{path:"../core"}],include:["src"]},
  "app/src/main.ts": 'import { make } from "core/api"; export const result = make();\n'
 };
 for (const [name,value] of Object.entries(files)) {
  const file = path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});
  const text=typeof value==="string"?value:JSON.stringify(value);
  fs.writeFileSync(file,extension==="ts"?text.replace(/,"vibe":\{[^}]*\}/g,""):text);
 }
 fs.mkdirSync(path.join(root,"app/node_modules"),{recursive:true});
 fs.symlinkSync(path.join(root,"core"),path.join(root,"app/node_modules/core"));
 for (const pkg of ["core","app"]) {
  const command=extension==="ts"?process.execPath:compiler;
  const args=[...(extension==="ts"?[stock]:[]),"-p",path.join(root,pkg),"--pretty","false"];
  const ran=spawnSync(command,args,{encoding:"utf8",timeout:20000});
  assert.equal(ran.status,0,extension+"/"+pkg+": "+ran.stdout+ran.stderr);
 }
 const declaration=fs.readFileSync(path.join(root,"app/out/src/main.d.ts"),"utf8");
 if(extension==="ts")oracle=declaration;
 else assert.equal(declaration,oracle,extension+" must preserve the stock public package name");
 assert.match(declaration,/import\("core\/Stage"\)\.Stage/);
}
console.log("native project reference declarations match stock TypeScript");
