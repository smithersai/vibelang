package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestAmbientSchemaDataRetainsIndependentDiagnostics(t *testing.T) {
	for _, tc := range []struct {
		source string
		native int32
	}{
		{"declare schema Row { n: number }; const independent: number = \"bad\"; export {}", 2322},
		{"declare namespace N { data Choice { A } } const independent: number = \"bad\"; export {}", 2322},
		{"declare schema Row { n: number }; const missing: number; export {}", 1155},
		{"declare namespace N { data Choice { A } } class C { readonly readonly n: number = 1 }; export {}", 1030},
	} {
		source := tc.source
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			all := append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...)
			primary, independent := 0, false
			for _, d := range all {
				if d.Source() == "EK" && (d.Code() == 1506 || d.Code() == 1607) {
					primary++
				}
				if d.Code() == tc.native {
					independent = true
				}
				if d.Code() == 1039 || d.Code() == 1254 {
					t.Errorf("duplicate ambient initializer root cause: %v", d)
				}
			}
			if primary != 1 || !independent {
				t.Fatalf("primary=%d independent=%v diagnostics=%v", primary, independent, all)
			}
		})
	}
}

func TestAmbientSchemaDataPrimaryDiagnostics(t *testing.T) {
	for _, form := range []struct {
		source string
		code   int32
	}{
		{"schema Row { n: number }", 1506}, {"schema Row = string", 1506}, {"data Choice { A; B { n: number } }", 1607}, {"data Choice<T> { A; B { n: T } }", 1607}, {"schema Row", 1506}, {"data Choice", 1607}, {"data Choice<T>", 1607},
	} {
		for _, wrap := range []string{"declare %s", "export declare %s", "declare namespace N { %s }", "declare namespace N { export %s }", "declare namespace N.Inner { %s }", "export {}; declare global { %s }", "declare namespace N { namespace Inner { %s } }"} {
			source := fmt.Sprintf(wrap, form.source)
			t.Run(source, func(t *testing.T) {
				program, file, _, _ := editorProgram(t, source)
				all := append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...)
				count := 0
				for _, d := range all {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					count++
					if d.Source() != "EK" || d.Code() != form.code {
						t.Errorf("want primary EK%04d, got %v", form.code, d)
					}
				}
				if count != 1 {
					t.Fatalf("want one primary error, got %d: %v", count, all)
				}
			})
		}
	}
}
