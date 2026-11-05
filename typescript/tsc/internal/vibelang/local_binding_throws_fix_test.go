package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A preserving bridge keeps the failure classes used before alias contracts
// were retained; the corrected annotation does not change that old split.
func TestLocalBindingThrowsFix(t *testing.T) {
	for _, row := range []struct{ name, signature, tag, call, want, absent string }{
		{"parse-range", "JSON.parse", "RangeError", "again(s)", "typeof SyntaxError", "typeof RangeError"},
		{"parse-imported", "JSON.parse", "ReadError", "again(s)", "typeof SyntaxError", "foreignReadError"},
		{"parse-unknown", "JSON.parse", "unknown", "again(s)", "typeof SyntaxError", "orDie("},
		{"max-range", "Math.max", "RangeError", "again(1,2)", "orDie(", "typeof RangeError"},
		{"max-unknown", "Math.max", "unknown", "again(1,2)", "orDie(", "typeof SyntaxError"},
		{"signature-range", "base", "RangeError", "again(s)", "typeof Error", "typeof RangeError"},
	} {
		t.Run(row.name, func(t *testing.T) {
			lib := "export class ReadError extends Error {}\n/** @throws {" + row.tag + "} */\nexport const read:typeof " + row.signature + " = " + row.signature
			if row.signature == "base" {
				lib = "/** @throws {Error} */\nexport function base(s:string){return s}\n" + lib
			}
			source := "import {read} from './lib.js';\nexport effect function probe(s:string){const again=read;return " + row.call + "}"
			_, file, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib.ts": lib})
			fixed := fixCase(t, filepath.Dir(file.FileName().AsString()))
			if fixed.Err != nil || len(fixed.Refused) != 0 {
				t.Fatalf("fix: %v refused %v", fixed.Err, fixed.Refused)
			}
			change := fixed.Files[file.FileName()]
			if change == nil || !strings.Contains(change.Text, row.want) || strings.Contains(change.Text, row.absent) {
				t.Fatalf("migration changed the old failure contract: %+v", change)
			}
			for name, change := range fixed.Files {
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
