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

func TestMigrationWildcardDeclarationsQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", "each export's type identical to \x60tsc\x60's in both directions")
	chapterSays(t, "001-functions.md", "and the same doc comment on each export")
}
func FuzzMigrationWildcardDeclarations(f *testing.F) {
	startShortBudget(f)
	keys := []string{"fixed-leaf-pattern", "whole-path-pattern", "explicit", "changed-type", "changed-doc", "missing-target"}
	for _, key := range keys {
		f.Add(key, uint8(15))
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMigrationWildcardDeclarationsQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
		defer cancel()
		command := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "migration_wildcard_declarations.mjs"), key, strconv.Itoa(int(mode&15)))
		command.Dir = Root()
		output, err := command.CombinedOutput()
		if err != nil {
			t.Fatalf("published wildcard model: %v; context=%v\n%s", err, ctx.Err(), output)
		}
		var result struct{ OK, Unchanged bool }
		if err := json.Unmarshal(output, &result); err != nil {
			t.Fatalf("invalid wildcard receipt: %v\n%s", err, output)
		}
		if !result.Unchanged {
			t.Fatalf("source guard failed: %s", output)
		}
		if !result.OK {
			t.Fatalf("valid stock TypeScript exports require a complete declaration comparison, retaining type/doc/missing-target guards\n%s", output)
		}
	})
}
