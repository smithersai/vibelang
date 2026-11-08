package vibelang

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestMemberHeadForeignCallRepair(t *testing.T) {
	for _, row := range []struct{ name, source string }{
		{"async-method", "class Local { async [key()]() {} }"},
		{"effect-method", "class Local { effect [key()]() {} }"},
		{"object-method", "const local = { [key()]() {} }"},
		{"decorator", "class Local { @(decorator()) value = 1 }"},
	} {
		t.Run(row.name, func(t *testing.T) {
			source := "import { key, decorator } from \"./lib.js\"\nexport effect function probe() {" + row.source + "}\n"
			_, file, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib.d.ts": memberHeadThrowLibrary})
			result := fixCase(t, filepath.Dir(file.FileName().AsString()))
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			fixed := result.Files[file.FileName()]
			if fixed == nil || len(result.Sites) != 0 {
				t.Fatalf("missing member-head bridge: %+v", result)
			}
			if !strings.Contains(fixed.Text, "try ") || !strings.Contains(fixed.Text, "Effect.try") {
				t.Fatalf("missing bridge:\n%s", fixed.Text)
			}
			p, f, _, _ := requirementIdentityProgram(t, fixed.Text, map[string]string{"lib.d.ts": memberHeadThrowLibrary})
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("fixed: %s\n%s", d.String(), fixed.Text)
				}
			}
		})
	}
}
