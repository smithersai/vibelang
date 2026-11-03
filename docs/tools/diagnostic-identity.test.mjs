import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import fc from "fast-check"
import { appendixCodes, auditIdentity, compilerCodes, repository } from "./diagnostic-identity.mjs"

const source = text => [{ path: "typescript/tsc/internal/vibelang/diagnostics.go", text }]
const appendix = rows => "## Appendix B. Diagnostics\n\n| Code | Rule | VIP | Chapter |\n| --- | --- | --- | --- |\n" + rows + "\n## Appendix C. Decisions\n| `EK9999` | outside B |\n"
const row = code => "| `" + code + "` | warning: a failure | 34 | Tooling |"
const past = JSON.parse(readFileSync(new URL("./property-regressions/gate6-ek4804.json", import.meta.url), "utf8"))

test("release gate 6: EK4804 is documented in devtools but has no Appendix B row", () => {
  const registered = compilerCodes(source(past.source + '\nvar EK4802 = message(4802, warningCategory, "nested Effect")'))
  const missing = auditIdentity(registered, appendixCodes(past.before), [{ path: past.path, text: past.citation }])
  assert.deepEqual(missing.map(f => [f.kind, f.code]), [["registered-missing", "EK4804"]])
  assert.deepEqual(auditIdentity(registered, appendixCodes(past.after), [{ path: past.path, text: past.citation }]), [])
})

test("rows must define codes; mentions, ranges and other appendices do not count", () => {
  const doc = appendix(row("EK0101") + "\nThe range `EK4801`–`EK4825` and `EK4804` are mentioned.")
  assert.deepEqual([...appendixCodes(doc).keys()], ["EK0101"])
  assert.deepEqual([...appendixCodes(appendix("| interim `EK9201` | error: contract | 1 | Replacement |")).keys()], ["EK9201"])
  assert.throws(() => appendixCodes(appendix(row("EK0101") + "\n" + row("EK0101"))), /Duplicate/)
  assert.throws(() => appendixCodes("## Appendix C. Diagnostics"), /Missing Appendix B/)
})

test("registered, unregistered and unknown cited identities fail independently", () => {
  const findings = auditIdentity(compilerCodes(source(past.source)), appendixCodes(appendix(row("EK9998"))),
    [{ path: "guide.md", text: "Use `EK9999`." }])
  assert.deepEqual(findings.map(f => [f.kind, f.code]), [
    ["appendix-unregistered", "EK9998"], ["cited-unknown", "EK9999"], ["registered-missing", "EK4804"]
  ])
  assert.equal(findings.find(f => f.kind === "cited-unknown").line, 1)
})

test("disabled messages, qualified severity aliases and named parser codes count", () => {
  const registered = compilerCodes([
    ...source('var EK4406 = message(4406, legacyTrustCategory, "old tags"); var EK9101 = message(9101, diagnostics.CategorySuggestion, "{0}"); var EK4811 = messageOff(4811, "channel"); var EK0109 = message(parser.EffectArrowHeadDiagnosticCode, errorCategory, parser.Text)'),
    { path: "typescript/tsc/internal/parser/vibelang_effect.go", text: "const EffectArrowHeadDiagnosticCode int32 = 109" }
  ])
  assert.deepEqual([...registered.keys()].sort(), ["EK0109", "EK4406", "EK4811", "EK9101"])
  assert.throws(() => compilerCodes(source("var EK1234 = message(unknown.Code, errorCategory, text)")), /unresolved/)
})

test("compiler registries include reserved VIP codes and whole imported lint ordinals", () => {
  const registered = compilerCodes([{ path: "core/registry.go", text:
    'var VibeDiagnosticCategories = map[string]string{"EK1501": "error"}; var VibeImportedLintCodes = map[string]string{"EK3810":"a","EK38100":"b"}' }])
  assert.deepEqual([...registered.keys()].sort(), ["EK1501", "EK3810", "EK38100"])
  const findings = auditIdentity(registered, appendixCodes(appendix(row("EK1501") + "\n" + row("EK3810"))), [])
  assert.deepEqual(findings.map(f => f.code), ["EK38100"])
})

test("only compiler constructor calls register identities after the registry extraction", () => {
  const registered = compilerCodes(source('var EK0103 = registryMessage("EK0103", "primary"); var other = registryVariant("EK0103", "variant")'))
  assert.deepEqual([...registered.keys()], ["EK0103"])
  assert.equal(registered.get("EK0103").length, 2)
})

test("non-diagnostic functions, comments and strings cannot invent registrations", () => {
  const registered = compilerCodes([
    ...source('// message(9998, errorCategory, "comment")\n/* messageOff(9997, "comment") */\nvar EK4804 = message(4804, warningCategory, "message(9996, errorCategory, text)")\nfunc message(code int32, category Category, text string) *Message {}'),
    { path: "typescript/tsc/internal/vibelangfmt/plugin.go", text: "message(nil, text)" }
  ])
  assert.deepEqual([...registered.keys()], ["EK4804"])
})

test("an explicit retired-code declaration is historical; ordinary citations still fail", () => {
  const codes = compilerCodes(source(past.source))
  assert.deepEqual(auditIdentity(codes, new Map([["EK4804", "warning"]]), [
    { path: "docs/design/src/900-appendices.md", text: "The old `EK2101` is retired and will never be reassigned: a bodyless declaration." }
  ]), [])
  for (const text of ["Use `EK2101`.", "`EK2101` is retired, so use `EK9999`.", "The old `EK2101` is retired and will never be reassigned: a bodyless declaration.\nUse `EK2101`."]) {
    assert.ok(auditIdentity(codes, new Map([["EK4804", "warning"]]), [{ path: "guide.md", text }]).some(f => f.kind === "cited-unknown"))
  }
})

test("seeded mutations detect row loss, registry loss and unknown citations across whole codes", () => {
  fc.assert(fc.property(
    fc.uniqueArray(fc.integer({ min: 1, max: 999999 }), { minLength: 1, maxLength: 30 }),
    fc.nat(), fc.constantFrom("message", "messageOff", "registryMessage"),
    (ordinals, choice, constructor) => {
      const names = ordinals.map(n => "EK" + String(n).padStart(4, "0"))
      const definitions = ordinals.map((n, i) => constructor === "message" ? 'var d' + i + ' = message(' + n + ', warningCategory, "text")'
        : constructor === "messageOff" ? 'var d' + i + ' = messageOff(' + n + ', "text")'
        : 'var d' + i + ' = registryMessage("' + names[i] + '", "primary")').join("\n")
      const codes = compilerCodes(source(definitions))
      const full = appendixCodes(appendix(names.map(row).join("\n")))
      const documents = [{ path: "guide.md", text: names.map(n => "`" + n + "`").join(" ") }]
      assert.deepEqual(auditIdentity(codes, full, documents), [])
      const selected = names[choice % names.length]
      const withoutRow = new Map(full)
      withoutRow.delete(selected)
      assert.deepEqual(auditIdentity(codes, withoutRow, documents).map(f => [f.kind, f.code]), [["registered-missing", selected]])
      const withoutRegistration = new Map(codes)
      withoutRegistration.delete(selected)
      assert.deepEqual(auditIdentity(withoutRegistration, full, documents).map(f => [f.kind, f.code]), [
        ["appendix-unregistered", selected], ["cited-unknown", selected]
      ])
    }), { seed: 6004804, numRuns: 500 })
})

test("the current guide no longer cites the retired unused-main code", () => {
  const guide = readFileSync(process.env.DIAGNOSTIC_IDENTITY_GUIDE ?? new URL("../user/src/getting-started/012-devtools.md", import.meta.url), "utf8")
  assert.doesNotMatch(guide, /\bEK1016\b/)
  assert.match(guide, /retired unused-`main` warning/)
})

test("the lint target stays exclusive until fold-details folds and regenerates the inventory", () => {
  const pkg = readFileSync(new URL("../../PACKAGE.ts", import.meta.url), "utf8")
  assert.match(pkg, /"spec-diagnostic-identity": specDiagnosticIdentity/)
  assert.match(pkg, /const specDiagnosticIdentity[\s\S]*?exclusive: true/)
  const aggregate = pkg.slice(pkg.indexOf("const specLint ="), pkg.indexOf("const targets ="))
  assert.doesNotMatch(aggregate, /specDiagnosticIdentity[,\]]/)
  assert.ok(repository.endsWith("/"))
})

test("a mapper reporter remains registered without a native message declaration", () => {
  const past = JSON.parse(readFileSync(new URL("./property-regressions/gate6-mapper-ek2115.json", import.meta.url), "utf8"))
  const registered = compilerCodes([
    ...source('var EK4804 = message(4804, warningCategory, "failure")'),
    { path: past.path, text: past.source }
  ])
  assert.ok(registered.has("EK2115"), "the stock TypeScript mapper still reports this code")
  assert.deepEqual(auditIdentity(registered, new Map([["EK4804", "warning"]]), []).map(f => [f.kind, f.code]), [["registered-missing", "EK2115"]])
})

test("mapper code fields ignore strings, comments and nested diagnostic records", () => {
  const registered = compilerCodes([
    ...source('var EK4804 = message(4804, warningCategory, "failure")'),
    { path: "typescript/tsc/internal/vibelangmapper/project.go", text:
      'var d = Diagnostic{Start: start(node), Code: 2115, Message: "Diagnostic{Code:9999}", Nested: Other{Code:9998}}; // Diagnostic{Code:9997}' }
  ])
  assert.deepEqual([...registered.keys()].sort(), ["EK2115", "EK4804"])
})

test("mapper code constants register tool errors, but a generic forwarding parameter is not an assignment", () => {
  const registered = compilerCodes([
    ...source('var EK4804 = message(4804, warningCategory, "failure")'),
    { path: "typescript/tsc/internal/vibelangmapper/emit.go", text: 'const CodeExecSyntax = 9002; var d = Diagnostic{Code: CodeExecSyntax, Message: "syntax"}; func forward(code int32) { append(ds, Diagnostic{Code:code}) }' },
    { path: "unrelated/numbers.go", text: "var code = 1030" }
  ])
  assert.deepEqual([...registered.keys()].sort(), ["EK4804", "EK9002"])
})

test("mapper registration mutations preserve full codes and ignore forwarded parameters", () => {
  fc.assert(fc.property(
    fc.integer({ min: 9000, max: 999999 }), fc.constantFrom(" ", "\n", "\t"), fc.boolean(), fc.boolean(),
    (ordinal, space, named, commentOnly) => {
      const code = "EK" + ordinal
      const declaration = named ? "const" + space + "CodeProbe" + space + "=" + space + ordinal + "\n" : ""
      const record = "var d = Diagnostic{Start: start(node), Code: " + (named ? "CodeProbe" : ordinal) + ', Message: "probe"}'
      const body = declaration + record
      const sources = [
        ...source('var EK4804 = message(4804, warningCategory, "failure")'),
        { path: "typescript/tsc/internal/vibelangmapper/project.go", text: (commentOnly ? "/* " + body + " */" : body) + "\nfunc forward(code int32) { append(ds, Diagnostic{Code:code}) }" },
        { path: "unrelated/constants.go", text: "var code = 1030" }
      ]
      const registered = compilerCodes(sources)
      const expected = commentOnly ? ["EK4804"] : ["EK4804", code].sort()
      assert.deepEqual([...registered.keys()].sort(), expected)
      const findings = auditIdentity(registered, new Map([["EK4804", "warning"]]), [])
      assert.deepEqual(findings.map(f => [f.kind, f.code]), commentOnly ? [] : [["registered-missing", code]])
    }), { seed: 690019004, numRuns: 150 })
})

test("mapper constants are package-local and work for option errors without a naming convention", () => {
  const registered = compilerCodes([
    ...source('var EK4804 = message(4804, warningCategory, "failure")'),
    { path: "typescript/tsc/internal/vibelangmapper/codes.go", text: "const optionError int32 = 9003; const unused = 9999; const typedUnused int32 = 9998" },
    { path: "typescript/tsc/internal/vibelangmapper/server.go", text: 'var d = contentmapper.OptionDiagnosticResult{Code:optionError, MessageText:"invalid option"}' },
    { path: "unrelated/codes.go", text: "const optionError = 1030" }
  ])
  assert.deepEqual([...registered.keys()].sort(), ["EK4804", "EK9003"])
})
