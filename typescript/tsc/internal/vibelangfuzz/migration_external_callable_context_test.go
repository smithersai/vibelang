package vibelangfuzz

import (
	"context"
	"encoding/json"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"testing"
)

func TestMigrationExternalCallableContextQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", "each export's type identical to \x60tsc\x60's in both directions")
	chapterSays(t, "001-functions.md", "and the same doc comment on each export")
}
func FuzzMigrationExternalCallableContext(f *testing.F) {
	startShortBudget(f)
	keys := []string{"function-plugin", "constant-plugin", "function-primitive", "function-vite", "changed-type", "changed-doc", "unresolved"}
	f.Add("function-primitive", uint8(0))
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		location := "internal"
		if mode&1 != 0 {
			location = "external"
		}
		TestMigrationExternalCallableContextQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
		defer cancel()
		command := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "migration_external_callable_context.mjs"), key, strconv.Itoa(int(mode&15)))
		command.Dir = Root()
		output, err := command.CombinedOutput()
		if err != nil {
			t.Fatalf("external callable context model: %v; context=%v\n%s", err, ctx.Err(), output)
		}
		var result struct{ OK, Unchanged, KnownGap bool }
		if err := json.Unmarshal(output, &result); err != nil {
			t.Fatalf("invalid external callable context receipt: %v\n%s", err, output)
		}
		if !result.Unchanged {
			t.Fatalf("source guard failed: %s", output)
		}
		if !result.OK {
			if !result.KnownGap {
				t.Fatalf("unexpected availability failure: %s", output)
			}
			Gap(t, "FuzzMigrationExternalCallableContext", "context:"+key+":"+location, "an explicitly included external callable retains its genuine project resolution context\n%s", output)
		}
		ExpectPending(t, "FuzzMigrationExternalCallableContext", "context:"+key+":"+location)
		ExpectPending(t, "FuzzMigrationExternalCallableContext", specCorpusKey(t))
	})
}
