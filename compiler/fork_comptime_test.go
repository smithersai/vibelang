package compiler

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// comptimeCase is one authored project plus the observation it must produce.
type comptimeCase struct {
	name    string
	files   []SourceFile
	options Options
}

func compileComptime(t *testing.T, files []SourceFile, options Options) CompileResult {
	t.Helper()
	backend, ctx := newPinnedTestBackend(t)
	if options == nil {
		options = Options{}
	}
	result, err := backend.Compile(ctx, CompileRequest{
		RootNames: []string{files[0].Path},
		Files:     files,
		Options:   options,
		Lowering:  LoweringInternal,
	})
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func comptimeSources(text string, extra ...SourceFile) []SourceFile {
	files := []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: text}}
	return append(files, extra...)
}

// runComptimeProgram executes the emitted artifacts and returns whatever
// `main()` printed. Nothing in this file is asserted from the shape of the
// emitted text alone: a comptime value that is wrong is only interesting when
// the program that runs it observes the wrong thing.
func runComptimeProgram(t *testing.T, result CompileResult) string {
	t.Helper()
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is required to execute the emitted JavaScript")
	}
	directory := t.TempDir()
	for _, item := range result.Artifacts {
		path := filepath.Join(directory, filepath.FromSlash(item.Path))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, item.Content, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(directory, "package.json"), []byte(`{"type":"module"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	harness := "import { main } from \"./main.js\";\nprocess.stdout.write(String(main()));\n"
	if err := os.WriteFile(filepath.Join(directory, "harness.mjs"), []byte(harness), 0o644); err != nil {
		t.Fatal(err)
	}
	command := exec.Command(node, "harness.mjs")
	command.Dir = directory
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("executing the emitted JavaScript failed: %v\n%s", err, output)
	}
	return string(output)
}

func requireClean(t *testing.T, result CompileResult) {
	t.Helper()
	if result.EmitSkipped || len(result.Diagnostics) != 0 {
		encoded, _ := json.Marshal(result.Diagnostics)
		t.Fatalf("comptime program must compile clean: emitSkipped=%v %s", result.EmitSkipped, encoded)
	}
}

func mainText(t *testing.T, result CompileResult) string {
	t.Helper()
	texts := artifactTextsByPath(t, result.Artifacts)
	emitted, ok := texts["main.js"]
	if !ok {
		t.Fatalf("missing main.js: %v", artifactPaths(result.Artifacts))
	}
	return emitted
}

// ---------------------------------------------------------------------------
// Recognition by resolved symbol identity
// ---------------------------------------------------------------------------

// TestPinnedForkComptimeResolvesTheIntrinsicBySymbol pins the specification's
// identity rule from both directions at once: the intrinsic keeps its meaning
// under an alias, and an unrelated local function that happens to be spelled
// `comptime` stays an ordinary runtime function.
func TestPinnedForkComptimeResolvesTheIntrinsicBySymbol(t *testing.T) {
	result := compileComptime(t, comptimeSources(`import { comptime as build } from "smithers:comptime"

const table = build({ mode: "fast", retries: 3 })

export function main(): string {
    return JSON.stringify(table)
}
`), nil)
	requireClean(t, result)
	emitted := mainText(t, result)
	if strings.Contains(emitted, "smithers:comptime") || strings.Contains(emitted, "build(") {
		t.Fatalf("the compiler-owned import and call must be gone:\n%s", emitted)
	}
	if got := runComptimeProgram(t, result); got != `{"mode":"fast","retries":3}` {
		t.Fatalf("aliased comptime import produced %q", got)
	}
}

func TestPinnedForkComptimeLeavesAnUnrelatedComptimeFunctionAlone(t *testing.T) {
	result := compileComptime(t, comptimeSources(`function comptime(value: string): string {
    return value + "!"
}

export function main(): string {
    return comptime("runtime")
}
`), nil)
	requireClean(t, result)
	emitted := mainText(t, result)
	if !strings.Contains(emitted, "function comptime(value)") {
		t.Fatalf("an unrelated local function named comptime must survive:\n%s", emitted)
	}
	if got := runComptimeProgram(t, result); got != "runtime!" {
		t.Fatalf("an unrelated local comptime must run at runtime, got %q", got)
	}
}

// TestPinnedForkComptimeRefusesAnUnimportedIntrinsic proves the other half of
// identity. Nothing here is granted compiler authority from a spelling, so an
// un-imported `comptime` is not a comptime diagnostic at all: it is the
// checker's own "cannot find name", which is the honest answer.
func TestPinnedForkComptimeRefusesAnUnimportedIntrinsic(t *testing.T) {
	result := compileComptime(t, comptimeSources(`export function main(): string {
    return JSON.stringify(comptime({ a: 1 }))
}
`), nil)
	requireComptimeDiagnostic(t, result, "TS2304")
	for _, item := range result.Diagnostics {
		if strings.HasPrefix(item.Code, "SMITHERS19") {
			t.Fatalf("a spelling alone must not produce a comptime diagnostic: %#v", item)
		}
	}
}

// A name the compiler-owned import introduced, shadowed at the call site by
// something else, is genuinely ambiguous: the author wrote the compiler's name
// and got a different binding. That, and only that, is the unrelated-identity
// refusal.
func TestPinnedForkComptimeRefusesAShadowedIntrinsicName(t *testing.T) {
	result := compileComptime(t, comptimeSources(`import { comptime } from "smithers:comptime"

const kept = comptime(1)

export function main(): string {
    const comptime = (value: number): number => value + 1
    return String(comptime(2) + kept)
}
`), nil)
	requireComptimeDiagnostic(t, result, "SMITHERS1902")
}

func requireComptimeDiagnostic(t *testing.T, result CompileResult, code string) Diagnostic {
	t.Helper()
	for _, item := range result.Diagnostics {
		if item.Code == code {
			if !result.EmitSkipped {
				t.Fatalf("a refused comptime program must not emit: %#v", item)
			}
			return item
		}
	}
	encoded, _ := json.Marshal(result.Diagnostics)
	t.Fatalf("expected %s, saw %s", code, encoded)
	return Diagnostic{}
}

// ---------------------------------------------------------------------------
// The evaluated subset
// ---------------------------------------------------------------------------

func TestPinnedForkComptimeEvaluatesTheStaticValueLanguage(t *testing.T) {
	result := compileComptime(t, comptimeSources(`import { comptime } from "smithers:comptime"

const base = { name: "smithers", version: 2 }
const parts = ["a", "b", "c"]

const summary = comptime({
    greeting: `+"`"+`hello ${base.name} v${base.version}`+"`"+`,
    joined: parts.join("-"),
    upper: base.name.toUpperCase(),
    doubled: base.version * 2,
    picked: parts[1],
    size: parts.length,
    nested: { ok: base.version > 1, missing: null },
    mapped: parts.map((item: string) => item + "!"),
    keys: Object.keys(base),
    parsed: JSON.parse('{"x":[1,2]}'),
    chosen: base.version === 2 ? "two" : "other",
    rounded: Math.max(1, Math.floor(3.7)),
})

export function main(): string {
    return JSON.stringify(summary)
}
`), nil)
	requireClean(t, result)
	got := runComptimeProgram(t, result)
	want := `{"chosen":"two","doubled":4,"greeting":"hello smithers v2","joined":"a-b-c",` +
		`"keys":["name","version"],"mapped":["a!","b!","c!"],"nested":{"missing":null,"ok":true},` +
		`"parsed":{"x":[1,2]},"picked":"b","rounded":3,"size":3,"upper":"SMITHERS"}`
	if got != want {
		t.Fatalf("comptime value language:\n got %s\nwant %s", got, want)
	}
	emitted := mainText(t, result)
	for _, authored := range []string{"toUpperCase", "JSON.parse", "Object.keys", "Math.max", "parts.join"} {
		if strings.Contains(emitted, authored) {
			t.Fatalf("comptime work leaked into the artifact (%q):\n%s", authored, emitted)
		}
	}
}

// TestPinnedForkComptimeInterpretsCompileTimeFunctions covers the imperative
// half of the subset — let, assignment, every loop form, break/continue, and
// mutation of interpreter-owned containers — through both marker spellings.
func TestPinnedForkComptimeInterpretsCompileTimeFunctions(t *testing.T) {
	result := compileComptime(t, comptimeSources(`import { comptime } from "smithers:comptime"

const rows = ["alpha", "beta", "gamma", "delta"]

const buildIndex = comptime((items: string[]) => {
    const index: Record<string, number> = {}
    let total = 0
    for (const item of items) {
        if (item === "gamma") {
            continue
        }
        index[item] = item.length
        total += item.length
        if (total > 12) {
            break
        }
    }
    let countdown = 3
    const steps: number[] = []
    while (countdown > 0) {
        steps.push(countdown)
        countdown--
    }
    for (let i = 0; i < 2; i++) {
        steps.push(i * 10)
    }
    let doubling = 1
    do {
        doubling = doubling * 2
    } while (doubling < 8)
    return { index, total, steps, doubling }
})

const inline = comptime(() => {
    const acc = [1, 2, 3].reduce((sum: number, value: number) => sum + value, 0)
    return { acc }
})()

export function main(): string {
    return JSON.stringify({ built: buildIndex(rows), inline })
}
`), nil)
	requireClean(t, result)
	got := runComptimeProgram(t, result)
	want := `{"built":{"doubling":8,"index":{"alpha":5,"beta":4,"delta":5},"steps":[3,2,1,0,10],"total":14},"inline":{"acc":6}}`
	if got != want {
		t.Fatalf("compile-time function interpretation:\n got %s\nwant %s", got, want)
	}
	emitted := mainText(t, result)
	if strings.Contains(emitted, "buildIndex") || strings.Contains(emitted, "while") ||
		strings.Contains(emitted, "reduce") {
		t.Fatalf("the compile-time function must not survive into the artifact:\n%s", emitted)
	}
}

// ---------------------------------------------------------------------------
// Hermeticity
// ---------------------------------------------------------------------------

// TestPinnedForkComptimeIsHermetic is the safety property. Each row attempts to
// observe ambient host state from inside a comptime evaluation, and each one
// must be refused with a diagnostic rather than deferred, defaulted, or
// evaluated. Half of the rows make the attempt from inside a loop, because a
// guard that only inspects the top-level argument expression would pass the
// direct forms and miss these.
func TestPinnedForkComptimeIsHermetic(t *testing.T) {
	for _, testCase := range []struct {
		name string
		body string
	}{
		{"wall clock", `comptime(Date.now())`},
		{"wall clock in a loop", `comptime(() => { let t = 0; for (let i = 0; i < 3; i++) { t = t + Date.now() } return t })()`},
		{"randomness", `comptime(Math.random())`},
		{"randomness in a loop", `comptime(() => { const out: number[] = []; for (const _ of [1, 2]) { out.push(Math.random()) } return out })()`},
		{"environment", `comptime(process.env.HOME ?? "")`},
		{"environment in a loop", `comptime(() => { let s = ""; while (s.length < 1) { s = s + String(process.env.HOME) } return s })()`},
		{"filesystem", `comptime(readFileSync("/etc/passwd", "utf8"))`},
		{"network", `comptime(fetch("https://example.com"))`},
		{"process state", `comptime(process.pid)`},
		{"globalThis", `comptime(String(globalThis))`},
		{"performance clock", `comptime(performance.now())`},
		{"mutable host state", `comptime(() => { const g = globalThis as Record<string, number>; g.seen = (g.seen ?? 0) + 1; return g.seen })()`},
		{"a non-deterministic Math member", `comptime(Math.random() + Math.PI)`},
		{"an arbitrary host call", `comptime(structuredClone({ a: 1 }))`},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			source := `import { comptime } from "smithers:comptime"

declare function readFileSync(path: string, encoding: string): string
declare function fetch(url: string): unknown
declare function structuredClone<T>(value: T): T
declare const performance: { now(): number }
declare const process: { env: Record<string, string | undefined>; pid: number }

const observed = ` + testCase.body + `

export function main(): string {
    return JSON.stringify(observed)
}
`
			result := compileComptime(t, comptimeSources(source), nil)
			if !result.EmitSkipped {
				t.Fatalf("an ambient observation must not compile: %s", mainText(t, result))
			}
			refused := false
			for _, item := range result.Diagnostics {
				if strings.HasPrefix(item.Code, "SMITHERS19") {
					refused = true
				}
			}
			if !refused {
				encoded, _ := json.Marshal(result.Diagnostics)
				t.Fatalf("expected a comptime refusal, saw %s", encoded)
			}
		})
	}
}

// TestPinnedForkComptimeIsNotWhatRefusesAmbientCalls is the control for the
// test above. Its purpose is to prove the comptime hermeticity guard is not
// over-reaching — that it refuses host access *because the evaluation is
// compile-time*, and does not simply refuse the spelling wherever it appears.
//
// The same `Date.now()` / `Math.random()` outside a comptime evaluation are
// also refused, but by a different rule and a different code: the host-global
// capability rule (SMITHERS1602/SMITHERS1603) from
// specification/compatibility.mdx, "Host Globals" (Locked), which requires a
// capability for clock and random access in authored `.sm` at all. That is the
// deliberate asymmetry recorded in poc/PRODUCTION_READINESS.md: the language
// frontend rejects them outright, while the target classifier reports them as
// Clock/Random requirements. A comptime code (SMITHERS19xx) appearing here
// would mean the comptime frontend had claimed runtime source it does not own.
func TestPinnedForkComptimeIsNotWhatRefusesAmbientCalls(t *testing.T) {
	result := compileComptime(t, comptimeSources(`import { comptime } from "smithers:comptime"

const scale = comptime(2)

export function main(): string {
    const now = Date.now()
    const random = Math.random()
    return JSON.stringify({
        scaled: scale * 3,
        nowIsNumber: typeof now === "number",
        randomIsNumber: typeof random === "number",
    })
}
`), nil)
	codes := make([]string, 0, len(result.Diagnostics))
	for _, item := range result.Diagnostics {
		if item.Category == DiagnosticError {
			codes = append(codes, item.Code)
		}
	}
	sort.Strings(codes)
	if strings.Join(codes, ",") != "SMITHERS1602,SMITHERS1603" {
		t.Fatalf("ambient host access outside comptime must be refused by the host-global rule, saw %v", codes)
	}
}

// TestPinnedForkComptimeLeavesRuntimeCodeAloneOutsideComptime is the other half
// of that control: ordinary runtime code beside a comptime binding must survive
// verbatim. A frontend that erased or refused runtime source it does not own
// would look hermetic while being broken, and this is the property the emitted
// text can actually witness.
func TestPinnedForkComptimeLeavesRuntimeCodeAloneOutsideComptime(t *testing.T) {
	result := compileComptime(t, comptimeSources(`import { comptime } from "smithers:comptime"

const scale = comptime(2)

export function main(): string {
    const largest = Math.max(2, 7, 5)
    return JSON.stringify({ scaled: scale * 3, largest })
}
`), nil)
	requireClean(t, result)
	got := runComptimeProgram(t, result)
	if got != `{"scaled":6,"largest":7}` {
		t.Fatalf("runtime code beside a comptime binding must still run: %q", got)
	}
	emitted := mainText(t, result)
	if !strings.Contains(emitted, "Math.max(2, 7, 5)") {
		t.Fatalf("runtime Math.max() must survive verbatim:\n%s", emitted)
	}
	if strings.Contains(emitted, "comptime") {
		t.Fatalf("the compiler-owned construct must be erased:\n%s", emitted)
	}
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

// TestPinnedForkComptimeEnforcesBudgets proves the interpreter cannot hang. All
// four budgets are exercised, including an unconditional infinite loop: if the
// step budget were missing this test would never return, so the assertion is
// backed by the test completing at all.
func TestPinnedForkComptimeEnforcesBudgets(t *testing.T) {
	for _, testCase := range []struct {
		name string
		body string
	}{
		{"infinite loop", `comptime(() => { let n = 0; while (true) { n = n + 1 } return n })()`},
		{"unbounded for", `comptime(() => { let n = 0; for (;;) { n = n + 1 } return n })()`},
		{"allocation growth", `comptime(() => { const out: number[] = []; for (let i = 0; i < 200000; i++) { out.push(i) } return out.length })()`},
		{"recursion depth", `comptime(() => deep(0))()`},
		{"string growth", `comptime("x".repeat(2000000))`},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			source := `import { comptime } from "smithers:comptime"

function deep(n: number): number {
    return deep(n + 1)
}

const value = ` + testCase.body + `

export function main(): string {
    return JSON.stringify(value)
}
`
			result := compileComptime(t, comptimeSources(source), nil)
			requireComptimeDiagnostic(t, result, "SMITHERS1912")
		})
	}
}

// ---------------------------------------------------------------------------
// Target selection
// ---------------------------------------------------------------------------

// TestPinnedForkComptimeSelectsTheTargetBranch proves both halves of the
// specification's target rule: the selected branch's value is what the program
// observes, and the unselected branch is absent from the emitted artifact.
func TestPinnedForkComptimeSelectsTheTargetBranch(t *testing.T) {
	source := `import { comptime } from "smithers:comptime"

const settings = comptime(() => {
    if (comptime.target === "browser") {
        return { transport: "fetch", pollMilliseconds: 250 }
    }
    return { transport: "node-http", pollMilliseconds: 1000 }
})()

export function main(): string {
    return JSON.stringify(settings)
}
`
	for _, testCase := range []struct {
		target   string
		expected string
		absent   string
	}{
		{"browser", `{"pollMilliseconds":250,"transport":"fetch"}`, "node-http"},
		{"typescript-node", `{"pollMilliseconds":1000,"transport":"node-http"}`, "fetch"},
	} {
		t.Run(testCase.target, func(t *testing.T) {
			options := Options{}
			if testCase.target != "typescript-node" {
				options["comptimeTarget"] = testCase.target
			}
			result := compileComptime(t, comptimeSources(source), options)
			requireClean(t, result)
			if got := runComptimeProgram(t, result); got != testCase.expected {
				t.Fatalf("target %q selected %s", testCase.target, got)
			}
			emitted := mainText(t, result)
			if strings.Contains(emitted, testCase.absent) {
				t.Fatalf("the unselected branch survived into the artifact (%q):\n%s", testCase.absent, emitted)
			}
			if strings.Contains(emitted, "comptime.target") {
				t.Fatalf("comptime.target must not reach the artifact:\n%s", emitted)
			}
		})
	}
}

// A function that is kept as runtime code cannot observe a compile-time-only
// operation, because there is no phase in which it could.
func TestPinnedForkComptimeRefusesPhaseOnlyWorkInARetainedFunction(t *testing.T) {
	result := compileComptime(t, comptimeSources(`import { comptime } from "smithers:comptime"

function pick(): string {
    return comptime.target === "browser" ? "b" : "n"
}

const chosen = comptime(pick)()

export function main(): string {
    return chosen
}
`), nil)
	requireComptimeDiagnostic(t, result, "SMITHERS1910")
}

// ---------------------------------------------------------------------------
// Fail-closed refusals
// ---------------------------------------------------------------------------

func TestPinnedForkComptimeFailsClosed(t *testing.T) {
	for _, testCase := range []struct {
		name string
		code string
		body string
	}{
		{"a runtime parameter", comptimeCodeUnsupportedExpression, `export function main(): string {
    return JSON.stringify(comptime(runtimeValue))
}
declare const runtimeValue: number
`},
		{"a mutable module binding", comptimeCodeUnsupportedExpression, `let counter = 1
const captured = comptime(counter)
export function main(): string { return String(captured) }
`},
		{"a cyclic const", comptimeCodeUnsupportedExpression, `const left: number = right
const right: number = left
const value = comptime(left)
export function main(): string { return String(value) }
`},
		{"an undefined value", comptimeCodeNoncanonicalResult, `const value = comptime(undefined)
export function main(): string { return String(value) }
`},
		{"a non-finite number", comptimeCodeNoncanonicalResult, `const value = comptime(1 / 0)
export function main(): string { return String(value) }
`},
		{"a bigint", comptimeCodeNoncanonicalResult, `const value = comptime(1n)
export function main(): string { return String(value) }
`},
		{"mutating shared const data", comptimeCodeUnsupportedExpression, `const shared = [1, 2, 3]
const value = comptime(() => { shared.push(4); return shared })()
export function main(): string { return JSON.stringify(value) }
`},
		{"the intrinsic escaping as a value", comptimeCodeUnsupportedUse, `const alias = comptime
export function main(): string { return String(alias) }
`},
		{"wrong arity", comptimeCodeArity, `const value = comptime(1, 2)
export function main(): string { return String(value) }
`},
		{"a compile-time function escaping", comptimeCodeUnsupportedUse, `const build = comptime((n: number) => n + 1)
const escaped = [build]
export function main(): string { return String(escaped.length) }
`},
		{"non-ASCII case mapping", comptimeCodeUnsupportedExpression, `const value = comptime("straße".toUpperCase())
export function main(): string { return value }
`},
		{"replaceAll with an empty search", comptimeCodeUnsupportedExpression, `const value = comptime("abc".replaceAll("", "-"))
export function main(): string { return value }
`},
		{"embed without a tracked-input channel", comptimeCodeTrackedInput, `const value = comptime(() => embed("./data.json"))()
export function main(): string { return String(value) }
`},
		{"a default import", comptimeCodeUnsupportedUse, `export function main(): string { return "x" }
`},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			header := "import { comptime, embed } from \"smithers:comptime\"\n\n"
			if testCase.name == "a default import" {
				header = "import comptime from \"smithers:comptime\"\n\n"
			}
			result := compileComptime(t, comptimeSources(header+testCase.body), nil)
			requireComptimeDiagnostic(t, result, testCase.code)
		})
	}
}

// The whole project is refused when any comptime use is refused: a partially
// substituted program is one neither the author nor the language defines.
func TestPinnedForkComptimeIsAllOrNothing(t *testing.T) {
	result := compileComptime(t, comptimeSources(`import { comptime } from "smithers:comptime"

const good = comptime({ a: 1 })
const bad = comptime(Math.random())

export function main(): string {
    return JSON.stringify({ good, bad })
}
`), nil)
	if !result.EmitSkipped {
		t.Fatal("a project with one refused comptime use must not emit")
	}
	if len(result.Artifacts) != 0 {
		t.Fatalf("a refused project must produce no artifacts: %v", artifactPaths(result.Artifacts))
	}
}

// A plain TypeScript module in the same project is never lowered, so a
// compiler-owned import there would survive to runtime and fail at load. It is
// refused at the authored specifier instead.
func TestPinnedForkComptimeRefusesTheIntrinsicInAPlainTypeScriptModule(t *testing.T) {
	result := compileComptime(t, []SourceFile{
		{Path: "main.sm", Kind: FileKindSmithers, Text: `import { value } from "./helper.ts"

export function main(): string {
    return String(value)
}
`},
		{Path: "helper.ts", Kind: FileKindTypeScript, Text: `/**
 * @module helper
 * @throws {never}
 */
import { comptime } from "smithers:comptime"

export const value = comptime(1)
`},
	}, nil)
	diagnostic := requireComptimeDiagnostic(t, result, comptimeCodeUnsupportedUse)
	if diagnostic.File != "helper.ts" {
		t.Fatalf("the refusal must name the module that imported it: %#v", diagnostic)
	}
}

// A nested comptime is named for what it is rather than reported as an unknown
// operation, because the inner call is already inside a compile-time evaluation.
func TestPinnedForkComptimeRefusesANestedComptime(t *testing.T) {
	result := compileComptime(t, comptimeSources(`import { comptime } from "smithers:comptime"

const doubled = comptime(comptime(2))

export function main(): string {
    return String(doubled)
}
`), nil)
	diagnostic := requireComptimeDiagnostic(t, result, comptimeCodeUnsupportedExpression)
	if !strings.Contains(diagnostic.Message, "nested comptime") {
		t.Fatalf("a nested comptime must be named: %#v", diagnostic)
	}
}

// The step budget names the loop that did not terminate, not whichever
// sub-expression the counter happened to land on. The position a reader needs
// is the loop; the exact expression is deterministic but arbitrary.
func TestPinnedForkComptimeBudgetNamesTheLoop(t *testing.T) {
	source := `import { comptime } from "smithers:comptime"

const spun = comptime(() => {
    let n = 0
    while (true) {
        n = n + 1
    }
    return n
})()

export function main(): string {
    return String(spun)
}
`
	result := compileComptime(t, comptimeSources(source), nil)
	diagnostic := requireComptimeDiagnostic(t, result, "SMITHERS1912")
	if diagnostic.Span == nil {
		t.Fatal("a budget refusal must carry an authored span")
	}
	if got := source[diagnostic.Span.Start : diagnostic.Span.Start+5]; got != "while" {
		t.Fatalf("the step budget must be reported at the loop, saw %q", got)
	}
	if !strings.Contains(diagnostic.Message, "did not terminate") {
		t.Fatalf("the message must say the loop did not terminate: %#v", diagnostic)
	}
}

// ---------------------------------------------------------------------------
// Type production
// ---------------------------------------------------------------------------

// TestPinnedForkComptimeProducesTypes covers the stretch goal: a comptime
// binding read in type position gains a same-named literal type alias, and a
// binding read *only* as a type loses its runtime const entirely.
func TestPinnedForkComptimeProducesTypes(t *testing.T) {
	result := compileComptime(t, comptimeSources(`import { comptime } from "smithers:comptime"

const Config = comptime({ mode: "fast", retries: 3 })

const Shape = comptime({ label: "only-a-type" })

export function describe(value: Config): string {
    return value.mode + ":" + String(value.retries)
}

function label(value: Shape): string {
    return value.label
}

export function main(): string {
    return describe(Config) + "|" + label({ label: "only-a-type" })
}
`), Options{"declaration": true})
	requireClean(t, result)
	emitted := mainText(t, result)
	if !strings.Contains(emitted, `const Config = `) {
		t.Fatalf("a comptime binding read as a value must keep its const:\n%s", emitted)
	}
	if strings.Contains(emitted, "Shape") {
		t.Fatalf("a comptime binding read only as a type must lose its runtime const:\n%s", emitted)
	}
	if got := runComptimeProgram(t, result); got != "fast:3|only-a-type" {
		t.Fatalf("type-producing comptime changed the program's behavior: %q", got)
	}
	// The generated type has to reach declaration emit too, or a consumer of
	// this module would see the alias disappear at the package boundary.
	declaration := artifactTextsByPath(t, result.Artifacts)["main.d.sm.ts"]
	for _, expected := range []string{`type Config = `, `readonly "mode": "fast"`, `readonly "retries": 3`} {
		if !strings.Contains(declaration, expected) {
			t.Fatalf("declaration emit lost the generated comptime type (%q):\n%s", expected, declaration)
		}
	}
}

// Compilation is deterministic: the same authored project produces byte
// identical artifacts. A compile-time evaluator that observed anything ambient
// would eventually fail this even when every individual guard above passed.
func TestPinnedForkComptimeIsReproducible(t *testing.T) {
	source := `import { comptime } from "smithers:comptime"

const data = comptime(() => {
    const out: Record<string, number> = {}
    for (const key of ["b", "a", "c"]) {
        out[key] = key.length + Object.keys(out).length
    }
    return { out, keys: Object.keys(out), stamp: comptime.target }
})()

export function main(): string {
    return JSON.stringify(data)
}
`
	first := compileComptime(t, comptimeSources(source), nil)
	requireClean(t, first)
	second := compileComptime(t, comptimeSources(source), nil)
	requireClean(t, second)
	left := artifactTextsByPath(t, first.Artifacts)
	right := artifactTextsByPath(t, second.Artifacts)
	if len(left) != len(right) {
		t.Fatalf("artifact sets differ: %v vs %v", artifactPaths(first.Artifacts), artifactPaths(second.Artifacts))
	}
	for path, text := range left {
		if right[path] != text {
			t.Fatalf("artifact %q is not reproducible:\n%s\n---\n%s", path, text, right[path])
		}
	}
	if got := runComptimeProgram(t, first); got != `{"keys":["b","a","c"],"out":{"a":2,"b":1,"c":3},"stamp":"typescript-node"}` {
		t.Fatalf("reproducible comptime value: %q", got)
	}
}

// A widened annotation against a generated comptime type is a type error, not a
// silent success: the alias carries the value's literal type, so it can actually
// reject something.
func TestPinnedForkComptimeGeneratedTypeRejectsAWiderValue(t *testing.T) {
	result := compileComptime(t, comptimeSources(`import { comptime } from "smithers:comptime"

const Config = comptime({ mode: "fast" })

function describe(value: Config): string {
    return value.mode
}

export function main(): string {
    return describe({ mode: "slow" })
}
`), nil)
	if !result.EmitSkipped {
		t.Fatal("a value that does not match the generated literal type must be rejected")
	}
	found := false
	for _, item := range result.Diagnostics {
		if strings.HasPrefix(item.Code, "TS") {
			found = true
		}
	}
	if !found {
		encoded, _ := json.Marshal(result.Diagnostics)
		t.Fatalf("expected a checker rejection against the generated type, saw %s", encoded)
	}
}

// ---------------------------------------------------------------------------
// Source maps
// ---------------------------------------------------------------------------

// A substituted literal keeps the authored call's position, so a diagnostic or
// a stack frame in the emitted program still points at what the author wrote.
func TestPinnedForkComptimeKeepsAuthoredPositions(t *testing.T) {
	source := `import { comptime } from "smithers:comptime"

export function main(): string {
    const table = comptime({ answer: 42 })
    return JSON.stringify(table)
}
`
	result := compileComptime(t, comptimeSources(source), nil)
	requireClean(t, result)
	texts := artifactTextsByPath(t, result.Artifacts)
	_, points := decodeEmittedMap(t, texts["main.js.map"])
	emitted := mainText(t, result)
	loweredLine, loweredColumn := positionOf(t, emitted, `{ "answer": 42 }`)
	authoredLine, authoredColumn := positionOf(t, source, `comptime({ answer: 42 })`)
	if !hasMapping(points, loweredLine, loweredColumn, authoredLine, authoredColumn) {
		t.Fatalf("the substituted literal lost the authored call position (%d:%d): %#v",
			authoredLine, authoredColumn, points)
	}
}

// Codes the tests above name, kept beside them so a renamed diagnostic breaks
// the build rather than quietly stopping a test from asserting anything.
const (
	comptimeCodeUnsupportedExpression = "SMITHERS1904"
	comptimeCodeNoncanonicalResult    = "SMITHERS1905"
	comptimeCodeUnsupportedUse        = "SMITHERS1906"
	comptimeCodeInvalidFunction       = "SMITHERS1910"
	comptimeCodeTrackedInput          = "SMITHERS1911"
	comptimeCodeArity                 = "SMITHERS1903"
)
