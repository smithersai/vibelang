import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { makeConfig, paths, record } from "../../../../../../.smithers/flows/migrate/lib/steps.mjs"
import { syncPackPolicy } from "../../../../../../.smithers/flows/migrate/lib/pack-policy.mjs"
import * as Jj from "../../../../../../.smithers/flows/migrate/lib/jj.mjs"
import { must, writeJson, slug } from "../../../../../../.smithers/flows/migrate/lib/util.mjs"
const repo = fileURLToPath(new URL("../../../../../../", import.meta.url))
const compiler = join(repo, "packages/compiler")
const require = createRequire(join(compiler, "package.json"))
const prettier = require("prettier")
const [key = "create", rawMode = "0"] = process.argv.slice(2), mode = Number(rawMode) & 15
const outer = mkdtempSync(join(tmpdir(), "record-packing-format-")), target = join(outer, "repo"), run = join(outer, "run")
const corpus = JSON.parse(readFileSync(new URL("../corpus/opencode-record-packing-format.json", import.meta.url), "utf8"))
const stages = []
const receipt = ".vibelang/pack-policy.json"
try {
 mkdirSync(join(target, "node_modules/.bin"), { recursive: true })
 for (const [name, where] of [
  ["vibelang", compiler], ["typescript", dirname(createRequire(join(repo, "packages/runtime/package.json")).resolve("typescript/package.json"))],
  ["effect", dirname(createRequire(join(repo, "experiments/package.json")).resolve("effect/package.json"))],
  ["vibelang-runtime", join(repo, "packages/runtime")],
 ]) symlinkSync(where, join(target, "node_modules", name), "dir")
 for (const [name, where] of [
  ["vibelang", join(compiler, "bin/vibelang")], ["vibelang-format", join(compiler, "bin/vibelang-format")],
  ["prettier", join(dirname(require.resolve("prettier/package.json")), "bin/prettier.cjs")],
 ]) symlinkSync(where, join(target, "node_modules/.bin", name))
 const moduleName = mode & 1 ? "nested/entry" : "entry"
 const from = moduleName + (mode & 2 ? ".tsx" : ".ts"), to = moduleName + (mode & 2 ? ".vibex" : ".vibe")
 const source = corpus.native
 mkdirSync(dirname(join(target, from)), { recursive: true })
 writeFileSync(join(target, from), source)
 const manifest = {
  name: "record-packing-fixture", version: "1.0.0", private: true, type: "module", files: ["dist"],
  scripts: { format: "prettier --check ." },
  exports: key === "unrouted" ? undefined : { ".": "./" + from },
 }
 writeJson(join(target, "package.json"), manifest)
 writeJson(join(target, ".prettierrc.json"), { semi: false, printWidth: mode & 4 ? 80 : 120, singleQuote: Boolean(mode & 8) })
 writeJson(join(target, "tsconfig.json"), { compilerOptions: { strict: true, target: "ES2022", module: "ESNext", moduleResolution: "bundler", jsx: "preserve", types: [], rootDir: "." }, include: ["**/*.ts", "**/*.tsx", "**/*.vibe", "**/*.vibex"], exclude: ["node_modules", ".vibelang"] })
 writeFileSync(join(target, ".gitignore"), "node_modules/\n")
 await must("jj git init", { cwd: target })
 await must("jj config set --repo user.name test", { cwd: target })
 await must("jj config set --repo user.email test@localhost", { cwd: target })
 await Jj.commit(target, "original")
 stages.push("original")
 renameSync(join(target, from), join(target, to))
 if (manifest.exports) manifest.exports["."] = { types: "./" + moduleName + (mode & 2 ? ".d.vibex.ts" : ".d.vibe.ts"), default: "./" + to }
 writeJson(join(target, "package.json"), manifest)
 if (key === "existing") {
  const old = { ...manifest, exports: { ".": { types: "./" + to, "vibelang-source": "./" + to, default: "./.vibelang/js/" + moduleName + ".js" } } }
  syncPackPolicy(target, old)
  writeJson(join(target, "package.json"), old)
 }
 const p = paths(run)
 const config = makeConfig({ target, test: "true", vibelangVersion: "0.0.12" })
 writeJson(p.config, config)
 writeJson(p.plan, { batches: [{ files: [from] }] })
 writeJson(p.codemod("01"), {
  renames: [{ from, to }], fix: { refused: [], totals: {} },
  exportEdits: [{ manifest: "package.json" }], packingFiles: ["package.json", receipt],
 })
 writeJson(p.inventory, { files: [{ path: from, tokens: 6 }] })
 writeJson(join(p.baseline, "tests.json"), { code: 0, tests: {}, total: 0, passed: 0, failed: [], skipped: 0 })
 writeJson(join(p.baseline, "compile-" + slug(".") + ".json"), [])
 writeJson(join(p.baseline, "upstream-packs.json"), { packages: {}, skipped: { ".": { reason: "private" } } })
 writeJson(p.verify("01"), { ok: true, checks: { packs: true } })
 stages.push("record")
 let result, error
 try { result = await record({ run, batch: "01" }) } catch (cause) { error = cause.message }
 stages.push(error ? "refused" : "recorded")
 const path = join(target, receipt), present = existsSync(path)
 const actual = present ? readFileSync(path, "utf8") : null
 const canonical = present ? await prettier.format(actual, { ...(await prettier.resolveConfig(path)), filepath: path }) : null
 if (present) assert.deepEqual(JSON.parse(actual), corpus.policy, "emission must preserve the captured packing policy values")
 const verification = existsSync(p.verify("01")) ? JSON.parse(readFileSync(p.verify("01"), "utf8")) : null
 console.log(JSON.stringify({ key, mode, stages, recorded: Boolean(result?.commit), error, present, actual, canonical,
  canonicalOutput: actual === canonical, verificationOK: verification?.ok, verificationRefreshed: result?.verificationRefreshed,
  formatter: "prettier@" + prettier.version,
  logs: error ? existsSync(join(p.batch("01"), "verify.json")) ? JSON.parse(readFileSync(join(p.batch("01"), "verify.json"), "utf8")) : null : null,
 }))
} finally { rmSync(outer, { recursive: true, force: true }) }
