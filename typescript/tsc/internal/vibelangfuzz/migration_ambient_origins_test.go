package vibelangfuzz

import (
	"context"
	"encoding/json"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
)

const migrationAmbientOriginsTarget = "FuzzMigrationAmbientOrigins"
const migrationAmbientIdentityQuote = "each export's type identical to `tsc`'s in both directions (a type-level check)"
const migrationAmbientDocsQuote = "No other JSDoc difference is allowed, and an authored `@throws` must remain unchanged."

func TestMigrationAmbientOriginsQuoted(t *testing.T) {
	r4Quoted(t, "001-functions.md", migrationAmbientIdentityQuote, migrationAmbientDocsQuote)
}

// The fixture minimizes the ProcessEnv consumer and duplicate installed type
// declarations. All inputs are independently stock-valid. Only byte-identical
// idempotent interface contributions are positive controls; public type and
// documentation mutations must still reject.
func FuzzMigrationAmbientOrigins(f *testing.F) {
	startShortBudget(f)
	keys := []string{"equivalent", "reversed", "alias", "single", "type-change", "docs-change"}
	for _, key := range keys {
		for mode := uint8(0); mode < 2; mode++ {
			f.Add(key, mode)
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMigrationAmbientOriginsQuoted(t)
		key = strings.TrimPrefix(key, "key:")
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
		defer cancel()
		cmd := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "migration_ambient_origins.mjs"), key, strconv.Itoa(int(mode&1)))
		cmd.Dir = Root()
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("static ambient-origin oracle: %v; context=%v\n%s", err, ctx.Err(), output)
		}
		var record struct {
			OK bool `json:"ok"`
		}
		if err := json.Unmarshal(output, &record); err != nil {
			t.Fatalf("invalid ambient-origin oracle result: %v\n%s", err, output)
		}
		gapKey := "origin:" + key + "/" + strconv.Itoa(int(mode&1))
		if !record.OK {
			Gap(t, migrationAmbientOriginsTarget, gapKey, "Chapter 1: %q; byte-identical idempotent ambient copies must preserve API identity; real types and documentation remain strict\n%s", migrationAmbientIdentityQuote, output)
		}
		ExpectPending(t, migrationAmbientOriginsTarget, gapKey)
		ExpectPending(t, migrationAmbientOriginsTarget, specCorpusKey(t))
	})
}
