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

const migrationWideRootQuote = "Public declarations reachable from `exports` or `types` must remain API-identical"

func TestMigrationWideRootLayoutsQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", "each export's type identical to \x60tsc\x60's in both directions")
	text, err := os.ReadFile(filepath.Join(Root(), ".smithers/flows/migrate/README.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), migrationWideRootQuote) {
		t.Fatalf("the migrate README no longer says %q", migrationWideRootQuote)
	}
}

// FuzzMigrationWideRootLayouts records a package whose rootDir sits above it
// (T3code's server: rootDir "..", include ["src"], src imports a generated
// schema file outside include) and compares the unchanged package with
// itself through the real declaration recorder and comparison. The unchanged
// package must compare complete and identical. A changed schema type must
// still differ, and a schema absent before recording must stay unavailable.
func FuzzMigrationWideRootLayouts(f *testing.F) {
	startShortBudget(f)
	keys := []string{"transitive-generated", "transitive-ordinary", "native-transitive", "included", "local-root", "changed-type", "missing-file"}
	f.Add("transitive-generated", uint8(9))
	f.Add("missing-file", uint8(6))
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMigrationWideRootLayoutsQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		if key == "native-transitive" {
			if _, err := os.Stat(filepath.Join(Root(), "packages/compiler/native/vibelang")); err != nil {
				Missing(t, "native-transitive needs the native compiler: run sh scripts/build-vibelang.sh")
			}
		}
		ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
		defer cancel()
		command := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "migration_wide_root_layouts.mjs"), key, strconv.Itoa(int(mode&15)))
		command.Dir = Root()
		output, err := command.CombinedOutput()
		if err != nil {
			t.Fatalf("wide-root layout model: %v; context=%v\n%s", err, ctx.Err(), output)
		}
		var result struct{ OK, Unchanged, KnownGap bool }
		if err := json.Unmarshal(output, &result); err != nil {
			t.Fatalf("invalid wide-root layout receipt: %v\n%s", err, output)
		}
		if !result.Unchanged {
			t.Fatalf("source guard failed: %s", output)
		}
		if !result.OK {
			if !result.KnownGap {
				t.Fatalf("declaration record or comparison broke its contract: %s", output)
			}
			Gap(t, "FuzzMigrationWideRootLayouts", "layout:"+key, "an unchanged package with a root above it is not comparable with itself\n%s", output)
		}
		ExpectPending(t, "FuzzMigrationWideRootLayouts", "layout:"+key)
		ExpectPending(t, "FuzzMigrationWideRootLayouts", specCorpusKey(t))
	})
}
