package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestWholeServiceNamelessMembers(t *testing.T) {
	for _, shape := range []string{": Shape", ": number"} {
		for _, member := range []string{
			"[key: string]: unknown",
			"readonly [key: symbol]: unknown",
			"[key: number]: unknown",
			"constructor() { super() }",
			"(): number",
			"(value: string): string",
			"<T>(value: T): T",
			"new(): number",
			"new<T>(value: T): T",
		} {
			t.Run(shape+"/"+member, func(t *testing.T) {
				source := "type Shape = number; export service S" + shape + " { static readonly key = \"whole/S\"; " + member + " }"
				p, file, _, _ := editorProgram(t, source)
				got := 0
				for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					if d.Source() == diagnosticSource && d.Code() == 902 {
						got++
					} else {
						t.Errorf("unexpected: %s", d.String())
					}
				}
				if got != 1 {
					t.Fatalf("want one EK0902, got %d: %s", got, source)
				}
			})
		}
	}
}

func TestWholeServiceNamelessControls(t *testing.T) {
	const source = "export service S: number { static readonly key = \"whole/S\" }\nexport class Ordinary { [key: string]: unknown; constructor(public readonly n: number) {} }\n"
	for _, d := range errorsOf(t, source) {
		t.Errorf("native/whole-shape control: %s", d.String())
	}
}
