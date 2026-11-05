package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

// Ordinary checking and --fix keep the current writable defaults.
// This property mutates legacy codec references, their lexical scope and
// subclass fields while retaining the existing codec's writable key.
func FuzzSchemaCodecFactoryNativeReturns(f *testing.F) {
	for i := uint8(0); i < 12; i++ {
		f.Add(i)
	}
	f.Fuzz(func(t *testing.T, b uint8) {
		fields := []string{"n:Mutable;count:number", "n:Mutable;count:number;note?:string", "n:Mutable;nested:{flag:boolean}"}[int(b)%3]
		source := "const Mutable=Schema.mutableKey(Schema.Number)\nabstract schema error Base {value:{" + fields + "}}\nschema error Child extends Base {}\n"
		if b&4 != 0 {
			source = "namespace N {" + source + "}\n"
		}
		if b&8 != 0 {
			source = strings.Replace(source, "Child extends Base {}", "Child extends Base {extra:{value:Mutable}}", 1)
		}
		program, file, _, _ := editorProgram(t, source)
		result := schemaReadonlyMigrationFixes(t.Context(), program, file, map[string]bool{})
		fixed := result.text()
		if len(result.fixes) == 0 {
			t.Fatal("missing codec migration")
		}
		if strings.Contains(fixed, "infer _") {
			t.Fatalf("generated factory has a retired return marker:\n%s", fixed)
		}
		if strings.Contains(fixed, "readonly n:Mutable") || !strings.Contains(fixed, "n: Mutable") {
			t.Fatalf("codec writability changed:\n%s", fixed)
		}
		next, nextFile, _, _ := editorProgram(t, fixed)
		inherited := 0
		for _, d := range append(next.GetSyntacticDiagnostics(t.Context(), nextFile), next.GetSemanticDiagnostics(t.Context(), nextFile)...) {
			if d.Category() == diagnostics.CategoryError {
				if d.Code() == 2117 {
					inherited++
					continue
				}
				t.Errorf("native return inference rejected: %s\n%s", d.String(), fixed)
			}
		}
		if inherited != 1 {
			t.Fatalf("want one retained VIP-13 inheritance diagnostic, got %d", inherited)
		}
		if again := schemaReadonlyMigrationFixes(t.Context(), next, nextFile, map[string]bool{}); len(again.fixes) != 0 {
			t.Fatal(fmt.Sprintf("not idempotent:\n%s", again.text()))
		}
	})
}
