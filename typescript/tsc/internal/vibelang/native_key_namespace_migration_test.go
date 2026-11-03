package vibelang

import (
	"encoding/json"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"os"
	"slices"
	"strings"
	"testing"
)

// The namespace correction has an erasing, binding-safe repair. It must leave
// real namespaces, ordinary classes, explicit type arguments and shadows alone.
func TestNativeServiceKeyNamespaceMigrationPlan(t *testing.T) {
	var rows []struct {
		Key, Source string
		Files       map[string]string
	}
	data, err := os.ReadFile("../vibelangfuzz/testdata/native-key-namespace.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(data, &rows); err != nil {
		t.Fatal(err)
	}
	wanted := map[string]bool{"native-class": true, "imported-class": true, "qualified-class": true, "nested-class": true, "local-class": true, "generic-local-class": true, "vibe-written-shape": true}
	rows = append(rows, struct {
		Key, Source string
		Files       map[string]string
	}{"shadowed-type", `import {Context} from "effect";class Key extends Context.Service<Key,{value:number}>()("native/Key"){};function scope<Key>(){type Impl=Key.Shape}`, nil})
	for _, row := range rows {
		t.Run(row.Key, func(t *testing.T) {
			p := nativeKeyNamespaceProgram(t, row.Source, row.Files)
			var file *ast.SourceFile
			for _, candidate := range p.GetSourceFiles() {
				if strings.HasSuffix(candidate.FileName().AsString(), "/main.vibe") {
					file = candidate
					break
				}
			}
			if file == nil {
				t.Fatal("missing regression source")
			}
			proposal := localServiceShapeMigrationFixes(t.Context(), p, file, map[string]bool{})
			expected := 0
			if wanted[row.Key] {
				expected = 1
			}
			if len(proposal.fixes) != expected {
				t.Fatalf("want %d repairs, got %+v", expected, proposal.fixes)
			}
			if expected == 0 {
				return
			}
			var edits []sourceEdit
			for _, fix := range proposal.fixes {
				edits = append(edits, fix.edits...)
			}
			slices.SortFunc(edits, func(a, b sourceEdit) int { return b.start - a.start })
			fixed := row.Source
			for _, edit := range edits {
				fixed = fixed[:edit.start] + edit.text + fixed[edit.end:]
			}
			if !strings.Contains(fixed, `import("effect/Context").Service.Shape<typeof `) {
				t.Fatalf("unsafe extraction: %s", fixed)
			}
			after := nativeKeyNamespaceProgram(t, fixed, row.Files)
			for _, d := range append(after.GetSyntacticDiagnostics(t.Context(), nil), after.GetSemanticDiagnostics(t.Context(), nil)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("repair reports %s", d.String())
				}
			}
		})
	}
}
