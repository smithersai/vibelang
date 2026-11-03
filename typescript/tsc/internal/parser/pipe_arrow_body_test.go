package parser

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// VIP-23/detail246 rejects a whole bare arrow, including a block body,
// but parentheses, argument lists and object literals shield nested arrows.
func TestPipeArrowBodyAdmission(t *testing.T) {
	arrows := []string{
		"() => %", "async () => %", "effect () => %",
		"(x: number) => % + x", "async (x: number) => % + x", "effect (x: number) => % + x",
		"x => %", "async x => %", "effect x => %",
		"<T>(x: T) => [%, x]", "async <T>(x: T) => [%, x]", "effect <T>(x: T) => [%, x]",
		"() => { return % }", "async () => { return % }", "effect () => { return % }",
		"(): number => %", "async (): Promise<number> => %", "effect (): number!! => %",
		"() => 2 |> % + 1", "async () => 2 |> % + 1", "effect () => 2 |> % + 1",
	}
	for _, arrow := range arrows {
		for _, stages := range []string{"", "% + 1 |> ", "% + 1 |> % * 2 |> "} {
			for _, wrapped := range []bool{false, true} {
				body := arrow
				if wrapped {
					body = "(" + body + ")"
				}
				source := "export const value = 1 |> " + stages + body + ";\nexport const after = 2;"
				t.Run(fmt.Sprintf("%s/%s/%v", arrow, stages, wrapped), func(t *testing.T) {
					file := ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath("/main.vibe"), PathKey: tspath.PathKey("/main.vibe")}, source, core.ScriptKindTS)
					ds := file.Diagnostics()
					if wrapped {
						if len(ds) != 0 {
							t.Fatalf("parenthesized arrow: %v", ds)
						}
					} else if len(ds) != 1 || ds[0].Source() != "EK" || ds[0].Code() != 2301 {
						t.Fatalf("whole bare arrow needs exactly EK2301: %v", ds)
					}
					if len(file.Statements.Nodes) != 2 {
						t.Fatalf("lost following statement: %s", source)
					}
				})
			}
		}
	}
	for _, body := range []string{
		"({ f: () => % })", "[() => %]", "f(() => %)",
		"effect { return % }", "(function () { return % })",
		"async(%)", "effect(%)", "% % 2", "(% ? 1 : 2)",
		"(% |> % + 1)", "({ f: effect () => % })",
	} {
		t.Run(body, func(t *testing.T) {
			source := "const value = 1 |> " + body
			file := ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath("/main.vibe"), PathKey: tspath.PathKey("/main.vibe")}, source, core.ScriptKindTS)
			if ds := file.Diagnostics(); len(ds) != 0 {
				t.Fatalf("nested/ordinary control: %v", ds)
			}
		})
	}
}

// This recovery belongs only to the adopted pipe grammar in .vibe.
func TestPipeArrowBodyNativeSyntaxUnchanged(t *testing.T) {
	for _, source := range []string{
		"const value = () => 1", "const value = async () => 1",
		"const value = <T>(x: T) => x", "const value = 1 |> () => 1",
	} {
		t.Run(source, func(t *testing.T) {
			file := ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath("/main.ts"), PathKey: tspath.PathKey("/main.ts")}, source, core.ScriptKindTS)
			for _, d := range file.Diagnostics() {
				if d.Source() == "EK" {
					t.Fatalf("native TypeScript gained a Vibe diagnostic: %v", d)
				}
			}
		})
	}
}

// Recovering the pipe body must retain the independently invalid Effect head.
func TestPipeArrowBodyKeepsHeadDiagnostic(t *testing.T) {
	source := "const value = 1 |> effect x: number => %"
	file := ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath("/main.vibe"), PathKey: tspath.PathKey("/main.vibe")}, source, core.ScriptKindTS)
	ds := file.Diagnostics()
	if len(ds) != 2 || ds[0].Source() != "EK" || ds[0].Code() != 109 || ds[1].Source() != "EK" || ds[1].Code() != 2301 {
		t.Fatalf("want both head EK0109 and body EK2301: %v", ds)
	}
}

// A pipe in a conditional's true branch keeps TypeScript's colon boundary.
// The parenthesized assignment is not a typed arrow head.
func TestPipeArrowBodyConditionalColon(t *testing.T) {
	for _, condition := range []string{"true", "false"} {
		source := "let n = 0; export const value: number | ((m: number) => number) = " + condition + " ? 1 |> (n = %) : m => m;"
		file := ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath("/main.vibe"), PathKey: tspath.PathKey("/main.vibe")}, source, core.ScriptKindTS)
		if ds := file.Diagnostics(); len(ds) != 0 {
			t.Fatalf("conditional colon was captured as an arrow return type: %v", ds)
		}
	}
}
