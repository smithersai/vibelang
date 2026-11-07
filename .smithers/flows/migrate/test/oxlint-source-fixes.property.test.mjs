import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { test } from "node:test"
import { wireDeveloperTools } from "../lib/tooling.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
function verify(extension, name, both, flagFirst, information) {
  const root = mkdtempSync(join(tmpdir(), "oxlint-source-fixes-"))
  const put = (file, text) => { mkdirSync(join(root, file, ".."), { recursive: true }); writeFileSync(join(root, file), text) }
  const before = ext => "// café " + name + "\nexport error Missing { message: string }\nexport function Work() {\n  let " + name + " = 1\n  return " + (ext === "vibex" ? "<div>{" + name + "}</div>" : name) + "\n}\n"
  try {
    put("package.json", '{"type":"module","scripts":{"lint":"oxlint src"}}')
    put(".oxlintrc.json", '{"categories":{"correctness":"off"},"rules":{"prefer-const":"error"}}')
    put("node_modules/oxlint/package.json", '{"name":"oxlint","bin":{"oxlint":"engine.cjs"}}')
    put("node_modules/oxlint/engine.cjs", 'console.log(JSON.stringify({diagnostics:[],number_of_files:0,number_of_rules:0,threads_count:1}));')
    put("node_modules/vibelang/package.json", '{"name":"vibelang","type":"module","exports":{"./register":"./register.mjs","./eslint":"./eslint.mjs","./oxlint":"./oxlint.mjs"}}')
    put("node_modules/vibelang/register.mjs", "")
    put("node_modules/vibelang/eslint.mjs", "export default {parseForESLint(){}}")
    put("node_modules/vibelang/oxlint.mjs", 'export function formatUnix(){return ""} export function printProjectedConfig(){return "{}"} export async function lintProjected(options){if(options.forward.includes("--fix"))throw Error("projected text must not be fixed");return {output:{diagnostics:[],number_of_files:1,number_of_rules:0}}}')
    put("node_modules/eslint/package.json", '{"name":"eslint","type":"module","exports":"./index.mjs"}')
    // Model ESLint's public fix/outputFixes contract; the adapter must ask it
    // to compute fixes and persist only the results of the selected lint run.
    put("node_modules/eslint/index.mjs", [
      'import fs from "node:fs";',
      'export class ESLint {constructor(options){this.options=options}',
      'async lintFiles(paths){return paths.map(filePath=>{const source=fs.readFileSync(filePath,"utf8"),pending=/\\blet /.test(source),fix=this.options.fix===true&&pending;return {filePath,messages:!pending||fix?[]:[{ruleId:"prefer-const",message:"use const",severity:2,line:4,column:3}],errorCount:!pending||fix?0:1,warningCount:0,output:fix?source.replace(/\\blet /,"const "):undefined}})}',
      'static async outputFixes(results){for(const result of results)if(result.output!==undefined)fs.writeFileSync(result.filePath,result.output)}',
      'async loadFormatter(){return {format(){return ""}}}}',
    ].join("\n"))
    const selected = both ? ["vibe", "vibex"] : [extension]
    for (const ext of ["vibe", "vibex"]) put("src/entry." + ext, before(ext))
    put("src/unselected." + extension, before(extension))
    wireDeveloperTools({ root, specsFor: () => ({ vibelang: "0.0.12" }), ts })
    const files = selected.map(ext => "src/entry." + ext)
    const run = args => spawnSync(process.execPath, [join(root, ".vibelang/oxlint.mjs"), "--format", "json", ...args], { cwd: root, encoding: "utf8" })
    const lint = run(files)
    assert.equal(lint.status, 1, lint.stdout + lint.stderr)
    for (const ext of ["vibe", "vibex"]) assert.equal(readFileSync(join(root, "src/entry." + ext), "utf8"), before(ext))
    const flags = ["--fix", ...(information ? [information] : [])]
    const fixed = run(flagFirst ? [...flags, ...files] : [...files, ...flags])
    assert.equal(fixed.status, information && information !== "--vibe-native" ? 1 : 0, fixed.stdout + fixed.stderr)
    for (const ext of ["vibe", "vibex"]) {
      const expected = !information && selected.includes(ext) ? before(ext).replace(/\blet /, "const ") : before(ext)
      assert.equal(readFileSync(join(root, "src/entry." + ext), "utf8"), expected, "only selected authored source is fixed")
    }
    assert.equal(readFileSync(join(root, "src/unselected." + extension), "utf8"), before(extension))
    if (!information) assert.equal(run(files).status, 0, "fixed source reruns clean")
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("file-list --fix persists source fixes on both extensions and preserves scope", () => {
  verify("vibe", "value", true, true)
  fc.assert(fc.property(fc.constantFrom("vibe", "vibex"), fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/).map(s => "item_" + s), fc.boolean(), fc.boolean(), (ext, name, both, first) => verify(ext, name, both, first)), { numRuns: 36 })
})

test("informational invocations with --fix do not edit source", () => {
  for (const flag of ["--help", "-h", "--version", "-V", "--print-config", "--init"]) verify("vibex", "value", true, false, flag)
})

test("native-only --fix does not edit projected or authored text", () => {
  verify("vibex", "value", true, false, "--vibe-native")
})
