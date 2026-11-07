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

// 1. Legacy severity map in the selected config, JSONC comment kept.
project(ctx => {
  repo(ctx, '// keep this comment\n{ "compilerOptions": ' + JSON.stringify(options) + ', "files": ["main.vibe"], "vibelang": { "diagnostics": { "EK4609": "off" } } }\n')
  const r = fix(ctx)
  const text = ctx.read("repo/tsconfig.json")
  assert.match(text, /keep this comment/, r.text)
  assert.doesNotMatch(text, /"diagnostics"/, text)
  assert.match(text, /"severities"[^}]*"EK4609": "off"/, text)
})
// 2. The retired declarationSidecars setting is removed; other vibe keys stay.
project(ctx => {
  repo(ctx, { compilerOptions: options, files: ["main.vibe"], vibe: { declarationSidecars: true, effectGlobals: false } })
  assert.match(compile(ctx).text, /declarationSidecars/, "the retired setting is diagnosed")
  const r = fix(ctx)
  assert.deepEqual(JSON.parse(ctx.read("repo/tsconfig.json")).vibe, { effectGlobals: false }, r.text)
  assert.doesNotMatch(compile(ctx).text, /declarationSidecars|error/)
})
// 3. EK3012: an assigned EK38xx key without a plugin entry gets the entry.
project(ctx => {
  repo(ctx, { compilerOptions: options, files: ["main.vibe"], vibe: { severities: { EK3801: "warning" } } })
  assert.match(compile(ctx).text, /EK3012/, "the legacy activation is diagnosed")
  const r = fix(ctx)
  const after = JSON.parse(ctx.read("repo/tsconfig.json"))
  assert.ok(after.compilerOptions.plugins?.some(p => p.name === "@effect/language-service"), r.text + JSON.stringify(after))
  assert.equal(after.vibe.severities.EK3801, "warning")
  assert.doesNotMatch(compile(ctx).text, /EK3012/)
})
// 4. --fix-vip-only sets the EK4802 override after a refused call; ordinary --fix does not.
const refused = "error Missing { id: number }\neffect function load(n: number) {\n  try yieldNow\n  return n\n}\neffect function f() {\n  return [1].map((n) => {\n    load(n)\n    return n\n  })\n}\n"
for (const flags of [["--fix-vip-only"], []]) project(ctx => {
  repo(ctx, { compilerOptions: options, files: ["main.vibe"] }, refused)
  const r = fix(ctx, ...flags)
  const text = ctx.read("repo/tsconfig.json")
  if (flags.length) {
    assert.notEqual(r.status, 0, r.text)
    assert.match(text, /"EK4802": "error"/, r.text + text)
    assert.match(text, /\/\/ vibelang --fix-vip-only refused 1 call/, text)
  } else assert.doesNotMatch(text, /EK4802/, text)
})

// 5. extends traversal: owned bases are edited; a base outside the
// repository, under node_modules, or reached through a symlink that leaves
// the repository is reported and left byte for byte.
for (const legacy of [{ vibelang: { diagnostics: { EK4609: "off" } } }, { vibe: { declarationSidecars: true } }]) project(ctx => {
  const base = "// base comment\n" + JSON.stringify(legacy) + "\n"
  const bases = { owned: "repo/config/owned.json", chained: "repo/config/chained.json", external: "external.json", dependency: "repo/node_modules/preset/base.json", linked: "outside/linked.json" }
  for (const file of Object.values(bases)) ctx.put(file, base)
  // owned.json extends chained.json, which is owned too.
  ctx.put(bases.owned, '// base comment\n{ "extends": "./chained.json", ' + JSON.stringify(legacy).slice(1) + "\n")
  const ownedText = ctx.read(bases.owned)
  mkdirSync(join(ctx.dir, "repo/links"), { recursive: true })
  symlinkSync(join(ctx.dir, bases.linked), join(ctx.dir, "repo/links/linked.json"))
  repo(ctx, { extends: ["./config/owned.json", "../external.json", "./node_modules/preset/base.json", "./links/linked.json"], compilerOptions: options, files: ["main.vibe"] })
  const r = fix(ctx)
  const label = Object.keys(legacy.vibe ?? legacy.vibelang)[0]
  for (const key of ["owned", "chained"]) {
    const text = ctx.read(bases[key])
    assert.notEqual(text, key === "owned" ? ownedText : base, label + ": owned " + key + " base is repaired\n" + r.text)
    assert.match(text, /base comment/)
    assert.doesNotMatch(text, /"diagnostics"|declarationSidecars/, label + " " + key + "\n" + text)
  }
  for (const key of ["external", "dependency", "linked"]) assert.equal(ctx.read(bases[key]), base, label + ": " + key + " base is not edited\n" + r.text)
  // Each external base is reported.
  if (legacy.vibelang) {
    for (const name of ["external.json", "node_modules/preset/base.json", "links/linked.json"]) {
      assert.match(r.text, new RegExp(name.replaceAll(".", "\\.").replaceAll("/", "[/\\\\]") + ": not fixed: config is outside repository ownership or under node_modules"), name + "\n" + r.text)
    }
  } else assert.equal((r.text.match(/declarationSidecars/g) ?? []).length >= 3, true, "each external sidecar setting is reported\n" + r.text)
})
console.log("owned configs are repaired; extends stops at the repository and node_modules")
