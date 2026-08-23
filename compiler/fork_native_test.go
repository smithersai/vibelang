package compiler

import (
	"strconv"
	"strings"
	"testing"
)

// TestPinnedForkNativePin proves the intrinsic's identity discipline, the
// complete dependency path, and the capability-only acceptance in one bridge
// build. The four identity rows are deliberately chosen so a use-site name
// matcher cannot pass them: renamed/namespace bindings do pin, while a local
// function and a same-shaped package export do not.
func TestPinnedForkNativePin(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	compile := func(t *testing.T, source string, extras ...SourceFile) CompileResult {
		t.Helper()
		files := []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: source}}
		files = append(files, extras...)
		roots := make([]string, 0, len(files))
		for _, file := range files {
			roots = append(roots, file.Path)
		}
		result, err := backend.Compile(ctx, CompileRequest{
			RootNames: roots,
			Files:     files,
			Options:   Options{},
			Lowering:  LoweringInternal,
		})
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	assertOnlyPinFailure := func(t *testing.T, source string, result CompileResult, line int, path string) {
		t.Helper()
		positions := formatDiagnosticPositions(t,
			[]SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: source}}, result)
		wantPosition := "SMITHERS3001@" + strconv.Itoa(line) + ":1"
		if len(positions) != 1 || positions[0] != wantPosition {
			t.Fatalf("diagnostics %v, want [%s]", positions, wantPosition)
		}
		for _, diagnostic := range result.Diagnostics {
			if diagnostic.Code == "SMITHERS3001" {
				want := "native pin failed: TypeScript is required through " + path
				if diagnostic.Message != want {
					t.Fatalf("pin message %q, want %q", diagnostic.Message, want)
				}
				return
			}
		}
		t.Fatal("SMITHERS3001 was absent")
	}

	t.Run("a renamed import retains compiler authority", func(t *testing.T) {
		source := "import { native as pin } from \"smithers:native\"\n" +
			"function boundary(source: string): any { return eval(source) }\n" +
			"function checksum(source: string): number { return `${boundary(source)}`.length }\n" +
			"\n" +
			"pin(checksum)\n" +
			"export function main(): string[] { return [\"unreachable\"] }\n"
		result := compile(t, source)
		assertOnlyPinFailure(t, source, result, 5, "main.sm#checksum -> main.sm#boundary")
	})

	t.Run("a namespace read retains compiler authority", func(t *testing.T) {
		source := "import * as compiler from \"smithers:native\"\n" +
			"function boundary(source: string): any { return eval(source) }\n" +
			"function checksum(source: string): number { return `${boundary(source)}`.length }\n" +
			"\n" +
			"compiler.native(checksum)\n" +
			"export function main(): string[] { return [\"unreachable\"] }\n"
		result := compile(t, source)
		assertOnlyPinFailure(t, source, result, 5, "main.sm#checksum -> main.sm#boundary")
	})

	t.Run("a local function named native remains ordinary", func(t *testing.T) {
		source := "function native<F>(pinned: F): F { return pinned }\n" +
			"function boundary(source: string): any { return eval(source) }\n" +
			"native(boundary)\n" +
			"export function main(): string[] { return [\"ordinary local\"] }\n"
		result := compile(t, source)
		if positions := formatDiagnosticPositions(t,
			[]SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: source}}, result); len(positions) != 0 {
			t.Fatalf("local native must not pin: %v", positions)
		}
		if got := runEmittedMain(t, result); got != "ordinary local" {
			t.Fatalf("emitted program printed %q", got)
		}
	})

	t.Run("a lookalike package export has no compiler authority", func(t *testing.T) {
		source := "import { native } from \"native-pin-lookalike\"\n" +
			"function boundary(source: string): any { return eval(source) }\n" +
			"native(boundary)\n" +
			"export function main(): string[] { return [\"ordinary package\"] }\n"
		lookalike := SourceFile{
			Path: "node_modules/native-pin-lookalike/index.ts",
			Kind: FileKindTypeScript,
			Text: "/**\n * @module\n * @throws {never}\n */\n" +
				"export function native<F>(pinned: F): F { return pinned }\n",
		}
		result := compile(t, source, lookalike)
		for _, diagnostic := range result.Diagnostics {
			if diagnostic.Code == "SMITHERS3001" || diagnostic.Code == "SMITHERS3005" ||
				diagnostic.Code == "TS2307" {
				t.Fatalf("lookalike package was unresolved or granted pin authority: %+v", result.Diagnostics)
			}
		}
	})

	t.Run("the transitive diagnostic names every hop", func(t *testing.T) {
		source := "import { native } from \"smithers:native\"\n" +
			"function boundary(source: string): any { return eval(source) }\n" +
			"function third(source: string): string { return `${boundary(source)}` }\n" +
			"function second(source: string): string { return third(source) }\n" +
			"function first(source: string): string { return second(source) }\n" +
			"function checksum(source: string): number { return first(source).length }\n" +
			"native(checksum)\n" +
			"export function main(): string[] { return [\"unreachable\"] }\n"
		result := compile(t, source)
		assertOnlyPinFailure(t, source, result, 7,
			"main.sm#checksum -> main.sm#first -> main.sm#second -> main.sm#third -> main.sm#boundary")
	})

	t.Run("a capability path is retained but does not block", func(t *testing.T) {
		source := "import { Context } from \"smthrs/context\"\n" +
			"import { Layer } from \"smthrs/provider\"\n" +
			"import { native } from \"smithers:native\"\n" +
			"abstract class Digest extends Context { abstract mix(seed: number, byte: number): number }\n" +
			"function checksum(input: string): number {\n" +
			"  let seed = 7\n" +
			"  for (const character of input) seed = Digest.context().mix(seed, character.charCodeAt(0))\n" +
			"  return seed\n" +
			"}\n" +
			"native(checksum)\n" +
			"const live: Digest = { mix: (seed, byte) => (seed * 31 + byte) % 65536 }\n" +
			"export function main(): string[] {\n" +
			"  return Layer.provide(Layer.succeed(Digest, live), () => [String(checksum(\"smithers\"))])\n" +
			"}\n"
		result := compile(t, source)
		if positions := formatDiagnosticPositions(t,
			[]SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: source}}, result); len(positions) != 0 {
			t.Fatalf("ordinary capability must not block a native pin: %v", positions)
		}
		if got := runEmittedMain(t, result); got != "48010" {
			t.Fatalf("emitted program printed %q", got)
		}
	})

	t.Run("an uncheckable assertion fails closed", func(t *testing.T) {
		source := "import { native } from \"smithers:native\"\n" +
			"native(function () { return 41 })\n" +
			"export function main(): string[] { return [\"unreachable\"] }\n"
		result := compile(t, source)
		positions := formatDiagnosticPositions(t,
			[]SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: source}}, result)
		if strings.Join(positions, " ") != "SMITHERS3005@2:8" {
			t.Fatalf("diagnostics %v, want SMITHERS3005@2:8", positions)
		}
	})

	t.Run("the retired marker warns and no longer pins", func(t *testing.T) {
		source := "/** @native */\n" +
			"function boundary(source: string): any { return eval(source) }\n" +
			"export function main(): string[] { return [\"marker retired\"] }\n"
		result := compile(t, source)
		seen := false
		for _, diagnostic := range result.Diagnostics {
			if diagnostic.Code == "SMITHERS3001" {
				t.Fatal("retired marker still pinned the function")
			}
			if diagnostic.Code == "SMITHERS3006" {
				seen = diagnostic.Category == DiagnosticWarning &&
					strings.Contains(diagnostic.Message, `import { native } from "smithers:native"`)
			}
		}
		if !seen {
			t.Fatalf("retired marker warning absent or malformed: %+v", result.Diagnostics)
		}
		if got := runEmittedMain(t, result); got != "marker retired" {
			t.Fatalf("emitted program printed %q", got)
		}
	})
}
