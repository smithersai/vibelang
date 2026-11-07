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

func TestMigrationNativePeerInferenceQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", "each export's type identical to \x60tsc\x60's in both directions")
	chapterSays(t, "007-tooling.md", "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output")
}
func FuzzMigrationNativePeerInference(f *testing.F) {
	startShortBudget(f)
	keys := []string{"ts-effect", "ts-value", "vibe-effect", "vibe-value", "vibe-effect-sidecar", "vibe-value-sidecar", "modern-effect", "modern-value"}
	for _, key := range []string{"ts-value", "vibe-effect-sidecar", "modern-effect"} {
		f.Add(key, uint8(15))
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMigrationNativePeerInferenceQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
		defer cancel()
		command := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "migration_native_peer_inference.mjs"), key, strconv.Itoa(int(mode&15)))
		command.Dir = Root()
		output, err := command.CombinedOutput()
		if err != nil {
			t.Fatalf("native peer inference model: %v; context=%v\n%s", err, ctx.Err(), output)
		}
		var result struct{ OK, Unchanged, KnownGap bool }
		if err := json.Unmarshal(output, &result); err != nil {
			t.Fatalf("invalid native peer inference receipt: %v\n%s", err, output)
		}
		if !result.Unchanged {
			t.Fatalf("source guard failed: %s", output)
		}
		if !result.OK {
			if !result.KnownGap {
				t.Fatalf("unexpected availability failure: %s", output)
			}
			Gap(t, "FuzzMigrationNativePeerInference", "peer:"+key, "legacy preservation retains a native peer factory returning an Effect\n%s", output)
		}
		ExpectPending(t, "FuzzMigrationNativePeerInference", "peer:"+key)
		ExpectPending(t, "FuzzMigrationNativePeerInference", specCorpusKey(t))
	})
}
