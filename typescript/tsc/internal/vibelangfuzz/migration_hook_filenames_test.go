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

func TestMigrationHookFilenamesQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", "each export's type identical to `tsc`'s in both directions")
	chapterSays(t, "007-tooling.md", "Diagnostics retain their existing codes, categories and eligibility; compiling a file does not apply a source rewrite.")
}

func FuzzMigrationHookFilenames(f *testing.F) {
	startShortBudget(f)
	keys := []string{"path-hook", "bare-hook", "ordinary-import", "unrelated", "native-pattern", "generic-extension", "other-package", "comment-pattern"}
	for _, key := range keys {
		f.Add(key, uint8(0))
		f.Add(key, uint8(15))
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMigrationHookFilenamesQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
		defer cancel()
		command := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "migration_hook_filenames.mjs"), key, strconv.Itoa(int(mode&15)))
		command.Dir = Root()
		output, err := command.CombinedOutput()
		if err != nil {
			t.Fatalf("migration model: %v; context=%v\n%s", err, ctx.Err(), output)
		}
		var result struct{ OK, Unchanged bool }
		if err := json.Unmarshal(output, &result); err != nil {
			t.Fatalf("invalid migration receipt: %v\n%s", err, output)
		}
		if !result.Unchanged {
			t.Fatalf("source-preservation control failed: %s", output)
		}
		gapKey := "filename:" + key
		if !result.OK {
			Gap(t, "FuzzMigrationHookFilenames", gapKey, "retain the TypeScript filename required by an unchanged signing-hook integration\n%s", output)
		}
		ExpectPending(t, "FuzzMigrationHookFilenames", gapKey)
		ExpectPending(t, "FuzzMigrationHookFilenames", specCorpusKey(t))
	})
}
