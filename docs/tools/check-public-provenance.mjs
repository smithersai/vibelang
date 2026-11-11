// The user docs, the specification and the VIPs describe the language, not how it is made or where
// it is hosted. This check fails when one of their sources contains:
//
// - an agent or model name used as an author, reviewer or decider (Claude, Codex, Sol, Astra, Opus,
//   Fable, Kimi, GPT-n), or an agent session name such as `vip-fable`;
// - a lane, a ruling number (`ruling 16`, `PROC-29`), a chat channel (Telegram), the "optimistic
//   approval" wording or a veto line ("may overturn");
// - the hosting product's name, except inside the allowlisted names below;
// - a GitHub link to the `vibe` branch rather than `main`.
//
//   node docs/tools/check-public-provenance.mjs
//
// It checks sources; the site's spec and VIP pages are generated from them.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/** Source roots, relative to the repository. A directory covers every .md and .mdx file under it. */
export const sources = [
  "docs/design/src",
  "docs/design/vips",
  "docs/user/src",
  // Hand-written, unlike the site's generated spec and VIP pages.
  "site/src/pages/proposals.mdx",
]

// The product name may appear only inside these spellings, which a reader needs to install or open
// something: a published npm package (`@smthrs/flow`) and a public repository of the GitHub
// organization (`github.com/smithersai/vibelang`, `smithersai/vibelang`), except the product's own
// repository. Nothing else is allowed:
// prose says what the thing is instead ("the repository's build targets").
// VIP-53 is the open proposal to rename the language after the product: its page cannot avoid the
// name, and pages link it by file name or by its published URL. Whether it stays public is the owner's decision.
const productPages = new Set(["docs/design/vips/0053-rename-smithersscript-open.md"])
const productAllowed = [
  /@smthrs\/[a-z][a-z0-9-]*/g,
  /0053-rename-smithersscript-open(?:\.mdx?)?(?![\w-])/g,
  /(?:https:\/\/)?(?:github\.com\/)?smithersai\/(?!smithers)[A-Za-z0-9._-]+/g,
]
const product = /smithers|smthrs/i

// Coding-agent clients are products a reader configures, not actors: "Claude Code" anywhere, and
// "Codex" on the page that documents those clients or in a line that lists them with Claude Code.
const clientPage = "docs/user/src/setup/coding-agents.md"
const agent = /\b(?:Claude|Codex|Sol|Astra|Opus|Fable|Kimi|GPT-\d[\w.]*)\b/
const session = /\b(?:(?:vip|lang|effectscript|claude|codex)-(?:fable|astra|sol|opus|kimi|final)|(?:lang|effectscript|claude|codex)-\d+[a-z]?)\b/

const internal = [
  ["a lane", /\blanes?\b/i],
  ["a ruling number", /\bruling (?:\d|PROC-)|\bPROC-\d+\b/i],
  ["a chat channel", /\bTelegram\b/i],
  ["the optimistic-approval wording", /\boptimistic(?:ally)? approv/i],
  ["a veto line", /\bmay overturn\b/i],
]
// Readers follow `main`, the released line; `vibe` holds unreviewed work.
const branchLink = /github\.com\/smithersai\/[^/\s]+\/(?:blob|tree)\/vibe\//

/** Prose of a Markdown page: fenced blocks and inline code removed, line numbers kept. */
export function prose(text) {
  let fence = null
  return text.split("\n").map(line => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (marker) {
      if (fence === null) fence = marker
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null
      return ""
    }
    return fence === null ? line.replace(/(`+)[^`]*?\1/g, "``") : ""
  })
}

/** The problems on one page, as `line: reason` strings. */
export function provenance(file, text) {
  const problems = []
  const lines = text.split("\n")
  prose(text).forEach((line, i) => {
    const client = file === clientPage || /Claude Code/.test(line)
    const actor = line.replace(/Claude Code/g, "").replace(client ? /\bCodex\b/g : /$^/, "")
    if (agent.test(actor) || session.test(line)) problems.push(`${i + 1}: an agent or model named as an actor`)
    for (const [reason, pattern] of internal) if (pattern.test(line)) problems.push(`${i + 1}: ${reason}`)
  })
  lines.forEach((line, i) => {
    let rest = line
    for (const allowed of productAllowed) rest = rest.replace(allowed, "")
    if (product.test(rest) && !productPages.has(file)) problems.push(`${i + 1}: the hosting product's name`)
    if (branchLink.test(line)) problems.push(`${i + 1}: a link to the vibe branch instead of main`)
  })
  return problems
}

function pages(root, dir) {
  const path = join(root, dir)
  if (!statSync(path, { throwIfNoEntry: false })) return []
  if (statSync(path).isFile()) return [dir]
  return readdirSync(path, { recursive: true }).map(String).filter(name => /\.mdx?$/.test(name)).map(name => join(dir, name)).sort()
}

export function check(root, roots = sources) {
  const problems = []
  for (const file of roots.flatMap(dir => pages(root, dir))) {
    for (const problem of provenance(file, readFileSync(join(root, file), "utf8"))) problems.push(`${file}:${problem}`)
  }
  return problems
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = check(resolve(fileURLToPath(new URL("../../", import.meta.url))))
  if (problems.length) {
    console.error(problems.join("\n"))
    console.error(`public-provenance: ${problems.length} problems. Say what the thing is, attribute a decision to the maintainers, and see docs/tools/check-public-provenance.mjs.`)
    process.exitCode = 1
  } else console.log("public-provenance: docs, specification and VIP sources name no agent, lane, ruling or hosting product")
}
