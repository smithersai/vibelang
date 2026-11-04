package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-7's own-matcher rule applies to the runtime registration emitted by
// the schema-error repair, without admitting a subclass's inherited matcher.
func TestSchemaErrorRegisteredMatcherOwnOnly(t *testing.T) {
	for _, test := range []struct {
		name, setup, pattern string
		rejected             bool
	}{
		{"direct", "class E { static { install(this, 'E') } }", "E", false},
		{"alias", "const register = install; class E { static { register(this, 'E') } }", "E", true},
		{"inherited", "class E { static { install(this, 'E') } }; class Sub extends E {}", "Sub", true},
		{"conditional", "class E { static { if (false) install(this, 'E') } }", "E", true},
		{"wrong receiver", "class Other {}; class E { static { install(Other, 'E') } }", "E", true},
		{"nested callback", "class E { static unused = () => install(E, 'E') }", "E", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := "import { $schemaErrorMatcher as install } from 'vibelang-runtime';\n" + test.setup + "\nexport function probe(subject: unknown) { return match(subject) { when " + test.pattern + "(let item): item; default: undefined; } }"
			program, file, _, _ := editorProgram(t, source)
			rejected := false
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Code() == 704 {
					rejected = true
				} else {
					t.Errorf("independent diagnostic: %s", d.String())
				}
			}
			if rejected != test.rejected {
				t.Fatalf("EK0704=%v, want %v", rejected, test.rejected)
			}
		})
	}
}
