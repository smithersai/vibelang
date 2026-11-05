package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestAbstractErrorFixPreservesDeclarations(t *testing.T) {
	for _, source := range []string{
		"export abstract error Root { code: string }\nexport class Concrete extends Root {}\n",
		"export abstract /*keep abstract*/ error /*keep error*/ Root { code: string; get label() { return this.code } }\nexport class Concrete extends Root {}\n",
		"export abstract error Empty\nexport class Concrete extends Empty {}\n",
		"const TaggedError = 0; const Data = 1; const $LegacyTaggedError = 2\nexport abstract error Root { code: string }\nexport class Concrete extends Root {}\n",
	} {
		fixed := applyQuickFixOf(t, source, 1308, diagnostics.CategoryWarning)
		if strings.Contains(fixed, "abstract error") || !strings.Contains(fixed, "abstract ") || !strings.Contains(fixed, "class ") {
			t.Fatalf("abstract native class migration missing:\n%s", fixed)
		}
		if strings.Contains(fixed, "$schemaErrorMatcher") {
			t.Fatalf("abstract root acquired an own matcher:\n%s", fixed)
		}
		for _, comment := range []string{"/*keep abstract*/", "/*keep error*/"} {
			if strings.Contains(source, comment) && !strings.Contains(fixed, comment) {
				t.Fatalf("lost %s:\n%s", comment, fixed)
			}
		}
		if errors := errorsOf(t, fixed); len(errors) != 0 {
			t.Fatalf("fixed errors %v:\n%s", errors, fixed)
		}
		before, after := layerMigrationDeclarations(t, source), layerMigrationDeclarations(t, fixed)
		if before != after {
			t.Fatalf("declaration bytes changed:\nbefore:\n%s\nafter:\n%s", before, after)
		}
	}
}

func TestAbstractErrorFixKeepsNativeClasses(t *testing.T) {
	for _, source := range []string{"export abstract class Root { abstract read(): string }\n", "export error Root { code: string }\n"} {
		program, file, _, _ := editorProgram(t, source)
		for _, diagnostic := range program.GetSemanticDiagnostics(t.Context(), file) {
			if diagnostic.Code() == 1308 {
				t.Fatalf("ordinary native/admitted declaration diagnosed: %s", diagnostic.String())
			}
		}
	}
}
