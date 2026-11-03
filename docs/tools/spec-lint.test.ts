import { expect, test } from "bun:test"
import fc from "fast-check"
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
