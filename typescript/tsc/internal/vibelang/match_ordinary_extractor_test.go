package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestOrdinaryClassExtractorDiagnostic(t *testing.T) {
	// Chapter 004: TestOrdinaryClassExtractorDiagnostic; rule-evidence: docs/design/src/004-match.md#68ebc38754714647
	// Chapter 004: TestOrdinaryClassExtractorDiagnostic; rule-evidence: docs/design/src/004-match.md#1761f4f2b8111988
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

// Chapter 004, Class patterns: a callee typed any has neither signature, so
// its pattern is EK0702, never the ordinary extractor's EK0704.
func TestOrdinaryClassExtractorAnyCallee(t *testing.T) {
	program, file, _, _ := editorProgram(t, "class C {}; const hidden:any=C; function f(s:unknown){return match(s){when hidden():1;default:0;}}")
	var codes []int32
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() == diagnostics.CategoryError {
			codes = append(codes, d.Code())
		}
	}
	if len(codes) != 1 || codes[0] != 702 {
		t.Fatalf("want one EK0702, got %v", codes)
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
