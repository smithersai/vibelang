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

// Declaration spelling is governed by VIP-27/30. Recognize a retired-key
// notice without requiring it to describe the old live option. While the
// separate spec publication is pending, validate the older scope contract;
// once VIP-30 retires it, reject live-option claims in every chapter/VIP.
const importStyleScope: Rule = {
  name: "declaration-import-style-scope",
  finding: "r14 OPUS-3/5 and r15 OPUS-2: declaration spelling must follow its published VIP contract",
  check(spec) {
    const out: Violation[] = []
    const retired = /There is no `declarationImportStyle` setting/.test(spec.get("vips/0030-config-files.md") ?? "")
    for (const [file, text] of [...chapters(spec), ...acceptedVips(spec)]) {
      for (const p of paragraphs(text)) {
        if (!p.text.includes("declarationImportStyle")) continue
        const notice = /(?:retired|retire[sd]?|no `declarationImportStyle` setting)/i.test(p.text)
        if (retired) {
          if (!notice || /not yet decided|by default|the default|Declaration output selects|Package declarations use/.test(p.text)) {
            out.push({ rule: this.name, file, line: lineAt(text, p.index), message: "the retired declarationImportStyle option cannot select declaration spelling" })
          }
          continue
        }
        if (!/sidecar/i.test(p.text)) {
          out.push({ rule: this.name, file, line: lineAt(text, p.index), message: "a paragraph naming `declarationImportStyle` does not say that source-adjacent sidecars keep their spelling" })
        }
        if (file.startsWith("src/") && !/`\.\/[\w-]+\.vibex`/.test(p.text)) {
          out.push({ rule: this.name, file, line: lineAt(text, p.index), message: "a chapter paragraph naming `declarationImportStyle` states no rule for a `./x.vibex` import" })
        }
      }
    }
    if (!retired) for (const file of ["vips/0027-declaration-output.md", "vips/0030-config-files.md"]) {
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
  { form: "the bare type `Effect<A, E, R>`", pattern: /(?<![\w.$])Effect</,
    source: "decided detail 260: a bare `Effect<A, E, R>` type is not a VibeLang form; write `A!E!R` or `Effect.Effect<A, E, R>`" },
]
const retiredForms: Rule = {
  name: "retired-forms",
  finding: "r7 ASTRA-4 (row 46): VIP-5's Decision example used the removed value handler `catch guest`; r7 OPUS-6 (row 45): VIP-1's written-type example used bare `Effect<A, E, R>`",
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

// Platform packages in examples (row 36 of round 14's open table, round 6
// OPUS-4). VIP-33's Decision example used `NodeServices` with no import and
// provided it at the top level, outside effect code; VIP-26's used
// `NodeRuntime` with no import. Chapter 5: `NodeServices` is "a platform
// package: imported, not in scope" (VIP-14 puts only Effect's modules in
// scope), and `provide` outside effect code is `EK1201` (VIP-12). An example
// that names a platform package's value imports it, and does not provide it
// at a module's top level.
const platformValue = /\b((?:Node|Bun|Browser)(?:Services|Runtime|Context|HttpServer|HttpClient|FileSystem|Path|Terminal|Worker))\b/g
const platformImports: Rule = {
  name: "platform-imports",
  finding: "r6 OPUS-4 (row 36): VIP-33 used `NodeServices` unimported in a top-level `provide`; VIP-26 used `NodeRuntime` unimported",
  check(spec) {
    const out: Violation[] = []
    for (const [file, text] of [...chapters(spec), ...acceptedVips(spec)]) {
      for (const { line, text: code, block } of vibeCode(text)) {
        if (/^\s*import\b/.test(code)) continue
        for (const [, name] of code.replace(/\/\/.*$/, "").matchAll(platformValue)) {
          const imported = new RegExp(`^\\s*import\\s+(?:type\\s+)?\\{[^}]*\\b${name}\\b[^}]*\\}\\s+from\\s+["']@effect\\/platform-`, "m")
          if (!imported.test(block)) out.push({ rule: this.name, file, line, message: `\`${name}\` is a platform package's value, not in scope: the example must import it` })
          if (/^provide\b/.test(code)) out.push({ rule: this.name, file, line, message: `\`provide ${name}…\` at a module's top level is outside effect code (EK1201)` })
        }
      }
    }
    return out
  }
}

// Counterparts keep native declarations (row 51 of round 14's open table,
// round 9 ASTRA-2). VIP-8's example kept `using f = openFile(p)`, which
// "keeps exactly TypeScript's meaning", but its `// Effect TS` counterpart
// dropped it, so the counterpart neither acquires nor disposes the file. In a
// code block with an `// Effect TS` counterpart, every `using` declaration of
// the VibeLang half appears in the counterpart.
const counterpartUsing: Rule = {
  name: "counterpart-using",
  finding: "r9 ASTRA-2 (row 51): VIP-8's Effect TS counterpart dropped the source's `using f = openFile(p)`",
  check(spec) {
    const out: Violation[] = []
    for (const [file, text] of spec) {
      for (const m of text.matchAll(/^[ \t]*```(\w+)?[^\n]*\n([^]*?)^[ \t]*```/gm)) {
        const parts = m[2]!.split(/^\s*\/\/ Effect TS\b.*$/m)
        if (parts.length < 2) continue
        const counterpart = parts.slice(1).join("\n")
        for (const u of parts[0]!.matchAll(/\b((?:await\s+)?using\s+[A-Za-z_$][\w$]*)\s*=/g)) {
          if (!new RegExp(`\\b${u[1]!.replace(/\s+/g, "\\s+").replace(/\$/g, "\\$")}\\s*=`).test(counterpart)) {
            out.push({ rule: this.name, file, line: lineAt(text, m.index! + m[0].indexOf(m[2]!) + u.index!) + 0,
              message: `the Effect TS counterpart drops \`${u[1]} = …\`, so it does not acquire or dispose what the source does` })
          }
        }
      }
    }
    return out
  }
}

// Output collisions follow output paths (row 39 of round 14's open table,
// round 6 ASTRA-5). VIP-39 said `App.vibe` beside `App.vibex` "write the same
// output and get TypeScript's TS5055/TS5056" unconditionally; under
// `"jsx": "preserve"` with declarations off they write `App.js` and
// `App.jsx`. Decided detail 265: "report native output-collision diagnostics
// only where the selected inputs really share a written path". A sentence
// giving a same-stem pair `TS5055` or `TS5056` states that condition.
const collisionConditional: Rule = {
  name: "collision-conditional",
  finding: "r6 ASTRA-5 (row 39): VIP-39 gave every `.vibe`/`.vibex` same-stem pair TS5055/TS5056",
  check(spec) {
    const out: Violation[] = []
    for (const [file, text] of spec) {
      for (const sentence of sentences(text)) {
        if (/TS505[56]/.test(sentence.text) && /\bbeside\b/.test(sentence.text) && !/\bonly (?:where|when|if)\b[^.]*\boutput/.test(sentence.text)) {
          out.push({ rule: this.name, file, line: lineAt(text, sentence.index), message: "a same-stem pair gets `TS5055`/`TS5056` only where the selected inputs write the same output path; the sentence does not say so" })
        }
      }
    }
    return out
  }
}

// Denied-VIP rationales a later ruling falsified (row 50 of round 14's open
// table, round 9 OPUS-2). VIP-25 was denied because "VIP-1, VIP-4 and VIP-5
// gave plain and `async` functions in `.vibe` exactly TypeScript's meaning,
// so nothing is left to escape from"; Will's 2026-10-31 ruling makes `throw`
// in synchronous VibeLang code a compile error. A denied VIP stating a claim
// listed here carries a dated amendment that cites the ruling.
const falsified: { claim: RegExp; ruling: string }[] = [
  { claim: /exactly TypeScript's meaning, so nothing is left to escape from/, ruling: "2026-10-31" },
]
const rulingClaims: Rule = {
  name: "ruling-claims",
  finding: "r9 OPUS-2 (row 50): VIP-25's denial reason contradicts Will's 2026-10-31 no-throw ruling",
  check(spec) {
    const out: Violation[] = []
    for (const [file, text] of spec) {
      if (!/^vips\/\d{4}-.*-denied\.md$/.test(file)) continue
      for (const { claim, ruling } of falsified) {
        const m = text.match(claim)
        if (!m) continue
        const amended = [...text.matchAll(/\*\*?Amended (\d{4}-\d{2}-\d{2})[^]*?(?:\n\n|$)/g)].some(a => a[1]! >= ruling && a[0].includes(ruling))
        if (!amended) out.push({ rule: this.name, file, line: lineAt(text, m.index!), message: `the denial's reason "${m[0]}" contradicts Will's ${ruling} ruling, and no dated amendment says so` })
      }
    }
    return out
  }
}

export const rules: Rule[] = [resolutionClaims, configKeys, importStyleScope, declarationImportForm, deniedVipRepairs, retiredForms, platformImports, counterpartUsing, collisionConditional, rulingClaims]

export const lint = (spec: Spec, only = rules) => only.flatMap(rule => rule.check(spec))

if (import.meta.main) {
  const found = lint(loadSpec())
  for (const v of found) console.log(`docs/design/${v.file}:${v.line}: [${v.rule}] ${v.message}`)
  console.log(found.length ? `${found.length} violations` : `spec-lint: ${rules.length} rules pass`)
  process.exit(found.length ? 1 : 0)
}
