import assert from "node:assert/strict"
import {mkdirSync,writeFileSync} from "node:fs"
import {spawnSync} from "node:child_process"
import {join,dirname} from "node:path"
import {fileURLToPath} from "node:url"
const cwd=join(dirname(fileURLToPath(import.meta.url)),"out/fallback");mkdirSync(cwd,{recursive:true})
writeFileSync(join(cwd,"main.vibe"),'import {kind} from "./leaf.vibe"; export const selected: "fallback"=kind')
writeFileSync(join(cwd,"leaf.d.ts"),'export declare const kind:"fallback"')
writeFileSync(join(cwd,"tsconfig.json"),JSON.stringify({compilerOptions:{module:"esnext",moduleResolution:"bundler",strict:true,noEmit:true,allowImportingTsExtensions:true,types:[]},files:["main.vibe"]}))
const binary=fileURLToPath(new URL("../../../built/local/tsc",import.meta.url))
const run=spawnSync(binary,["-p",cwd,"--pretty","false"],{encoding:"utf8",timeout:60000})
assert.equal(run.status,0,run.stdout+run.stderr)
console.log("VIP-39 PASS")
