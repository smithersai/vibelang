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

const migrationConfigCallersTarget = "FuzzMigrationConfigCallers"
const migrationConfigDiscoveryQuote = "other tool configs, which their tool finds by name, stay \x60.ts\x60"
const migrationConfigLoaderQuote = "A setting inside the config cannot select its own loader."
const migrationConfigCLIQuote = "the codemod points each wired script at the renamed file with \x60--config vite.config.vibe\x60"

func TestMigrationConfigCallersQuoted(t *testing.T) {
	text, err := os.ReadFile(filepath.Join(Root(), ".smithers/flows/migrate/README.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{migrationConfigDiscoveryQuote, migrationConfigLoaderQuote, migrationConfigCLIQuote} {
		if !strings.Contains(string(text), quote) {
			t.Fatalf("native config contract no longer contains %q", quote)
		}
	}
}

func FuzzMigrationConfigCallers(f *testing.F) {
	startShortBudget(f)
	keys := []string{"implicit-call", "explicit-call", "retained-config", "script-only", "opt-out", "foreign-shadow"}
	for _, key := range keys {
		for _, mode := range []uint8{0, 15} {
			f.Add(key, mode)
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMigrationConfigCallersQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
		defer cancel()
		cmd := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "migration_config_callers.mjs"), key, strconv.Itoa(int(mode&15)))
		cmd.Dir = Root()
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("native config caller transaction: %v; context=%v\n%s", err, ctx.Err(), output)
		}
		var result struct{ OK bool }
		if err := json.Unmarshal(output, &result); err != nil {
			t.Fatalf("invalid config caller receipt: %v\n%s", err, output)
		}
		gapKey := "caller:" + key
		if !result.OK {
			Gap(t, migrationConfigCallersTarget, gapKey, "Native configuration contract: %q; %q; %q; preserve each caller's config selection and value across migration\n%s", migrationConfigDiscoveryQuote, migrationConfigLoaderQuote, migrationConfigCLIQuote, output)
		}
		ExpectPending(t, migrationConfigCallersTarget, gapKey)
		ExpectPending(t, migrationConfigCallersTarget, specCorpusKey(t))
	})
}
