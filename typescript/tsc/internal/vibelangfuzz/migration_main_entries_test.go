package vibelangfuzz

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
)

const migrationMainEntriesTarget = "FuzzMigrationMainEntries"
const migrationMainPrivacyQuote = "The declaration is never exported."
const migrationMainMTSQuote = "For a migrated \x60.mts\x60 module, declaration identity pairs a removed \x60x.d.mts\x60 with its new \x60x.d.ts\x60, recorded under \x60renamed\x60."

func TestMigrationMainEntriesQuoted(t *testing.T) {
	for file, quote := range map[string]string{
		"docs/design/vips/0040-module-declarations.md": migrationMainPrivacyQuote,
		".smithers/flows/migrate/README.md":            migrationMainMTSQuote,
	} {
		text, err := os.ReadFile(filepath.Join(Root(), file))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(text), quote) {
			t.Fatalf("%s no longer contains %q", file, quote)
		}
	}
}

func FuzzMigrationMainEntries(f *testing.F) {
	startShortBudget(f)
	keys := []string{"private-companion", "mts-normalization", "no-main", "authored-entry", "reexport", "type-change", "doc-change", "mts-collision"}
	// The minimized corpora seed the two defect keys; seed their controls here.
	for _, key := range keys[2:] {
		f.Add(key, uint8(0))
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMigrationMainEntriesQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
		defer cancel()
		cmd := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "migration_main_entries.mjs"), key, strconv.Itoa(int(mode&15)))
		cmd.Dir = Root()
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("main-entry declaration comparison: %v; context=%v\n%s", err, ctx.Err(), output)
		}
		var result struct{ OK bool }
		if err := json.Unmarshal(output, &result); err != nil {
			t.Fatalf("invalid main-entry receipt: %v\n%s", err, output)
		}
		gapKey := "entry:" + key
		if !result.OK {
			Gap(t, migrationMainEntriesTarget, gapKey, "VIP-40: %q; declaration identity: %q; retain private companions and logical renamed entries\n%s", migrationMainPrivacyQuote, migrationMainMTSQuote, output)
		}
		ExpectPending(t, migrationMainEntriesTarget, gapKey)
		ExpectPending(t, migrationMainEntriesTarget, specCorpusKey(t))
	})
}
