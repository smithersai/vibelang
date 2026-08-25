package compiler

import (
	"os"
	"sort"
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
