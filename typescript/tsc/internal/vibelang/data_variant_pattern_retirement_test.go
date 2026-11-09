package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-7, chapter004: variant constructors are values, not class patterns.
func TestDataVariantClassPatternRetirement(t *testing.T) {
	for _, decl := range []struct{ name, source, matcher string }{
		{"direct", "data D { A; B { n:number } };", "D.A"},
		{"alias", "data D { A; B { n:number } };const Alias=D;", "Alias.A"},
		{"namespace", "namespace N {export data D { A; B { n:number } }};", "N.D.A"},
		{"generic", "data D<T> { A; B { n:T } };", "D.A"},
	} {
		for _, suffix := range []string{"", "()", "(let value)", " { }"} {
			for _, use := range []string{"match(x){when %s:1;default:0;}", "x is %s"} {
				source := decl.source + "export function f(x:unknown){return " + fmt.Sprintf(use, decl.matcher+suffix) + "}"
				t.Run(decl.name+suffix+use, func(t *testing.T) {
					program, file, _, _ := editorProgram(t, source)
					count := 0
					for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
						if d.Category() != diagnostics.CategoryError {
							continue
						}
						if d.Source() == diagnosticSource && d.Code() == 702 {
							count++
						} else {
							t.Errorf("independent error: %s", d.String())
						}
					}
					if count != 1 {
						t.Fatalf("want one EK0702, got %d", count)
					}
				})
			}
		}
	}
}

func TestDataVariantClassPatternIndependentError(t *testing.T) {
	program, file, _, _ := editorProgram(t, "data D {A};export function f(x:unknown){return match(x){when D.A: missingName;default:0;}}")
	codes := map[int32]bool{}
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		codes[d.Code()] = true
	}
	if !codes[702] || !codes[2304] {
		t.Fatalf("want EK0702 and TS2304, got %v", codes)
	}
}
