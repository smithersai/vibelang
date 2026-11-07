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

const savedNativeSiblingTarget = "FuzzMigrationSavedNativeSiblings"

var savedNativeSiblingKeys = []string{
	"outside-inferred-native", "outside-explicit-native", "inside-inferred-native",
	"outside-inferred-typescript", "missing-native", "changed-type",
}

func TestMigrationSavedNativeSiblingsQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", "each export's type identical to \x60tsc\x60's in both directions")
	data, err := os.ReadFile(filepath.Join(Root(), ".smithers/flows/migrate/README.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{
		migrationWideRootQuote,
		"Snapshot paths follow their original package output paths",
		"An unresolved root remains conservative even if it is unresolved on both sides.",
	} {
		if !strings.Contains(string(data), quote) {
			t.Fatalf("migration contract no longer says %q", quote)
		}
	}
}

func TestMigrationSavedNativeSiblingsCorpus(t *testing.T) {
	data, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", "t3code-saved-native-sibling.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct{ Model, Helper, Entry string }
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	if fixture.Model != "export interface Box<T> { readonly value: T }\n" ||
		!strings.Contains(fixture.Helper, "./model.vibe") ||
		fixture.Entry != "export { allowed } from \"../../scripts/lib/helper.ts\";\n" {
		t.Fatal("saved sibling corpus lost its minimized source pattern")
	}
}

func FuzzMigrationSavedNativeSiblings(f *testing.F) {
	startShortBudget(f)
	if testing.Short() {
		// The keyed corpus already supplies the original native witness.
		f.Add("missing-native", uint8(0))
	} else {
		for _, key := range savedNativeSiblingKeys {
			for mode := range 16 {
				f.Add(key, uint8(mode))
			}
		}
	}
	w := NewWorkspace(f)
	binary := cliBuild(f, w.Dir)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMigrationSavedNativeSiblingsQuoted(t)
		if !slices.Contains(savedNativeSiblingKeys, key) {
			if key == "" {
				key = savedNativeSiblingKeys[0]
			} else {
				key = savedNativeSiblingKeys[int(key[0])%len(savedNativeSiblingKeys)]
			}
		}
		ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
		defer cancel()
		cmd := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "migration_saved_native_siblings.mjs"), binary, key, strconv.Itoa(int(mode&15)))
		cmd.Dir = Root()
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("saved native sibling oracle: %v; context=%v\n%s", err, ctx.Err(), output)
		}
		var result struct {
			OK, Unchanged, KnownGap bool
			Key                     string
		}
		if err := json.Unmarshal(output, &result); err != nil {
			t.Fatalf("invalid sibling receipt: %v\n%s", err, output)
		}
		if !result.Unchanged {
			t.Fatalf("comparison changed authored sources: %s", output)
		}
		if !result.OK {
			if !result.KnownGap {
				t.Fatalf("unexpected declaration context failure: %s", output)
			}
			Gap(t, savedNativeSiblingTarget, result.Key, "Chapter 1 API identity and recorded output-path preservation require the saved source to retain its native sibling\n%s", output)
		}
		ExpectPending(t, savedNativeSiblingTarget, result.Key)
		ExpectPending(t, savedNativeSiblingTarget, specCorpusKey(t))
	})
}
