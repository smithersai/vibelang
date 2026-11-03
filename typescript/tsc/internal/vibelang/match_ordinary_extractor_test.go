package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestOrdinaryClassExtractorDiagnostic(t *testing.T) {
	for _, declaration := range []string{
		"class C {}",
		"class Base {}; class C extends Base {}",
		"class Base {}; const C = Base",
		"namespace N { export class C {} }; const C = N.C",
		"import { customMatcher as key } from 'vibelang-runtime'; class Base { static [key]() { return [] } }; class C extends Base {}",
		"declare const C: new () => object",
	} {
		for _, pattern := range []string{"C()", "C(let x)", "C(let x, let y)", "C(...let xs)"} {
			for _, use := range []string{
				"function f(s:unknown){return match(s){when %s:1;default:0;}}",
				"function f(s:unknown){return s is %s}",
			} {
				source := declaration + "; " + fmt.Sprintf(use, pattern)
				t.Run(source, func(t *testing.T) {
					program, file, _, _ := editorProgram(t, source)
					count := 0
					for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
						if d.Code() == 704 && d.Source() == diagnosticSource {
							count++
						} else if d.Category() == diagnostics.CategoryError {
							t.Errorf("independent error: %s", d.String())
						}
					}
					if count != 1 {
						t.Errorf("got %d EK0704 diagnostics; want one", count)
					}
				})
			}
		}
	}
}

func TestOrdinaryClassExtractorControls(t *testing.T) {
	for _, source := range []string{
		"class C {}; function f(s:unknown){return match(s){when C:1;default:0;}}",
		"class C {}; function f(s:unknown){return s is C}",
		"function C(s:unknown){return [s]}; function f(s:unknown){return match(s){when C(let x):x;default:0;}}",
		"function f(s:unknown){return match(s){when Map(let x):x;default:0;}}",
		"function f(s:unknown){return match(s){when String(let x):x;default:0;}}",
		"error E; function f(s:E){return match(s){when E(let x):x;default:null;}}",
		"class C {}; const hidden:any=C; function f(s:unknown){return match(s){when hidden():1;default:0;}}",
		"import { customMatcher as key } from 'vibelang-runtime'; class C { static [key](s:unknown){return [s]} }; function f(s:unknown){return match(s){when C(let x):x;default:0;}}",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("%s%d: %s", d.Source(), d.Code(), d.String())
				}
			}
		})
	}
}

func TestOrdinaryClassExtractorQuickFix(t *testing.T) {
	for _, test := range []struct{ source, want string }{
		{"class C {}; function f(s:unknown){return match(s){when C():1;default:0;}}", "class C {}; function f(s:unknown){return match(s){when C:1;default:0;}}"},
		{"class C { constructor(readonly x:number, public y:string){} }; function f(s:unknown){return match(s){when C(let a, const b):a+b;default:'';}}", "class C { constructor(readonly x:number, public y:string){} }; function f(s:unknown){return match(s){when C and { x: let a, y: const b }:a+b;default:'';}}"},
	} {
		got := applyQuickFixOf(t, test.source, 704, diagnostics.CategoryError)
		if got != test.want {
			t.Fatalf("got:\n%s\nwant:\n%s", got, test.want)
		}
		program, file, _, _ := editorProgram(t, got)
		for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("fixed source: %s", d.String())
			}
		}
	}
}

func TestOrdinaryClassExtractorKeepsIndependentError(t *testing.T) {
	program, file, _, _ := editorProgram(t, "class C {}; function f(s:unknown){return match(s){when C(let x):missingName;default:0;}}")
	seen := map[int32]bool{}
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		seen[d.Code()] = true
	}
	if !seen[704] || !seen[2304] {
		t.Errorf("want EK0704 and TS2304, got %v", seen)
	}
}

func TestOrdinaryClassExtractorShadowsPrimitives(t *testing.T) {
	for _, name := range []string{"String", "Number", "Boolean", "BigInt", "Symbol"} {
		for _, arguments := range []string{"()", "(let value)"} {
			source := "class " + name + " {}; function f(s:unknown){return match(s){when " + name + arguments + ":1;default:0;}}"
			t.Run(name+arguments, func(t *testing.T) {
				program, file, _, _ := editorProgram(t, source)
				found := false
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					found = found || d.Code() == 704
				}
				if !found {
					t.Fatal("missing EK0704 for shadowed primitive")
				}
			})
		}
	}
}

func TestOrdinaryClassExtractorQuickFixKeepsComments(t *testing.T) {
	source := "class C { constructor(readonly x:number){} }; function f(s:unknown){return match(s){when C /* callee */ (/* before */ let /* name */ a /* after */, // trailing\n):a;default:0;}}"
	got := applyQuickFixOf(t, source, 704, diagnostics.CategoryError)
	for _, comment := range []string{"/* callee */", "/* before */", "/* name */", "/* after */", "// trailing\n"} {
		if !strings.Contains(got, comment) {
			t.Errorf("lost comment %q in %s", comment, got)
		}
	}
	program, file, _, _ := editorProgram(t, got)
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("fixed source: %s", d.String())
		}
	}
}
