// Legacy owned configuration settings retain their diagnostics.
import assert from "node:assert/strict"
import { mkdirSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { project, baseOptions } from "../_tooling-witness.mjs"

const options = { ...baseOptions(), noEmit: true }
// repo(...) lays out a repository in repo/ beneath the temp project, so
// ../ is outside it; node_modules above it still resolve effect.
const repo = (ctx, config, main = "export const value = 1\n") => {
  mkdirSync(join(ctx.dir, "repo/.git"), { recursive: true })
  ctx.put("repo/package.json", '{"type":"module"}')
  ctx.put("repo/main.vibe", main)
  ctx.put("repo/tsconfig.json", config)
}
const compile = ctx => ctx.invoke("-p", "repo/tsconfig.json", "--pretty", "false")

// 2. The retired declarationSidecars setting is removed; other vibe keys stay.
project(ctx => {
  repo(ctx, { compilerOptions: options, files: ["main.vibe"], vibe: { declarationSidecars: true, effectGlobals: false } })
  assert.match(compile(ctx).text, /declarationSidecars/, "the retired setting is diagnosed")
})
// 3. EK3012: an assigned EK38xx key without a plugin entry gets the entry.
project(ctx => {
  repo(ctx, { compilerOptions: options, files: ["main.vibe"], vibe: { severities: { EK3801: "warning" } } })
  assert.match(compile(ctx).text, /EK3012/, "the legacy activation is diagnosed")
})

console.log("owned legacy settings are diagnosed")
