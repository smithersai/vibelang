package compiler

import (
	"os"
	"sort"
	"strconv"
	"strings"
	"testing"
)

func TestPinnedForkUnboundProducerContainersMatchReference(t *testing.T) {
	authored, err := os.ReadFile("testdata/fa-f1-enumeration.sm")
	if err != nil {
		t.Fatal(err)
	}
	files := []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: string(authored)}}
	result := compileInternalSource(t, files)
	want := []string{
		"SMITHERS1301@9:41",
		"SMITHERS1301@10:29",
		"SMITHERS1301@11:45",
		"SMITHERS1301@12:36",
		"SMITHERS1301@13:40",
		"SMITHERS1301@14:47",
		"SMITHERS1301@15:51",
		"SMITHERS1301@16:45",
		"SMITHERS1301@17:46",
		"SMITHERS1301@18:41",
		"SMITHERS1301@19:44",
		"SMITHERS1301@20:42",
		"SMITHERS1301@21:53",
		"SMITHERS1301@22:48",
		"SMITHERS1301@23:51",
		"SMITHERS1301@24:46",
		"SMITHERS1301@25:55",
		"SMITHERS1402@27:67",
		"SMITHERS1402@28:62",
		"SMITHERS1402@29:60",
		"SMITHERS1402@30:62",
		"SMITHERS1402@31:55",
		"SMITHERS1301@32:56",
	}
	sort.Strings(want)
	if got := formatDiagnosticPositions(t, files, result); strings.Join(got, " ") != strings.Join(want, " ") {
		t.Fatalf("unbound producer diagnostics = %v, want %v; raw %#v", got, want, result.Diagnostics)
	}

	for _, diagnostic := range result.Diagnostics {
		if diagnostic.Code != "SMITHERS1301" || diagnostic.Span == nil {
			continue
		}
		line, _ := lineColumnOfOffset(files[0].Text, diagnostic.Span.Start)
		if line == 9 && strings.Contains(diagnostic.Message, "await removes") {
			t.Fatalf("a non-awaited Result discard retained the stale await-only explanation: %#v", diagnostic)
		}
		if line == 32 && !strings.Contains(diagnostic.Message, "await removes only Promise") {
			t.Fatalf("an awaited Promise<Result> discard lost the specific explanation: %#v", diagnostic)
		}
	}
}

func TestPinnedForkUnboundProducerAcceptanceControls(t *testing.T) {
	authored, err := os.ReadFile("testdata/fa-f1-controls.sm")
	if err != nil {
		t.Fatal(err)
	}
	result := compileInternalSource(t, []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: string(authored)}})
	requireCleanCompile(t, result)
	if got := runEmittedMain(t, result); got != "owned\ncomma\nada\nada\nand\nor\n2" {
		t.Fatalf("acceptance controls printed %q", got)
	}
}

// TestPinnedForkDynamicCodeImportsFailClosed pins the module-initialization
// trust rule on the DYNAMIC spelling of a module edge.
//
// The rule the diagnostic names is about foreign module initialization — an ESM
// initializer can panic before any checked call boundary exists — and that
// hazard is identical however the edge is spelled, so an untrusted foreign
// module is refused through `import()` exactly as through `import ... from`.
// It is equally not a licence to refuse dynamic import as such:
// docs/DECISIONS.md:266 is Locked that "arbitrary dynamic import expressions
// remain available", and a project `.sm` module crosses no foreign boundary at
// all. Refusing a TRUSTED foreign module would answer the open ledger question
// (DECISIONS.md:266 versus the SMITHERS1510 model) by fiat, which this rule may
// not do; a module that carries the claim carries it through either spelling.
//
// This test previously asserted the blanket refusal, and the reference frontend
// previously had the mirror-image defect: it accepted every dynamic edge,
// including an untrusted foreign one. Both backends now implement this exact
// rule, and the corpus pair
// 09-foreign-calls/a-dynamic-import-of-a-project-module-is-not-a-foreign-module-edge
// and .../a-dynamic-import-of-an-untrusted-foreign-module-is-refused holds both
// directions closed.
func TestPinnedForkDynamicCodeImportsFailClosed(t *testing.T) {
	const trusted = "/** @module @throws {never} */\nexport const value = \"trusted\"\n"
	const untrusted = "export const value = \"untrusted\"\n"
	const projectModule = "export const value = \"project\"\n"
	cases := []struct {
		name     string
		source   string
		modules  []SourceFile
		needle   string
		accepted bool
	}{
		{
			name:    "untrusted foreign literal",
			source:  "export async function main(): Promise<string[]> {\n  const loaded = await import(\"./foreign.ts\")\n  return [loaded.value]\n}\n",
			modules: []SourceFile{{Path: "foreign.ts", Kind: FileKindTypeScript, Text: untrusted}},
			needle:  "\"./foreign.ts\"",
		},
		{
			name:     "trusted foreign literal keeps its claim through the dynamic spelling",
			source:   "export async function main(): Promise<string[]> {\n  const loaded = await import(\"./foreign.ts\")\n  return [loaded.value]\n}\n",
			modules:  []SourceFile{{Path: "foreign.ts", Kind: FileKindTypeScript, Text: trusted}},
			accepted: true,
		},
		{
			name:     "project module literal is not a foreign module edge",
			source:   "export async function main(): Promise<string[]> {\n  const loaded = await import(\"./helper.sm\")\n  return [loaded.value]\n}\n",
			modules:  []SourceFile{{Path: "helper.sm", Kind: FileKindSmithers, Text: projectModule}},
			accepted: true,
		},
		{
			name:    "computed specifier",
			source:  "const chosen = \"./foreign.ts\"\nexport async function main(): Promise<string[]> {\n  const loaded = await import(chosen)\n  return [loaded.value]\n}\n",
			modules: []SourceFile{{Path: "foreign.ts", Kind: FileKindTypeScript, Text: trusted}},
			needle:  "chosen",
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			files := append([]SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: testCase.source}}, testCase.modules...)
			result := compileInternalSource(t, files)
			observed := formatDiagnosticPositions(t, files, result)
			if testCase.accepted {
				requireCleanCompile(t, result)
				if got := runEmittedMain(t, result); got == "" {
					t.Fatalf("accepted dynamic import printed nothing; diagnostics %v", observed)
				}
				return
			}
			start := strings.LastIndex(testCase.source, testCase.needle)
			if start < 0 {
				t.Fatalf("test bug: %q is absent", testCase.needle)
			}
			line, column := lineColumnOfOffset(testCase.source, start)
			want := "SMITHERS1510@" + strconv.Itoa(line) + ":" + strconv.Itoa(column)
			if strings.Join(observed, " ") != want {
				t.Fatalf("dynamic import diagnostics = %v, want %s; raw %#v", observed, want, result.Diagnostics)
			}
		})
	}
}

// TestPinnedForkSpecifierRewriteSurvivesImportInAModuleName is the regression
// pin for a crash, not a diagnostic.
//
// SourceFile.Imports() can name one specifier more than once: the fork's
// ForEachDynamicImportOrRequireCall finds candidate dynamic imports by scanning
// the RAW TEXT for "import"/"require" and resolving the node at each hit, so a
// module whose FILE NAME contains those letters made every occurrence inside the
// specifier resolve back to the same call. planSpecifierEdits then produced two
// identical edits and applySpecifierEdits panicked with `slice bounds out of
// range`, taking the whole compile down with no diagnostic at all.
func TestPinnedForkSpecifierRewriteSurvivesImportInAModuleName(t *testing.T) {
	files := []SourceFile{
		{Path: "main.sm", Kind: FileKindSmithers, Text: "export async function main(): Promise<string[]> {\n  const helper = await import(\"./an-import-named-helper.sm\")\n  return [helper.greet(\"ada\")]\n}\n"},
		{Path: "an-import-named-helper.sm", Kind: FileKindSmithers, Text: "export function greet(name: string): string {\n  return `hello ${name}`\n}\n"},
	}
	result := compileInternalSource(t, files)
	requireCleanCompile(t, result)
	if got := runEmittedMain(t, result); got != "hello ada" {
		t.Fatalf("emitted program printed %q, want %q", got, "hello ada")
	}
}

func TestPinnedForkContextReceiversResolveByTypeIdentity(t *testing.T) {
	cases := []struct {
		name    string
		binding string
		receive string
	}{
		{name: "const alias", binding: "const Chronometer = Clock", receive: "Chronometer.context()"},
		{name: "typed alias", binding: "const Chronometer: typeof Clock = Clock", receive: "Chronometer.context()"},
		{name: "alias chain", binding: "const First = Clock\nconst Chronometer = First", receive: "Chronometer.context()"},
		{name: "flow-stable let alias", binding: "let Chronometer = Clock", receive: "Chronometer.context()"},
		{name: "object property alias", binding: "const clocks = { Clock }", receive: "clocks.Clock.context()"},
		{name: "parenthesized receiver", receive: "(Clock).context()"},
		{name: "as-wrapped receiver", receive: "(Clock as typeof Clock).context()"},
		{name: "literal computed context", receive: "Clock[\"context\"]()"},
		{name: "template-literal computed context", receive: "Clock[`context`]()"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			source := "import { Context } from \"smthrs/context\"\n" +
				"abstract class Clock extends Context { abstract now(): number }\n" + testCase.binding + "\n" +
				"function timestamp(): number { return " + testCase.receive + ".now() }\n" +
				"export const stamped = [`${timestamp()}`]\n"
			files := []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: source}}
			result := compileInternalSource(t, files)
			call := strings.LastIndex(source, "timestamp()")
			line, column := lineColumnOfOffset(source, call)
			want := "SMITHERS2102@" + strconv.Itoa(line) + ":" + strconv.Itoa(column)
			if got := strings.Join(formatDiagnosticPositions(t, files, result), " "); got != want {
				t.Fatalf("context diagnostics = %s, want %s; raw %#v", got, want, result.Diagnostics)
			}
		})
	}
}

func TestPinnedForkLiteralComputedCompilerMembers(t *testing.T) {
	t.Run("Promise instance chains", func(t *testing.T) {
		for _, member := range []string{"then", "catch", "finally"} {
			t.Run(member, func(t *testing.T) {
				callback := "(value: number) => value"
				if member != "then" {
					callback = "() => 0"
				}
				source := "async function work(): Promise<number> { return 7 }\n" +
					"export async function main(): Promise<string[]> {\n" +
					"  const value = await work()[\"" + member + "\"](" + callback + ")\n" +
					"  return [`${value}`]\n}\n"
				files := []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: source}}
				result := compileInternalSource(t, files)
				got := strings.Join(formatDiagnosticPositions(t, files, result), " ")
				if got != "SMITHERS1401@3:23 SMITHERS1402@3:23" {
					t.Fatalf("computed %s diagnostics = %s; raw %#v", member, got, result.Diagnostics)
				}
			})
		}
	})

	t.Run("computed Result and Layer members remain legitimate", func(t *testing.T) {
		source := `import { Context } from "smthrs/context"
import { Layer } from "smthrs/provider"
class Missing extends Error {}
abstract class Clock extends Context { abstract now(): number }
const live: Clock = { now: () => 7 }
function lookup(): Result<string, Missing> { return "ada" }
function read(): string { return Clock["context"]().now().toString() }
export function main(): string[] {
  const gathered = Result["all"]([lookup()])["unwrapOr"]([])
  return Layer["provide"](Layer["succeed"](Clock, live), () => [...gathered, read()])
}
`
		result := compileInternalSource(t, []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: source}})
		requireCleanCompile(t, result)
		if got := runEmittedMain(t, result); got != "ada\n7" {
			t.Fatalf("computed compiler members printed %q", got)
		}
	})
}

func TestPinnedForkRejectedObservationsAlignWithReference(t *testing.T) {
	const resultPrelude = `class Missing extends Error {}
function lookup(): Result<string, Missing> { return "ada" }
`
	cases := []failClosedCase{
		{
			name:   "ternary discard reports both branch producers",
			source: resultPrelude + "export function main(): string[] {\n  const flag = true\n  flag ? lookup() : lookup()\n  return [\"done\"]\n}\n",
			reject: []string{"SMITHERS1301@5:10", "SMITHERS1301@5:21"},
		},
		{
			name:   "parenthesized discard reports the producer",
			source: resultPrelude + "export function main(): string[] {\n  (lookup())\n  return [\"done\"]\n}\n",
			reject: []string{"SMITHERS1301@4:4"},
		},
		{
			// specification/failures.mdx §Panic Does Not Widen a Return Type:
			// "Calling `panic(...)` MUST NOT force a function's return type to
			// widen into `Result<A, Panic>`." This case previously declared
			// SMITHERS1101 here and was the twin of the corpus case
			// 09-foreign-calls/a-panic-in-an-if-body-still-needs-the-panic-channel.
			// Both are retired by that rule: `main` keeps `string[]` and runs.
			name: "a panic in an if body keeps a plain return type",
			source: "import { panic } from \"smithers:exceptions\"\n" +
				"export function main(): string[] {\n  if (false) panic(\"unreachable\")\n  return [\"done\"]\n}\n",
			stdout: "done",
		},
		{
			// The cascade property the retired case was written for, on a shape
			// where a contract error genuinely exists: a recoverable `throw`
			// charges SMITHERS1101 at the declaration, and a panic written where
			// a VALUE is expected still charges its own placement refusal. The
			// reference reports both, so the fork must too.
			name: "a contract error does not suppress a panic placement refusal",
			source: "import { panic } from \"smithers:exceptions\"\n" +
				"class Missing extends Error {}\n" +
				"export function main(): string[] {\n" +
				"  if (false) throw new Missing()\n" +
				"  const value = false ? \"a\" : panic(\"unreachable\")\n" +
				"  return [value]\n}\n",
			reject: []string{"SMITHERS1101@3:1", "SMITHERS1503@5:31"},
		},
		{
			// specification/compatibility.mdx:72 — "Postfix `!` requires a `Result`
			// operand" — with specification/failures.mdx, "Promise Semantics":
			// "Awaiting `Promise<Result<A, E>>` MUST produce `Result<A, E>`". So
			// `await` is what removes the Promise layer, and an un-awaited
			// `Promise<Result<A, E>>` is a non-Result operand exactly like
			// `T | undefined`. specification/failures.mdx, "Accepted Placements",
			// settles what to do about it: "A rejected placement MUST be a
			// diagnostic, never a silent lowering", and it names non-Result
			// provenance as one of the separately diagnosed conditions.
			// SMITHERS1207 is also the only diagnostic that names the fix —
			// `(await checked())!`.
			//
			// This case previously asserted a lone SMITHERS1402 at the producer,
			// suppressing the 1207. That answer and the reference's were swapped by
			// two lanes correcting toward each other's pre-correction state; the
			// specification did not move.
			// 08-promise-chaining/postfix-bang-on-an-unawaited-promise-result-is-not-a-result-operand
			// pins the pair on both backends.
			name: "postfix bang on an unawaited Promise is a non-Result operand",
			source: resultPrelude + "async function checked(): Promise<Result<string, Missing>> { return \"ada\" }\n" +
				"export async function main(): Promise<Result<string[], Missing>> {\n  const value = checked()!\n  return [value]\n}\n",
			reject: []string{"SMITHERS1207@5:17"},
		},
		{
			// The same violation with the Promise left genuinely unconsumed. `!`
			// extracts nothing from a Promise, so the value flows into the binding
			// and the BINDING carries the missing-await obligation — SMITHERS1403
			// against the name, which is the bound/unbound split both backends
			// already agree on in
			// 08-promise-chaining/promise-then-on-a-bound-promise-is-rejected.
			// Above, `return [value]` transfers the binding into a container the
			// return consumes, so only the operand violation remains; here the
			// template span consumes nothing.
			name: "an unawaited Promise behind a bang still owes its await at the binding",
			source: resultPrelude + "async function checked(): Promise<Result<string, Missing>> { return \"ada\" }\n" +
				"export async function main(): Promise<Result<string[], Missing>> {\n  const value = checked()!\n  return [`${value}`]\n}\n",
			reject: []string{"SMITHERS1403@5:9", "SMITHERS1207@5:17"},
		},
		{
			// A refused module edge does NOT excuse the calls behind it.
			// specification/type-system.mdx:60 — "Every unannotated foreign call
			// MUST add the distinguished checked `panic` case" — and :56 — "An
			// ignored Result MUST be a compile error" — are conditioned on nothing
			// but the call being unannotated.
			//
			// The control that proves it is not a cascade is
			// 09-foreign-calls/the-never-annotation-is-case-sensitive: the identical
			// call in the identical shape over a module carrying a GENUINE trust
			// header is charged SMITHERS1301 at the identical position, and passes
			// on both backends. So the second diagnostic survives fixing the first
			// and is a second authored defect, not a consequence of the first.
			// Suppressing it handed back one error and hid another.
			name:    "an untrusted initializer does not excuse the foreign calls behind it",
			support: "export function read(): string { return \"value\" }\n",
			source: "import { read } from \"./foreign.ts\"\n" +
				"export function main(): string[] {\n  const value = read()\n  return [value]\n}\n",
			reject: []string{"SMITHERS1510@1:22", "SMITHERS1301@3:17"},
		},
	}
	runFailClosedCases(t, cases)
}

func TestPinnedForkProducerAnalysisRespectsExistingDiagnosticOwners(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name: "an inferred Result receiver is consumed by match",
			source: `class Missing extends Error {}
function lookup(key: string) {
  if (key !== "ada") throw new Missing()
  return "Ada"
}
export function main(): string[] {
  const outcome = lookup("ada")
  return [outcome.match({ ok: (value) => value, error: () => "missing" })]
}
`,
			stdout: "Ada",
		},
		{
			name: "the retired unwrap diagnostic owns its producer",
			source: `class Missing extends Error {}
function lookup(): Result<string, Missing> { return "Ada" }
export function main(): Result<string[], Missing> {
  const name = lookup().unwrap()
  return [name]
}
`,
			reject: []string{"SMITHERS1206@4:16"},
		},
		{
			name: "an unconsumed Result parameter reports its argument once",
			source: `class Missing extends Error {}
function lookup(): Result<string, Missing> { return "Ada" }
function ignore(outcome: Result<string, Missing>): string { return "ignored" }
export function main(): string[] { return [ignore(lookup())] }
`,
			reject: []string{"SMITHERS1301@4:51", "SMITHERS1302@3:17"},
		},
	})
}
