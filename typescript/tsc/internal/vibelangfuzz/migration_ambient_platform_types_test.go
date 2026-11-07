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

const ambientPlatformTarget = "FuzzMigrationAmbientPlatformTypes"

func TestMigrationAmbientPlatformTypesQuoted(t *testing.T) {
	TestMigrationWideRootLayoutsQuoted(t)
}
func FuzzMigrationAmbientPlatformTypes(f *testing.F) {
	startShortBudget(f)
	keys := []string{"module-augmentation", "plain-native", "no-augmentation", "changed-type", "changed-augmentation"}
	if testing.Short() {
		f.Add("changed-type", uint8(0))
	} else {
		for _, key := range keys {
			for mode := range 8 {
				f.Add(key, uint8(mode))
			}
		}
	}
	w := NewWorkspace(f)
	binary := cliBuild(f, w.Dir)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMigrationAmbientPlatformTypesQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
		defer cancel()
		cmd := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "migration_ambient_platform_types.mjs"), binary, key, strconv.Itoa(int(mode&7)))
		cmd.Dir = Root()
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("ambient platform model: %v; context=%v\n%s", err, ctx.Err(), output)
		}
		var result struct{ OK, KnownGap, Unchanged bool }
		if err := json.Unmarshal(output, &result); err != nil {
			t.Fatalf("invalid ambient receipt: %v\n%s", err, output)
		}
		if !result.Unchanged {
			t.Fatalf("source guard failed: %s", output)
		}
		if !result.OK {
			if !result.KnownGap {
				t.Fatalf("unexpected ambient contract failure: %s", output)
			}
			Gap(t, ambientPlatformTarget, "closure:platform-type-alias", "an inline and named generated platform type preserve the ambient module contract\n%s", output)
		}
		if key == "module-augmentation" {
			ExpectPending(t, ambientPlatformTarget, "closure:platform-type-alias")
		}
		ExpectPending(t, ambientPlatformTarget, specCorpusKey(t))
	})
}
