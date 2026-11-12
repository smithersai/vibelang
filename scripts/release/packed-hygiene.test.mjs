import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { productMentions, reviewerMentions, packedHygiene } from "./packed-hygiene.mjs"

test("only repository URLs and scoped package names exempt a product occurrence", () => {
  for (const name of ["Smithers", "smithers", "SMITHERS", "sMiThErS", "smthrs", "SMTHRS"]) {
    for (const allowed of ["https://github.com/smithersai/vibelang", "git+https://github.com/smithersai/vibelang.git", "@smthrs/cli-win32-x64", "@smithers/tools"]) {
      assert.deepEqual(productMentions(allowed, "file"), [])
      assert.equal(productMentions(allowed + " " + name, "file").length, 1)
    }
    assert.equal(productMentions("comment\n" + name + "' retry policy", "file")[0].split(":")[1], "2")
    assert.equal(productMentions("https://example.com/" + name, "file").length, 1)
    assert.equal(productMentions("smithersai/vibelang .smithers/flows/docs/flow.ts", "file").length, 1)
  }
})

test("archive scan reads all extensions and decodes escaped embedded source content", t => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-hygiene-test-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const pkg = join(root, "package")
  mkdirSync(pkg)
  writeFileSync(join(pkg, "notes.txt"), "Smithers\n")
  writeFileSync(join(pkg, "module.d.ts"), "/** SMITHERS */\n")
  writeFileSync(join(pkg, "module.js.map"), '{"version":3,"sources":["source.ts"],"sourcesContent":["// \\u0053mithers retry policy"]}')
  writeFileSync(join(pkg, "package.json"), '{"repository":"https://github.com/smithersai/vibelang","name":"@smthrs/cli-win32-arm64"}')
  const archive = join(root, "package.tgz")
  execFileSync("tar", ["-czf", archive, "-C", root, "package"])
  const findings = packedHygiene(archive)
  for (const path of ["notes.txt:1", "module.d.ts:1", "module.js.map#sourcesContent[0]:1"]) {
    assert.ok(findings.some(line => line.includes(path)), findings.join("\n"))
  }
  assert.ok(!findings.some(line => line.includes("package.json")))
})

test("reviewer provenance is rejected while model and coding-agent documentation remains allowed", () => {
  for (const name of ["Codex", "Fable", "Opus", "Astra", "Sol", "Luna"]) {
    for (const note of [name + " review R5", name + " R10", name + " finding 1", "reviewed by " + name, name + " design", "reviewer: " + name]) {
      assert.equal(reviewerMentions("// " + note, "source.js").length, 1, note)
      assert.equal(reviewerMentions("// " + note.toLowerCase(), "source.js").length, 1, note)
    }
    assert.deepEqual(reviewerMentions("Choose " + name + " as the model.", "README.md"), [])
  }
  for (const note of ["review R12", "finding 9"]) {
    assert.equal(reviewerMentions("// " + note, "source.js").length, 1)
  }
  for (const text of ["Set up Claude Code, Codex, opencode and Cursor.", "In Codex, review the hook in /hooks.", "opus?: OpusEncoderConfig", "// Codex: the same hook after apply_patch."]) {
    assert.deepEqual(reviewerMentions(text, "file"), [])
  }
})

test("archive scan rejects reviewer credits in emitted comments and escaped map sources", t => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-reviewer-hygiene-test-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "package"))
  writeFileSync(join(root, "package/kernel.js"), "// Codex design\n")
  writeFileSync(join(root, "package/kernel.js.map"), '{"version":3,"sourcesContent":["// \\u0046able finding 1"]}')
  const archive = join(root, "package.tgz")
  execFileSync("tar", ["-czf", archive, "-C", root, "package"])
  const findings = packedHygiene(archive)
  assert.ok(findings.some(line => line.includes("kernel.js:1: [reviewer provenance]")))
  assert.ok(findings.some(line => line.includes("kernel.js.map#sourcesContent[0]:1: [reviewer provenance]")))
})
