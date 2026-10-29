#!/usr/bin/env node
// Rename codemod: the language Effeck is VibeLang (2026-10-18).
//
// One deterministic, idempotent pass over the tracked files of a checkout. It
// rewrites names inside files and renames files and directories:
//
//   brand        Effeck / effeck / EFFECK      -> BRAND / BRAND_LOWER / BRAND_UPPER
//   compounds    create-effeck, effeck-runtime, effeckmapper, EFFECK_BINARY,
//                isEffeckFile, $effeck, @effeck trusted, compilerOptions.effeck
//                                              -> the same shapes with the new brand
//   extension    .effeck (files, globs, regexes, source.effeck scopes)
//                                              -> .EXTENSION
//   language id  VS Code language id, Neovim filetype, ```effeck fences
//                                              -> LANGUAGE_ID
//   binary       bin/effeck, effeck --lsp, effeck.exe, "build": "effeck"
//                                              -> CLI
//
// "Smithers" (the orchestrator), EffectScript, Effect, and the EK diagnostic
// codes are different words and are never touched.
//
// Re-run it on any tree: on the newest main before merging, or on your
// own branch. A second run finds nothing to change. After rewriting, it
// gofmts the Go files it changed and reruns two generators whose output a
// regex cannot reproduce: the forms table, whose digests cover the runtime's
// sources, and the projector's stock goldens, whose imports sort by module
// (pass --no-regenerate to skip them).
//
//   node scripts/rename-to-vibelang.mjs --dry-run   # report counts, write nothing
//   node scripts/rename-to-vibelang.mjs             # apply
//   node scripts/rename-to-vibelang.mjs --verbose   # list every file
//   node scripts/rename-to-vibelang.mjs --root DIR  # another tree (the test uses it)
//   node scripts/rename-to-vibelang.mjs --regenerate  # rerun only the generators
//
// scripts/brand-gate.mjs imports the exemptions below and fails on any retired
// spelling they do not cover. A line that must keep a retired spelling on
// purpose carries the marker `brand-gate: allow`; a block sits between
// `brand-gate: allow-start` and `brand-gate: allow-end`.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, writeFileSync } from "node:fs"
import { dirname, extname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

// ---- The new names. Change one line here and re-run. ----
export const BRAND = "VibeLang"
export const BRAND_LOWER = "vibelang"
export const BRAND_UPPER = "VIBELANG"
export const EXTENSION = "vibe"
// The editor language id, the Neovim filetype, and the Markdown fence. The docs
// checker requires a fence's language to equal the file extension it names.
export const LANGUAGE_ID = EXTENSION
export const CLI = "vibelang"
// The decision record that the rename appends to the decision log.
const DECISION_DATE = "2026-10-18"

// ---- What the codemod and the brand gate leave alone. ----
export const ALLOW_MARKER = "brand-gate: allow"
export const ALLOW_START = "brand-gate: allow-start"
export const ALLOW_END = "brand-gate: allow-end"

/** Paths never rewritten, renamed, or checked, each with its reason. A trailing / is a directory. */
export const EXEMPT_PATHS = [
  ["scripts/rename-to-vibelang.mjs", "spells the retired names to replace them"],
  ["scripts/brand-gate.mjs", "spells the retired names to find them"],
  ["scripts/brand-gate.test.mjs", "writes retired spellings into its fixtures"],
  ["artifacts/", "artifact docs: snapshots, never edited (doc-lifecycle doctrine)"],
  ["docs/research/", "research reports are artifacts, never edited"],
]
/** A file whose name carries a date is an artifact (doc-lifecycle doctrine, rule 3). */
const DATED = /(^|\/)[^/]*\d{4}-\d{2}-\d{2}[^/]*$/
export const EXCLUDED_DIRECTORIES = new Set(["node_modules", "dist", ".git", ".jj", "vendor", "coverage", ".cache"])
export const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".vsix",
  ".bundle", ".zip", ".gz", ".tgz", ".wasm", ".pdf", ".mp4", ".sqlite", ".db", ".node", ".exe",
])

/**
 * Retired spellings that name things we do not control yet. The codemod masks
 * them before rewriting, and the gate ignores them. `paths` limits an entry to
 * those files.
 */
/** Only the redirect Worker still names the retired domains. */
const effeckSite = ["docs/redirect/"]

export const KEEP = [
  {
    why: "the retired domains served by the redirect Worker",
    paths: effeckSite,
    pattern: /(?<![\w.-])(?<![^/]\/)(?:www\.)?effeck\.(?:dev|sh|ai|app|com|fun|tech)(?![\w-])/g,
  },
  { why: "the same domains as a wildcard", paths: effeckSite, pattern: /(?<![\w.-])effeck\.\*/g },
  {
    why: "the issue tracker repository effeck/effeck on Smithers Cloud, and its URLs",
    pattern: /smithers\.sh\/effeck\/effeck(?![\w-])|(?<![\w.-]\/)(?<![\w-])effeck\\?\/effeck(?![\w-])/g,
  },
  {
    why: "paths in an external notes directory, whose owner renames its files",
    pattern: /Smithers-Ops\/[^\s)`'"]*/g,
  },
  {
    why: "the deployed Cloudflare Worker names of the docs site",
    paths: ["docs/redirect/wrangler.jsonc"],
    pattern: /"name": "effeck(?:-redirect)?"|names the Worker, effeck\b/g,
  },
  {
    why: "D125 records the earlier name, and D255, the rename, quotes it",
    paths: ["docs/design/history/DECISIONS.md", "site/src/pages/spec/529-part5-ch29-decisions.mdx"],
    pattern: /^\*\*D(?:125|255)\. .*$|^\| D125 \|.*$/gm,
  },
  {
    why: "the spec's row for D125, a record of the earlier name, and its copy on the vibelang.sh site",
    paths: ["docs/design/history/src/529-part5-ch29-decisions.md", "site/src/pages/spec/529-part5-ch29-decisions.mdx"],
    pattern: /^\| D125 \|.*$/g,
  },
]

const capitalized = (word) => word[0].toUpperCase() + word.slice(1)

/**
 * Ordered rules, applied to each line. Specific shapes come first so that the
 * generic brand rules at the end never see them. Each is [name, pattern,
 * replacement, paths?]; `paths` are prefixes the rule is limited to.
 */
export const RULES = [
  // A link into the effeck.dev docs site becomes the same page on vibelang.sh,
  // which drops the .html. The site's own files keep the domain (KEEP).
  ["docs domain", /https?:\/\/(?:www\.)?effeck\.dev(\/[^\s)"'\]>`]*)?/g, (_url, path = "") => `https://vibelang.sh${path.replace(/\.html$/, "").replace(/(^|\/)index$/, "$1")}`],

  // The earlier VibeLang project (effect-lang) is prior art in the spec; once
  // the language takes its name, those lines must say which one they mean.
  ["prior art", /\bVibeLang's checkpoint\b/g, "the earlier VibeLang project's checkpoint", ["docs/design/history/src/"]],
  ["prior art", /\bVibeLang reversed course\b/g, "The earlier VibeLang project reversed course", ["docs/design/history/src/"]],
  ["prior art", /: VibeLang `main`/g, ": the earlier VibeLang project's `main`", ["docs/design/history/src/"]],

  // "an Effeck" becomes "a VibeLang".
  ["article", /\b([Aa])n(\s+[`*_"'(\[]*)(?=\.?(?:effeck|Effeck|EFFECK))/g, "$1$2"],

  // Property accesses that look like a file name: the configuration key and
  // other members named effeck. Before the extension rule.
  ["property", /\bcompilerOptions\.effeck\b/g, `compilerOptions.${BRAND_LOWER}`],
  ["property", /\bdevDependencies\.effeck\b/g, `devDependencies.${BRAND_LOWER}`],
  ["property", /(\bas any\))\.effeck\b/g, `$1.${BRAND_LOWER}`],
  ["property", /\bhero\.effeck\b/g, `hero.${BRAND_LOWER}`, ["docs/tools/"]],
  ["property", /\.effeck(?=\?\.)|(?<=\?)\.effeck\b(?![-\w])/g, `.${BRAND_LOWER}`],
  // The editor extension's id, publisher.name.
  ["extension id", /\beffeck\.effeck\b/g, `${BRAND_LOWER}.${BRAND_LOWER}`],

  // The language id: VS Code, Neovim, LSP clients, and Markdown fences.
  ["language id", /((?:`|~|\\`){3,})effeck\b/g, `$1${LANGUAGE_ID}`],
  ["language id", /\bonLanguage:effeck\b/g, `onLanguage:${LANGUAGE_ID}`],
  ["language id", /("id"\s*:\s*)"effeck"/g, `$1"${LANGUAGE_ID}"`],
  ["language id", /(\b(?:language|languageId|lang)"?\s*(?::|===?|!==?)\s*)"effeck"/g, `$1"${LANGUAGE_ID}"`],
  ["language id", /(\blanguageId:[^\n]*?"typescript"\s*:\s*)"effeck"/g, `$1"${LANGUAGE_ID}"`],
  ["language id", /(\bopen\([^)\n]*,\s*)"effeck"\)/g, `$1"${LANGUAGE_ID}")`],
  ["language id", /(\bopen(?:s|ed) as )effeck\b/g, `$1${LANGUAGE_ID}`],
  ["language id", /^(\s*const languages = .*)$/g, (line) => line.replaceAll('"effeck"', `"${LANGUAGE_ID}"`), ["editors/vscode/src/"]],
  ["language id", /(\[)"effeck"(, "ts")/g, `$1"${LANGUAGE_ID}"$2`],
  ["language id", /(\[\d+, )"effeck"/g, `$1"${LANGUAGE_ID}"`],
  ["language id", /\b([Aa]) effeck( fences?)\b/g, `$1 ${LANGUAGE_ID}$2`],
  ["language id", /"([Aa]) effeck"/g, `"$1 ${LANGUAGE_ID}"`],
  ["language id", /\beffeck( and ts fences)\b/g, `${LANGUAGE_ID}$1`],
  ["language id", /\beffeck is Effeck\b/g, `${LANGUAGE_ID} is ${BRAND}`],
  ["language id", /(\bfiletype\s*==\s*)"effeck"/g, `$1"${LANGUAGE_ID}"`],
  ["language id", /(\blanguage\.register\("typescript",\s*)"effeck"/g, `$1"${LANGUAGE_ID}"`],
  ["language id", /(\blocal filetypes = \{ )"effeck"/g, `$1"${LANGUAGE_ID}"`],
  ["language id", /(\bextension = \{ )effeck = "effeck"/g, `$1${EXTENSION} = "${LANGUAGE_ID}"`],
  ["language id", /\b(the `?)effeck(`? filetype)\b/g, `$1${LANGUAGE_ID}$2`],
  ["language id", /(\bfiles are )effeck\b/g, `$1${LANGUAGE_ID}`],
  ["language id", /(Language id \| `)effeck(`)/g, `$1${LANGUAGE_ID}$2`],
  ["language id", /(\beither `)effeck(` or `typescript`)/g, `$1${LANGUAGE_ID}$2`],
  // Zed maps a file extension to a language.
  ["extension", /("TypeScript":\s*\[)"effeck"(\])/g, `$1"${EXTENSION}"$2`],

  // The binary.
  ["binary", /\b(npx|bunx|pnpm exec|pnpm dlx|yarn|npm exec) effeck\b(?![-\w])/g, `$1 ${CLI}`],
  ["binary", /((?:\.bin|\bbin|\bnative|\blocal)\/)effeck\b(?![-.\w])/g, `$1${CLI}`],
  ["binary", /(?<![-\w/.@])effeck(?=\.(?:exe|cmd)\b)/g, CLI],
  ["binary", /("(?:\.bin|bin|native)",\s*)"effeck"/g, `$1"${CLI}"`],
  ["binary", /(?<![-\w/.@])effeck(?= --?[a-zA-Z])/g, CLI],
  ["binary", /("(?:build|start|dev)":\s*")effeck\b(?![-\w])/g, `$1${CLI}`],
  ["binary", /(\bspawn(?:Sync)?\(\s*)"effeck"/g, `$1"${CLI}"`],
  ["binary", /(\bCommand:\s*)"effeck"/g, `$1"${CLI}"`],
  ["binary", /("bin":\s*\{\s*)"effeck"/g, `$1"${CLI}"`],
  ["binary", /(\bbin:\s*\{\s*)effeck(?=:)/g, `$1${CLI}`],
  ["binary", /(\bcommand -v )effeck\b(?![-\w])/g, `$1${CLI}`],
  ["binary", /(\?\s*"[^"\n]*\.(?:exe|cmd)"\s*:\s*)"effeck"/g, `$1"${CLI}"`],
  ["binary", /(\breturn\s+)"effeck"/g, `$1"${CLI}"`, ["editors/nvim/", "docs/user/src/setup/"]],

  // The @vibelang npm scope belongs to someone else (vault decision
  // 2026-10-18), so a scoped package becomes an unscoped one: @effeck/unplugin
  // is vibelang-unplugin.
  ["npm scope", /@effeck\/([\w.-]+)/g, `${BRAND_LOWER}-$1`],

  // The source extension.
  ["extension", /\bExtensionEffeck\b/g, `Extension${capitalized(EXTENSION)}`],
  // A regular expression's alternation over extensions: \.(effeck|ts), \.(?:effeck|ts).
  ["extension", /(?<=\\\.\((?:\?:)?(?:\w+\|)*)effeck(?=[|)\\])/g, EXTENSION],
  // A brace glob over extensions: **/*.{ts,json,effeck}.
  ["extension", /(?<=\*\.\{(?:\w+,)*)effeck(?=[,}])/g, EXTENSION],
  // A file extension, a glob, a TextMate scope (source.effeck), but not a
  // directory (node_modules/.effeck) or a CSS class (.effeck-pane).
  ["extension", /(?<!\/)\.effeck(?![-\w])/g, `.${EXTENSION}`],

  // The brand words, last.
  ["brand", /EFFECK/g, BRAND_UPPER],
  ["brand", /Effeck/g, BRAND],
  ["brand", /effeck/g, BRAND_LOWER],
]

export function isExempt(rel) {
  if (DATED.test(rel)) return true
  return EXEMPT_PATHS.some(([path]) => (path.endsWith("/") ? rel.startsWith(path) : rel === path))
}

const applies = (paths, rel) => !paths || paths.some((path) => rel.startsWith(path))

/** Masks KEEP spans with placeholders; returns the masked line and the spans. */
export function maskKept(line, rel) {
  const kept = []
  let masked = line
  for (const { pattern, paths } of KEEP) {
    if (!applies(paths, rel)) continue
    masked = masked.replace(pattern, (span) => {
      kept.push(span)
      return `\u0000${kept.length - 1}\u0000`
    })
  }
  return { masked, kept }
}

/** Restores masked spans; a span masked inside another comes back on a later pass. */
function unmask(line, kept) {
  const placeholder = /\u0000(\d+)\u0000/g
  while (placeholder.test(line)) line = line.replace(placeholder, (_, index) => kept[Number(index)])
  return line
}

export const RETIRED = /effeck/gi
const retired = (text) => text.match(RETIRED)?.length ?? 0

/** Rewrites one line; returns the new line and how many retired spellings it replaced. */
export function rewriteLine(line, rel) {
  const { masked, kept } = maskKept(line, rel)
  let output = masked
  for (const [, pattern, replacement, paths] of RULES) {
    if (applies(paths, rel)) output = output.replace(pattern, replacement)
  }
  return { line: unmask(output, kept), count: retired(masked) - retired(output) }
}

/** Rewrites a file's text, honouring the allow markers. */
export function rewriteText(text, rel) {
  let allowed = false
  let count = 0
  const lines = text.split("\n").map((line) => {
    if (line.includes(ALLOW_START)) { allowed = true; return line }
    if (line.includes(ALLOW_END)) { allowed = false; return line }
    if (allowed || line.includes(ALLOW_MARKER)) return line
    const result = rewriteLine(line, rel)
    count += result.count
    return result.line
  })
  return { text: lines.join("\n"), count }
}

/** The new path of a file: the extension and brand rules over its segments. */
export function renamePath(rel) {
  return rewriteLine(rel, rel).line
}

function walk(root, directory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) walk(root, path, files)
    } else if (entry.isFile()) {
      files.push(relative(root, path).split(sep).join("/"))
    }
  }
  return files
}

/** The tracked files: jj's list in a jj workspace, git's in a git checkout, else a walk. */
export function listFiles(root) {
  const run = (command, args) => spawnSync(command, args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 })
  let files
  if (existsSync(join(root, ".jj"))) {
    let result = run("jj", ["file", "list"])
    if (result.status !== 0) result = run("jj", ["file", "list", "--ignore-working-copy"])
    if (result.status === 0) files = result.stdout.split("\n").filter(Boolean)
  }
  if (!files && existsSync(join(root, ".git"))) {
    const git = run("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
    if (git.status === 0) files = git.stdout.split("\0").filter(Boolean)
  }
  // A tracked file is source wherever it sits (a case's vendor/ fixture moves
  // with its case); only the walk skips the excluded directories.
  files ??= walk(root, root, [])
  return files
    .map((file) => file.split(sep).join("/"))
    .filter((file) => existsSync(join(root, file)))
    .sort()
}

export function isBinary(rel, buffer) {
  if (BINARY_EXTENSIONS.has(extname(rel).toLowerCase())) return true
  return buffer.subarray(0, 8192).includes(0)
}

// ---- The decision log records the rename once. ----
const DECISIONS = "docs/design/history/DECISIONS.md"
const DECISIONS_TABLE = "docs/design/history/src/529-part5-ch29-decisions.md"

function decisionText(number) {
  return [
    `## The name ${BRAND} (${DECISION_DATE})`,
    "",
    `**D${number}. The language is ${BRAND}** (supersedes D125). The language was renamed before the 0.0.1 launch. ` +
      `The packages are \`${BRAND_LOWER}\` (the compiler and its \`${CLI}\` binary), \`${BRAND_LOWER}-runtime\`, \`${BRAND_LOWER}-vite\`, ` +
      `\`${BRAND_LOWER}-unplugin\`, \`create-${BRAND_LOWER}\`, and one \`${BRAND_LOWER}-<os>-<cpu>\` package per platform binary. ` +
      `Source files end in \`.${EXTENSION}\`, the editor language id and the Neovim filetype are \`${LANGUAGE_ID}\`, ` +
      `the configuration key is \`compilerOptions.${BRAND_LOWER}\`, the trust tag is \`@${BRAND_LOWER} trusted\`, ` +
      `and the editor extension is \`${BRAND_LOWER}.${BRAND_LOWER}\`. Diagnostic codes keep the prefix \`EK\`. ` +
      "The single docs site is vibelang.sh. The issue tracker `effeck/effeck` on smithers.sh keeps its name until it moves. " +
      "`node scripts/rename-to-vibelang.mjs` applies the rename to any tree, " +
      "and `scripts/brand-gate.mjs` fails on a retired spelling.",
    "",
  ].join("\n")
}

/** Appends the decision and links D125 to it; returns the files it changed. */
function recordDecision(root, dryRun) {
  const path = join(root, DECISIONS)
  if (!existsSync(path)) return []
  const log = readFileSync(path, "utf8")
  if (new RegExp(`^\\*\\*D\\d+\\. The language is ${BRAND}\\*\\*`, "m").test(log)) return []
  const number = Math.max(...[...log.matchAll(/^\*\*D(\d+)\./gm)].map((match) => Number(match[1]))) + 1
  const linked = log.replace(/^(\*\*D125\. .*?\(Will, \*\*controversial\*\*; supersedes D58)\)/m, `$1; superseded by D${number})`)
  const changed = [DECISIONS]
  if (!dryRun) writeFileSync(path, `${linked.replace(/\n*$/, "\n\n")}${decisionText(number)}`)
  const table = join(root, DECISIONS_TABLE)
  if (existsSync(table)) {
    const text = readFileSync(table, "utf8")
    const next = text.replace(/^(\| O9 \| D58, superseded by D125)( \(\*\*controversial\*\*\))/m, `$1, then D${number}$2`)
    if (next !== text) {
      changed.push(DECISIONS_TABLE)
      if (!dryRun) writeFileSync(table, next)
    }
  }
  return changed
}

// ---- Generated files: rebuilt by their generators, not by regex. ----
function goRoot(root) {
  const tsc = join(root, "typescript", "tsc")
  const go = spawnSync("go", ["env", "GOROOT"], { cwd: existsSync(tsc) ? tsc : root, encoding: "utf8", env: { ...process.env, GOTOOLCHAIN: process.env.GOTOOLCHAIN || "auto" } })
  return go.status === 0 ? go.stdout.trim() : undefined
}

/** The files among rels that gofmt would change, as gofmt -l lists them. */
function gofmtUnclean(gofmt, root, rels) {
  const unclean = new Set()
  for (let start = 0; start < rels.length; start += 200) {
    const result = spawnSync(gofmt, ["-l", ...rels.slice(start, start + 200)], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 })
    if (result.error || result.signal) throw new Error(`gofmt -l did not finish: ${result.error?.message ?? result.signal}`)
    for (const line of result.stdout.split("\n")) if (line) unclean.add(line.split(sep).join("/"))
  }
  return unclean
}

/** forms_decisions.txt is a header line and lines sorted byte-wise (cmd/effeck-forms, sort.Strings). */
function resortDecisions(text) {
  const lines = text.split("\n")
  const header = lines[0].startsWith("#") ? [lines.shift()] : []
  const body = lines.filter(Boolean).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return [...header, ...body, ""].join("\n")
}

function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes("--dry-run")
  const verbose = args.includes("--verbose")
  const regenerate = !args.includes("--no-regenerate")
  const rootIndex = args.indexOf("--root")
  const root = resolve(rootIndex >= 0 ? args[rootIndex + 1] : process.cwd())
  const log = (line) => verbose && process.stdout.write(`${line}\n`)

  // Plan every change before writing any, so gofmt can judge the untouched files.
  const plan = []
  for (const rel of listFiles(root)) {
    if (isExempt(rel)) continue
    const buffer = readFileSync(join(root, rel))
    let rewrite
    if (!isBinary(rel, buffer)) {
      const before = buffer.toString("utf8")
      const { text: after, count } = rewriteText(before, rel)
      if (after.includes("\u0000") && !before.includes("\u0000")) throw new Error(`${rel}: a masked span was not restored`)
      if (after !== before) rewrite = { after: rel.endsWith("forms_decisions.txt") ? resortDecisions(after) : after, count }
    }
    const next = renamePath(rel)
    if (rewrite || next !== rel) plan.push({ rel, next, rewrite, size: buffer.length })
  }

  // gofmt realigns the Go files the rename lengthens; a file gofmt already
  // disliked keeps its layout, so the rename adds no unrelated change.
  let gofmt
  let missingGofmt = false
  let goFiles = []
  const rewrittenGo = plan.filter((entry) => entry.rewrite && entry.rel.endsWith(".go"))
  if (!dryRun && regenerate && rewrittenGo.length > 0) {
    gofmt = join(goRoot(root) ?? "", "bin", "gofmt")
    if (!existsSync(gofmt)) missingGofmt = true
    else {
      const unclean = gofmtUnclean(gofmt, root, rewrittenGo.map((entry) => entry.rel))
      goFiles = rewrittenGo.filter((entry) => !unclean.has(entry.rel)).map((entry) => entry.next)
    }
  }

  let rewrittenFiles = 0
  let occurrences = 0
  let renamedFiles = 0
  const touchedDirectories = new Set()
  const largest = { size: 0, rel: "" }
  for (const { rel, next, rewrite, size } of plan) {
    const path = join(root, rel)
    if (rewrite) {
      rewrittenFiles += 1
      occurrences += rewrite.count
      log(`rewrite ${rel} (${rewrite.count})`)
      if (!dryRun) writeFileSync(path, rewrite.after)
    }
    if (next !== rel) {
      renamedFiles += 1
      log(`rename  ${rel} -> ${next}`)
      if (!dryRun) {
        const target = join(root, next)
        if (existsSync(target)) throw new Error(`rename target already exists: ${next}`)
        mkdirSync(dirname(target), { recursive: true })
        renameSync(path, target)
        if (size > largest.size) Object.assign(largest, { size, rel: next })
        touchedDirectories.add(dirname(path))
      }
    }
  }

  if (!dryRun) {
    for (const directory of [...touchedDirectories].sort((a, b) => b.length - a.length)) {
      let current = directory
      while (current !== root && existsSync(current) && readdirSync(current).length === 0) {
        rmdirSync(current)
        current = dirname(current)
      }
    }
  }

  const decisionFiles = recordDecision(root, dryRun)
  for (const file of decisionFiles) log(`record  ${file}`)

  process.stdout.write(
    `${dryRun ? "[dry-run] " : ""}rename-to-vibelang: ${rewrittenFiles} files rewritten (${occurrences} occurrences), ` +
      `${renamedFiles} files renamed${decisionFiles.length ? `, decision recorded in ${decisionFiles.join(" and ")}` : ""}\n`,
  )

  // jj snapshots a renamed file as a new one, and refuses new files over 1 MiB by default.
  if (largest.size > 1 << 20 && existsSync(join(root, ".jj"))) {
    process.stdout.write(
      `rename-to-vibelang: ${largest.rel} is ${largest.size} bytes; snapshot it with ` +
        `jj --config snapshot.max-new-file-size=${largest.size} status\n`,
    )
  }
  // --regenerate reruns the generators alone, for a tree the rename already reached.
  const changed = rewrittenFiles + renamedFiles > 0 || args.includes("--regenerate")
  if (dryRun || !regenerate || !changed) return
  const failures = []
  const goEnv = { ...process.env, GOTOOLCHAIN: process.env.GOTOOLCHAIN || "auto" }
  if (missingGofmt) failures.push(`gofmt was not found (\`go env GOROOT\` in typescript/tsc); run gofmt -w on ${rewrittenGo.map((entry) => entry.next).join(" ")}`)
  if (goFiles.length > 0) {
    const result = spawnSync(gofmt, ["-w", ...goFiles], { cwd: root, encoding: "utf8" })
    if (result.status === 0) process.stdout.write(`rename-to-vibelang: gofmt ${goFiles.length} Go files\n`)
    else failures.push(`gofmt -w failed: ${result.stderr.trim()}`)
  }
  // The forms table digests the runtime's sources and sorts by package name.
  const forms = join(root, "scripts", "check-forms-table.sh")
  if (existsSync(forms)) {
    process.stdout.write("rename-to-vibelang: bash scripts/check-forms-table.sh --write\n")
    const result = spawnSync("bash", [forms, "--write"], { cwd: root, stdio: "inherit", env: goEnv })
    if (result.status !== 0) failures.push("bash scripts/check-forms-table.sh --write failed (it needs Go 1.27 and docs/tools/node_modules)")
  }
  // The projector's goldens sort imports by module, and the runtime's package
  // name now sorts after effect's: rewrite them with the test's own switch.
  const mapper = `internal/${BRAND_LOWER}mapper`
  const tsc = join(root, "typescript", "tsc")
  if (existsSync(join(tsc, mapper, "testdata", "stock"))) {
    const command = `UPDATE_STOCK_GOLDENS=1 go test -count=1 -run '^TestStockProjectionGoldens$' ./${mapper}/`
    process.stdout.write(`rename-to-vibelang: (cd typescript/tsc && ${command})\n`)
    const result = spawnSync("go", ["test", "-count=1", "-run", "^TestStockProjectionGoldens$", `./${mapper}/`], {
      cwd: tsc,
      encoding: "utf8",
      env: { ...goEnv, GOFLAGS: "", UPDATE_STOCK_GOLDENS: "1" },
    })
    if (result.status !== 0) {
      failures.push(
        `${command} failed in typescript/tsc (it needs experiments/node_modules and the stock TypeScript that ` +
          `bash packages/ts-mapper/test/e2e.sh installs):\n${(result.stdout + result.stderr).trim().split("\n").slice(-8).join("\n")}`,
      )
    }
  }
  if (failures.length > 0) {
    process.stderr.write(
      `rename-to-vibelang: the rename is applied, but:\n${failures.map((line) => `  ${line}`).join("\n")}\n` +
        "Fix that and run node scripts/rename-to-vibelang.mjs --regenerate.\n",
    )
    process.exit(2)
  }
}

const invoked = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
if (invoked) main()
