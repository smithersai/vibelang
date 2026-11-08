package vibelang

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestNestedWrapperRepair(t *testing.T) {
	for _, expr := range []string{
		"effect function nested() { return foreign() }",
		"effect () => foreign()",
		"effect { return foreign() }",
	} {
		t.Run(expr, func(t *testing.T) {
			lib := map[string]string{"lib.d.ts": "export declare function foreign(): number"}
			source := "import {foreign} from \"./lib.js\"\nexport const probe=Effect.sync(() => " + expr + ")\n"
			_, file, _, _ := requirementIdentityProgram(t, source, lib)
			result := fixCase(t, filepath.Dir(file.FileName().AsString()))
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			fixed := result.Files[file.FileName()]
			if fixed == nil || len(result.Sites) != 0 {
				t.Fatalf("missing nested bridge: %+v", result)
			}
			if !strings.Contains(fixed.Text, "Effect.orDie(Effect.try(") {
				t.Fatalf("missing defect-preserving bridge:\n%s", fixed.Text)
			}
			p, f, _, _ := requirementIdentityProgram(t, fixed.Text, lib)
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("fixed: %s", d.String())
				}
			}
		})
	}
}

func TestDirectEffectWrapperRepair(t *testing.T) {
	lib := map[string]string{"lib.d.ts": "export declare function foreign(): number"}
	source := "import {foreign} from \"./lib.js\"\nexport const probe=Effect.sync(effect () => foreign())\n"
	_, file, _, _ := requirementIdentityProgram(t, source, lib)
	result := fixCase(t, filepath.Dir(file.FileName().AsString()))
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	fixed := result.Files[file.FileName()]
	if fixed == nil || len(result.Sites) != 0 || !strings.Contains(fixed.Text, "Effect.orDie(Effect.try(") {
		t.Fatalf("missing direct Effect bridge: %+v", result)
	}
	p, f, _, _ := requirementIdentityProgram(t, fixed.Text, lib)
	for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("fixed: %s", d.String())
		}
	}
}

func TestNestedWrapperDefaultRepair(t *testing.T) {
	lib := map[string]string{"lib.d.ts": "export declare function foreign(): number"}
	source := "import {foreign} from \"./lib.js\"\nexport const probe=Effect.sync(() => effect function nested(value=foreign()){return value})\n"
	_, file, _, _ := requirementIdentityProgram(t, source, lib)
	result := fixCase(t, filepath.Dir(file.FileName().AsString()))
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	fixed := result.Files[file.FileName()]
	if fixed == nil || len(result.Sites) != 0 {
		t.Fatalf("missing call-time default repair: %+v", result)
	}
	p, f, _, _ := requirementIdentityProgram(t, fixed.Text, lib)
	for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("fixed: %s", d.String())
		}
	}
}
