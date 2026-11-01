import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const script = process.env.VIBELANG_NATIVE_OUTPUT_SCRIPT ?? fileURLToPath(new URL("./native-output.sh", import.meta.url))
function fixture(t, kind, late) {
  const root = mkdtempSync(join(tmpdir(), "native directory collision-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const output = join(root, "output", "vibelang")
  const target = join(root, "existing directory")
  const bin = join(root, "bin")
  mkdirSync(dirname(output))
  mkdirSync(target)
  mkdirSync(bin)
  const payload = join(root, "source")
  copyFileSync("/bin/true", payload)
  writeFileSync(join(target, "keep.txt"), "existing directory content")
  const makeCollision = () => {
    if (kind === "directory") {
      mkdirSync(output)
      writeFileSync(join(output, "keep.txt"), "existing directory content")
    } else {
      symlinkSync(kind === "absolute-link" ? target : relative(dirname(output), target), output, "dir")
    }
  }
  if (!late) makeCollision()
  const writer = join(bin, "go")
  // A writer creates the collision after the initial path check, without a race or sleep.
  writeFileSync(writer, "#!" + process.execPath + "\n" + [
    'const fs = require("node:fs")',
    'const out = process.argv[process.argv.indexOf("-o")+1]',
    'fs.copyFileSync(process.env.NATIVE_PAYLOAD,out)',
    'if(process.env.NATIVE_LATE==="1") {',
    ' if(process.env.NATIVE_KIND==="directory"){fs.mkdirSync(process.env.NATIVE_OUTPUT);fs.writeFileSync(process.env.NATIVE_OUTPUT+"/keep.txt","existing directory content")}',
    ' else fs.symlinkSync(process.env.NATIVE_LINK,process.env.NATIVE_OUTPUT,"dir")',
    '}'
  ].join("\n"))
  chmodSync(writer, 0o755)
  return { root, output, target, payload, env: {
    ...process.env, PATH: bin + ":" + process.env.PATH, NATIVE_PAYLOAD: payload,
    NATIVE_OUTPUT: output, NATIVE_KIND: kind, NATIVE_LATE: late ? "1" : "",
    NATIVE_LINK: kind === "absolute-link" ? target : relative(dirname(output), target)
  } }
}

for (const operation of ["copy", "build"]) {
  for (const kind of ["directory", "absolute-link", "relative-link"]) {
    for (const late of operation === "build" ? [false, true] : [false]) {
      test(operation + " refuses " + kind + (late ? " created by the writer" : ""), t => {
        const f = fixture(t, kind, late)
        const result = spawnSync("sh", [script,
          operation, f.output, operation === "copy" ? f.payload : "./fixture"], { env: f.env, encoding: "utf8" })
        assert.equal(result.status, 1, result.stdout + result.stderr)
        assert.match(result.stderr, /native-output: .*output is a directory/)
        assert.deepEqual(readdirSync(f.output), ["keep.txt"], "must not publish inside the collision")
        assert.equal(readFileSync(join(f.output, "keep.txt"), "utf8"), "existing directory content")
        assert.deepEqual(readdirSync(f.target), ["keep.txt"], "must not modify a symlink's target")
        if (kind !== "directory") {
          assert.ok(lstatSync(f.output).isSymbolicLink())
          assert.equal(readlinkSync(f.output), f.env.NATIVE_LINK)
        }
        assert.deepEqual(readdirSync(dirname(f.output)), ["vibelang"], "must remove temporary native output")
      })
    }
  }
}

for (const kind of ["absent", "file", "file-link", "dangling-link"]) {
  test("native publication preserves successful file replacement: " + kind, t => {
    const f = fixture(t, "directory", true)
    const prior = join(f.root, "prior")
    if (kind === "file") writeFileSync(f.output, "old output")
    if (kind === "file-link") {
      writeFileSync(prior, "old target")
      symlinkSync(prior, f.output)
    }
    if (kind === "dangling-link") symlinkSync(prior, f.output)
    const result = spawnSync("sh", [script, "copy", f.output, f.payload], { env: f.env, encoding: "utf8" })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.ok(lstatSync(f.output).isFile())
    assert.deepEqual(readFileSync(f.output), readFileSync(f.payload))
    if (kind === "file-link") assert.equal(readFileSync(prior, "utf8"), "old target")
    if (kind === "dangling-link") assert.equal(existsSync(prior), false)
    assert.deepEqual(readdirSync(dirname(f.output)), ["vibelang"])
  })
}
