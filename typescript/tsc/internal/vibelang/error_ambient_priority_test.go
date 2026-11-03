package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Chapter 003: check the ambient-context rule before classifying members.
func TestAmbientErrorDeclarationPriority(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		for _, context := range []string{"declare %s\nexport {}", "declare namespace API { export %s }\nexport {}", "declare global { %s }\nexport {}"} {
			for _, body := range []string{
				"Entry { constructor() { super() } }",
				"Entry { set value(n: number) {} }",
				"Entry { static field = 1 }",
				"Entry { static { 1; } }",
				"Entry<T> {}",
				"Entry { _tag: string }",
				"Entry { value = 1 }",
			} {
				source := fmt.Sprintf(context, form+" "+body)
				t.Run(source, func(t *testing.T) {
					program, file, _, _ := editorProgram(t, source)
					var codes []string
					for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
						if d.Category() == diagnostics.CategoryError {
							codes = append(codes, fmt.Sprintf("%s%d", d.Source(), d.Code()))
						}
					}
					if len(codes) != 1 || codes[0] != "EK1307" {
						t.Fatalf("want EK1307 alone, got %v", codes)
					}
				})
			}
		}
	}
}

func TestAmbientErrorDeclarationPriorityControls(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		t.Run(form, func(t *testing.T) {
			source := "declare " + form + " Ambient { static value = 1 }\n" +
				form + " Runtime { static value = 1 }\n" +
				"const independent: number = \"wrong\"\nexport {}\n"
			program, file, _, _ := editorProgram(t, source)
			counts := map[int32]int{}
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					counts[d.Code()]++
				}
			}
			if len(counts) != 3 || counts[1307] != 1 || counts[1302] != 1 || counts[2322] != 1 {
				t.Fatalf("want ambient EK1307, nonambient EK1302 and independent TS2322, got %v", counts)
			}
		})
	}
	for _, source := range []string{
		"declare class Native { value = 1 }\nexport {}",
		"declare class Native { method() { return 1 } }\nexport {}",
	} {
		program, file, _, _ := editorProgram(t, source)
		found := false
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			found = found || d.Source() == "" && (d.Code() == 1039 || d.Code() == 1183)
		}
		if !found {
			t.Fatalf("native ambient class must keep its error: %s", source)
		}
	}
}

func TestAmbientErrorDeclarationPriorityKeepsNativeBodyErrors(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		source := "declare " + form + " Entry { get value(): number { return \"wrong\" } }\nexport {}"
		program, file, _, _ := editorProgram(t, source)
		counts := map[int32]int{}
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Category() == diagnostics.CategoryError {
				counts[d.Code()]++
			}
		}
		if len(counts) != 2 || counts[1307] != 1 || counts[2322] != 1 {
			t.Fatalf("want EK1307 and independent getter TS2322, got %v", counts)
		}
	}
}

func TestAmbientErrorDeclarationPriorityCombined(t *testing.T) {
	for _, source := range []string{`// expect: EK1307
// VIP-13/29 and chapter 003: ambient rejection precedes member classification.
declare error WrittenConstructor { constructor() { super() } }
declare schema error WrittenSetter { set value(n: number) {} }
declare namespace API {
  export error StaticMember { static value = 1 }
  export schema error Generic<T> {}
}
declare global {
  error ReservedTag { _tag: string }
  schema error Initialized { value = 1 }
}
export {}
`, "declare error Entry { constructor() { super() }; static field = 1 }\nexport {}", "declare schema error Entry { constructor() { super() }; static field = 1 }\nexport {}"} {
		program, file, _, _ := editorProgram(t, source)
		count := 0
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Category() == diagnostics.CategoryError {
				if d.Source() != diagnosticSource || d.Code() != 1307 {
					t.Errorf("unexpected diagnostic: %s", d.String())
				}
				count++
			}
		}
		if count == 0 {
			t.Error("missing EK1307")
		}
	}
}
