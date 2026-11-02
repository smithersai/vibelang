// Run from the repository root: bun docs/tools/fix-snippets.ts [--check]
// Edits are staged per page and written only after diagnostics and every marked
// output still match. Temporary imports/exports never become Markdown content.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"
import { createRequire } from "node:module"
import { classify, command, defaultCompiler, extract, linkModules, markdownPages, parseDiagnostics, runBlock, writeProject, type Block, type Result } from "./check-snippets"

const repo = resolve(import.meta.dir, "../..")
const ts = () => createRequire(join(repo, "experiments/package.json"))("typescript") as typeof import("../../experiments/node_modules/typescript")
const directive = /(?:^[\t ]*)?\/\/ (?:Plain TypeScript inside this (?:hatch|module), not VibeLang\.|(?:try|sync|callback)'s first argument is plain TypeScript, not VibeLang\.)[^\r\n]*/gm

export function preserveDirectives(before: string, after: string) {
  const original = before.match(directive) ?? []
  const rewritten = after.match(directive) ?? []
  let at = 0
  for (const line of original) {
    at = rewritten.indexOf(line, at)
    if (at < 0) throw new Error("plain-TypeScript comment changed")
    at++
  }
}

// A newly introduced hatch/module needs the same explanatory comment as the
// hand-written examples. Parse TypeScript bodies, rather than matching braces
// in strings. Existing directive lines are checked byte for byte afterwards.
export function annotateRegions(source: string): string {
  const parser = ts()
  // VibeLang's try(...) expression is a reserved word in TypeScript. Give
  // that token an equal-length identifier for this syntax-only walk.
  const scanner = parser.createScanner(parser.ScriptTarget.Latest, true)
  scanner.setText(source)
  let parsed = source
  const tries: number[] = []
  for (let token = scanner.scan(); token !== parser.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token === parser.SyntaxKind.TryKeyword) {
      const start = scanner.getTokenPos()
      if (scanner.scan() === parser.SyntaxKind.OpenParenToken) tries.push(start)
    }
  }
  for (const start of tries.reverse()) parsed = parsed.slice(0, start) + "trY" + parsed.slice(start + 3)
  const file = parser.createSourceFile("snippet.vibe", parsed, parser.ScriptTarget.Latest, true)
  const edits = new Map<number, string>()
  const visit = (node: any) => {
    let body: any, kind: string | undefined
    if (parser.isCallExpression(node) && parser.isIdentifier(node.expression) && ["sync", "trY", "callback"].includes(node.expression.text) && node.arguments.length) {
      kind = node.expression.text === "trY" ? "try" : node.expression.text
      const argument = node.arguments[0]
      body = parser.isArrowFunction(argument) || parser.isFunctionExpression(argument) ? argument.body : argument
    } else if (parser.isModuleDeclaration(node) && node.body && parser.isModuleBlock(node.body)) {
      kind = "module"
      body = node.body
    }
    if (body && kind) {
      const start = body.getStart(file), end = body.end
      const firstLine = source.lastIndexOf("\n", start) + 1
      const lastLine = source.indexOf("\n", node.end)
      const region = source.slice(firstLine, lastLine < 0 ? source.length : lastLine)
      if (!/\/\/ (?:Plain TypeScript inside this (?:hatch|module), not VibeLang\.|(?:try|sync|callback)'s first argument is plain TypeScript, not VibeLang\.)/.test(region)) {
        if ((parser.isBlock(body) || parser.isModuleBlock(body)) && source.slice(start, end).includes("\n")) {
          const indent = /^\s*/.exec(source.slice(firstLine, start))![0]
          edits.set(start + 1, `\n${indent}  // Plain TypeScript inside this ${kind === "module" ? "module" : "hatch"}, not VibeLang.`)
        } else if (kind !== "module") {
          const at = lastLine < 0 ? source.length : lastLine
          const comment = ` // ${kind}'s first argument is plain TypeScript, not VibeLang.`
          edits.set(at, (edits.get(at) ?? "") + comment)
        } else {
          const indent = /^\s*/.exec(source.slice(firstLine, start))![0]
          edits.set(start + 1, `\n${indent}  // Plain TypeScript inside this module, not VibeLang.\n${indent} `)
        }
      }
      // A hatch's first argument and a module body are plain TypeScript;
      // names like sync inside them do not denote VibeLang hatches.
      if (kind === "module") return
      for (const argument of node.arguments.slice(1)) visit(argument)
      return
    }
    parser.forEachChild(node, visit)
  }
  visit(file)
  for (const [at, text] of [...edits].sort(([a], [b]) => b - a)) source = source.slice(0, at) + text + source.slice(at)
  return source
}

// Replace bodies by their extraction spans, from the bottom up. This preserves
// fences, prose, output fences and CRLF byte for byte, including repeated blocks.
export function replaceBlocks(markdown: string, blocks: Block[], sources: Map<number, string>): string {
  const lines = markdown.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const starts = [0]
  for (const line of lines) starts.push(starts.at(-1)! + line.length)
  const newline = markdown.includes("\r\n") ? "\r\n" : "\n"
  for (const block of [...blocks].reverse()) {
    const source = sources.get(block.number)
    if (source === undefined || source === block.source) continue
    preserveDirectives(block.source, source)
    const start = starts[block.line - 1]
    const end = starts[block.endLine === undefined ? block.line - 1 + block.source.split("\n").length : block.endLine - 1]
    markdown = markdown.slice(0, start) + source.replaceAll("\n", newline) + newline + markdown.slice(end)
  }
  return markdown
}

// Every recorder note (pipe look-ahead, a dual's block) starts this way.
const migrationNote = /^\s+Through VibeLang 0\.0\.10, /

async function checkProject(dir: string, blocks: Block[], compiler: string): Promise<(Result & { migration?: boolean })[]> {
  const { filenames, offsets } = writeProject(dir, blocks, { omitFragments: true })
  const checked = blocks.some(block => !block.fragment)
    ? await command([compiler, "--noEmit", "--pretty", "false", "-p", join(dir, "tsconfig.json")], dir, 60000)
    : { stdout: "", stderr: "", exitCode: 0, timedOut: false }
  if (checked.timedOut) throw new Error("checking snippets timed out")
  const diagnostics = parseDiagnostics(checked.stdout + "\n" + checked.stderr)
  if (diagnostics.some(d => !d.file || !offsets.has(relative(dir, resolve(dir, d.file)).replaceAll("\\", "/"))) || checked.exitCode !== 0 && !diagnostics.length) {
    throw new Error(`compiler failed (${checked.exitCode}): ${checked.stdout}${checked.stderr}`)
  }
  // Only the recorder's own migration note permits a successful block to
  // lose diagnostics. Other errors and explicitly expected diagnostics stay
  // part of the transaction's contract.
  const migrationFiles = new Set<string>()
  let diagnosticFile: string | undefined
  for (const line of (checked.stdout + "\n" + checked.stderr).split(/\r?\n/)) {
    const match = /^(.*)\(\d+,\d+\): error (?:TS|EK)\d+:/.exec(line)
    if (match) diagnosticFile = relative(dir, resolve(dir, match[1])).replaceAll("\\", "/")
    else if (diagnosticFile && migrationNote.test(line)) migrationFiles.add(diagnosticFile)
  }
  return blocks.map(block => ({ ...classify(block, diagnostics.filter(d => d.file &&
    relative(dir, resolve(dir, d.file)).replaceAll("\\", "/") === filenames.get(block.number)).map(({ diagnostic }) => diagnostic)),
    migration: migrationFiles.has(filenames.get(block.number)!) }))
}

export async function verifyOutputs(dir: string, blocks: Result[], compiler: string, timeout: number) {
  mkdirSync(dir, { recursive: true })
  const runnable = blocks.filter(block => block.status === "ok" && !block.expected.length)
  for (const block of blocks) if (block.output !== undefined) {
    const result = await runBlock(join(dir, String(block.number)), runnable, block, compiler, timeout)
    if (result.status !== "ok") throw new Error(`block ${block.number}: expected output changed or cannot be verified (${result.reason})`)
  }
}

export async function fixPage(markdown: string, dir: string, compiler: string, timeout = 10000, allFixes = false, vip = false) {
  mkdirSync(dir, { recursive: true })
  const blocks = extract(markdown)
  if (!blocks.some(block => block.language === "vibe" && !block.fragment)) return { markdown, changed: 0, blocks: blocks.length }
  const before = await checkProject(join(dir, "before"), blocks, compiler)
  const { filenames, offsets } = writeProject(join(dir, "fix"), blocks, { omitFragments: true })
  const markers = new Map<number, { start: string; end: string }>()
  const runMarkers = new Map<number, { start: string; end: string }>()
  for (const block of blocks.filter(block => block.language === "vibe" && !block.fragment)) {
    const path = join(dir, "fix", filenames.get(block.number)!)
    const text = readFileSync(path, "utf8")
    let tag = `$docs-fix-${block.number}`
    while (text.includes(tag)) tag += "$"
    const start = `// ${tag}:start\n`, end = `\n// ${tag}:end`
    const at = text.split("\n").slice(0, offsets.get(filenames.get(block.number)!)!).join("\n").length + (offsets.get(filenames.get(block.number)!)! ? 1 : 0)
    let fixedText = text.slice(0, at) + start + block.source + end + text.slice(at + block.source.length)
    // A run marker's code is the block's too: check and migrate it beside
    // the block, as runBlock appends it, and write back a one-line result.
    if (block.run) {
      let helper = `$docsFixRun${block.number}`
      while (fixedText.includes(helper)) helper += "$"
      fixedText += `\n// ${tag}:run\nfunction ${helper}() { ${block.run} }\n// ${tag}:run-end\n`
      runMarkers.set(block.number, { start: `// ${tag}:run\nfunction ${helper}() { `, end: ` }\n// ${tag}:run-end` })
    }
    writeFileSync(path, fixedText)
    markers.set(block.number, { start, end })
  }
  const fixed = await command([compiler, "--fix", ...(vip ? ["--fix-vip-only"] : allFixes ? [] : ["--fix-migration-only"]), "--noEmit", "--pretty", "false", "-p", join(dir, "fix/tsconfig.json")], join(dir, "fix"), 120000)
  if (fixed.timedOut) throw new Error("--fix timed out")
  if (/EK(?:1023|4609|4610|4613) not fixed:/.test(fixed.stdout + fixed.stderr)) throw new Error(`migration refused: ${fixed.stdout}${fixed.stderr}`)
  if (fixed.exitCode !== 0 && !parseDiagnostics(fixed.stdout + "\n" + fixed.stderr).length) {
    throw new Error(`--fix failed (${fixed.exitCode}): ${fixed.stdout}${fixed.stderr}`)
  }
  const sources = new Map<number, string>()
  const migratedRuns = new Set<number>()
  for (const block of blocks) {
    const marker = markers.get(block.number)
    if (!marker) continue
    const text = readFileSync(join(dir, "fix", filenames.get(block.number)!), "utf8")
    const start = text.indexOf(marker.start), end = text.indexOf(marker.end)
    if (start < 0 || end < start) throw new Error(`block ${block.number}: --fix removed its source boundary`)
    let raw = text.slice(start + marker.start.length, end)
    const runMarker = runMarkers.get(block.number)
    if (runMarker && block.run) {
      const runStart = text.indexOf(runMarker.start), runEnd = text.indexOf(runMarker.end)
      if (runStart < 0 || runEnd < runStart) throw new Error(`block ${block.number}: --fix removed its run marker's boundary`)
      const run = text.slice(runStart + runMarker.start.length, runEnd)
      if (run !== block.run) {
        if (/[\r\n]/.test(run)) throw new Error(`block ${block.number}: the migrated run marker no longer fits on one line`)
        const line = /^(\s*\/\/ run:\s*)(.*)$/m.exec(raw)
        if (!line || line[2] !== block.run) throw new Error(`block ${block.number}: --fix changed its run marker's line`)
        raw = raw.slice(0, line.index) + line[1] + run + raw.slice(line.index + line[0].length)
        migratedRuns.add(block.number)
      }
    }
    if (raw !== block.source) {
      const source = annotateRegions(raw)
      preserveDirectives(block.source, source)
      sources.set(block.number, source)
    }
  }
  if (!sources.size) return { markdown, changed: 0, blocks: blocks.length }
  const rewritten = replaceBlocks(markdown, blocks, sources)
  const after = await checkProject(join(dir, "after"), extract(rewritten), compiler)
  for (let i = 0; i < before.length; i++) {
    const codes = (result: Result) => result.diagnostics.map(d => `${d.code}: ${d.message}`).sort().join("\n")
    const migrated = sources.has(before[i].number) && before[i].migration &&
      !before[i].expected.length && after[i].status === "ok"
    if (!migrated && (after[i].status !== before[i].status || codes(after[i]) !== codes(before[i]))) {
      throw new Error(`block ${before[i].number}: expected diagnostics changed`)
    }
  }
  // A changed dependency can affect an unchanged block on the page too.
  // A legacy block rejected by the new checker cannot run before its fix.
  // Its marked stdout remains mandatory after the migration, including
  // unchanged blocks that depend on it. A migrated run marker, likewise,
  // cannot compile before its fix.
  if (!before.some(block => block.migration) && !migratedRuns.size) await verifyOutputs(join(dir, "run-before"), before, compiler, timeout)
  await verifyOutputs(join(dir, "run-after"), after, compiler, timeout)
  return { markdown: rewritten, changed: sources.size, blocks: blocks.length }
}

async function main() {
  const args = process.argv.slice(2)
  const option = (name: string, fallback?: string) => {
    const i = args.indexOf(name)
    if (i < 0) return fallback
    if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`${name} requires a value`)
    return args.splice(i, 2)[1]
  }
  if (args.includes("--help")) {
    console.log("bun docs/tools/fix-snippets.ts [--compiler path] [--root docs/user] [--filter text] [--check] [--all-fixes] [--vip] [--timeout milliseconds]")
    return
  }
  const selected = option("--compiler", defaultCompiler())!
  const compiler = selected.includes("/") ? resolve(selected) : selected
  const root = resolve(option("--root", join(repo, "docs/user"))!)
  const filter = option("--filter", "")!
  const timeout = Number(option("--timeout", "10000"))
  if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new Error("--timeout must be a positive integer")
  const check = args.includes("--check")
  const allFixes = args.includes("--all-fixes")
  const vip = args.includes("--vip") // the VIP rewrites alone: vibelang --fix-vip-only
  if (args.some(arg => arg !== "--check" && arg !== "--all-fixes" && arg !== "--vip")) throw new Error(`Unknown argument: ${args.join(" ")}`)
  const temp = mkdtempSync(join(tmpdir(), "vibelang-fix-snippets-"))
  let changed = 0, refused = 0, blocks = 0
  try {
    linkModules(temp)
    for (const [index, page] of markdownPages(root).filter(page => relative(root, page).includes(filter)).entries()) {
      const markdown = readFileSync(page, "utf8")
      if (!extract(markdown).length) continue
      const dir = join(temp, String(index))
      mkdirSync(dir)
      try {
        const result = await fixPage(markdown, dir, compiler, timeout, allFixes, vip)
        blocks += result.blocks
        if (result.changed) {
          changed += result.changed
          if (!check) writeFileSync(page, result.markdown)
          console.log(`${relative(repo, page)}: ${result.changed} changed blocks${check ? " (check only)" : ""}`)
        }
      } catch (error) {
        refused++
        console.error(`${relative(repo, page)}: refused: ${(error as Error).message}`)
      }
    }
    console.log(`fix-snippets: ${blocks} blocks, ${changed} changed, ${refused} refused pages`)
    if (refused || check && changed) process.exitCode = 1
  } finally { rmSync(temp, { recursive: true, force: true }) }
}

if (import.meta.main) main().catch(error => { console.error(error.message); process.exitCode = 2 })
