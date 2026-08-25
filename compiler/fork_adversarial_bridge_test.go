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

func TestPinnedForkDynamicCodeImportsFailClosed(t *testing.T) {
	const trusted = "/** @module @throws {never} */\nexport const value = \"trusted\"\n"
	const untrusted = "export const value = \"untrusted\"\n"
	const projectModule = "export const value = \"project\"\n"
	cases := []struct {
		name    string
		source  string
		modules []SourceFile
		needle  string
	}{
		{
			name:    "untrusted foreign literal",
			source:  "export async function main(): Promise<string[]> {\n  const loaded = await import(\"./foreign.ts\")\n  return [loaded.value]\n}\n",
			modules: []SourceFile{{Path: "foreign.ts", Kind: FileKindTypeScript, Text: untrusted}},
			needle:  "\"./foreign.ts\"",
		},
		{
			name:    "trusted foreign literal is conservatively deferred too",
			source:  "export async function main(): Promise<string[]> {\n  const loaded = await import(\"./foreign.ts\")\n  return [loaded.value]\n}\n",
			modules: []SourceFile{{Path: "foreign.ts", Kind: FileKindTypeScript, Text: trusted}},
			needle:  "\"./foreign.ts\"",
		},
		{
			name:    "project module literal",
			source:  "export async function main(): Promise<string[]> {\n  const loaded = await import(\"./helper.sm\")\n  return [loaded.value]\n}\n",
			modules: []SourceFile{{Path: "helper.sm", Kind: FileKindSmithers, Text: projectModule}},
			needle:  "\"./helper.sm\"",
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
			name: "panic contract error has no lowering cascade",
			source: "import { panic } from \"smithers:exceptions\"\n" +
				"export function main(): string[] {\n  if (false) panic(\"unreachable\")\n  return [\"done\"]\n}\n",
			reject: []string{"SMITHERS1101@2:1"},
		},
		{
			name: "postfix bang on an unawaited Promise reports the producer",
			source: resultPrelude + "async function checked(): Promise<Result<string, Missing>> { return \"ada\" }\n" +
				"export async function main(): Promise<Result<string[], Missing>> {\n  const value = checked()!\n  return [value]\n}\n",
			reject: []string{"SMITHERS1402@5:17"},
		},
		{
			name:    "untrusted initializer suppresses foreign call cascades",
			support: "export function read(): string { return \"value\" }\n",
			source: "import { read } from \"./foreign.ts\"\n" +
				"export function main(): string[] {\n  const value = read()\n  return [value]\n}\n",
			reject: []string{"SMITHERS1510@1:22"},
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
