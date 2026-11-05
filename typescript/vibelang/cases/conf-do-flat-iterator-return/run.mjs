import { ensurePinnedReference } from "../../test/vip7-reference.mjs"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdirSync, rmSync, symlinkSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import { Effect } from "effect"
import { main } from "./out/main.js"
const here=dirname(fileURLToPath(import.meta.url))
const cache=resolve(here,"../../../.cache/do-flat-reference")
await ensurePinnedReference(cache)
mkdirSync(resolve(here,"typescript/node_modules"),{recursive:true})
rmSync(resolve(here,"typescript/node_modules/effect"),{recursive:true,force:true})
symlinkSync(resolve(cache,"node_modules/effect"),resolve(here,"typescript/node_modules/effect"),"dir")
const built=spawnSync(process.execPath,[resolve(cache,"node_modules/typescript/bin/tsc"),"-p","typescript/tsconfig.json"],{cwd:here,encoding:"utf8",timeout:120000})
assert.ifError(built.error)
assert.equal(built.status,0,built.stdout+"\n"+built.stderr)
const reference=await import("./typescript/out/main.js")
const requireReference=createRequire(resolve(cache,"package.json"))
const nativeEffect=await import(pathToFileURL(requireReference.resolve("effect/Effect")))
const actual=await Effect.runPromise(main())
assert.deepEqual(actual,await nativeEffect.runPromise(reference.main()))
assert.deepEqual(actual,[9,["start","closed"]])
console.log("ok outward default return closes the iterator and skips later statements")
