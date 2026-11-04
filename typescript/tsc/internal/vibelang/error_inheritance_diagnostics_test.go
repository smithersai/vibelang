package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestSchemaErrorInheritanceGeneratedBaseDiagnostics(t *testing.T) {
	for _, shape := range []struct{ name, parent, child string }{
		{"empty", "{}", "{}"},
		{"fields", "{ id: string }", "{ code: number }"},
		{"optional", "{ id?: string }", "{ code?: number }"},
		{"getter", "{ id: string; get label() { return this.id } }", "{ code: number }"},
		{"bodyless", "", ""},
	} {
		t.Run(shape.name, func(t *testing.T) {
			source := "export schema error Parent " + shape.parent + "\nexport schema error Child extends Parent " + shape.child + "\n"
			p, f, _, _ := editorProgram(t, source)
			count := 0
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Source() == diagnosticSource && d.Code() == 2117 {
					count++
					continue
				}
				t.Errorf("unexpected %s at %d..%d: %s", d.String(), d.Pos(), d.End(), source[d.Pos():d.End()])
			}
			if count != 1 {
				t.Errorf("got %d inheritance errors, want 1", count)
			}
		})
	}
}

func TestSchemaErrorInheritanceKeepsIndependentDiagnostics(t *testing.T) {
	for _, body := range []struct {
		name, member string
		code         int32
	}{
		{"missing-type", "get value(): UnknownPayload { return 1 }", 2304},
		{"method-return", "get value(): number { return \"wrong\" }", 2322},
		{"native-base", "get value() { const Native = null as unknown as { new(): string | number }; class Inner extends Native {}; return 1 }", 2509},
	} {
		t.Run(body.name, func(t *testing.T) {
			source := "schema error Parent {}\nexport schema error Child extends Parent { " + body.member + " }\n"
			p, f, _, _ := editorProgram(t, source)
			found := 0
			for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
				if d.Source() == "" && d.Code() == body.code {
					found++
					t.Logf("native error %s at %d..%d: %s", d.String(), d.Pos(), d.End(), source[d.Pos():d.End()])
				}
			}
			if found != 1 {
				t.Errorf("got %d TS%d diagnostics, want 1; %s", found, body.code, source)
			}
		})
	}
}
