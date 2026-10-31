package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Decided detail248 reconciles VIP-13/29 runtime constructors with TypeScript
// ambient declarations. Native ambient classes retain their erased meaning.
func TestAmbientErrorDeclarationRejected(t *testing.T) {
	contexts := []string{
		"declare %s\nexport {}\n",
		"export declare %s\n",
		"declare namespace API { export %s }\nexport {}\n",
		"declare namespace API { namespace Nested { export %s } }\nexport {}\n",
		"declare global { %s }\nexport {}\n",
	}
	for _, form := range []string{"error", "schema error"} {
		for _, body := range []string{"", " { id: string }"} {
			for i, context := range contexts {
				t.Run(fmt.Sprintf("%s/body%t/context%d", form, body != "", i), func(t *testing.T) {
					source := fmt.Sprintf(context, form+" Missing"+body)
					program, file, _, _ := editorProgram(t, source)
					count := 0
					for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
						if d.Code() == 1307 {
							count++
							if d.Source() != diagnosticSource || d.Category() != diagnostics.CategoryError {
								t.Errorf("EK1307 must be an owning error: %s", d.String())
							}
						}
					}
					if count != 1 {
						t.Fatalf("got %d EK1307 diagnostics, want 1 for ambient declaration:\n%s", count, source)
					}
				})
			}
		}
	}
}

func TestAmbientErrorDeclarationControls(t *testing.T) {
	for i, source := range []string{
		"export error Missing\n",
		"export schema error Missing\n",
		"export error Missing { id: string }\n",
		"export schema error Missing { id: string }\n",
		"namespace API { export error Missing { id: string } }\nexport {}\n",
		"namespace API { export schema error Missing { id: string } }\nexport {}\n",
		"export declare class Missing { readonly id: string }\n",
		"declare namespace API { export class Missing { readonly id: string } }\nexport {}\n",
		"declare const error: number; export { error }\n",
		"declare namespace API { const error: number }\nexport {}\n",
	} {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("valid native/nonambient control: %s\n%s", d.String(), source)
				}
			}
		})
	}
}

// An erased native class cannot be repaired into a runtime-only custom
// declaration. Inherited ambientness matters just as explicit declare does.
func TestAmbientErrorClassTeachingControls(t *testing.T) {
	for i, source := range []string{
		"export declare class Missing extends Data.TaggedError(\"Missing\")<{ readonly id: string }> {}\n",
		"declare namespace API { export class Missing extends Data.TaggedError(\"Missing\")<{ readonly id: string }> {} }\nexport {}\n",
		"export declare class Missing extends Schema.TaggedError<Missing>()(\"Missing\", { id: Schema.String }) {}\n",
		"declare namespace API { export class Missing extends Schema.TaggedError<Missing>()(\"Missing\", { id: Schema.String }) {} }\nexport {}\n",
	} {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == 4830 || d.Code() == 4837 || d.Category() == diagnostics.CategoryError {
					t.Errorf("ambient native class must retain its erased form: %s", d.String())
				}
			}
		})
	}
}

func TestAmbientErrorDeclarationExternalModule(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		for _, body := range []string{"", " { id: string }"} {
			t.Run(form+body, func(t *testing.T) {
				source := fmt.Sprintf("declare module %q { export %s Missing%s }", "ambient-errors", form, body)
				program, file, _, _ := editorProgram(t, source)
				count := 0
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Code() == 1307 {
						count++
					}
				}
				if count != 1 {
					t.Fatalf("got %d EK1307 diagnostics in external module, want1:\n%s", count, source)
				}
			})
		}
	}
}

func TestAmbientErrorDeclarationSubclass(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		for _, context := range []string{"declare %s", "declare namespace API { export %s }"} {
			t.Run(form+"/"+context, func(t *testing.T) {
				source := form + " Root\n" + fmt.Sprintf(context, form+" Child extends Root") + "\nexport {}\n"
				program, file, _, _ := editorProgram(t, source)
				count := 0
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Code() == 1307 {
						count++
					}
				}
				if count != 1 {
					t.Fatalf("got %d EK1307 diagnostics for ambient subclass, want1:\n%s", count, source)
				}
			})
		}
	}
}

func TestAmbientErrorDeclarationKeepsIndependentErrors(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		t.Run(form, func(t *testing.T) {
			source := "declare " + form + " Missing { id: NoSuchPayload }\nexport {}\n"
			program, file, _, _ := editorProgram(t, source)
			seenAmbient, seenPayload := false, false
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				seenAmbient = seenAmbient || d.Code() == 1307
				seenPayload = seenPayload || d.Code() == 2304
			}
			if !seenAmbient || !seenPayload {
				t.Fatalf("ambient=%v independent payload error=%v, want both", seenAmbient, seenPayload)
			}
		})
	}
}
