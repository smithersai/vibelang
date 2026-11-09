// run-seconds: 120
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

// One entry per declared property: its name, prefixed by readonly when written.
function readonlyProjection(text) {
  // Custom matcher declarations were added after the old binary's release.
  // Their generated hint type is separate from the source member contract.
  text = text.replace(/^\s*static \[Symbol\.customMatcher\]\([\s\S]*?^\s*\];\n/gm, "")
  return text.split("\n").flatMap(line => {
    const m = /^\s*(readonly\s+)?([\w$]+|"[^"]*"|'[^']*')\??\s*:/.exec(line)
    return m ? [(m[1] ? "readonly " : "") + m[2]] : []
  })
}

// The reference materializes pre-pin schema/service and nested payload defaults.
// Ordinary native members keep their original source spelling.
export function checkMemberReadonlyUpgrade(caseUrl) {
  const root = fileURLToPath(caseUrl)
  const compiler = process.env.VIBELANG_BINARY
  assert(compiler, "harness compiler is required")
  const source = fs.readFileSync(path.join(root, "input.txt"), "utf8")
  const reference = fs.readFileSync(path.join(root, "legacy.txt"), "utf8")
  const invalid = fs.existsSync(path.join(root, "invalid"))
  const dir = path.join(root, "out", "upgrade")
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "package.json"), '{"name":"member-readonly","type":"module"}')
  fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target:"ES2022",module:"NodeNext",strict:true,skipLibCheck:true,
      declaration:true,emitDeclarationOnly:true,noEmitOnError:false,
      noPropertyAccessFromIndexSignature:true,outDir:"decl"
    },files:["main.vibe"]
  }))
  const run = (...flags) => {
    const r = spawnSync(compiler, ["-p",dir,"--pretty","false",...flags], {encoding:"utf8", timeout:20000})
    assert.ifError(r.error)
    assert.equal(r.signal,null,r.stdout+r.stderr)
    return {...r,text:r.stdout+r.stderr}
  }
  fs.writeFileSync(path.join(dir,"main.vibe"),reference)
  const old = run()
  if (!invalid) assert.equal(old.status,0,old.text)
  else assert.match(old.text,/EK2109/)
  const expected = fs.readFileSync(path.join(dir,"decl","main.d.ts"),"utf8")
  if (process.env.VIBELANG_PREPIN_BINARY) {
    // Check the explicit published member contract across compiler versions.
    // The explicit member spelling remains independently compilable;
    // historical releases differ in synthesized defaults and matcher helpers.
    fs.writeFileSync(path.join(dir,"main.vibe"),reference)
    const oldPin = spawnSync(process.env.VIBELANG_PREPIN_BINARY, ["-p",dir,"--pretty","false"], {encoding:"utf8",timeout:20000})
    assert.ifError(oldPin.error)
    if (!invalid) assert.equal(oldPin.status,0,oldPin.stdout+oldPin.stderr)
    // Compare the readonly projection: emit changes since the pin that are not
    // readonly (inline service shapes) are not this upgrade's to preserve.
    const prepin = fs.readFileSync(path.join(dir,"decl","main.d.ts"),"utf8")
    assert.deepEqual(readonlyProjection(expected),readonlyProjection(prepin),"published member contract readonly projection")
  }
  fs.writeFileSync(path.join(dir,"main.vibe"),source)
  const current = run()
  if (invalid) assert.match(current.text,/EK2109/)
  else assert.equal(current.status,0,current.text)
  const declaration = fs.readFileSync(path.join(dir,"decl","main.d.ts"),"utf8")
  assert.equal(fs.readFileSync(path.join(dir,"main.vibe"),"utf8"),source)
  const again = run()
  assert.equal(again.status,current.status,again.text)
  assert.equal(fs.readFileSync(path.join(dir,"decl","main.d.ts"),"utf8"),declaration)
  assert.equal(fs.readFileSync(path.join(dir,"main.vibe"),"utf8"),source)
  console.log("explicit and native member declarations are stable")
}
