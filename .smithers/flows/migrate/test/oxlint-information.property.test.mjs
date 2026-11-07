import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { test } from "node:test"
import { wireDeveloperTools } from "../lib/tooling.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
function verify(flag, missing, first, projection = false) {
  const root = mkdtempSync(join(tmpdir(), "oxlint-information-"))
  const put = (file, text) => { mkdirSync(join(root, file, ".."), { recursive: true }); writeFileSync(join(root, file), text) }
  const before = "export function broken( {\n"
  try {
    put("package.json", '{"type":"module","scripts":{"lint":"oxlint src"}}')
    put(".oxlintrc.json", '{"categories":{"correctness":"off"},"rules":{"no-debugger":"error"}}')
    put("node_modules/oxlint/package.json", '{"name":"oxlint","bin":{"oxlint":"engine.cjs"}}')
    put("node_modules/oxlint/engine.cjs", [
      'const fs=require("node:fs"),a=process.argv.slice(2);',
      'fs.writeFileSync("native-arguments.json",JSON.stringify(a));',
      'if(a.includes("--help")||a.includes("-h"))console.log("Usage: oxlint [OPTIONS]");',
      'else if(a.includes("--version")||a.includes("-V"))console.log("oxlint fixture-version");',
      'else if(a.includes("--print-config"))console.log(JSON.stringify({rules:{"no-debugger":"error"}}));',
      'else if(a.includes("--init")){fs.writeFileSync("initialized.json","{}");console.log("Initialized configuration")}',
      'else console.log(JSON.stringify({diagnostics:[]}));',
    ].join("\n"))
    put("node_modules/vibelang/package.json", '{"name":"vibelang","type":"module","exports":{"./register":"./register.mjs","./eslint":"./eslint.mjs","./oxlint":"./oxlint.mjs"}}')
    put("node_modules/vibelang/register.mjs", projection ? "" : 'throw Error("information must not load the source compiler");')
    put("node_modules/vibelang/eslint.mjs", "export default {parseForESLint(){throw Error('must not parse source')}}")
    put("node_modules/vibelang/oxlint.mjs", 'export function printProjectedConfig(){return JSON.stringify({projected:true})} export function formatUnix(){return ""} export async function lintProjected(){throw Error("information must not lint source")}')
    for (const ext of ["vibe", "vibex"]) put("src/broken." + ext, before)
    put("reject-input-stat.mjs", 'import fs from "node:fs"; import {syncBuiltinESMExports} from "node:module"; const original=fs.statSync; fs.statSync=(path,...args)=>{if(/\\.vibex?$/.test(String(path))||String(path).includes("blocked/"))throw Error("information inspected an input path"); return original(path,...args)}; syncBuiltinESMExports();')
    wireDeveloperTools({ root, specsFor: () => ({ vibelang: "0.0.12" }), ts })
    const paths = missing ? ["src/missing.vibe", "src/missing.vibex", "blocked/file.ts"] : ["src/broken.vibe", "src/broken.vibex"]
    const flags = [flag, "--fix", ...(projection ? ["--vibe-native"] : [])]
    const args = first ? [...flags, ...paths] : [...paths, ...flags]
    const run = spawnSync(process.execPath, [join(root, ".vibelang/oxlint.mjs"), ...args], { cwd: root, encoding: "utf8", env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, projection ? "--import=" + pathToFileURL(join(root, "reject-input-stat.mjs")).href : ""].filter(Boolean).join(" ") } })
    assert.equal(run.status, 0, run.stdout + run.stderr)
    if (projection) assert.deepEqual(JSON.parse(run.stdout), { projected: true })
    else if (/help|^-h$/.test(flag)) assert.match(run.stdout, /^Usage: oxlint/)
    else if (/version|^-V$/.test(flag)) assert.equal(run.stdout.trim(), "oxlint fixture-version")
    else if (flag === "--print-config") assert.deepEqual(JSON.parse(run.stdout), { rules: { "no-debugger": "error" } })
    else assert.equal(readFileSync(join(root, "initialized.json"), "utf8"), "{}")
    for (const ext of ["vibe", "vibex"]) assert.equal(readFileSync(join(root, "src/broken." + ext), "utf8"), before)
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("source-only information commands bypass parsing, findings and missing inputs", () => {
  verify("--help", false, true)
  fc.assert(fc.property(fc.constantFrom("--help", "-h", "--version", "-V", "--print-config", "--init"), fc.boolean(), fc.boolean(), verify), { numRuns: 36 })
})
test("native configuration output ignores missing source inputs", () => {
  verify("--print-config", true, false, true)
})
