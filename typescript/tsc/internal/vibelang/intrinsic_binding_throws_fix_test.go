package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// VIP-4: preserve the previous error channel when adding an explicit bridge.
func TestIntrinsicBindingThrowsFix(t *testing.T) {
	for _, row := range []struct{ name, lib, body, want string }{
		{"global", "/** @throws {RangeError} */\nexport const read: typeof JSON.parse = JSON.parse", "read(s)", "typeof RangeError"},
		{"imported", "export class ReadError extends Error {}\n/** @throws {ReadError} */\nexport const read: typeof JSON.parse = JSON.parse", "read(s)", "typeof foreignReadError"},
		{"unknown", "/** @throws {unknown} */\nexport const read: typeof Math.max = Math.max", "read(1,2)", "orDie("},
	} {
		t.Run(row.name, func(t *testing.T) {
			_, file, _, _ := requirementIdentityProgram(t, "import { read } from \"./lib.js\"\nexport effect function probe(s:string){ return "+row.body+" }", map[string]string{"lib.ts": row.lib})
			result := fixCase(t, filepath.Dir(file.FileName().AsString()))
			if result.Err != nil || len(result.Refused) != 0 {
				t.Fatalf("fix: %v refused %v", result.Err, result.Refused)
			}
			fixed := result.Files[file.FileName()]
			if fixed == nil || !strings.Contains(fixed.Text, row.want) || !strings.Contains(fixed.Text, "Effect.try(") {
				t.Fatalf("missing preserving bridge: %+v", fixed)
			}
			for name, change := range result.Files {
				if err := os.WriteFile(name.AsString(), []byte(change.Text), 0600); err != nil {
					t.Fatal(err)
				}
			}
			again := fixCase(t, filepath.Dir(file.FileName().AsString()))
			if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("not idempotent: %+v", again)
			}
		})
	}
}
