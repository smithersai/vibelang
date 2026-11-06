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

const migrationLibraryContextTarget = "FuzzMigrationLibraryContext"
const migrationLibraryContextQuote = "each export's type identical to `tsc`'s in both directions"

func TestMigrationLibraryContextQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", migrationLibraryContextQuote)
}

func checkMigrationLibraryContext(t *testing.T, target, key string, mode uint8, keys []string) {
	t.Helper()
	TestMigrationLibraryContextQuoted(t)
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
	cmd := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "migration_library_context.mjs"), key, strconv.Itoa(int(mode&31)))
	cmd.Dir = Root()
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("library-context oracle: %v; context=%v\n%s", err, ctx.Err(), output)
	}
	var result struct {
		OK, Unchanged       bool
		StockDiagnostics    []int
		Complete, Identical bool
	}
	if err := json.Unmarshal(output, &result); err != nil {
		t.Fatalf("invalid library-context receipt: %v\n%s", err, output)
	}
	if !result.Unchanged {
		t.Fatalf("comparison changed the original source or snapshot: %s", output)
	}
	gapKey := "context:" + key
	if !result.OK {
		Gap(t, target, gapKey, "Chapter 1 %q: retain the original TypeScript library context, and reject unavailable names rather than treating them as equal; %s", migrationLibraryContextQuote, output)
	}
	ExpectPending(t, target, gapKey)
	ExpectPending(t, target, specCorpusKey(t))
}

func TestMigrationLibraryContextControls(t *testing.T) {
	for _, key := range []string{"scalar", "changed-type", "unresolved"} {
		t.Run(key, func(t *testing.T) {
			checkMigrationLibraryContext(t, migrationLibraryContextTarget, key, 0, []string{"scalar", "changed-type", "unresolved"})
		})
	}
}

func FuzzMigrationLibraryContext(f *testing.F) {
	startShortBudget(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		checkMigrationLibraryContext(t, migrationLibraryContextTarget, key, mode, []string{"webworker", "scalar", "changed-type", "unresolved"})
	})
}

// Invalid original projects remain source-eligibility and byte-preservation
// controls, separate from the valid-input declaration identity regression.
func FuzzMigrationLibraryEligibility(f *testing.F) {
	startShortBudget(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		checkMigrationLibraryContext(t, "FuzzMigrationLibraryEligibility", key, mode, []string{"worker-dom", "es-dom"})
	})
}
