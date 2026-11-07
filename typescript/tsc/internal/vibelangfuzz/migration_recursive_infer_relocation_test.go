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

const recursiveInferTarget = "FuzzMigrationRecursiveInferRelocation"

func TestMigrationRecursiveInferRelocationQuoted(t *testing.T) {
	TestMigrationWideRootLayoutsQuoted(t)
}

func checkRecursiveInferRelocation(t *testing.T, key string, mode uint8) {
	t.Helper()
	TestMigrationRecursiveInferRelocationQuoted(t)
	ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
	defer cancel()
	command := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "migration_recursive_infer_relocation.mjs"), key, strconv.Itoa(int(mode&15)))
	command.Dir = Root()
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("recursive infer model: %v; context=%v\n%s", err, ctx.Err(), output)
	}
	var result struct{ OK, KnownGap, Unchanged bool }
	if err := json.Unmarshal(output, &result); err != nil {
		t.Fatalf("invalid receipt: %v\n%s", err, output)
	}
	if !result.Unchanged {
		t.Fatalf("source guard failed: %s", output)
	}
	if !result.OK {
		if !result.KnownGap {
			t.Fatalf("unexpected declaration comparison failure: %s", output)
		}
		Gap(t, recursiveInferTarget, "relocation:recursive-infer", "public recursive conditional types remain identical when an unrelated interface moves behind a re-export\n%s", output)
	}
	if key == "relocated" {
		ExpectPending(t, recursiveInferTarget, "relocation:recursive-infer")
	}
	ExpectPending(t, recursiveInferTarget, specCorpusKey(t))
}

func FuzzMigrationRecursiveInferRelocation(f *testing.F) {
	startShortBudget(f)
	f.Add("same-copy", uint8(0))
	f.Add("changed-bigint", uint8(0))
	keys := []string{"same-copy", "relocated", "changed-bigint", "raw-relocated-control"}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		checkRecursiveInferRelocation(t, key, mode&15)
	})
}

func TestMigrationRecursiveInferRelocationNeighborhood(t *testing.T) {
	if testing.Short() {
		t.Skip("extended matrix runs without -short")
	}
	for _, key := range []string{"same-copy", "relocated", "changed-bigint", "raw-relocated-control"} {
		for mode := range 16 {
			t.Run(key+"/"+strconv.Itoa(mode), func(t *testing.T) { checkRecursiveInferRelocation(t, key, uint8(mode)) })
		}
	}
}
