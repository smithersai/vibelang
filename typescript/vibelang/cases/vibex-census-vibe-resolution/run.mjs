// run-seconds: 120
import assert from "node:assert/strict"
import {mkdirSync,readFileSync,writeFileSync} from "node:fs"
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
// Beside leaf.vibe the explicit source wins over a hand-written leaf.d.ts
// (no TS2322), and emit keeps that declaration's bytes and reports the
// collision at its native declaration path (VIP-27): TS5055 alone.
const both=join(dirname(fileURLToPath(import.meta.url)),"out/both");mkdirSync(both,{recursive:true})
writeFileSync(join(both,"main.vibe"),'import {kind} from "./leaf.vibe"; export const selected: "source"=kind')
writeFileSync(join(both,"leaf.vibe"),'export const kind="source"')
writeFileSync(join(both,"leaf.d.ts"),'export declare const kind:"fallback"')
writeFileSync(join(both,"tsconfig.json"),JSON.stringify({compilerOptions:{module:"esnext",moduleResolution:"bundler",strict:true,noEmit:true,allowImportingTsExtensions:true,types:[]},files:["main.vibe"]}))
const collided=spawnSync(binary,["-p",both,"--pretty","false"],{encoding:"utf8",timeout:60000})
assert.deepEqual([...(collided.stdout+collided.stderr).matchAll(/error (TS\d+)/g)].map(m=>m[1]),["TS5055"],collided.stdout+collided.stderr)
assert.equal(readFileSync(join(both,"leaf.d.ts"),"utf8"),'export declare const kind:"fallback"')
console.log("VIP-39 PASS")
