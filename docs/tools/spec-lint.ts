// spec-lint.ts: deterministic linters over docs/design. Each rule is one class
// of inconsistency a specification review found; spec-lint.test.ts runs every
// rule on the real specification, which must pass, and on the past defect the
// rule was written for, which must fail. `bun docs/tools/spec-lint.ts` prints
// the violations and exits non-zero on any. The graph target is //:spec-lint.
import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

// A specification: path relative to docs/design ("src/007-tooling.md",
// "vips/0039-vibex.md") to text.
export type Spec = Map<string, string>
export type Violation = { rule: string; file: string; line: number; message: string }
export type Rule = { name: string; finding: string; check: (spec: Spec) => Violation[] }

export function loadSpec(root = resolve(import.meta.dir, "../design")): Spec {
  const spec: Spec = new Map()
  for (const dir of ["src", "vips"]) {
    for (const name of readdirSync(resolve(root, dir)).filter(name => name.endsWith(".md")).sort()) {
      spec.set(`${dir}/${name}`, readFileSync(resolve(root, dir, name), "utf8"))
    }
  }
  return spec
}

const lineAt = (text: string, index: number) => text.slice(0, index).split("\n").length
const chapters = (spec: Spec) => [...spec].filter(([file]) => file.startsWith("src/"))
// An accepted VIP is the authority a chapter may cite; a denied or open one is not.
const acceptedVips = (spec: Spec) =>
  [...spec].filter(([file]) => /^vips\/\d{4}-/.test(file) && !/-(denied|open)\.md$/.test(file))

// Prose with fenced code blocks blanked, so offsets still give line numbers.
export const prose = (text: string) => text.replace(/^```[^]*?^```/gm, block => block.replace(/[^\n]/g, " "))

// The sentences of a text's prose, each with its offset.
export function sentences(text: string): { text: string; index: number }[] {
  const out: { text: string; index: number }[] = []
  const body = prose(text)
  const re = /[^\n.!?]*(?:(?:\.(?=[\w`"'(])|`[^`\n]*`|[^\n.!?`])[^\n.!?]*)*[.!?]?/g
  for (const m of body.matchAll(re)) if (m[0].trim()) out.push({ text: m[0], index: m.index! })
  return out
}

// The paragraphs and list items of a text's prose, each with its offset.
export function paragraphs(text: string): { text: string; index: number }[] {
  const out: { text: string; index: number }[] = []
  for (const m of prose(text).matchAll(/(?:^|\n)((?:(?![ \t]*(?:[-*]|\d+\.)[ \t])[^\n]+|[ \t]*(?:[-*]|\d+\.)[ \t][^\n]*)(?:\n(?![ \t]*(?:[-*]|\d+\.)[ \t])[^\n]+)*)/g)) {
    if (m[1]!.trim()) out.push({ text: m[1]!, index: m.index! + m[0].indexOf(m[1]!) })
  }
  return out
}

// The VibeLang half of each TypeScript-family code block: the lines before a
// `// Effect TS` or `// compiles to` counterpart, each with its line number.
export function vibeCode(text: string): { line: number; text: string; block: string }[] {
  const out: { line: number; text: string; block: string }[] = []
  for (const m of text.matchAll(/^[ \t]*```(\w+)?[^\n]*\n([^]*?)^[ \t]*```/gm)) {
    if (!/^(ts|vibe|tsx|vibex)$/.test(m[1] ?? "")) continue
    const first = lineAt(text, m.index!) + 1
    const half = m[2]!.split(/^\s*\/\/ (?:Effect TS|compiles to)\b.*$/m)[0]!
    half.split("\n").forEach((line, i) => out.push({ line: first + i, text: line, block: half }))
  }
  return out
}

// The rows of the first table after `marker`, each a list of trimmed cells.
function tableAfter(text: string, marker: string): string[][] | undefined {
  const at = text.indexOf(marker)
  if (at < 0) return undefined
  const lines = text.slice(at).split("\n").slice(1)
  const start = lines.findIndex(line => line.startsWith("|"))
  if (start < 0) return undefined
  const rows: string[][] = []
  for (const line of lines.slice(start)) {
    if (!line.startsWith("|")) break
    rows.push(line.slice(1, line.endsWith("|") ? -1 : undefined).split("|").map(cell => cell.trim()))
  }
  return rows.slice(2)
}

// Relative-specifier resolution (round 14 OPUS-1). Chapter 7 copies VIP-39's
// resolution table, which lists every relative specifier ending VibeLang
// changes. A sentence elsewhere saying `./x.ts` resolves to `x.vibe` adds a
// row the table does not have, so the table must stay VIP-39's, and every
// "`./x.e` resolves to `x.f`" claim must be a try the table lists.
const resolutionTable = (text: string, marker: string) => {
  const rows = tableAfter(text, marker)
  if (!rows) return undefined
  const tries = new Map<string, string[]>()
  for (const [specifiers, order] of rows) {
    const targets = [...order!.matchAll(/`App(\.[\w.]+)`/g)].map(m => m[1]!)
    for (const [, ext] of specifiers!.matchAll(/`\.\/App((?:\.\w+)?)`/g)) tries.set(ext!, targets)
  }
  return { tries }
}
const chapterTable = "Relative specifiers resolve as follows"
const vipTable = "Resolution treats `.vibex` as `.vibe`'s `.tsx`:"

const resolutionClaims: Rule = {
  name: "resolution-claims",
  finding: "r14 OPUS-1: 007 said `./x.ts` resolves to `x.vibe`, a row neither resolution table has",
  check(spec) {
    const out: Violation[] = []
    const chapter = spec.get("src/007-tooling.md") ?? "", vip = spec.get("vips/0039-vibex.md") ?? ""
    const ours = resolutionTable(chapter, chapterTable), theirs = resolutionTable(vip, vipTable)
    if (!ours || !theirs) {
      return [{ rule: this.name, file: ours ? "vips/0039-vibex.md" : "src/007-tooling.md", line: 1, message: "the relative-specifier resolution table is missing" }]
    }
    // Compare the try orders; VIP-39's "(unchanged)" note is not a try.
    if (JSON.stringify([...ours.tries]) !== JSON.stringify([...theirs.tries])) {
      out.push({ rule: this.name, file: "src/007-tooling.md", line: lineAt(chapter, chapter.indexOf(chapterTable)), message: "the resolution table differs from VIP-39's" })
    }
    const claim = /`\.\/([\w-]+)((?:\.\w+)?)`(?: that| which)? resolves? to `\1(\.[\w.]+)`/g
    for (const [file, text] of spec) {
      for (const m of prose(text).matchAll(claim)) {
        const [, , from, to] = m
        if (!ours.tries.get(from!)?.includes(to!)) {
          out.push({ rule: this.name, file, line: lineAt(text, m.index!), message: `\`./x${from}\` resolving to \`x${to}\` is not in VIP-39's resolution table: ${m[0]}` })
        }
      }
    }
    return out
  }
}

// Configuration keys (round 14 OPUS-3). Chapter 7 named a second path,
// `compilerOptions.vibelang.declarationImportStyle`, two sibling keys,
// `trustedPackages` and `tracing`, and a TypeScript code, `TS6046`, for a
// VibeLang option, none with a VIP behind it. A configuration path a chapter
// names must appear in an accepted VIP; so must each key a chapter lists as
// part of the legacy `vibelang` section; and a VibeLang option's
// configuration error is not given a TypeScript code.
const configPath = /`((?:compilerOptions\.)?vibe(?:lang)?\.[a-z][A-Za-z]*)`/g
const configKeys: Rule = {
  name: "config-keys",
  finding: "r14 OPUS-3: 007 named `compilerOptions.vibelang.declarationImportStyle`, `trustedPackages`, `tracing` and `TS6046` with no VIP",
  check(spec) {
    const out: Violation[] = []
    const vips = acceptedVips(spec).map(([, text]) => text).join("\n")
    for (const [file, text] of chapters(spec)) {
      for (const m of prose(text).matchAll(configPath)) {
        if (!vips.includes(m[1]!)) out.push({ rule: this.name, file, line: lineAt(text, m.index!), message: `\`${m[1]}\` appears in no accepted VIP` })
      }
      for (const sentence of sentences(text)) {
        const listed = sentence.text.match(/`vibelang` section with ((?:`\w+`(?:,? and |, )?)+)/)
        for (const [, key] of listed?.[1]!.matchAll(/`(\w+)`/g) ?? []) {
          if (!vips.includes(`vibelang.${key}`)) out.push({ rule: this.name, file, line: lineAt(text, sentence.index), message: `\`vibelang.${key}\` appears in no accepted VIP` })
        }
        if (/\bconfig(?:uration)? error\b/.test(sentence.text)) {
          for (const [code] of sentence.text.matchAll(/TS\d{4,5}/g)) {
            out.push({ rule: this.name, file, line: lineAt(text, sentence.index), message: `a VibeLang configuration error is given TypeScript's \`${code}\`` })
          }
        }
      }
    }
    return out
  }
}

// The scope of `vibelang.declarationImportStyle` (round 14 ASTRA-1). Decided
// detail 263 calls it "an opt-in package declaration spelling policy" and
// says "source-adjacent sidecars retain their existing VibeLang-source
// reference rules", and asks for VIP-27 and VIP-30 amendments. 001 and 007
// stated the option with no sidecar boundary and neither VIP named it. Every
// paragraph that names the option states the sidecar boundary, and VIP-27
// and VIP-30 both publish it.
const importStyleScope: Rule = {
  name: "declaration-import-style-scope",
  finding: "r14 ASTRA-1 and OPUS-5: 001:483 and 007:107 gave declarationImportStyle no sidecar boundary and no `.vibex` rule; VIP-27 and VIP-30 did not name it",
  check(spec) {
    const out: Violation[] = []
    for (const [file, text] of [...chapters(spec), ...acceptedVips(spec)]) {
      for (const p of paragraphs(text)) {
        if (p.text.includes("declarationImportStyle") && !/sidecar/i.test(p.text)) {
          out.push({ rule: this.name, file, line: lineAt(text, p.index), message: "a paragraph naming `declarationImportStyle` does not say that source-adjacent sidecars keep their spelling" })
        }
        // Round 14 OPUS-5: VIP-39 made `.vibex` a source kind beside `.vibe`;
        // a chapter's declaration-spelling rule says what a `.vibex` import gets.
        if (file.startsWith("src/") && p.text.includes("declarationImportStyle") && !/`\.\/[\w-]+\.vibex`/.test(p.text)) {
          out.push({ rule: this.name, file, line: lineAt(text, p.index), message: "a chapter paragraph naming `declarationImportStyle` states no rule for a `./x.vibex` import" })
        }
      }
    }
    for (const file of ["vips/0027-declaration-output.md", "vips/0030-config-files.md"]) {
      if (!spec.get(file)?.includes("`vibelang.declarationImportStyle`")) {
        out.push({ rule: this.name, file, line: 1, message: "the VIP does not publish `vibelang.declarationImportStyle`, as decided detail 263 asks" })
      }
    }
    return out
  }
}

// The import a declaration adds (round 14 OPUS-4). 001's Content bullet and
// its worked example wrote `import type { Effect, Stream } from "effect"`;
// the Specifiers bullet beside it wrote `import { Effect } from "effect"`, and
// VIP-27 holds declarations to the bytes the Effect TypeScript twin's
// declaration has, which keeps the twin's value import. Within chapter 1's
// Declaration output section every `import … from "effect"` takes one form.
const declarationImportForm: Rule = {
  name: "declaration-import-form",
  finding: "r14 OPUS-4: 001:482 and 001:565 wrote `import type { Effect, Stream }`, 001:483 `import { Effect }`, for the same added import",
  check(spec) {
    const text = spec.get("src/001-functions.md") ?? ""
    const start = text.indexOf("\n## Declaration output\n")
    if (start < 0) return [{ rule: this.name, file: "src/001-functions.md", line: 1, message: "the Declaration output section is missing" }]
    const next = text.indexOf("\n## ", start + 1)
    const section = text.slice(start, next < 0 ? undefined : next)
    const found = [...section.matchAll(/import (type )?\{[^}\n]*\} from ["']effect["']/g)]
    const typeOnly = found.filter(m => m[1]), value = found.filter(m => !m[1])
    if (!typeOnly.length || !value.length) return []
    return typeOnly.map(m => ({ rule: this.name, file: "src/001-functions.md", line: lineAt(text, start + m.index!),
      message: `\`${m[0]}\` disagrees with the section's \`${value[0]![0]}\`: an added import has one form, the Effect TypeScript twin's` }))
  }
}

// Denied-VIP repairs (round 14 OPUS-2, part 4). Appendix C's row for VIP-11
// listed two repairs, `f(x, () => { … })` or `f(x, effect { … })`, while
// VIP-11's amendment and Appendix B's `EK1101` row list three. Where a
// denied VIP's code has an Appendix B row, Appendix C's "Instead" cell
// lists exactly that row's call-shaped repairs.
const callForms = (cell: string) => new Set([...cell.matchAll(/`(f\((?:[^`]*)\))`/g)].map(m => m[1]!.replace(/\bargs\b/g, "x")))
const deniedVipRepairs: Rule = {
  name: "denied-vip-repairs",
  finding: "r14 OPUS-2: Appendix C gave VIP-11 two repairs, Appendix B's EK1101 row and VIP-11's amendment three",
  check(spec) {
    const out: Violation[] = []
    const file = "src/900-appendices.md", text = spec.get(file) ?? ""
    const codeRows = new Map<string, string>()
    for (const m of text.matchAll(/^\| `(EK\d{4,5})` \|([^\n]*)$/gm)) codeRows.set(m[1]!, m[2]!)
    const denied = text.indexOf("### Denied VIPs")
    for (const m of text.slice(denied).matchAll(/^\| \[(\d+)\]\(\.\.\/vips\/([\w-]+\.md)\) \|[^|]*\|([^\n]*)\|$/gm)) {
      if (denied < 0) break
      const instead = callForms(m[3]!)
      const vip = spec.get(`vips/${m[2]}`) ?? ""
      for (const code of new Set([...vip.matchAll(/`(EK\d{4,5})`/g)].map(c => c[1]!))) {
        const row = codeRows.get(code)
        if (!row) continue
        const fixes = callForms(row.slice(row.indexOf("quick fix")))
        if (!fixes.size || !instead.size) continue
        if ([...fixes].sort().join("\n") !== [...instead].sort().join("\n")) {
          out.push({ rule: this.name, file, line: lineAt(text, denied + m.index!),
            message: `VIP-${m[1]}'s Appendix C repairs ${[...instead].join(", ")} differ from \`${code}\`'s quick fix ${[...fixes].join(", ")}` })
        }
      }
    }
    return out
  }
}

// Retired forms in VIP and chapter examples (rows 45 and 46 of round 14's
// open table). A VIP's opening example is the first program a reader copies,
// and two still used forms an accepted source has removed. Each check names
// the source that removed its form.
const retired: { form: string; pattern: RegExp; source: string }[] = [
  { form: "the value handler `x catch guest`", pattern: /\bcatch\s+(?!effect\b|async\b|\(|<)[A-Za-z_$][\w$]*\s*(?:\/\/.*)?$/,
    source: "VIP-5, amended 2026-10-29: `x catch () => guest` replaces the value form `x catch guest`, which is removed" },
]
const retiredForms: Rule = {
  name: "retired-forms",
  finding: "r7 ASTRA-4 (row 46): VIP-5's Decision example used the removed value handler `catch guest`",
  check(spec) {
    const out: Violation[] = []
    for (const [file, text] of [...chapters(spec), ...acceptedVips(spec)]) {
      for (const { line, text: code } of vibeCode(text)) {
        for (const r of retired) {
          if (r.pattern.test(code)) out.push({ rule: this.name, file, line, message: `${r.form} is removed (${r.source}): ${code.trim()}` })
        }
      }
    }
    return out
  }
}

export const rules: Rule[] = [resolutionClaims, configKeys, importStyleScope, declarationImportForm, deniedVipRepairs, retiredForms]

export const lint = (spec: Spec, only = rules) => only.flatMap(rule => rule.check(spec))

if (import.meta.main) {
  const found = lint(loadSpec())
  for (const v of found) console.log(`docs/design/${v.file}:${v.line}: [${v.rule}] ${v.message}`)
  console.log(found.length ? `${found.length} violations` : `spec-lint: ${rules.length} rules pass`)
  process.exit(found.length ? 1 : 0)
}
