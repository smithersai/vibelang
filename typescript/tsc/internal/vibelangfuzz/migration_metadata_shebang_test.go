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

const metadataShebangTarget = "FuzzMigrationMetadataShebang"

func TestMigrationMetadataShebangQuoted(t *testing.T) {
	chapterSays(t, "005-services.md", "refuse with the not-fixed explanation if the move cannot preserve run phase, captures, receiver and public types")
	chapterSays(t, "../vips/0040-module-declarations.md", "Each tool reads a body as the")
}
func FuzzMigrationMetadataShebang(f *testing.F) {
	startShortBudget(f)
	keys := []string{"dirname", "filename", "resolve", "env", "no-meta-control", "no-shebang-control"}
	if testing.Short() {
		f.Add("no-meta-control", uint8(0))
		f.Add("no-shebang-control", uint8(15))
	} else {
		for _, key := range keys {
			for mode := range 16 {
				f.Add(key, uint8(mode))
			}
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMigrationMetadataShebangQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
		defer cancel()
		cmd := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "migration_metadata_shebang.mjs"), key, strconv.Itoa(int(mode&15)))
		cmd.Dir = Root()
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("metadata shebang model: %v; context=%v\n%s", err, ctx.Err(), output)
		}
		var result struct {
			OK, KnownGap bool
			GapKey       string
		}
		if err := json.Unmarshal(output, &result); err != nil {
			t.Fatalf("invalid shebang receipt: %v\n%s", err, output)
		}
		if !result.OK {
			if !result.KnownGap {
				t.Fatalf("unexpected source-layout failure: %s", output)
			}
			Gap(t, metadataShebangTarget, result.GapKey, "a supported platform split preserves the entry shebang and produces a syntactically valid companion\n%s", output)
		}
		ExpectPending(t, metadataShebangTarget, result.GapKey)
		ExpectPending(t, metadataShebangTarget, specCorpusKey(t))
	})
}
