import { expect, test } from "bun:test"
import fc from "fast-check"
import ts from "typescript"
import { lint, lintKind, loadSpec, rules, type Spec } from "./spec-lint"
import { examples, verdict } from "./spec-examples.mjs"

const spec = legacyStyleFixtures(loadSpec(process.env.VIBELANG_SPEC_ROOT))
const rule = (name: string) => {
  const found = rules.find(r => r.name === name)
  if (!found) throw new Error(`no rule ${name}`)
  return [found]
}
// The specification with one file's text changed: `edit` gets the current text.
function withEdit(file: string, edit: (text: string) => string): Spec {
  const copy = new Map(spec)
  const before = copy.get(file)!
  const after = edit(before)
  if (after === before) throw new Error(`the edit to ${file} changed nothing`)
  copy.set(file, after)
  return copy
}
const insertAfter = (anchor: string, added: string) => (text: string) => {
  if (!text.includes(anchor)) throw new Error(`anchor not found: ${anchor}`)
  return text.replace(anchor, anchor + added)
}

test("the specification passes every rule", () => {
  expect(lint(loadSpec()).map(v => `${v.file}:${v.line} [${v.rule}] ${v.message}`)).toEqual([])
})

test("resolution-claims rejects round 14 OPUS-1's `./x.ts` to `x.vibe` sentence", () => {
  const defect = withEdit("src/007-tooling.md", insertAfter(
    "## JSX source files: `.vibex`\n",
    " A relative `./x.ts` that resolves to `x.vibe`, as an import written before `x.ts` became `x.vibe` does, is checked and emitted as it is for `x.ts`: `rewriteRelativeImportExtensions` rewrites it to `./x.js`, and a declaration keeps `./x.ts`."
  ))
  expect(lint(defect, rule("resolution-claims")).map(v => v.message)).toEqual([
    expect.stringContaining("`./x.ts` resolving to `x.vibe` is not in VIP-39's resolution table")
  ])
})

test("resolution-claims accepts a claim the table lists; generated copies own table equality", () => {
  const listed = withEdit("src/007-tooling.md", insertAfter("## JSX source files: `.vibex`\n", "\nA `./App.jsx` that resolves to `App.vibex` is checked as `.tsx`.\n"))
  expect(lint(listed, rule("resolution-claims"))).toEqual([])

})

const opus3 = "Root `vibelang.declarationImportStyle`, or `compilerOptions.vibelang.declarationImportStyle`, is `\".js\"` (the default), `\"extensionless\"` or `\".ts\"`. It decides how an emitted declaration spells a relative import of a `.vibe` module ([Declaration output](001-functions.md#declaration-output)). Any other value is a configuration error (`TS6046`). It sits in the legacy `vibelang` section with `trustedPackages` and `tracing`, so a child config's own `vibelang` section replaces an inherited one as a whole."

test("config-keys rejects round 14 OPUS-3's TypeScript configuration code; registry owns option authority", () => {
  const defect = withEdit("src/007-tooling.md", text => text + "\n\n" + opus3 + "\n")
  expect(lint(defect, rule("config-keys")).map(v => v.message)).toEqual([
    "a VibeLang configuration error is given TypeScript's `TS6046`"
  ])
})



const retiredStyle: Spec = new Map([
  ["vips/0030-config-files.md", "There is no `declarationImportStyle` setting. Both historical paths, root `vibelang.declarationImportStyle` and `compilerOptions.vibelang.declarationImportStyle`, are ignored with a nonfatal deprecation warning for every value, including invalid values."],
  ["vips/0027-declaration-output.md", "Written relative specifiers stay as written in package declarations and compatibility sidecars. The retired `declarationImportStyle` paths are ignored."],
  ["src/001-functions.md", "Declaration emit follows TypeScript for the source's `.ts`/`.tsx` twin."],
  ["src/007-tooling.md", "`declarationImportStyle` is retired: both historical paths are ignored with a nonfatal deprecation warning for every value."]
])

test("declaration-import-style-scope accepts retirement without requiring the removed setting", () => {
  expect(lint(retiredStyle, rule("declaration-import-style-scope"))).toEqual([])
})

test("declaration-import-style-scope rejects the carried live styles and undecided vibex spelling", () => {
  for (const file of ["src/001-functions.md", "src/007-tooling.md", "vips/0027-declaration-output.md", "vips/0034-compiler-and-tooling.md"]) {
    for (const claim of [
      "Package declarations use `vibelang.declarationImportStyle`: `\".js\"` (the default). Compatibility sidecars keep `./x.vibex`.",
      "The retired `declarationImportStyle` option selects `./x.js` by default.",
      "The retired `declarationImportStyle` option's `.vibex` spelling is not yet decided."
    ]) {
      const defect = new Map(retiredStyle)
      defect.set(file, claim)
      expect(lint(defect, rule("declaration-import-style-scope"))).toHaveLength(1)
    }
  }
})

test("retired declaration notices accept arbitrary examples at both historical paths", () => {
  fc.assert(fc.property(
    fc.constantFrom("vibelang.declarationImportStyle", "compilerOptions.vibelang.declarationImportStyle"),
    fc.jsonValue(),
    (path, value) => {
      const fixture = new Map(retiredStyle)
      fixture.set("src/007-tooling.md", "The retired `" + path + "` is ignored with a nonfatal deprecation warning for every value.\n\n```json\n" + JSON.stringify({ value }) + "\n```\n")
      expect(lint(fixture, rule("declaration-import-style-scope"))).toEqual([])
    }
  ), { numRuns: 100, seed: 1007 })
})

test("retired declaration notices accept arbitrary examples at both historical paths", () => {
  fc.assert(fc.property(
    fc.constantFrom("vibelang.declarationImportStyle", "compilerOptions.vibelang.declarationImportStyle"),
    fc.jsonValue(),
    (path, value) => {
      const fixture = new Map(retiredStyle)
      fixture.set("src/007-tooling.md", "The retired `" + path + "` is ignored with a nonfatal deprecation warning for every value.\n\n```json\n" + JSON.stringify({ value }) + "\n```\n")
      expect(lint(fixture, rule("declaration-import-style-scope"))).toEqual([])
    }
  ), { numRuns: 100, seed: 1007 })
})

test("declaration-import-form rejects round 14 OPUS-4's `import type` beside `import` for the same added import", () => {
  const defect = withEdit("src/001-functions.md", text => text
    .replace("// load.d.vibe.ts\nimport { Effect, Stream } from \"effect\"", "// load.d.vibe.ts\nimport type { Effect, Stream } from \"effect\"") + '\nimport { Effect } from "effect"\n')
  expect(lint(defect, rule("declaration-import-form")).map(v => v.message)).toEqual([
    expect.stringContaining("`import type { Effect, Stream } from \"effect\"` disagrees")
  ])
})

test("denied-vip-repairs rejects round 14 OPUS-2's two-repair Appendix C row for VIP-11", () => {
  const defect = withEdit("src/900-appendices.md", text => text.replace(/^(\| \[11\]\(\.\.\/vips\/0011-trailing-blocks-denied\.md\) \| trailing blocks, `f\(x\) \{ … \}` \| )[^\n]*$/m, "$1`f(x, () => { … })` or `f(x, effect { … })` |"))
  expect(lint(defect, rule("denied-vip-repairs")).map(v => v.message)).toEqual([
    expect.stringMatching(/^VIP-11's Appendix C repairs .* differ from `EK1101`'s quick fix /)
  ])
})

test("retired-forms rejects round 7 ASTRA-4's `catch guest` in VIP-5's Decision example (row 46)", () => {
  const defect = withEdit("vips/0005-try-runs-effects.md", text => text.replace("const g = fetchUser(id) catch () => guest", "const g = fetchUser(id) catch guest"))
  const source = examples(defect.get("vips/0005-try-runs-effects.md")!)[0]!
  expect(verdict(source, { status: 0, stdout: "" }).map(v => v.message)).toContain(
    "EK0509: catch requires a function literal (VIP-5); removed value handler"
  )
})

test("retired-forms rejects round 7 OPUS-6's bare `Effect<User, NotFound, Users>` in VIP-1 (row 45)", () => {
  const defect = withEdit("vips/0001-effect-and-async-functions.md", text => text.replace("effect function load(id): User!NotFound!Users {", "effect function load(id): Effect<User, NotFound, Users> {"))
  expect(lint(defect, rule("retired-forms")).map(v => `${v.file}:${v.line} ${v.message}`)).toEqual([
    expect.stringMatching(/^vips\/0001-effect-and-async-functions\.md:27 the bare type `Effect<A, E, R>` is removed/)
  ])
})

test("platform-imports rejects round 6 OPUS-4's VIP-33 and VIP-26 examples (row 36)", () => {
  const vip33 = "```ts\neffect function readConfig(path: string) {\n  const fs = try FileSystem.FileSystem             // Effect's platform service, injected by a layer\n  return try fs.readFileString(path)\n}\nprovide NodeServices.layer { try readConfig(\"app.json\") }   // VIP-12; the platform layer is chosen at the edge\n```"
  const defect: Spec = new Map(spec)
  defect.set("vips/0033-platform-stdlib.md", spec.get("vips/0033-platform-stdlib.md")!.replace(/```ts\n[^]*?\n```/, vip33))
  defect.set("vips/0026-top-level-and-main.md", spec.get("vips/0026-top-level-and-main.md")!.replace(/^import \{ NodeRuntime \} from "@effect\/platform-node"\n/m, ""))
  expect(lint(defect, rule("platform-imports")).map(v => `${v.file}:${v.line} ${v.message}`)).toEqual([
    "vips/0026-top-level-and-main.md:9 `NodeRuntime` is a platform package's value, not in scope: the example must import it",
    "vips/0033-platform-stdlib.md:12 `NodeServices` is a platform package's value, not in scope: the example must import it",
    "vips/0033-platform-stdlib.md:12 `provide NodeServices…` at a module's top level is outside effect code (EK1201)"
  ])
})

test("counterpart-using rejects round 9 ASTRA-2's VIP-8 counterpart without `using` (row 51)", () => {
  const original = "// Effect TS\nconst load = (p, q) => Effect.scoped(Effect.gen(function* () {\n  const db = yield* openDb()\n  return yield* db.query(q)\n}))\n```"
  const defect = withEdit("vips/0008-using-denied.md", text => text.replace(/\/\/ Effect TS\n[^]*?\n```/, original))
  expect(lint(defect, rule("counterpart-using")).map(v => `${v.file}:${v.line} ${v.message}`)).toEqual([
    "vips/0008-using-denied.md:7 the Effect TS counterpart drops `using f = …`, so it does not acquire or dispose what the source does"
  ])
})

test("collision-conditional rejects round 6 ASTRA-5's unconditional VIP-39 collision (row 39)", () => {
  const original = "`App.vibe` beside `App.vibex`, or `App.tsx` beside `App.vibex`, write the same output and get TypeScript's TS5055/TS5056, as `App.ts` beside `App.tsx` does."
  const defect = withEdit("vips/0039-vibex.md", text => text.replace(/`App\.vibe` beside `App\.vibex`, or `App\.tsx` beside `App\.vibex`, get[^\n]*/, original))
  expect(lint(defect, rule("collision-conditional")).map(v => `${v.file} ${v.message}`)).toEqual([
    "vips/0039-vibex.md a same-stem pair gets `TS5055`/`TS5056` only where the selected inputs write the same output path; the sentence does not say so"
  ])
})

test("ruling-claims rejects round 9 OPUS-2's VIP-25 rationale without its amendment (row 50)", () => {
  const defect = withEdit("vips/0025-inline-modules-denied.md", text => text.replace(/\n\*Amended 2026-11-02[^]*?(?=\n\n|$)/, ""))
  expect(lint(defect, rule("ruling-claims")).map(v => `${v.file} ${v.message}`)).toEqual([
    expect.stringMatching(/^vips\/0025-inline-modules-denied\.md the denial's reason .* contradicts Will's 2026-10-31 ruling/)
  ])
})

test("historical resolution fixtures preserve changed live tables without mutating their inputs", () => {
  fc.assert(fc.property(
    fc.uniqueArray(fc.constantFrom("App.vibe", "App.vibex", "App.ts", "App.tsx", "App.d.ts"), { minLength: 1 }),
    targets => {
      const row = "| `./App.vibe` | " + targets.map(name => "`" + name + "`").join(", ") + " |"
      const current: Spec = new Map([...loadSpec()].map(([file, text]) => [file,
        file === "src/007-tooling.md" || file === "vips/0039-vibex.md"
          ? text.replace(/^\| `\.\/App\.vibe` \|[^\n]*$/m, row) : text]))
      const snapshot = [...current]
      const fixture = legacyStyleFixtures(current)
      for (const file of ["src/007-tooling.md", "vips/0039-vibex.md"]) {
        expect(current.get(file)).toContain(row)
        expect(fixture.get(file)).toContain("| `./App.vibe` | `App.vibe`, `App.d.ts` |")
      }
      expect([...current]).toEqual(snapshot)
    }
  ), { seed: 3927, numRuns: 100 })
})

// Historical defects are explicit fixtures, not wording the current spec must keep.
// Keep the real-spec check above on loadSpec(); only mutation inputs use this view.
function legacyStyleFixtures(current: Spec): Spec {
  const fixture: Spec = new Map([...current].map(([file, text]) =>
    [file, text.replaceAll("declarationImportStyle", "retiredStyle").replaceAll("It decides how a package declaration in the output directory spells a relative import", "Historical package spelling").replaceAll("A relative `./x.vibex`", "Historical relative source")]))
  // The round-14 drift mutation uses its historical resolution row.
  // Keep that witness explicit while the real-spec check reads today's table.
  for (const file of ["src/007-tooling.md", "vips/0039-vibex.md"]) {
    fixture.set(file, fixture.get(file)!.replace(/^\| `\.\/App\.vibe` \|[^\n]*$/m,
      "| `./App.vibe` | `App.vibe`, `App.d.ts` |"))
  }
  fixture.set("src/001-functions.md", fixture.get("src/001-functions.md")! + '\n\nA package whose sources spell relative imports another way uses `vibelang.declarationImportStyle`; source-adjacent sidecars keep `./x.vibex`, and `".js"` is the default. Under every setting the TypeScript declaration contract stays the same.\n')
  fixture.set("src/007-tooling.md", fixture.get("src/007-tooling.md")! + '\n\nRoot `vibelang.declarationImportStyle` selects package spelling; source-adjacent sidecars keep their spelling. It decides how a package declaration in the output directory spells a relative import of a `.vibe` or `.vibex` module. A relative `./x.vibex` keeps its spelling. It sits in the legacy section.\n\nincluding `./helper.ts` ([VIP-27](../vips/0027-declaration-output.md#decision), amended).\n')
  fixture.set("vips/0027-declaration-output.md", fixture.get("vips/0027-declaration-output.md")!.replace(/\n- \*\*Amended 2026-11-02: declaration import spelling\.\*\*[^\n]*\n/g, "\n") + '\n- **Amended 2026-11-02: declaration import spelling.** `vibelang.declarationImportStyle` controls package output; sidecars keep source spelling.\n')
  fixture.set("vips/0030-config-files.md", fixture.get("vips/0030-config-files.md")! + '\n\n`vibelang.declarationImportStyle` controls package output; sidecars keep source spelling.\n')
  return fixture
}

test("compiler-gaps-not-rules rejects round 15 OPUS-1's EK0204 row in the normative table", () => {
  const row = "| `EK0204` | current compiler implementation limitation: an outward source completion cannot yet cross a generated function boundary in this position; this is not a TC39 early error | 2 | [Running Effects](002-running.md#do-expressions) |\n"
  const defect = withEdit("src/900-appendices.md", text => text.replace(/^\| `EK0205` \|/m, row + "| `EK0205` |"))
  expect(lint(defect, rule("compiler-gaps-not-rules")).map(v => v.message)).toEqual([
    "EK0204 describes a compiler gap, not a language rule: list it under Transitional compiler diagnostics"
  ])
  expect(lintKind(defect, "tables")).toEqual(lint(defect, rule("compiler-gaps-not-rules")))
})

// Appendix B separates language rules from transitional compiler limitations.
test("compiler-gaps-not-rules checks gap wording only in the normative table", () => {
  fc.assert(fc.property(
    fc.integer({ min: 1000, max: 9999 }),
    fc.constantFrom("compiler limitation", "compiler implementation limitation", "implementation limitation", "compiler gap", "cannot yet", "not a TC39 early error"),
    fc.boolean(),
    (number, wording, uppercase) => {
      const code = `EK${number}`
      const row = `| \`${code}\` | ${uppercase ? wording.toUpperCase() : wording} | 2 | chapter |\n`
      const normative: Spec = new Map([["src/900-appendices.md", "## Appendix B\n" + row + "### Transitional compiler diagnostics\n"]])
      expect(lint(normative, rule("compiler-gaps-not-rules")).map(v => v.message)).toEqual([
        `${code} describes a compiler gap, not a language rule: list it under Transitional compiler diagnostics`
      ])
      const transitional: Spec = new Map([["src/900-appendices.md", "## Appendix B\n### Transitional compiler diagnostics\n" + row]])
      expect(lint(transitional, rule("compiler-gaps-not-rules"))).toEqual([])
    }
  ), { numRuns: 100, seed: 1501 })
})

test("fallback-row rejects round 18 OPUS-2's positional fallback over a declaration row", () => {
  const defect = withEdit("src/005-services.md", text => text.replace(/The general member row, the `EK0902` row beginning "any member", applies only when no other row applies\./, "The last row applies only when no other row applies."))
  expect(lint(defect, rule("fallback-row")).map(v => v.file)).toEqual(["src/005-services.md"])
})

test("fallback-row accepts a table that does end in its fallback", () => {
  const text = "The last row applies only when no other row applies.\n\n| Rule | Code |\n| --- | --- |\n| a static member | EK1 |\n| any other member | EK2 |\n"
  expect(lint(new Map([["src/x.md", text]]), rule("fallback-row"))).toEqual([])
})

test("plain-unknown-call rejects round 18 OPUS-1's untagged call as known to throw", () => {
  const defect = withEdit("src/003-failures.md", text => text.replace(/A call whose throwing is unknown, such as an unannotated `\.ts` function, stays an ordinary call[^.]*\./, "It has no tag on a foreign declaration (so throws `unknown`)."))
  expect(lint(defect, rule("plain-unknown-call")).map(v => v.rule)).toEqual(["plain-unknown-call"])
})


const extractionFixture = (source: string, language = "ts"): Spec => new Map([
  ["vips/0040-module-declarations.md", "```" + language + "\n// module-extraction-twin\n" + source + "\n```\n"]
])

test("module-extraction-twins rejects the unchanged R29 ASTRA-1 body", () => {
  const body = "const privateBodyValue = 7"
  const result = lint(extractionFixture(body), rule("module-extraction-twins"))
  expect(result).toEqual([{
    rule: "module-extraction-twins", file: "vips/0040-module-declarations.md", line: 2,
    message: expect.stringContaining("the extracted module twin is a script")
  }])
  expect(lint(extractionFixture(body + "\nexport {}"), rule("module-extraction-twins"))).toEqual([])
})

test("module-extraction-twins checks script neighbors and native module indicators", () => {
  fc.assert(fc.property(
    fc.integer({ min: -100000, max: 100000 }),
    fc.constantFrom("ts", "tsx"),
    fc.constantFrom(
      "const privateBodyValue = VALUE",
      "interface PrivateShape { value: VALUE }",
      "type PrivateShape = VALUE",
      "async function initialize() { return VALUE }",
      "await Promise.resolve(VALUE)",
      "// export {} is only a comment\nconst privateBodyValue = VALUE",
      'const text = "export {}"; const privateBodyValue = VALUE'
    ),
    fc.constantFrom("export {}", "export const publicValue = 1", 'import "./dependency.js"', 'import type { Shape } from "./shape.js"', 'export type Shape = number'),
    (value, language, template, marker) => {
      const body = template.replaceAll("VALUE", String(value))
      expect(lint(extractionFixture(body, language), rule("module-extraction-twins"))).toHaveLength(1)
      expect(lint(extractionFixture(body + "\n" + marker, language), rule("module-extraction-twins"))).toEqual([])
    }
  ), { numRuns: 200, seed: 29001 })
})

test("module-extraction-twins ignores unannotated illustrative scripts and ordinary comments", () => {
  const fixture = new Map([["src/001-functions.md", "```ts\nconst value = 7\n```\n"]])
  expect(lint(fixture, rule("module-extraction-twins"))).toEqual([])
})


test("module-extraction-twins rejects the R29 ASTRA-2 JSX body written as .ts", () => {
  const source = "export const element = <div />"
  expect(lint(extractionFixture(source, "ts"), rule("module-extraction-twins"))).toEqual([{
    rule: "module-extraction-twins", file: "vips/0040-module-declarations.md", line: 2,
    message: expect.stringContaining("TS1005")
  }])
  expect(lint(extractionFixture(source, "tsx"), rule("module-extraction-twins"))).toEqual([])
})

test("module-extraction-twins checks JSX source-kind neighbors without banning TS syntax", () => {
  fc.assert(fc.property(
    fc.constantFrom("div", "section", "Widget", "custom-element", "svg:path"),
    fc.constantFrom("", " ", "\n"),
    fc.boolean(),
    (tag, space, paired) => {
      const element = paired ? "<" + tag + ">text</" + tag + ">" : "<" + tag + space + "/>"
      const source = "export const element = " + element
      expect(lint(extractionFixture(source, "tsx"), rule("module-extraction-twins"))).toEqual([])
      expect(lint(extractionFixture(source, "ts"), rule("module-extraction-twins")).some(v => v.message.includes("does not parse"))).toBe(true)
    }
  ), { numRuns: 200, seed: 29002 })
  const genericArrow = "export const identity = <T>(value: T) => value"
  expect(lint(extractionFixture(genericArrow, "ts"), rule("module-extraction-twins"))).toEqual([])
  expect(lint(extractionFixture(genericArrow, "tsx"), rule("module-extraction-twins")).some(v => v.message.includes("does not parse"))).toBe(true)
  expect(lint(extractionFixture('export const text = "<div />"', "ts"), rule("module-extraction-twins"))).toEqual([])
})

test("module-projection-kind rejects the original all-ts mapper instruction", () => {
  const original = "- **TypeScript mapper.** The one-file projector for stock TypeScript tools refuses bodies today (`EK9100`). It projects each body as its own virtual `.ts` file."
  const fixture: Spec = new Map([["vips/0040-module-declarations.md", original]])
  expect(lint(fixture, rule("module-projection-kind")).map(v => v.message)).toEqual([
    "the TypeScript mapper must preserve both source kinds: .ts for .vibe and .tsx for .vibex (VIP-39/40)"
  ])
})

test("module-projection-kind checks the mapper independently of the correct extraction rule", () => {
  const fixture: Spec = new Map([["vips/0040-module-declarations.md",
    "The extracted twin uses `.ts` for `.vibe` and `.tsx` for `.vibex`.\n\n" +
    "- **TypeScript mapper.** It projects each body as its own virtual `.ts` file."]])
  expect(lint(fixture, rule("module-projection-kind"))).toHaveLength(1)
})

test("module-projection-kind rejects missing variants across layouts and ignores fenced examples", () => {
  fc.assert(fc.property(
    fc.constantFrom(" ", "\n", "  "),
    fc.constantFrom("`.ts`", "`.vibe`", "`.tsx`", "`.vibex`"),
    fc.boolean(),
    (gap, missing, exampleFirst) => {
      const instruction = "- **TypeScript mapper.** It projects each body as a virtual `.ts` file for `.vibe` or `.tsx` for `.vibex`."
      const fenced = "\n\n```md\n" + instruction.replace(missing, "`missing`") + "\n```\n\n"
      const valid = instruction.replaceAll(" ", gap)
      const wrap = (body: string) => exampleFirst ? fenced + body : body + fenced
      const fixture: Spec = new Map([["vips/0040-module-declarations.md", wrap(valid)]])
      expect(lint(fixture, rule("module-projection-kind"))).toEqual([])
      fixture.set("vips/0040-module-declarations.md", wrap(valid.replace(missing, "`missing`")))
      expect(lint(fixture, rule("module-projection-kind"))).toHaveLength(1)
    }
  ), { seed: 4023, numRuns: 200 })
})

test("the spec-copies gate includes module projection source kinds", () => {
  const fixture: Spec = new Map([["vips/0040-module-declarations.md",
    "- **TypeScript mapper.** It projects each body as its own virtual `.ts` file."]])
  expect(lintKind(fixture, "copies").some(v => v.rule === "module-projection-kind")).toBe(true)
})

test("native TypeScript preserves JSX in virtual tsx files and rejects it in ts files", () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 1000000 }), n => {
    const text = "export const view" + n + " = <widget" + n + " data-index={" + n + "} />"
    const parse = (name: string) => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true) as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }
    expect(parse("body.ts").parseDiagnostics.length).toBeGreaterThan(0)
    expect(parse("body.tsx").parseDiagnostics).toEqual([])
    expect(parse("body.tsx").languageVariant).toBe(ts.LanguageVariant.JSX)
  }), { seed: 3940, numRuns: 200 })
})

// Native TypeScript source-kind probes above establish the parser distinction.
// They do not establish module-body projection through the Vibe mapper, which
// the VIP still records as an EK9100 refusal. Keep that integration obligation
// explicit until the mapper exposes separate virtual body files.
test.todo("rule-evidence: docs/design/vips/0040-module-declarations.md#tooling | project module bodies from .vibe and .vibex through stock TypeScript with and without JSX | present | It projects each body as its own virtual `.ts` file for a body in `.vibe`, or `.tsx` for one in `.vibex`, retaining the body’s source language variant even when it contains no JSX ([VIP-39](0039-vibex.md#decision)).")

test("spec-links rejects round 16's VIP-25 link and removed heading", () => {
  const badFile = withEdit("src/900-appendices.md", text => text.replace("../vips/0025-inline-modules-denied.md", "../vips/0025-inline-modules-denied, superseded by VIP-40.md"))
  expect(lint(badFile, rule("spec-links")).map(v => v.message)).toEqual([expect.stringContaining("which is no file")])
  const badAnchor = withEdit("src/004-match.md", text => text + "\n[Thrown](003-failures.md#thrown-type-by-kind-of-callable)\n")
  expect(lint(badAnchor, rule("spec-links")).map(v => v.message)).toEqual([expect.stringContaining("no heading or anchor")])
})

test("gap-marker-authority rejects round 17 OPUS-6's marker on denied VIP-8", () => {
  const defect = withEdit("src/008-runtime.md", text => text + "\n```vibe es\n// compiler-gap: pending VIP-8\nconst a = 1\n```\n")
  expect(lint(defect, rule("gap-marker-authority")).map(v => v.message)).toEqual([
    "a compiler-gap marker names VIP-8, which is not accepted"
  ])
})

test("statement-continuation rejects round 17 OPUS-3's assertion line after an arrow body", () => {
  const defect = withEdit("src/002-running.md", text => text + "\n```vibe es\nconst f = () => 7 // one statement?\n<T>g\n```\n")
  expect(lint(defect, rule("statement-continuation")).map(v => v.message)).toEqual([
    expect.stringMatching(/^this line continues the one before it/)
  ])
})

test("diagnostic-priority rejects an appended priority row across code values", () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 8000 }), n => {
    const text = [
      "| Rule | Diagnostic |", "| --- | --- |",
      "| a constructor | EK1301 |", "| any other member | EK1304 |",
      "| an ambient declaration comes ahead of other diagnostics | EK" + (1307 + n) + " |",
      "", "The last row applies only when no other row applies."
    ].join("\n")
    expect(lint(new Map([["src/test.md", text]]), rule("diagnostic-priority"))).toHaveLength(1)
    const corrected = text.replace("The last row", "The general member rule, EK1304,")
    expect(lint(new Map([["src/test.md", corrected]]), rule("diagnostic-priority"))).toEqual([])
  }), { numRuns: 100, seed: 17 })
})
test("diagnostic-priority accepts a genuinely last fallback", () => {
  const text = "| Rule | Diagnostic |\n| --- | --- |\n| comes ahead of other diagnostics | EK1307 |\n| any other member | EK1304 |\n\nThe last row applies only when no other row applies."
  expect(lint(new Map([["src/test.md", text]]), rule("diagnostic-priority"))).toEqual([])
})

test("declaration-bytes rejects byte comparisons of declarations and keeps TS5055 input protection", () => {
  for (const claim of [
    "It refuses unsupported outward jumps, observed `do` completion and any rewrite whose emitted declaration bytes differ.",
    "Opaque, duplicate or cyclic graphs, spreads and rewrites that change declaration bytes require manual migration.",
    "In every scope, `--fix` keeps an import so the declaration stays the same bytes: an import goes only where the module's declaration is the same bytes without it."
  ]) {
    const defect = withEdit("src/007-tooling.md", text => text + "\n\n" + claim + "\n")
    expect(lint(defect, rule("declaration-bytes")).length).toBeGreaterThan(0)
  }
  const protectedInput = withEdit("vips/0027-declaration-output.md", text => text + "\n\nExplicit `files` inputs retain native `TS5055` protection: exit `1` and unchanged declaration bytes.\n")
  expect(lint(protectedInput, rule("declaration-bytes"))).toEqual([])
})

test("chapter-codes rejects round 20 OPUS-5's transitional EK1023 without its row", () => {
  const defect = withEdit("src/900-appendices.md", text => text.replace(/^\| `EK1023` \|.*\n/m, ""))
  expect(lint(defect, rule("chapter-codes")).map(v => `${v.file} ${v.message}`)).toEqual([
    "src/007-tooling.md EK1023 has no Appendix B row and no retirement note",
  ])
})

test("chapter-codes accepts a code Appendix B states retired and rejects an unknown one", () => {
  const retired = withEdit("src/002-running.md", text => text.replace("## `try`\n", "## `try`\n\nThe old `EK4843` warning is gone.\n"))
  expect(lint(retired, rule("chapter-codes"))).toEqual([])
  const unknown = withEdit("src/002-running.md", text => text.replace("## `try`\n", "## `try`\n\nThe old `EK2007` warning is gone.\n"))
  expect(lint(unknown, rule("chapter-codes")).map(v => v.message)).toEqual(["EK2007 has no Appendix B row and no retirement note"])
})

test("chapter-codes preserves generator repair ordering without an unassigned code", () => {
  const current = loadSpec()
  expect(lint(current, rule("chapter-codes"))).toEqual([])
  const row = current.get("src/007-tooling.md")!.split("\n").find(line => line.startsWith("| `EK4839` |"))!
  expect(row).toContain("is reported after that generator is rewritten by `vibelang --fix`")
  expect(row).toContain("`Effect.gen`")
  expect(row).toContain("`Effect.fn`")
})

test("chapter-codes rejects unassigned migration advice across the diagnostic range", () => {
  const current = loadSpec()
  const appendix = current.get("src/900-appendices.md")!
  fc.assert(fc.property(fc.integer({ min: 1000, max: 9999 }).filter(n => !appendix.includes("EK" + n)), n => {
    const code = "EK" + n
    const bad = new Map(current)
    bad.set("src/007-tooling.md", bad.get("src/007-tooling.md")! + "\nRun `" + code + "`'s generator repair first.\n")
    expect(lint(bad, rule("chapter-codes")).map(v => v.message)).toEqual([code + " has no Appendix B row and no retirement note"])
    const corrected = new Map(current)
    corrected.set("src/007-tooling.md", corrected.get("src/007-tooling.md")! + "\nRun `vibelang --fix`'s preserving generator repair first.\n")
    expect(lint(corrected, rule("chapter-codes"))).toEqual([])
  }), { numRuns: 200, seed: 20261104 })
})

test("VIP references reject a historical broken supersession link", () => {
  const defect: Spec = new Map([
    ["src/900-appendices.md", "## Denied\n| [25](../vips/0025-inline-modules-denied, superseded by VIP-40.md) | denied |"],
    ["vips/0025-inline-modules-denied.md", "**Superseded by [VIP-40](0040-module-declarations.md).**"],
    ["vips/0040-module-declarations.md", "Accepted."]
  ])
  expect(lint(defect, rule("vip-references")).map(v => v.line)).toEqual([2])
})

test("VIP references reject a historical stale denied index and accept historical prose", () => {
  const source = "**Superseded by [VIP-40](0040-module-declarations.md).**"
  const defect: Spec = new Map([
    ["vips/README.md", "## Denied\n| [25](0025-inline-modules-denied.md) | denied |"],
    ["vips/0025-inline-modules-denied.md", source],
    ["vips/0040-module-declarations.md", "Accepted."]
  ])
  expect(lint(defect, rule("vip-references"))).toHaveLength(1)
  defect.set("vips/README.md", "## Denied\n[VIP-25](0025-inline-modules-denied.md) is superseded by [VIP-40](0040-module-declarations.md).")
  expect(lint(defect, rule("vip-references"))).toEqual([])
})

test("VIP reference properties cover paths, anchors, missing targets and status transitions", () => {
  // Authority: VIP index requires later VIPs to update superseded predecessors.
  fc.assert(fc.property(fc.integer({ min: 1, max: 9998 }), fc.boolean(), fc.boolean(), (id, anchor, fromChapter) => {
    const name = `${String(id).padStart(4, "0")}-proposal-denied.md`
    const next = `${String(id + 1).padStart(4, "0")}-successor.md`
    const file = fromChapter ? "src/900-appendices.md" : "vips/README.md"
    const prefix = fromChapter ? "../vips/" : ""
    const row = `| [${id}](${prefix}${name}${anchor ? "#decision" : ""}) | denied |`
    const fixture: Spec = new Map([
      [file, `## Denied\n${row}`], [`vips/${name}`, "Denied."], [`vips/${next}`, "Accepted."]
    ])
    expect(lint(fixture, rule("vip-references"))).toEqual([])
    fixture.set(`vips/${name}`, `Superseded by [VIP-${id + 1}](${next}).`)
    expect(lint(fixture, rule("vip-references"))).toHaveLength(1)
    fixture.set(file, `## Historical decisions\n${row}`)
    expect(lint(fixture, rule("vip-references"))).toEqual([])
    fixture.delete(`vips/${name}`)
    expect(lint(fixture, rule("vip-references"))).toHaveLength(1)
    fixture.set(file, `## Examples\n\`\`\`md\n${row}\n\`\`\`\n[external](https://example.com/vips/${name})`)
    expect(lint(fixture, rule("vip-references"))).toEqual([])
  }), { seed: 16001, numRuns: 200 })
})

test("superseded denial cannot still remove the successor's accepted module form", () => {
  const fixture: Spec = new Map([
    ["src/005-services.md", "VIP-25 removed inline modules."],
    ["vips/0025-inline-modules-denied.md", "Superseded by [VIP-40](0040-module-declarations.md)."],
    ["vips/0040-module-declarations.md", "Accepted."]
  ])
  expect(lint(fixture, rule("vip-references"))).toHaveLength(1)
  fixture.set("src/005-services.md", "[VIP-25](../vips/0025-inline-modules-denied.md) removed inline modules.")
  expect(lint(fixture, rule("vip-references"))).toHaveLength(1)
})



test("whole-shape service regression rejects a historical grammar and exclusive claims", () => {
  const fixture: Spec = new Map([
    ["src/005-services.md", "`service Name { members }` is the only way to declare a service.\n`service Name: Type { … }` supplies the exact whole Shape."],
    ["src/900-appendices.md", 'ServiceDeclaration = ServiceStart TypeParameters? ClassHeritage? "{" (ServiceMember Separator)* "}"'],
    ["vips/0009-service-declarations.md", "`service Name { members }` is the only way to declare a service."]
  ])
  expect(lint(fixture, rule("service-shape-grammar"))).toHaveLength(3)
  fixture.set("src/900-appendices.md", 'ServiceDeclaration = ServiceStart TypeParameters? ":" Type "{" (ServiceMember Separator)* "}"')
  fixture.set("src/005-services.md", "`service Name: Type { … }` supplies the exact whole Shape.")
  fixture.set("vips/0009-service-declarations.md", "Both body-only and whole-shape services are admitted.")
  expect(lint(fixture, rule("service-shape-grammar"))).toEqual([])
})

test("whole-shape service grammar property covers names and grammar layout", () => {
  // Whole-shape service admission does not depend on its identifier.
  fc.assert(fc.property(fc.constantFrom("Port", "Store", "S", "Node42"), fc.constantFrom(" ", "\n", "  "), (name, ws) => {
    const fixture: Spec = new Map([
      ["src/005-services.md", `\`service ${name}: Shape { … }\` supplies the exact whole Shape.`],
      ["src/900-appendices.md", ["ServiceDeclaration =", "ServiceStart", "TypeParameters?", '":"', "Type", '"{"'].join(ws)]
    ])
    expect(lint(fixture, rule("service-shape-grammar"))).toEqual([])
    fixture.set("src/900-appendices.md", fixture.get("src/900-appendices.md")!.replace('":"', '""'))
    expect(lint(fixture, rule("service-shape-grammar"))).toHaveLength(1)
  }), { seed: 16002, numRuns: 100 })
})



test("schema alias documentation rejects a historical declaration contradiction", () => {
  const fixture: Spec = new Map([
    ["src/006-data.md", "One written, nongeneric `type X = typeof X.Type` replaces the synthesized alias.\nA schema's declaration has a comment; its `typeof Name.Type` alias has no comment.\nTo retain distinct documentation on a constant and its type alias, keep the ordinary TypeScript pair."],
    ["vips/0027-declaration-output.md", "A separate type-comment form is not introduced."]
  ])
  expect(lint(fixture, rule("written-schema-docs"))).toHaveLength(3)
  fixture.set("src/006-data.md", "One written, nongeneric alias replaces the synthesized alias.\nIts synthesized alias is bare; a written alias keeps its own JSDoc.")
  fixture.set("vips/0027-declaration-output.md", "Written aliases keep their own JSDoc.")
  expect(lint(fixture, rule("written-schema-docs"))).toEqual([])
})

test("schema documentation property covers every owning document and alias names", () => {
  // Written declarations keep their own JSDoc, order and export status.
  fc.assert(fc.property(fc.constantFrom("src/006-data.md", "vips/0015-schema-declarations.md", "vips/0027-declaration-output.md"), fc.constantFrom("X", "Message", "S42"), (file, name) => {
    const fixture: Spec = new Map([["src/006-data.md", "A written alias replaces the synthesized alias."]])
    fixture.set(file, (fixture.get(file) ?? "") + `\nits \`typeof ${name}.Type\` alias has no comment.`)
    expect(lint(fixture, rule("written-schema-docs"))).toHaveLength(1)
    fixture.set(file, fixture.get(file)!.replace("its `typeof", "its synthesized `typeof"))
    expect(lint(fixture, rule("written-schema-docs"))).toEqual([])
  }), { seed: 16003, numRuns: 100 })
})


const oneExternalRule = "A callable declared outside VibeLang, in an npm package, carries a thrown type by one rule."

test("npm contracts reject a historical implicit inventory and retain explicit/global contracts", () => {
  const fixture: Spec = new Map([
    ["src/003-failures.md", oneExternalRule + "\nEffect and TypeScript's lib declare no tags, so the compiler ships them."],
    ["src/900-appendices.md", "VibeLang ships them for JavaScript's globals and for Effect's non-effectful exports.\nEvery remaining global and effect 4.1.0 non-Effect export is annotated by a generator."]
  ])
  expect(lint(fixture, rule("npm-signature-contracts"))).toHaveLength(3)
  fixture.set("src/003-failures.md", oneExternalRule + "\nAn npm signature needs its own annotation; compiler inventories grant no implicit contract.")
  fixture.set("src/900-appendices.md", "VibeLang supplies intrinsic global and explicit wrapper-thunk contracts. A written library annotation is respected.")
  expect(lint(fixture, rule("npm-signature-contracts"))).toEqual([])
})

test("npm inventory property covers pinned versions, placement and literal examples", () => {
  // External npm signatures follow the same rule as local TypeScript signatures.
  fc.assert(fc.property(fc.integer({ min: 0, max: 99 }), fc.integer({ min: 0, max: 99 }), fc.constantFrom("src/003-failures.md", "src/900-appendices.md"), (minor, patch, file) => {
    const fixture: Spec = new Map([["src/003-failures.md", oneExternalRule]])
    const bad = `Every remaining global and effect 4.${minor}.${patch} non-Effect export is annotated by a generator.`
    fixture.set(file, (fixture.get(file) ?? "") + "\n" + bad)
    expect(lint(fixture, rule("npm-signature-contracts"))).toHaveLength(1)
    fixture.set(file, (file === "src/003-failures.md" ? oneExternalRule : "") + "\n```text\n" + bad + "\n```")
    expect(lint(fixture, rule("npm-signature-contracts"))).toEqual([])
  }), { seed: 16004, numRuns: 100 })
})

test("new specification guards run through their categorized gate targets", () => {
  const fixtures: Array<[string, string, Spec]> = [
    ["authority", "vip-references", new Map([["vips/README.md", "[missing](0099-missing.md)"]])],
    ["tables", "service-shape-grammar", new Map([["src/005-services.md", "`service Port: Shape { … }` supplies the exact whole Shape."]])],
    ["copies", "written-schema-docs", new Map([["src/006-data.md", "A written alias replaces the synthesized alias.\nits `typeof X.Type` alias has no comment."]])],
    ["authority", "npm-signature-contracts", new Map([["src/003-failures.md", oneExternalRule + "\nEvery remaining global and effect 4.1.1 non-Effect export is annotated by a generator."]])]
  ]
  for (const [kind, expected, fixture] of fixtures) {
    expect(lintKind(fixture, kind).map(v => v.rule)).toContain(expected)
  }
})
