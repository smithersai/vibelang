import { spawnSync } from "node:child_process"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { test } from "node:test"
import * as policy from "../lib/pack-policy.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const fc = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))("fast-check")
const rule = "A package build also writes ordinary `.d.ts` files to its output directory"
const scratch = process.env.TMPDIR || "/tmp"
const write = (root, file, text) => { mkdirSync(join(root, file, ".."), { recursive: true }); writeFileSync(join(root, file), text) }

test("sidecar pack oracle quotes VIP-27", () => {
  assert.ok(readFileSync(new URL("../../../../docs/design/vips/0027-declaration-output.md", import.meta.url), "utf8").includes(rule))
})

async function witness({ files, shape, extension = "vibe", packer = "npm", publish = false }) {
  const root = mkdtempSync(join(scratch, "sidecar-pack-"))
  try {
    const pkg = join(root, "pkg")
    const leaf = { types: "./dist/index.d.ts", default: "./dist/index.js" }
    const exports = shape === "pattern" ? { "./*": { types: "./dist/*.d.ts", default: "./dist/*.js" } }
      : shape === "array" ? { ".": [leaf] } : { ".": leaf }
    const manifest = { name: "alchemy-aws-sidecar-repro", version: "1.0.0", type: "module", exports }
    if (files !== null) manifest.files = [...files]
    if (publish) manifest.publishConfig = { ...(files !== null ? { files: [...files] } : {}), exports }
    write(pkg, "package.json", JSON.stringify(manifest))
    write(pkg, ".gitignore", "secret.txt\n")
    write(pkg, "secret.txt", "private")
    write(pkg, "dist/index.js", "export const answer = 42\n")
    write(pkg, "dist/index.d.ts", "export declare const answer: 42\n")
    write(pkg, "src/index." + extension, "export const answer = 42\n")
    write(pkg, "src/index.d." + extension + ".ts", "export declare const answer: 42\n")
    const before = await policy.packRepository({ target: pkg, packages: [{ dir: "." }], packer }, join(root, "before"))
    const hadSidecars = before.packages["."].files.some(policy.isSidecar)
    if (packer === "npm") assert.equal(hadSidecars, true, JSON.stringify({ files, shape, extension, packer, packed: before.packages["."].files }))
    policy.excludeSidecars(pkg, manifest)
    write(pkg, "package.json", JSON.stringify(manifest))
    const once = JSON.stringify(manifest)
    assert.deepEqual(policy.excludeSidecars(pkg, manifest), [])
    assert.equal(JSON.stringify(manifest), once)
    const after = await policy.packRepository({ target: pkg, packages: [{ dir: "." }], packer }, join(root, "after"))
    assert.deepEqual(after.packages["."].files.filter(policy.isSidecar), [])
    assert.ok(after.packages["."].files.includes("dist/index.d.ts"))
    assert.ok(!after.packages["."].files.includes("secret.txt"))
    assert.equal(policy.comparePacks(before, after).ok, true)
    assert.equal(policy.comparePacks(before, before).ok, !hadSidecars)
    const dropped = structuredClone(after)
    dropped.packages["."].files = dropped.packages["."].files.filter(f => f !== "dist/index.d.ts")
    assert.equal(policy.comparePacks(before, dropped).ok, false)
    const extra = structuredClone(after)
    extra.packages["."].files.push("surprise.js")
    assert.equal(policy.comparePacks(before, extra).ok, false)
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("pnpm publishConfig files retain declarations and exclude sidecars", () => witness({ files: ["src", "dist"], shape: "conditions", publish: true, packer: "pnpm" }))
test("alchemy AWS: source allowlist must exclude declaration sidecars", () => witness({ files: ["src", "dist"], shape: "pattern" }))
test("property: files and exports shapes preserve declarations while sidecars stay private", async () => {
  await checkProperty(fc, { name: "sidecars-out-of-packs", rule, command: "node --test .smithers/flows/migrate/test/sidecar-pack.property.test.mjs",
    arbitrary: fc.record({ files: fc.constantFrom(null, ["src", "dist"], ["**", "!secret.txt"], ["src/**", "dist/**"]),
      shape: fc.constantFrom("conditions", "pattern", "array"), extension: fc.constantFrom("vibe", "vibex"), packer: fc.constantFrom("npm", "bun", "pnpm"), publish: fc.boolean() }),
    check: witness, numRuns: 36, regressions: new URL("./corpus/", import.meta.url) })
})
test("pack comparison permits only explicitly migrated source pairs", () => {
  const receipt = files => ({ packages: { ".": { files } } })
  assert.equal(policy.comparePacks(receipt(["src/a.ts"]), receipt(["src/a.vibe"]), { ".": ["src/a.vibe"] }).ok, true)
  assert.equal(policy.comparePacks(receipt(["src/a.ts"]), receipt(["src/a.vibe"])).ok, false)
  assert.equal(policy.comparePacks(receipt(["src/a.ts"]), receipt(["src/a.ts", "src/b.vibe"]), { ".": ["src/b.vibe"] }).ok, false)
  assert.equal(policy.comparePacks(null, receipt([])).ok, false)
})

test("setup packing policy leaves test fixtures and vendored trees byte-identical", () => {
  const root = mkdtempSync(join(scratch, "sidecar-setup-"))
  try {
    write(root, "package.json", JSON.stringify({ private: true, workspaces: ["packages/*"] }))
    const original = '{"name":"witness","version":"1.0.0","files":["src"]}\n'
    for (const dir of ["packages/public", "packages/public/test/fixture", "vendor/lib", "test/fixtures/pkg"]) write(root, dir + "/package.json", original)
    assert.deepEqual(policy.wireSidecarPacking(root), ["packages/public/package.json"])
    for (const dir of ["packages/public/test/fixture", "vendor/lib", "test/fixtures/pkg"]) assert.equal(readFileSync(join(root, dir, "package.json"), "utf8"), original)
    assert.deepEqual(policy.wireSidecarPacking(root), [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test("pack gate sees publication lifecycle changes and ignores private packages", async () => {
  const root = mkdtempSync(join(scratch, "sidecar-lifecycle-"))
  try {
    write(root, "pkg/package.json", JSON.stringify({ name: "lifecycle", version: "1.0.0", scripts: { prepack: "node make.cjs" } }))
    write(root, "pkg/make.cjs", "require('node:fs').writeFileSync('generated.d.vibex.ts', 'export {}')")
    const receipt = await policy.packRepository({ target: join(root, "pkg"), packages: [{ dir: "." }] }, join(root, "packs"))
    assert.ok(receipt.packages["."].files.includes("generated.d.vibex.ts"))
    assert.equal(policy.comparePacks(receipt, receipt).ok, false)
    write(root, "private/package.json", '{"private":true}')
    assert.deepEqual((await policy.packRepository({ target: join(root, "private"), packages: [{ dir: "." }] }, join(root, "private-packs"))).packages, {})
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("published types cannot keep pointing at a sidecar after exclusion", async () => {
  const root = mkdtempSync(join(scratch, "sidecar-types-"))
  try {
    const pkg = join(root, "pkg")
    write(pkg, "package.json", JSON.stringify({ name: "source-types", version: "1.0.0", files: ["src", "!**/*.d.vibe.ts"], exports: { ".": { types: "./src/index.d.vibe.ts", default: "./src/index.js" } } }))
    write(pkg, "src/index.js", "export const answer = 42")
    write(pkg, "src/index.d.vibe.ts", "export declare const answer: 42")
    const after = await policy.packRepository({ target: pkg }, join(root, "packs"))
    assert.deepEqual(after.packages["."].files.filter(policy.isSidecar), [])
    assert.deepEqual(after.packages["."].sidecarTargets, ["./src/index.d.vibe.ts"])
    assert.equal(policy.comparePacks(after, after).ok, false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test("pack gate uses a custom publication archive's manifest and removes only its new artifact", async () => {
  const root = mkdtempSync(join(scratch, "sidecar-custom-"))
  try {
    const pkg = join(root, "pkg")
    write(pkg, "package.json", JSON.stringify({ name: "custom-pack", version: "1.0.0", exports: { ".": "./src/index.d.vibe.ts" }, scripts: { pack: "node pack.cjs" } }))
    write(pkg, "pack.cjs", "const fs=require('node:fs'),cp=require('node:child_process');fs.mkdirSync('stage/package',{recursive:true});fs.writeFileSync('stage/package/package.json',JSON.stringify({name:'custom-pack',version:'1.0.0',exports:{'.':'./dist/index.js'}}));cp.execFileSync('tar',['-czf','published.tgz','-C','stage','package']);fs.rmSync('stage',{recursive:true})")
    const after = await policy.packRepository({ target: pkg }, join(root, "packs"))
    assert.deepEqual(after.packages["."].sidecarTargets, [])
    assert.equal(policy.comparePacks(after, after).ok, true)
    assert.throws(() => readFileSync(join(pkg, "published.tgz")), { code: "ENOENT" })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("stock TypeScript 5.9.3 twin and installed Node/Bun consumers use built declarations", async () => {
  const root = mkdtempSync(join(scratch, "sidecar-consumer-"))
  const run = (cwd, cmd, args) => {
    const result = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 60000 })
    assert.equal(result.status, 0, [cmd, ...args].join(" ") + "\n" + result.stdout + result.stderr)
    return result.stdout.trim()
  }
  try {
    const compiler = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url)).resolve("typescript/bin/tsc")
    const pkg = join(root, "pkg")
    const manifest = { name: "sidecar-consumer", version: "1.0.0", type: "module", files: ["src", "dist"], exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } } }
    write(pkg, "package.json", JSON.stringify(manifest))
    write(pkg, "src/index.ts", "export const answer = 42\n")
    run(pkg, "node", [compiler, "--declaration", "--module", "nodenext", "--target", "es2022", "--outDir", "dist", "src/index.ts"])
    assert.equal(run(pkg, "node", [compiler, "--version"]), "Version 5.9.3")
    assert.equal(readFileSync(join(pkg, "dist/index.d.ts"), "utf8").trim(), "export declare const answer = 42;")
    // The migrated module has the same built API, with an additional source-tool sidecar.
    write(pkg, "src/index.d.vibe.ts", "export declare const answer = 42\n")
    for (const side of ["before", "after"]) {
      if (side === "after") {
        policy.excludeSidecars(pkg, manifest)
        write(pkg, "package.json", JSON.stringify(manifest))
      }
      const packed = JSON.parse(run(pkg, "npm", ["pack", "--json", "--pack-destination", root]))[0]
      const consumer = join(root, side)
      write(consumer, "package.json", '{"private":true,"type":"module"}')
      run(consumer, "npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", join(root, packed.filename)])
      write(consumer, "index.ts", 'import { answer } from "sidecar-consumer"; const exact: 42 = answer;\n// @ts-expect-error the declared value is a number\nconst wrong: string = answer;\n')
      run(consumer, "node", [compiler, "--noEmit", "--strict", "--module", "nodenext", "index.ts"])
      for (const engine of ["node", "bun"]) assert.equal(run(consumer, engine, ["--input-type=module", "-e", 'import { answer } from "sidecar-consumer"; console.log(answer)']), "42")
      rmSync(join(root, packed.filename))
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
