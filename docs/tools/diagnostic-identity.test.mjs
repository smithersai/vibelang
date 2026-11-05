// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | Other VibeLang rows are errors; the imported table gives each lint rule’s explicit default.
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | A row whose rule starts "warning" or "lint warning" is a warning; a row starting "suggestion" is an editor suggestion; an interim row starting "off by default" is a disabled warning.
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | The old `EK3008` is retired and will never be reassigned: its static service-key rule uses `EK0901`.
// rule-evidence: docs/design/src/900-appendices.md#imported-lint-codes | The old lint warning `EK4843` is retired; its entry-point warning is retired and will never be reassigned.
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | The old module-declaration codes are retired by [VIP-40](../vips/0040-module-declarations.md#diagnostics); its current rules use `EK4001`–`EK4009`.
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | The old `EK0511` is retired and will never be reassigned: VIP-4 makes a `throw` in a plain `catch` handler the error `EK0401`.
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | The old `EK4407` is retired and will never be reassigned: module-name resolution now follows VIP-40.
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | The old `EK4408` is retired and will never be reassigned: VIP-40 owns `EK4001`–`EK4009`; and a duplicate module or a module/value collision is the error `EK4005`.
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | The old `EK4843` is retired and will never be reassigned: it was the entry-point warning.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import {createHash} from "node:crypto"
import {allocationPreservesChecker} from "./diagnostic-identity-allocation.mjs"
import fc from "fast-check"
import {identityHash} from "./diagnostic-identity-renames.mjs"
import {executableDigest,digest} from "./diagnostic-identity-authorization.mjs"
import { appendixCodes, auditIdentity, compilerCodes, compilerCategories, appendixCategory, auditCategories, repository } from "./diagnostic-identity.mjs"

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
  const findings = auditIdentity(registered, appendixCodes(appendix(row("EK1501") + "\n| `EK3810` | `effecttsgo/a` | 38 | Tooling | `error` |")), [])
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

test("the complete inventory and executable examples participate in the queue's ordinary spec graph", () => {
 const pkg=readFileSync(new URL("../../PACKAGE.ts",import.meta.url),"utf8")
 assert.match(pkg, /"spec-diagnostic-identity": specDiagnosticIdentity/)
 const target=pkg.slice(pkg.indexOf("const specDiagnosticIdentity"),pkg.indexOf("const specAppendixExamples"))
 assert.doesNotMatch(target,/exclusive: true/)
 const aggregate=pkg.slice(pkg.indexOf("const specLint ="),pkg.indexOf("const foreignCallExamples"))
 assert.match(aggregate,/data: \[[^\]]*specDiagnosticIdentity/)
 assert.match(aggregate,/data: \[[^\]]*specAppendixHostExamples/)
 assert.match(aggregate,/data: \[[^\]]*specAppendixExamples/)
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


test("a parser-only diagnostic cannot disappear with its native message declaration", () => {
  const codes = compilerCodes([{path: "typescript/tsc/internal/parser/vibelang_probe.go",
    text: "const ProbeDiagnosticCode int32 = 9876"}])
  assert.deepEqual([...codes.keys()], ["EK9876"])
  assert.deepEqual(auditIdentity(codes, new Map([["EK9875", "error"]]), []).map(f => [f.kind,f.code]),
    [["appendix-unregistered","EK9875"],["registered-missing","EK9876"]])
})

test("reservation categories cannot conceal a contrary native emitter or alias", () => {
  const sources = source('const transitional = warningCategory; var x = message(3201, transitional, "a different rule")')
  sources.push({path: "core/registry.go",text: 'var VibeDiagnosticCategories = map[string]string{"EK3201":"error"}'})
  const categories = compilerCategories(sources)
  const findings = auditCategories(categories, new Map([["EK3201", "an incompatible Effect version | 32 | Tooling |"]]))
  assert.deepEqual(findings.map(f=>[f.kind,f.code,f.expected,f.actual]), [["severity-mismatch","EK3201","error","warning"]])
})

test("categories distinguish disabled, editor suggestion, imported and ordinary warnings", () => {
  assert.equal(appendixCategory(" lint warning: advice | 34 | Tooling |"),"warning")
  assert.equal(appendixCategory(" suggestion: advice | 34 | Tooling |"),"suggestion")
  assert.equal(appendixCategory(' `effecttsgo/probe` | 38 | Tooling | `off` |'),"off")
  const sources = source('var x = messageOff(4811, "off"); var y = message(9101, diagnostics.CategorySuggestion, "editor")')
  const categories = compilerCategories(sources)
  assert.equal(categories.get("EK4811")[0].category,"off")
  assert.equal(categories.get("EK9101")[0].category,"suggestion")
  assert.deepEqual(auditCategories(categories,new Map([["EK4811","off: disabled"],["EK9101","suggestion: editor"]])),[])
})

test("an imported code with a different pinned rule meaning fails even when both code sets agree", () => {
  const registered = compilerCodes([{path:"core/lint.go",text:'var VibeImportedLintCodes = map[string]string{"EK3801":"floatingEffect"}'}])
  const wrong = new Map([["EK3801"," `effecttsgo/unnecessaryPipe` | 38 | Tooling | `error` |"]])
  assert.deepEqual(auditIdentity(registered,wrong,[]).map(f=>[f.kind,f.code]),[["meaning-mismatch","EK3801"]])
  assert.deepEqual(auditIdentity(registered,new Map([["EK3801"," `effecttsgo/floatingEffect` | 38 | Tooling | `error` |"]]),[]),[])
})

test("a historical citation needs a declared retirement and never hides a current use on the same line",()=>{
 const registered=compilerCodes(source('var x=message(4804,warningCategory,"failure")'))
 const documents=[
  {path:"docs/design/src/900-appendices.md",text:"The old `EK0511` is retired and will never be reassigned: a warning."},
  {path:"guide.md",text:"The old lint warning `EK0511` retires; use `EK0511`."}
 ]
 const findings=auditIdentity(registered,new Map([["EK4804","warning"]]),documents)
 assert.deepEqual(findings.map(f=>[f.kind,f.code,f.path]),[["cited-unknown","EK0511","guide.md"]])
})

test("the native editor category cannot hide a fatal diagnostic from the content mapper host",()=>{
 const sources=[
  ...source('var x = message(9100, warningCategory, "annotation choice")'),
  {path:"typescript/tsc/internal/vibelangmapper/choice.go",text:'var x=Diagnostic{Code:9100,Message:"annotation choice"}'}
 ]
 const findings=auditCategories(compilerCategories(sources),new Map([["EK9100","warning: annotation choice"]]))
 assert.deepEqual(findings.map(f=>[f.code,f.expected,f.actual,f.host]),[["EK9100","warning","error","content-mapper"]])
 const split=[sources[0],{...sources[1],text:sources[1].text.replace("Code:9100","Code:9005")}]
 assert.deepEqual(auditCategories(compilerCategories(split),new Map([["EK9100","warning: editor choice"],["EK9005","error: fatal projection"]])),[])
})

test("typed mapper helpers register actual call-site codes without registering their generic parameter",()=>{
 const registered=compilerCodes([
  ...source('var d=message(4804,warningCategory,"retained")'),
  {path:"typescript/tsc/internal/vibelangmapper/flow.go",text:`
    const JumpCode = 4605
    func (p *projector) flowDiagnostic(node *Node, code int32, text string) { append(ds, Diagnostic{Start:node.Start(), Code:code,Message:text}) }
    func flow() { p.flowDiagnostic(node, JumpCode, "break"); p.flowDiagnostic(node, 4606, "return") }
  `}
 ])
 assert.deepEqual([...registered.keys()].sort(),["EK4605","EK4606","EK4804"])
 assert.deepEqual(auditIdentity(registered,new Map([["EK4804","warning"]]),[]).map(f=>f.code),["EK4605","EK4606"])
})
test("a helper with nested call arguments retains the whole code and ignores strings/comments",()=>{
 const registered=compilerCodes([
  ...source('var d=message(4804,warningCategory,"retained")'),
  {path:"typescript/tsc/internal/vibelangmapper/flow.go",text:`
    func emit(node *Node, code int32, text string) { append(ds, Diagnostic{Code:code,Message:text}) }
    func flow() { emit(find(a,b), 12345, "emit(node,9999,text)"); /* emit(node,9998,text) */ }
  `}
 ])
 assert.deepEqual([...registered.keys()].sort(),["EK12345","EK4804"])
})
test("an explicit retirement forbids both a surviving registration and a newly invented row",()=>{
 const registered=compilerCodes(source('var d=message(2101,errorCategory,"legacy bodyless contract")'))
 const findings=auditIdentity(registered,new Map([["EK2101","legacy"]]),[{path:"docs/design/src/900-appendices.md",
 text:"The old `EK2101` is retired and will never be reassigned: bodyless contracts."}])
 assert.deepEqual(findings.map(f=>f.kind),["retired-registered","retired-row"])
})

test("pinned imported severities are independent of generated reservations and published defaults",()=>{
 const sources=[
 {path:"core/registry.go",text:'var VibeImportedLintCodes=map[string]string{"EK3801":"probe"}; var VibeDiagnosticCategories=map[string]string{"EK3801":"error"}'},
 {path:"typescript/tsc/internal/effecttsgo/internal/rules/probe.go",text:'var Probe=rule.Rule{Name:"probe",DefaultSeverity:etscore.SeverityWarning}'}
 ]
 const findings=auditCategories(compilerCategories(sources),new Map([["EK3801"," `effecttsgo/probe` | 38 | Tooling | `error` |"]]))
 assert.deepEqual(findings.filter(f=>f.kind==="severity-mismatch").map(f=>[f.code,f.expected,f.actual]),[["EK3801","error","warning"]])
 assert.deepEqual(findings.filter(f=>f.kind==="classification-mismatch").map(f=>f.code),["EK3801"])
 const clean=[{path:"core/registry.go",text:'var VibeImportedLintCodes=map[string]string{"EK3801":"probe"}'},sources[1]]
 assert.deepEqual(auditCategories(compilerCategories(clean),new Map([["EK3801"," `effecttsgo/probe` | 38 | Tooling | `warning` |"]])),[])
})


test("the task's identity-only authorization cannot license source or configuration changes",()=>{
 const entries=JSON.parse(readFileSync(new URL("../design/retirement-allowlist.json",import.meta.url),"utf8"))
 for(const a of entries.filter(e=>e.identityOnly)) {
  const base=new URL("../../"+a.case+"/",import.meta.url)
  const source=readFileSync(new URL(a.identityOnly.source,base),"utf8")
  assert.equal(executableDigest(source),a.identityOnly.tokensSha256,a.code+" executable source changed")
  for(const entry of a.identityOnly.sources??[]) {
   assert.equal(executableDigest(readFileSync(new URL(entry.source,base),"utf8")),entry.tokensSha256,a.code+" helper source changed: "+entry.source)
  }
  assert.equal(digest(readFileSync(new URL("tsconfig.json",base),"utf8")),a.identityOnly.configSha256,a.code+" config changed")
  assert.equal(executableDigest("// expectation comment\n"+source),a.identityOnly.tokensSha256)
  assert.notEqual(executableDigest(source+"\nthrow 1"),a.identityOnly.tokensSha256)
 }
})


test("a report-site category override cannot hide behind its primary declaration",()=>{
 const sources=source('var EK4408 = message(4408,errorCategory,"module"); func reportCollision() { collision := EK4408.With("binding"); collision.Category = warningCategory }')
 const categories=compilerCategories(sources)
 assert.deepEqual(categories.get("EK4408").map(s=>s.category),["error","warning"])
 assert.equal(auditCategories(categories,new Map([["EK4408","error: module"]]))[0].actual,"warning")
 const scoped=source('var EK4408 = message(4408,errorCategory,"module"); func first(){d := EK4408.With("x")};func second(){d.Category = warningCategory}')
 assert.deepEqual(compilerCategories(scoped).get("EK4408").map(s=>s.category),["error"])
})


// Historical allocation receipts remain verifiable after later diagnostic retirement.
test("identity-only allocations preserve the independently captured prior checker bodies",()=>{
 const proof=JSON.parse(readFileSync(new URL("../design/diagnostic-identity-renames.json",import.meta.url),"utf8"))
 const bytes=readFileSync(new URL("../design/diagnostic-identity-allocation.json",import.meta.url),"utf8")
 assert.equal(createHash("sha256").update(bytes).digest("hex"),proof.allocationSnapshotSha256)
 const capture=JSON.parse(bytes)
 assert.equal(capture.allocation,proof.allocation)
 assert.deepEqual(capture.files.map(record=>record.path).sort(),proof.files.map(record=>record.path).sort())
 for(const record of proof.files) {
  const archived=capture.files.find(item=>item.path===record.path)
  assert.ok(allocationPreservesChecker(archived,{...record,base:record.base??proof.base}),record.path+": allocation changed its checker")
 }
 const manifest=JSON.parse(readFileSync(new URL("../design/retirement-allowlist.json",import.meta.url),"utf8"))
 for(const code of ["EK9209","EK9210","EK9211","EK9214","EK9005","EK9006"]) {
  const authorization=manifest.find(r=>r.code===code&&r.severity==="error")
  assert.equal(authorization?.identityRenumbering,"docs/design/diagnostic-identity-renames.json",code)
 }
})

test("declared context categories never weaken the registry default or unrelated rows",()=>{
 const registered=compilerCodes([{path:"core/registry.go",text:'var VibeDiagnosticCategories = map[string]string{"EK1010":"error"}'},...source('var EK1010 = message(1010,errorCategory,"throw");func comma(){m:=*EK1010;m.Category=warningCategory}')])
 const categories=compilerCategories([{path:"core/registry.go",text:'var VibeDiagnosticCategories = map[string]string{"EK1010":"error"}'},...source('var EK1010 = message(1010,errorCategory,"throw");func comma(){m:=*EK1010;m.Category=warningCategory}')],registered)
 assert.deepEqual(new Set(categories.get("EK1010").map(s=>s.category)),new Set(["error","warning"]))
 assert.equal(auditCategories(categories,new Map([["EK1010","error: throw"]])).length,1)
 assert.deepEqual(auditCategories(categories,new Map([["EK1010","error: throw. Category variants: `error`, `warning`."]])),[])
 const wrong=compilerCategories([{path:"core/registry.go",text:'var VibeDiagnosticCategories = map[string]string{"EK1010":"warning"}'}])
 assert.equal(auditCategories(wrong,new Map([["EK1010","error: throw. Category variants: `error`, `warning`."]])).length,1)
})

// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | The old `EK4503` is retired and will never be reassigned: native TypeScript property diagnostics replace the denied service shorthand (VIP-10).
test("retired service-member diagnostics have no active row or archive replay", async () => {
 const {loadIdentity}=await import("./diagnostic-identity.mjs")
 const audit=loadIdentity(repository)
 assert.equal(audit.registered.has("EK4503"),false)
 assert.equal(audit.appendix.has("EK4503"),false)
 const fixtures=JSON.parse(readFileSync(new URL("../../typescript/vibelang/cases/appendix-diagnostic-identities/examples.json",import.meta.url),"utf8"))
 assert.equal(fixtures.some(example=>example.code==="EK4503"),false)
})

// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | The old `EK4707` is retired and will never be reassigned: data-variant class patterns use `EK0702` under VIP-7.
test("retired variant-pattern identity stays absent from active rows and replay", async () => {
 const {loadIdentity}=await import("./diagnostic-identity.mjs")
 const audit=loadIdentity(repository)
 assert.equal(audit.registered.has("EK4707"),false)
 assert.equal(audit.appendix.has("EK4707"),false)
 const fixtures=JSON.parse(readFileSync(new URL("../../typescript/vibelang/cases/appendix-diagnostic-identities/examples.json",import.meta.url),"utf8"))
 const fixture=fixtures.find(example=>example.code==="EK4707")
 assert.equal(fixture?.retired,true)
 assert.equal(fixture?.archive,undefined)
 const text=readFileSync(new URL("../design/src/900-appendices.md",import.meta.url),"utf8")
 const retirement=text.match(/^The old `EK4707` is retired and will never be reassigned:.*$/m)?.[0]
 assert.ok(retirement)
 fc.assert(fc.property(
  fc.constantFrom("message","messageOff","registryMessage"),
  fc.array(fc.constantFrom("a","b","_","0"," "),{maxLength:30}),
  (constructor,characters)=>{
   const body=JSON.stringify(characters.join(""))
   const definition=constructor==="registryMessage"?'var d=registryMessage("EK4707",'+body+')'
    :constructor==="messageOff"?'var d=messageOff(4707,'+body+')'
    :'var d=message(4707,errorCategory,'+body+')'
   const registered=new Map([...audit.registered,...compilerCodes(source(definition))])
   const rows=new Map([...audit.appendix,["EK4707","error: "+characters.join("")]])
   const documents=[{path:"docs/design/src/900-appendices.md",text:retirement}]
   assert.deepEqual(auditIdentity(registered,rows,documents).map(f=>f.kind),["retired-registered","retired-row"])
  }),{seed:4707,numRuns:200})
})

test("allocation checkpoints reject added predicates and mismatched prior authority",()=>{
 const proof=JSON.parse(readFileSync(new URL("../design/diagnostic-identity-renames.json",import.meta.url),"utf8"))
 const capture=JSON.parse(readFileSync(new URL("../design/diagnostic-identity-allocation.json",import.meta.url),"utf8"))
 fc.assert(fc.property(fc.integer({min:0,max:capture.files.length-1}),fc.integer({min:1,max:999999}),(index,salt)=>{
  const archived=capture.files[index]
  const record=proof.files.find(item=>item.path===archived.path)
  const reference={...record,base:record.base??proof.base}
  assert.equal(allocationPreservesChecker(archived,reference),true)
  const changed=structuredClone(archived)
  changed.segments[0].after+=" if deny_"+salt+"() { return }"
  assert.equal(allocationPreservesChecker(changed,reference),false,"new predicate "+archived.path)
  assert.equal(allocationPreservesChecker({...archived,path:archived.path+".other"},reference),false)
  assert.equal(allocationPreservesChecker({...archived,base:"0".repeat(40)},reference),false)
  assert.equal(allocationPreservesChecker({...archived,normalizedSha256:"0".repeat(64)},reference),false)
  assert.equal(allocationPreservesChecker({...archived,segments:[]},reference),false)
 }),{seed:342005,numRuns:512})
})


test("retirement authorization keys are unique across approval records", () => {
  const entries=JSON.parse(readFileSync(new URL("../design/retirement-allowlist.json",import.meta.url),"utf8"));
  const seen=new Set();
  for(const entry of entries) {
    const key=JSON.stringify([entry.code,entry.case??null,entry.pending??null,entry.path??null]);
    assert.ok(!seen.has(key),"duplicate retirement authorization: "+key);
    seen.add(key);
  }
});

test("service-key argument witness adds only the required whole-shape body",()=>{
 const entries=JSON.parse(readFileSync(new URL("../design/retirement-allowlist.json",import.meta.url),"utf8"))
 const entry=entries.find(e=>e.code==="EK9214"&&e.case==="typescript/vibelang/cases/service-key-call-arguments.fail")
 const migration=entry.sourceMigration
 assert.equal(migration.vip,"VIP-9")
 const source=readFileSync(new URL("../../"+entry.case+"/main.vibe",import.meta.url),"utf8")
 const before=source.replace("service Fn: (n: number) => number {}","service Fn: (n: number) => number")
 assert.notEqual(before,source,"the function-shape service must have its required body")
 assert.equal(executableDigest(before),migration.previousTokensSha256,"all prior executable tokens must remain")
 assert.equal(executableDigest(source),migration.tokensSha256)
 assert.equal(migration.tokensSha256,entry.identityOnly.tokensSha256)
 assert.equal(source.split("\n")[0],"// expect: EK9214","both original argument rejections stay active")
})

test("service-key argument witness adds only the required whole-shape body",()=>{
 const entries=JSON.parse(readFileSync(new URL("../design/retirement-allowlist.json",import.meta.url),"utf8"))
 const entry=entries.find(e=>e.code==="EK9214"&&e.case==="typescript/vibelang/cases/service-key-call-arguments.fail")
 const migration=entry.sourceMigration
 assert.equal(migration.vip,"VIP-9")
 const source=readFileSync(new URL("../../"+entry.case+"/main.vibe",import.meta.url),"utf8")
 const before=source.replace("service Fn: (n: number) => number {}","service Fn: (n: number) => number")
 assert.notEqual(before,source,"the function-shape service must have its required body")
 assert.equal(executableDigest(before),migration.previousTokensSha256,"all prior executable tokens must remain")
 assert.equal(executableDigest(source),migration.tokensSha256)
 assert.equal(migration.tokensSha256,entry.identityOnly.tokensSha256)
 assert.equal(source.split("\n")[0],"// expect: EK9214","both original argument rejections stay active")
})

test("retired continuation contracts have no active registration or Appendix row",async()=>{
 const {loadIdentity}=await import("./diagnostic-identity.mjs")
 const audit=loadIdentity(repository)
 assert.equal(audit.registered.has("EK9210"),false)
 assert.equal(audit.appendix.has("EK9210"),false)
})

test("retired subclass constructor identity has no active registration, row or replay", async () => {
 const {loadIdentity}=await import("./diagnostic-identity.mjs")
 const inventory=loadIdentity()
 assert.equal(inventory.registered.has("EK2118"),false)
 assert.equal(inventory.appendix.has("EK2118"),false)
 const fixtures=JSON.parse(readFileSync(new URL("../../typescript/vibelang/cases/appendix-diagnostic-identities/examples.json",import.meta.url),"utf8"))
 assert.equal(fixtures.find(x=>x.code==="EK2118")?.retired,true)
})
