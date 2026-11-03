package vibelang

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// VIP-34's preservation oracle: compare the compiler with itself across
// the migration, without making today's output the expected declaration.
// "A quick fix is offered only when it preserves evaluation order, coldness,
// types, comments, and declaration output; otherwise the diagnostic explains
// why it has no automatic fix." (007-tooling.md; its quote test also guards the
// FuzzMigrationDeclarationFix archive for the minimized Alchemy witness.)
func FuzzTrustedEmptyMigration(f *testing.F) {
	for _, key := range []string{"direct", "branch", "arithmetic", "shadow", "string", "object", "array"} {
		f.Add(key, uint8(3))
	}
	f.Fuzz(func(t *testing.T, key string, raw uint8) {
		n := int(raw % 20)
		body := fmt.Sprintf("return safe(%d, 2)", n)
		implementation := "Math.max"
		prefix := ""
		annotation := ": number!!"
		switch key {
		case "branch":
			body = fmt.Sprintf("return %d > 5 ? safe(%d, 1) : safe(0, 2)", n, n)
		case "arithmetic":
			body = fmt.Sprintf("return safe(%d, 1) + safe(2, 3)", n)
		case "shadow":
			body += "\nfunction other(safe: number) { return safe }"
		case "string":
			implementation, annotation = "native", ""
			prefix = "function native(a: number, b: number): string { return a + \"-\" + b }\n"
		case "object":
			implementation, annotation = "native", ""
			prefix = "function native(a: number, b: number): { value: number } { return { value: a + b } }\n"
		case "array":
			implementation, annotation = "native", ""
			prefix = "function native(a: number, b: number): number[] { return [a, b] }\n"
		case "direct":
		}
		source := "import { trusted } from \"vibelang-runtime\"\n" + prefix + "const safe = trusted(" + implementation + ", [])\nexport effect function value()" + annotation + " {\n" + body + "\n}\n"
		_, file, _, _ := editorProgram(t, source)
		dir := filepath.Dir(file.FileName().AsString())
		config := filepath.Join(dir, "tsconfig.json")
		if err := os.WriteFile(config, []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"declaration":true,"emitDeclarationOnly":true,"outDir":"out"},"files":["main.vibe"]}`), 0600); err != nil {
			t.Fatal(err)
		}
		before := migrationRuleDeclarations(t, dir, nil)
		result := fixCase(t, dir)
		if result.Err != nil || len(result.Refused) != 0 {
			t.Fatalf("fix %v, refused %v", result.Err, result.Refused)
		}
		changed := false
		for name, fixed := range result.Files {
			if strings.Contains(fixed.Text, "trusted("+implementation+", [])") {
				t.Fatalf("no migration: %s", fixed.Text)
			}
			changed = true
			if err := os.WriteFile(name.AsString(), []byte(fixed.Text), 0600); err != nil {
				t.Fatal(err)
			}
		}
		if !changed {
			t.Fatal("no preserving rewrite")
		}
		if after := migrationRuleDeclarations(t, dir, nil); !reflect.DeepEqual(before, after) {
			t.Fatalf("declarations changed: %v -> %v", before, after)
		}
	})
}
