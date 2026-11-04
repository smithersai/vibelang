package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A bridge must preserve both the intrinsic's error channel and unexpected defects.
func TestBuiltinThrowsGateFix(t *testing.T) {
	for _, row := range []struct{ name, body, class string }{
		{"parse", "return JSON.parse(s)", "SyntaxError"},
		{"alias", "const parse=JSON.parse; return parse(s)", "SyntaxError"},
		{"decode", "return decodeURIComponent(s)", "URIError"},
		{"bigint", "return BigInt(s)", "RangeError"},
	} {
		t.Run(row.name, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, "export effect function probe(s:string){"+row.body+"}")
			result := fixCase(t, filepath.Dir(file.FileName().AsString()))
			if result.Err != nil || len(result.Refused) != 0 {
				t.Fatalf("fix: %v refused %v", result.Err, result.Refused)
			}
			fixed := result.Files[file.FileName()]
			if fixed == nil || !strings.Contains(fixed.Text, "typeof "+row.class) || !strings.Contains(fixed.Text, "Effect.fail(error)") || !strings.Contains(fixed.Text, "Effect.die(error)") {
				t.Fatalf("missing preserving class split: %+v", fixed)
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
				t.Fatal(err)
			}
			again := fixCase(t, filepath.Dir(file.FileName().AsString()))
			if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("not idempotent: %+v", again)
			}
		})
	}
}
