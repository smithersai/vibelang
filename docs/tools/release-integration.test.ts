import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const root = process.env.DOCS_REVIEW_ROOT || resolve(import.meta.dir, "../..")
const notes = readFileSync(resolve(root, "docs/user/src/setup/release-notes.md"), "utf8")
  .split("## 0.0.11")[1]?.split("\n## ")[0] || ""
const fixes = notes.split("### Bugs fixed since 0.0.10")[1]?.split("### Known bugs")[0] || ""

// Fixes stacked after the 0.0.11 notes were written, by group: [fix, text its bullet contains].
const late: Record<string, [string, string][]> = {
  "Compiler and diagnostics": [
    ["experimental identity", "Experimental FileSystem"],
    ["runner resolution", "aliased runner"],
    ["browser entry", "BrowserRuntime"],
    ["conflicting platforms", "EK3206"],
    ["shared layer", "platform twice"],
    ["provider names", "EK3205"],
    ["plain methods", "EK2003"],
    ["service values", "Path().sep"],
    ["shared names", "shared prelude"],
    ["banned suggestions", "EK4402 bans"],
    ["fieldless errors", "fieldless error"],
    ["prelude pipe", "prelude pipe"],
    ["escaping fork", "EK4838"],
    ["provide expression", "provide in an expression"],
    ["diagnostic width", "ten members"],
    ["unsupported Effect", "EK1011"],
  ],
  "Runtime": [
    ["layer names", "exports now start with Experimental"],
    ["typed main failures", "error's fields"],
    ["early version check", "module linking"],
    ["traced callers", "before forwarding"],
    ["rest and default parameters", "rest-parameter array"],
    ["parameter assignments", "assignment to a parameter"],
  ],
  "Editor and language server": [
    ["hover separator", "Hover text"],
  ],
  "Tooling and bundlers": [
    ["method catch fix", ".pipe(Effect.catchTag"],
  ],
  "Docs": [
    ["Locks skill", "skill claimed"],
    ["diagnostic coverage", "checks coverage"],
    ["editor warning", "EK9100"],
    ["HTTP body", "FetchHttpClient.layer"],
    ["Node declarations", "@types/node"],
    ["exit statuses", "numeric main"],
    ["contributor setup", "contributor compiler"],
    ["Bun starter", "package manager"],
    ["shared platform imports", "non-entry imports"],
    ["Bun stacks", "unmapped emitted"],
    ["Vitest project", "separate test project"],
    ["Vite rewriting", "React and Vite"],
  ],
}

for (const [group, entries] of Object.entries(late)) {
  const section = fixes.split("#### " + group + "\n")[1]?.split("\n#### ")[0] || ""
  for (const [name, text] of entries) {
    test("late release fix is listed under " + group + ": " + name, () => {
      expect(section.split("\n").some(line => line.startsWith("- ") && line.includes(text))).toBe(true)
    })
  }
}

test("upgrade repairs cover plain methods, renamed experimental layers and conflicting platforms", () => {
  const upgrade = notes.split("### Upgrade from 0.0.10")[1]?.split("### Bugs fixed")[0] || ""
  const rows = upgrade.split("\n").filter(line => line.startsWith("| "))
  expect(rows.some(row => row.includes("EK0501") && row.includes("effect function"))).toBe(true)
  expect(rows.some(row => row.includes("ExperimentalNodeServices") && row.includes("NodeCrypto") && row.includes("ExperimentalNodeCrypto"))).toBe(true)
  expect(rows.some(row => row.includes("EK3206") && row.includes("one platform"))).toBe(true)
})

test("trailing-block upgrade names the new compile error and automatic rewrite", () => {
  const entry = fixes.split("\n").find(line => line.startsWith("- ") && line.includes("VIP-11") && line.includes("EK1101")) || ""
  expect(entry).toContain("compiled")
  expect(entry).toContain("compile error")
  expect(entry).toContain("`vibelang --fix`")
  expect(entry).toContain("last argument")
})
