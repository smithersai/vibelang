package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func TestServiceClassFixKeepsComments(t *testing.T) {
	for _, separator := range []string{" ", " /* key identity */ ", "\t/*one*/ /*two*/\t"} {
		source := "export service" + separator + "class Users { static readonly key = \"test/Users\"; name: string }\n"
		fixed := applyQuickFixOf(t, source, EK0909.Code, diagnostics.CategoryError)
		if strings.Contains(fixed, "class Users") {
			t.Fatalf("class survived:\n%s", fixed)
		}
		if strings.Contains(separator, "/*") && !strings.Contains(fixed, strings.TrimSpace(separator)) {
			t.Fatalf("comments lost:\n%s", fixed)
		}
		if errors := errorsOf(t, fixed); len(errors) != 0 {
			t.Fatalf("fixed: %v", errors)
		}
		before := layerMigrationDeclarations(t, source, EK0909.Code)
		after := layerMigrationDeclarations(t, fixed)
		if before != after {
			t.Fatalf("declarations changed:\n%s\n%s", before, after)
		}
	}
}
