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

const generatedOutputNamesTarget = "FuzzMigrationGeneratedOutputNames"
const generatedOutputNamesQuote = "A rewrite that can't preserve types, behavior and declaration output refuses at that site."

func TestMigrationGeneratedOutputNamesQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", generatedOutputNamesQuote)
}

// Generated output descriptors are program data even when their basenames
// coincide with a renamed source. A proven source read remains a positive control.
func FuzzMigrationGeneratedOutputNames(f *testing.F) {
	startShortBudget(f)
	keys := []string{"array", "object", "returned", "nested"}
	for _, key := range keys {
		for _, mode := range []uint8{0, 1, 2, 7} {
			f.Add(key, mode)
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMigrationGeneratedOutputNamesQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
		defer cancel()
		script := filepath.Join(repoTestdata(), "oracles", "migration_generated_output_names.mjs")
		cmd := exec.CommandContext(ctx, "node", script, key, strconv.Itoa(int(mode&7)))
		cmd.Dir = Root()
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("generated-output oracle: %v; context=%v\n%s", err, ctx.Err(), output)
		}
		var result struct {
			OK bool
		}
		if err := json.Unmarshal(output, &result); err != nil {
			t.Fatalf("invalid generated-output result: %v\n%s", err, output)
		}
		extension := "ts"
		if mode&2 != 0 {
			extension = "tsx"
		}
		gapKey := "output:" + key + "/" + extension
		if !result.OK {
			Gap(t, generatedOutputNamesTarget, gapKey, "Chapter 7: %q; source wiring must preserve generated descriptor basenames\n%s", generatedOutputNamesQuote, output)
		}
		ExpectPending(t, generatedOutputNamesTarget, gapKey)
		ExpectPending(t, generatedOutputNamesTarget, specCorpusKey(t))
	})
}
