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

func TestMigrationSidecarAvailabilityQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", "each export's type identical to \x60tsc\x60's in both directions")
	chapterSays(t, "001-functions.md", "and the same doc comment on each export")
}
func FuzzMigrationSidecarAvailability(f *testing.F) {
	startShortBudget(f)
	keys := []string{"clean", "changed-clean", "doc-clean", "unrelated-error", "changed-with-error", "doc-with-error", "dependent-error", "missing-entry"}
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMigrationSidecarAvailabilityQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
		defer cancel()
		command := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "migration_sidecar_availability.mjs"), key, strconv.Itoa(int(mode&15)))
		command.Dir = Root()
		output, err := command.CombinedOutput()
		if err != nil {
			t.Fatalf("sidecar availability model: %v; context=%v\n%s", err, ctx.Err(), output)
		}
		var result struct{ OK, Unchanged, KnownGap bool }
		if err := json.Unmarshal(output, &result); err != nil {
			t.Fatalf("invalid sidecar availability receipt: %v\n%s", err, output)
		}
		if !result.Unchanged {
			t.Fatalf("source guard failed: %s", output)
		}
		if !result.OK {
			if !result.KnownGap {
				t.Fatalf("unexpected availability failure: %s", output)
			}
			Gap(t, "FuzzMigrationSidecarAvailability", "availability:"+key, "an erroneous neighbour must stay unavailable without stopping independent type/doc comparison\n%s", output)
		}
		ExpectPending(t, "FuzzMigrationSidecarAvailability", "availability:"+key)
		ExpectPending(t, "FuzzMigrationSidecarAvailability", specCorpusKey(t))
	})
}
