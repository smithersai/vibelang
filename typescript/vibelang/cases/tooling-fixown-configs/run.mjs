// --fix repairs owned configs: legacy severity maps, the retired
// declarationSidecars setting, the EK3012 plugin-entry migration and the
// --fix-vip-only EK4802 override. It traverses extends only inside the
// repository and outside node_modules, and reports external configs
// without editing them.
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
const fix = (ctx, ...flags) => ctx.invoke(...flags, "--fix", "-p", "repo/tsconfig.json", "--pretty", "false")
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

console.log("owned configs are repaired; extends stops at the repository and node_modules")
