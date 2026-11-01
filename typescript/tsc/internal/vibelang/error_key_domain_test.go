package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Chapter 3 static rules (VIP-29): a computed schema error key whose runtime
// domain is not proved to exclude "_tag" is EK2117. A getter under such a key
// shadows the tag the schema constructor assigns, and construction throws.
func TestSchemaErrorComputedKeyDomain(t *testing.T) {
	prelude := "enum Field { Tag = \"_tag\", Count = \"count\" }\n" +
		"declare const broad: string\n" +
		"declare const either: \"a\" | \"_tag\"\n" +
		"declare const branded: string & { readonly brand: unique symbol }\n" +
		"declare const brandedLiteral: \"a\" & { readonly brand: unique symbol }\n" +
		"declare const prefixed: `x-${string}`\n" +
		"declare const open: `${string}`\n" +
		"declare const loose: any\n" +
		"declare const sym: unique symbol\n" +
		"declare const num: number\n" +
		"declare const count: Field.Count\n" +
		"declare const field: Field\n"
	for _, test := range []struct {
		key      string
		reserved bool
	}{
		{"broad", true}, {"either", true}, {"branded", true}, {"open", true}, {"loose", true}, {"field", true},
		{"brandedLiteral", false}, {"prefixed", false}, {"sym", false}, {"num", false}, {"count", false},
	} {
		for _, member := range []string{"get [" + test.key + "](): number { return 1 }", "[" + test.key + "]() { return 1 }", "static [" + test.key + "] = 1"} {
			for _, form := range []string{"schema error", "error"} {
				t.Run(form+" "+member, func(t *testing.T) {
					source := prelude + "export " + form + " E { id: string; " + member + " }\n"
					program, file, _, _ := editorProgram(t, source)
					var errors []string
					reserved, static1302 := -1, false
					for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
						if d.Category() != diagnostics.CategoryError {
							continue
						}
						errors = append(errors, d.String())
						static1302 = static1302 || (d.Code() == 1302 && d.Source() == diagnosticSource)
						if d.Code() == 2117 && d.Source() == diagnosticSource {
							reserved = d.Pos()
						}
					}
					static := strings.HasPrefix(member, "static")
					want := test.reserved && form == "schema error"
					if static && !want {
						// The static-member row (EK1302) applies when the
						// reserved-tag row does not.
						if len(errors) != 1 || !static1302 {
							t.Fatalf("want EK1302 alone, got %v", errors)
						}
						return
					}
					at := strings.Index(source, "["+test.key+"]")
					if want && (len(errors) != 1 || reserved != at) {
						t.Fatalf("want one EK2117 at the key (%d), got %v", at, errors)
					}
					if !want && len(errors) != 0 {
						t.Fatalf("want no errors, got %v", errors)
					}
				})
			}
		}
	}
}

// The explicit-class repair keeps a previously valid getter as it was.
func TestSchemaErrorComputedKeyDomainClassFix(t *testing.T) {
	fixed := applyQuickFixOf(t, "declare const broad: string\nexport schema error E { id: string; get [broad](): number { return 1 } }\n", 2117, diagnostics.CategoryError)
	if !strings.Contains(fixed, "class E extends") || !strings.Contains(fixed, "get [broad](): number { return 1 }") {
		t.Fatalf("class repair did not keep the getter:\n%s", fixed)
	}
	program, file, _, _ := editorProgram(t, fixed)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("class repair: %s\n%s", d.String(), fixed)
		}
	}
}
