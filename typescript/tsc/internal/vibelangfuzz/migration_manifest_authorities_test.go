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

const manifestAuthoritiesTarget = "FuzzMigrationManifestAuthorities"
const manifestAuthorityQuote = "Unrecorded scripts, flags and unrelated manifest changes gain no new scope."
const manifestRoutingQuote = "Setup writes exact private \x60#vibelang/emitted/…\x60 imports"

func TestMigrationManifestAuthoritiesQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", nativeJSXPreserveQuote)
	text, err := os.ReadFile(filepath.Join(Root(), ".smithers/flows/migrate/README.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{manifestAuthorityQuote, manifestRoutingQuote} {
		if !strings.Contains(string(text), quote) {
			t.Fatalf("migration contract no longer contains %q", quote)
		}
	}
}

func FuzzMigrationManifestAuthorities(f *testing.F) {
	startShortBudget(f)
	keys := []string{"combined", "script-only", "map-only", "authored-name", "authored-name-map-only", "changed-dependency", "missing-receipt", "stale-script", "reverted"}
	for _, key := range keys {
		for _, mode := range []uint8{0, 31} {
			f.Add(key, mode)
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMigrationManifestAuthoritiesQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
		defer cancel()
		cmd := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "migration_manifest_authorities.mjs"), key, strconv.Itoa(int(mode&31)))
		cmd.Dir = Root()
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("manifest authority model: %v; context=%v\n%s", err, ctx.Err(), output)
		}
		var result struct{ OK bool }
		if err := json.Unmarshal(output, &result); err != nil {
			t.Fatalf("invalid manifest authority receipt: %v\n%s", err, output)
		}
		gapKey := "authority:" + key
		if !result.OK {
			Gap(t, manifestAuthoritiesTarget, gapKey, "Chapter 7: %q; migration contract: %q, %q; compose recorded script and generated-map authority without admitting unrelated manifest changes\n%s", nativeJSXPreserveQuote, manifestAuthorityQuote, manifestRoutingQuote, output)
		}
		ExpectPending(t, manifestAuthoritiesTarget, gapKey)
		ExpectPending(t, manifestAuthoritiesTarget, specCorpusKey(t))
	})
}
