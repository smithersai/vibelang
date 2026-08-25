package compiler

import (
	"strings"
	"testing"
)

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
