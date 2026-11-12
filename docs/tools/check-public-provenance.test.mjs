import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { check, provenance, repositoryPage, repositoryPages } from "./check-public-provenance.mjs"

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)))
const page = "docs/design/src/example.md"
const reasons = text => provenance(page, text).map(problem => problem.replace(/^\d+: /, ""))

test("the docs, specification, VIP sources and repository pages pass", () => {
  assert.deepEqual(check(root), [])
})

test("an agent-attributed decision record fails on its agent, lane, ruling and veto", () => {
  const record = "### Claude's decisions\n\n- **Amended 2026-11-10: finite cases.** Codex Sol, lane `fix-match`, promotes the warning under the pre-alpha optimistic approval in ruling 16. Will may overturn this decision.\n"
  assert.deepEqual([...new Set(reasons(record))].sort(), [
    "a lane", "a ruling number", "a veto line", "an agent or model named as an actor", "the optimistic-approval wording",
  ])
})

test("the same record attributed to the maintainers passes", () => {
  assert.deepEqual(reasons("### Maintainers' decisions\n\n- **Amended 2026-11-10: finite cases.** The maintainers promote the warning to an error before the first release.\n"), [])
})

test("each internal-process phrase fails on its own", () => {
  for (const [text, reason] of [
    ["Authors: vip-fable and vip-astra; adopted by lang-5e.", "an agent or model named as an actor"],
    ["Opus and Fable disagreed.", "an agent or model named as an actor"],
    ["Reviewed by GPT-6.1.", "an agent or model named as an actor"],
    ["No codemods ship (PROC-29).", "a ruling number"],
    ["Will's ruling 16 applies.", "a ruling number"],
    ["Sent to Will on Telegram.", "a chat channel"],
    ["The implementation lanes own the gaps.", "a lane"],
  ]) assert.ok(reasons(text).includes(reason), text)
})

test("the product name fails outside package names and repository URLs", () => {
  assert.deepEqual(reasons("Options keep Smithers' names."), ["the hosting product's name"])
  assert.deepEqual(reasons("Count the issues of `smithersai/smithers`."), ["the hosting product's name"])
  assert.deepEqual(reasons("The migrate flow (`.smithers/flows/migrate`) runs it."), ["the hosting product's name"])
  assert.deepEqual(reasons("Install `@smthrs/flow`, or read https://github.com/smithersai/vibelang/blob/main/CONTRIBUTING.md and `smithersai/TypeScript`."), [])
})

test("coding-agent clients and code are not actors", () => {
  assert.deepEqual(reasons("| Claude Code, Codex, opencode, or an agent in Cursor | setup |"), [])
  assert.deepEqual(provenance("docs/user/src/setup/coding-agents.md", "- **Codex** runs the hook once the project is trusted.\n"), [])
  assert.deepEqual(reasons("- **Codex** runs the hook once the project is trusted.\n"), ["an agent or model named as an actor"])
  assert.deepEqual(reasons('```ts\nconst unnamed = { name: "Sol" }\n```\nUse `Model.use("openai:gpt-6.1-sol")` or `"Sol"`.\n'), [])
  assert.deepEqual(reasons("VIP-1, VIP-20 and Solid stay legal; so does `vip-fable` in code."), [])
})

test("repository links follow main", () => {
  assert.deepEqual(reasons("See [CONTRIBUTING](https://github.com/smithersai/vibelang/blob/vibe/CONTRIBUTING.md)."), ["a link to the vibe branch instead of main"])
  assert.deepEqual(reasons("See [CONTRIBUTING](https://github.com/smithersai/vibelang/blob/main/CONTRIBUTING.md)."), [])
})

test("the specification names only shipped tools and dates its transitional rows", () => {
  const spec = name => readFileSync(resolve(root, "docs/design/src", name), "utf8")
  // The npm package ships vibelang, vibelang-format and vibelang-ast-grep; the forms audit is a repository tool.
  assert.doesNotMatch(spec("000-intro.md"), /vibelang-forms/)
  // Rows that name a past release, such as EK1023's `0.0.10`, are explained beside the table.
  assert.match(spec("900-appendices.md"), /A release number in a row names a past release whose behaviour the diagnostic reports: the 0\.0\.10 release/)
})

test("only VIP-53, the rename proposal, may name the product in its page and index link", () => {
  assert.deepEqual(provenance("docs/design/vips/0053-rename-smithersscript-open.md", "# VIP-53: Renaming VibeLang to SmithersScript (open)\n"), [])
  assert.deepEqual(reasons("| [53](0053-rename-smithersscript-open.md) | Renaming VibeLang | open 2026-11-07 |"), [])
  assert.deepEqual(reasons("| [53](https://vibelang.sh/vips/0053-rename-smithersscript-open) | Renaming VibeLang | Open, no code |"), [])
  assert.deepEqual(reasons("See https://vibelang.sh/vips/0053-rename-smithersscript-open-v2."), ["the hosting product's name"])
  assert.deepEqual(reasons("| [53](0053-rename-smithersscript-open.md) | Renaming VibeLang to SmithersScript |"), ["the hosting product's name"])
  assert.ok(provenance("docs/design/vips/0053-rename-smithersscript-open.md", "Codex Sol reviewed it.\n").length > 0)
})

test("the repository's own pages are checked: top-level files, the security policy and each package's", () => {
  const pages = repositoryPages(root)
  for (const file of ["README.md", "CONTRIBUTING.md", "MAINTAINERS.md", "AGENTS.md", ".github/SECURITY.md",
    "packages/compiler/README.md", "packages/runtime/README.md", "packages/vite/README.md", "packages/unplugin/README.md",
    "packages/create-vibelang/README.md", "editors/vscode/README.md", "templates/app/README.md", "templates/app/AGENTS.md"]) {
    assert.ok(pages.includes(file), file)
  }
  assert.ok(!repositoryPage("packages/compiler/test/AGENTS.md"))
  assert.ok(!repositoryPage("docs/tools/README.md"))
})

test("a generated top-level page fails on the product's name in its prose", () => {
  const contributing = text => provenance("CONTRIBUTING.md", text).map(problem => problem.replace(/^\d+: /, ""))
  assert.deepEqual(contributing("The optional Smithers build graph retains its dependency's Node 26.4 runtime declaration.\n"), ["the hosting product's name"])
  assert.deepEqual(provenance("packages/runtime/README.md", "Built with smthrs.\n").length, 1)
  assert.deepEqual(provenance("packages/vite/README.md", "Their features require the corresponding compiler lanes.\n").length, 1)
})

test("repository pages may name paths into .smithers/; the docs may not", () => {
  const line = "<!-- Generated by .smithers/flows/docs/flow.ts. Run `bun run docs:generate` in .smithers/. -->\n| `.smithers/` | The docs flow |\n`(cd .smithers && bun install)`\n"
  assert.deepEqual(provenance("CONTRIBUTING.md", line), [])
  assert.deepEqual(provenance("templates/app/AGENTS.md", "<!-- Generated: smithersai/vibelang .smithers/flows/docs/flow.ts -->\n"), [])
  assert.equal(provenance("docs/user/src/example.md", line).length, 3)
  assert.equal(provenance("CONTRIBUTING.md", "Run the smithers CLI in .smithers/.\n").length, 1)
})

test("the language factory's URL is a link, not an explanation", () => {
  assert.deepEqual(reasons("Propose a change at the [factory](https://lang.smithers.sh)."), [])
  assert.deepEqual(provenance("README.md", "See https://lang.smithers.sh/app/live.\n"), [])
  assert.deepEqual(reasons("The factory runs on smithers.sh."), ["the hosting product's name"])
})
