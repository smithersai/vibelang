package vibelangfuzz

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const migrationReferenceTarget = "FuzzMigrationReferencePlan"
const migrationReferenceQuote = "They follow the reverse reference closure"
const migrationReferencePreservation = "A rewrite that can't preserve types, behavior and declaration output refuses at that site."

func TestMigrationReferencePlanQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", migrationReferencePreservation)
	for _, file := range []string{".smithers/flows/migrate/README.md", "docs/user/src/setup/existing-project.md"} {
		text, err := os.ReadFile(filepath.Join(Root(), file))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(text), migrationReferenceQuote) {
			t.Fatalf("%s no longer contains reference-closure contract %q", file, migrationReferenceQuote)
		}
	}
}

// Scope comes from the documented reference closure. A broken reachable
// dependency and an unsafe deletion plan remain hard failures, while unrelated
// vendor references must leave a reference-free owned leaf and its outputs alone.
func FuzzMigrationReferencePlan(f *testing.F) {
	startShortBudget(f)
	keys := []string{"unowned-direct", "unowned-transitive", "owned-direct", "owned-transitive", "unsafe-output"}
	for _, key := range keys {
		f.Add(key, uint8(0))
		f.Add(key, uint8(7))
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMigrationReferencePlanQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		corpus, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", "t3code-reference-missing-child.json"))
		if err != nil {
			t.Fatal(err)
		}
		var witness struct{ Source, Quote string }
		if err := json.Unmarshal(corpus, &witness); err != nil {
			t.Fatal(err)
		}
		if witness.Source == "" || witness.Quote != migrationReferenceQuote {
			t.Fatal("invalid reference corpus")
		}
		input, err := json.Marshal(map[string]any{"key": key, "mode": mode})
		if err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
		defer cancel()
		cmd := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "migration_reference_plan.mjs"))
		cmd.Dir, cmd.Stdin = Root(), strings.NewReader(string(input))
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("reference oracle process: %v; context=%v\n%s", err, ctx.Err(), output)
		}
		var result struct {
			Error               *string
			State               string
			Projects            []string
			Executed, Unchanged bool
		}
		if err := json.Unmarshal(output, &result); err != nil {
			t.Fatalf("invalid reference result: %v\n%s", err, output)
		}
		if result.Executed || !result.Unchanged {
			t.Fatalf("reference plan changed source/output or ran a build: %s", output)
		}
		if key == "unsafe-output" {
			if result.Error == nil || !strings.Contains(*result.Error, "unsafe project output") {
				t.Fatalf("unsafe-output control: %s", output)
			}
			return
		}
		if strings.HasPrefix(key, "owned-") {
			if result.Error == nil || !strings.Contains(*result.Error, "TS5083") {
				t.Fatalf("reachable missing-dependency control: %s", output)
			}
			return
		}
		gapKey := "missing:" + strings.TrimPrefix(key, "unowned-")
		if result.Error != nil {
			if !strings.Contains(*result.Error, "TS5083") {
				t.Fatalf("unrelated planning failure: %s", output)
			}
			Gap(t, migrationReferenceTarget, gapKey, "Chapter 007: %s; %s; unrelated missing child invalidates independent leaf: %s", migrationReferencePreservation, migrationReferenceQuote, output)
		}
		if result.State != "not-needed" || len(result.Projects) != 0 {
			t.Fatalf("independent leaf was scheduled: %s", output)
		}
		ExpectPending(t, migrationReferenceTarget, gapKey)
		ExpectPending(t, migrationReferenceTarget, specCorpusKey(t))
	})
}
