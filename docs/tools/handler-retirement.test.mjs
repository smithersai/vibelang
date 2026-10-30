import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const root = process.env.VIBELANG_RETIREMENT_ROOT ?? fileURLToPath(new URL("../../", import.meta.url))
const read = path => readFileSync(resolve(root, path), "utf8")

test("the proposals page does not ship the open handler proposal", () => {
  const proposals = read("site/src/pages/proposals.mdx")
  const shipped = proposals.split("## Shipped features")[1]?.split("\n## ")[0]
  assert.ok(shipped, "the shipped-feature comparison exists")
  assert.doesNotMatch(shipped, /^\| Effect handlers \|/m)
  assert.match(proposals, /VIP-35[^\n]*open proposal|open proposal[^\n]*VIP-35/)
})

test("upstream drafts cite the retired prototype as historical source", () => {
  const upstream = read("docs/upstream/README.md")
  assert.doesNotMatch(upstream, /\]\((?:\.\.\/)+prototype\//)
  assert.match(upstream, /historical prototype findings/)
  assert.match(upstream, /https:\/\/github\.com\/smithersai\/vibelang\/blob\/[a-f0-9]{40}\/prototype\/esc\/FINDINGS\.md/)
})

test("upstream drafts cite retired kernel notes as historical source", () => {
  const upstream = read("docs/upstream/README.md")
  assert.doesNotMatch(upstream, /\]\((?:\.\.\/)+experiments\/KERNEL-CHANGES\.md\)/)
  assert.match(upstream, /historical kernel changes/)
  assert.match(upstream, /https:\/\/github\.com\/smithersai\/vibelang\/blob\/[a-f0-9]{40}\/experiments\/KERNEL-CHANGES\.md/)
})

test("the Layer draft does not offer the deleted conformance suite as runnable", () => {
  const draft = read("docs/upstream/effect-layer-memoization-docs.md")
  assert.doesNotMatch(draft, /bun test tests\/conformance\/source-claims\.test\.ts/)
  assert.doesNotMatch(draft, /\]\((?:\.\.\/)+experiments\/tests\/conformance\//)
  assert.match(draft, /historical D05 reproduction/)
  assert.match(draft, /https:\/\/github\.com\/smithersai\/vibelang\/blob\/[a-f0-9]{40}\/experiments\/tests\/conformance\/source-claims\.test\.ts/)
})


test("archived handler design states retirement before showing the old prototype", () => {
  const chapter = read("docs/design/history/src/109-part1-ch09-handlers.md")
  assert.match(chapter, /first release has no handlers/)
  assert.match(chapter, /VIP-35[^\n]*open proposal/)
  assert.doesNotMatch(chapter, new RegExp(String.fromCharCode(96).repeat(3) + "(?:ts es|vibe)\\n"))
  assert.match(chapter, /https:\/\/github\.com\/smithersai\/vibelang\/blob\/[a-f0-9]{40}\/docs\/design\/history\/src\/109-part1-ch09-handlers\.md/)
  for (const path of ["docs/design/history/src/321-part3-ch21-ownership.md", "docs/design/history/src/216-part2-ch16-callbacks.md", "docs/design/history/src/319-part3-ch19-trace.md", "docs/design/history/src/323-part3-ch23-boundaries.md", "docs/design/history/src/320-part3-ch20-machine.md", "docs/design/history/src/000-intro.md", "docs/design/history/src/530-part5-ch30-risks.md", "docs/design/history/src/901-appendix-c-coverage.md", "docs/design/history/src/109-part1-ch09-handlers.md", "docs/design/history/src/217-part2-ch17-failures.md", "docs/design/history/src/106-part1-ch06-resources.md", "docs/design/history/src/322-part3-ch22-restore.md", "docs/design/history/src/112-part1-ch12-faq.md", "docs/design/history/src/900-appendices.md", "docs/design/history/src/326-part3-ch26-compiled.md", "docs/design/history/src/529-part5-ch29-decisions.md"]) {
    assert.match(read(path).slice(0, 2000), /VIP-35[^\n]*open proposal/, path)
  }
})
