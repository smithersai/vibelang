package compiler

import (
	"strings"
	"testing"
)

// Re-export and value-provenance behavior in the pinned fork.
//
// This file used to observe all of it through the portability (native) pin,
// which was the only channel that reported a transitive requirement graph. The
// pin, the `TypeScript` requirement and the portable/required/forbidden
// classification were withdrawn from the specification on 2026-08-23, so the
// pin-only assertions went with them. What is asserted here now is what
// survived the withdrawal and still depends on the same traversal:
//
//   - the module-edge trust rule across re-exports (SMITHERS1510), which
//     `staticRuntimeModuleEdge` and `nativeExportIsTypeOnly` own;
//   - compile-time asset identity through a re-export, which
//     `assetProvenanceThroughBindings` owns;
//   - the failure channel's invoked-where-defined boundary, which
//     `nativeInvokedWhereDefined` owns.
//
// Each of the three is a survivor of the removal, so each is asserted in BOTH
// directions: a deletion that quietly stops charging is the failure mode this
// file exists to catch.

func compileReExportProject(t *testing.T, backend Compiler, source string, extras ...SourceFile) CompileResult {
	t.Helper()
	files := append([]SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: source}}, extras...)
	result, err := backend.Compile(t.Context(), CompileRequest{
		RootNames: []string{"main.sm"},
		Files:     files,
		Options:   Options{},
		Lowering:  LoweringInternal,
	})
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func diagnosticMessages(result CompileResult, code string) []string {
	messages := make([]string, 0)
	for _, diagnostic := range result.Diagnostics {
		if diagnostic.Code == code {
			messages = append(messages, diagnostic.Message)
		}
	}
	return messages
}

func requireNoDiagnostic(t *testing.T, result CompileResult, code string) {
	t.Helper()
	if messages := diagnosticMessages(result, code); len(messages) != 0 {
		t.Fatalf("unexpected %s diagnostics %#v; all diagnostics %#v", code, messages, result.Diagnostics)
	}
}

// TestPinnedForkReExportModuleEdgeTrust is the surviving half of what the pin
// used to observe one module further away: a re-export runs the target
// module's initializer exactly as an import does, so it needs the same
// initialization trust claim. specification/compatibility.mdx, "Foreign
// Boundary". Both directions, because a walk that stopped following
// re-exports would satisfy the negative automatically.
func TestPinnedForkReExportModuleEdgeTrust(t *testing.T) {
	backend, _ := newPinnedTestBackend(t)

	t.Run("named re-export of an untrusted foreign module is charged", func(t *testing.T) {
		source := "import { helper } from \"./launder.sm\"\n" +
			"export function main(): string[] { return [typeof helper] }\n"
		result := compileReExportProject(t, backend, source,
			SourceFile{Path: "launder.sm", Kind: FileKindSmithers,
				Text: "export { helper } from \"./untrusted.ts\"\n"},
			SourceFile{Path: "untrusted.ts", Kind: FileKindTypeScript,
				Text: "export function helper(value: number): number { return value + 1 }\n"},
		)
		if len(diagnosticMessages(result, "SMITHERS1510")) == 0 {
			t.Fatalf("a re-export of an untrusted foreign module must be charged: %#v", result.Diagnostics)
		}
	})

	t.Run("type-only re-export is not charged", func(t *testing.T) {
		source := "import type { Settings } from \"./types.sm\"\n" +
			"const local: Settings = { size: 3 }\n" +
			"export function main(): string[] { return [String(local.size)] }\n"
		result := compileReExportProject(t, backend, source,
			SourceFile{Path: "types.sm", Kind: FileKindSmithers,
				Text: "export type { Settings } from \"./foreign.ts\"\n"},
			SourceFile{Path: "foreign.ts", Kind: FileKindTypeScript,
				Text: "export interface Settings { readonly size: number }\n"},
		)
		if result.EmitSkipped || len(result.Diagnostics) != 0 {
			t.Fatalf("a type-only re-export adds no runtime module edge: %#v", result.Diagnostics)
		}
	})
}

// TestPinnedForkReExportAcceptanceControls is the negative table: project
// values, compiler-owned virtual modules, and compile-time assets reached
// through a re-export are NOT foreign runtime edges. Before the withdrawal
// this table was written as native pins; the acceptance it measures is
// unchanged, so it is now measured as an ordinary clean compile plus the
// emitted artifact.
func TestPinnedForkReExportAcceptanceControls(t *testing.T) {
	backend, _ := newPinnedTestBackend(t)

	t.Run("ordinary project values through named and star exports", func(t *testing.T) {
		source := "import { LIMIT } from \"./named.sm\"\nimport { STEP } from \"./star.sm\"\n" +
			"export function main(): string[] { return [String(LIMIT + STEP)] }\n"
		result := compileReExportProject(t, backend, source,
			SourceFile{Path: "named.sm", Kind: FileKindSmithers, Text: `export { LIMIT } from "./values.sm"` + "\n"},
			SourceFile{Path: "star.sm", Kind: FileKindSmithers, Text: `export * from "./values.sm"` + "\n"},
			SourceFile{Path: "values.sm", Kind: FileKindSmithers, Text: "export const LIMIT = 1\nexport const STEP = 2\n"},
		)
		if result.EmitSkipped || len(result.Diagnostics) != 0 {
			t.Fatalf("clean re-exports must compile: %#v", result.Diagnostics)
		}
		if got := runEmittedMain(t, result); got != "3" {
			t.Fatalf("clean re-export program printed %q", got)
		}
	})

	t.Run("compiler-owned virtual modules", func(t *testing.T) {
		source := "import { Layer, Context } from \"./compiler.sm\"\n" +
			"export function main(): string[] { void Layer; void Context; return [\"1\"] }\n"
		result := compileReExportProject(t, backend, source,
			SourceFile{Path: "compiler.sm", Kind: FileKindSmithers,
				Text: "export { Layer } from \"smthrs/provider\"\nexport * from \"smthrs/context\"\n"},
		)
		if result.EmitSkipped || len(result.Diagnostics) != 0 {
			t.Fatalf("compiler-owned re-exports must remain edge-free: %#v", result.Diagnostics)
		}
		if got := runEmittedMain(t, result); got != "1" {
			t.Fatalf("compiler-owned re-export program printed %q", got)
		}
	})

	// This is the case `assetProvenanceThroughBindings` exists for: the asset
	// arrives one module away, so the direct import lookup cannot answer it and
	// the binding walk has to. If the walk stopped answering, the specifier
	// would reach the runtime artifact, which is what the last assertion reads.
	t.Run("compile-time asset re-export", func(t *testing.T) {
		source := "import { config } from \"./asset.sm\"\n" +
			"export function main(): string[] { return [String(config.answer)] }\n"
		result := compileReExportProject(t, backend, source,
			SourceFile{Path: "asset.sm", Kind: FileKindSmithers,
				Text: `export { default as config } from "./config.json" with { type: "json", mode: "const" }` + "\n"},
			SourceFile{Path: "config.json", Kind: FileKindAsset, Text: `{"answer":42}`},
		)
		if result.EmitSkipped || len(result.Diagnostics) != 0 {
			t.Fatalf("asset re-export must remain compile-time-only: %#v", result.Diagnostics)
		}
		if got := runEmittedMain(t, result); got != "42" {
			t.Fatalf("asset re-export program printed %q", got)
		}
		for path, text := range artifactTextsByPath(t, result.Artifacts) {
			if strings.HasSuffix(path, ".js") && strings.Contains(text, "config.json") {
				t.Fatalf("asset specifier reached runtime artifact %s:\n%s", path, text)
			}
		}
	})
}

// TestPinnedForkInvokedWhereDefinedChargesTheFailureChannel is the surviving
// observation of `nativeInvokedWhereDefined`. The pin used to be its only
// channel; `collectFacts` is the other one, and it is load-bearing for the
// failure row rather than for portability: a callable INVOKED where it is
// written runs, so its `throw` is the enclosing function's failure, and a
// callable merely DEFINED does not.
func TestPinnedForkInvokedWhereDefinedChargesTheFailureChannel(t *testing.T) {
	const boom = "export class Boom extends Error {\n" +
		"  constructor(readonly value: number) { super(`bad ${value}`) }\n" +
		"}\n"

	runFailClosedCases(t, []failClosedCase{
		{
			name: "an immediately invoked throw is the enclosing function's failure",
			source: boom + "\nexport function halve(value: number) {\n" +
				"  return (() => { if (value < 0) throw new Boom(value); return value / 2 })()\n" +
				"}\n",
			reject: []string{"SMITHERS1102@5:1"},
		},
		{
			// The same body, merely DEFINED. If the walk charged it, `halve`
			// would be fallible and would need the Result contract the case
			// above reports; a clean compile is the assertion.
			name: "a callable merely defined is not invoked and charges nothing",
			source: boom + "\nexport function halve(value: number) {\n" +
				"  const deferred = () => { if (value < 0) throw new Boom(value); return value / 2 }\n" +
				"  return typeof deferred\n" +
				"}\n" +
				"\nexport function main(): string[] { return [halve(8)] }\n",
			stdout: "function",
		},
	})
}
