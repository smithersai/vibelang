package parser

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// Chapter 2: "The existing conditional, yield, assignment and arrow
// covering-production errors remain", under EK2301. A whole unparenthesized
// yield or assignment pipe body reports EK2301 alone, keeps the following
// statement, and parentheses admit it.
func TestPipeCoveringBodyYieldAndAssignment(t *testing.T) {
	parse := func(name, source string) *ast.SourceFile {
		return ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(name), PathKey: tspath.PathKey(name)}, source, core.ScriptKindTS)
	}
	bodies := []string{"yield %", "yield", "z = %", "z += %", "z ??= %", "z ||= %", "z **= %", "z >>= %", "z >>>= %", "o.k = %", "o[k] = %", "[a] = [%]", "z = y = %"}
	for _, body := range bodies {
		for _, stages := range []string{"", "% + 1 |> "} {
			for _, wrapped := range []bool{false, true} {
				b := body
				if wrapped {
					b = "(" + b + ")"
				}
				source := "declare let z: number, y: number, a: number; declare const o: any, k: string\nexport function* g() { const r = 1 |> " + stages + b + "; return r }\nexport const after = 2"
				t.Run(stages+b, func(t *testing.T) {
					file := parse("/main.vibe", source)
					ds := file.Diagnostics()
					if wrapped {
						if len(ds) != 0 {
							t.Fatalf("parenthesized body: %v", ds)
						}
					} else if len(ds) != 1 || ds[0].Source() != "EK" || ds[0].Code() != 2301 {
						t.Fatalf("whole bare body needs exactly EK2301: %v", ds)
					}
					if n := len(file.Statements.Nodes); n != 4 {
						t.Fatalf("lost a statement (%d): %s", n, source)
					}
				})
			}
		}
	}
	// Ordinary bodies and a pipe inside an assignment stay valid.
	for _, source := range []string{
		"let z = 0; z = 1 |> % + 1",
		"let z = 0; z += 1 |> % + 1",
		"export function* g() { yield 1 |> % + 1 }",
		"declare const c: boolean; let n = 0; const v = c ? 1 |> (n = %) : 2",
		"const v = 1 |> % === 1",
		"const v = 1 |> % >= 1",
	} {
		t.Run(source, func(t *testing.T) {
			if ds := parse("/main.vibe", source).Diagnostics(); len(ds) != 0 {
				t.Fatalf("control: %v", ds)
			}
		})
	}
	// A .ts file has no pipe grammar.
	for _, d := range parse("/main.ts", "let z = 0; const v = 1 |> z = 2").Diagnostics() {
		if d.Source() == "EK" {
			t.Fatalf("native TypeScript gained a Vibe diagnostic: %v", d)
		}
	}
}
