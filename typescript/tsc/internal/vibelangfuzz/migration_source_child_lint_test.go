package vibelangfuzz

import (
	"context"
	"encoding/json"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const migrationSourceChildLintTarget = "FuzzMigrationSourceChildLint"
const migrationSourceChildLintQuote = "Existing tools work."

func TestMigrationSourceChildLintQuoted(t *testing.T) {
	r4Quoted(t, "../vips/0034-compiler-and-tooling.md", migrationSourceChildLintQuote)
	r4Quoted(t, "007-tooling.md", migrationWrittenGeneratorQuote)
}

// The fixture records the unchanged target's two style requirements. Check
// each independently: one pending requirement must not mask the other.
func FuzzMigrationSourceChildLint(f *testing.F) {
	startShortBudget(f)
	keys := []string{"namespace:mjs", "namespace:js", "namespace:existing-url", "comment:mjs", "comment:js", "comment:existing-url"}
	for _, key := range keys {
		f.Add(key, uint8(0))
		f.Add(key, uint8(1))
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMigrationSourceChildLintQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		input, err := json.Marshal(map[string]any{"key": key, "mode": mode})
		if err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
		defer cancel()
		cmd := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "migration_source_child_lint.mjs"))
		cmd.Dir, cmd.Stdin = Root(), strings.NewReader(string(input))
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("source-child lint oracle process: %v; context=%v\n%s", err, ctx.Err(), output)
		}
		var result struct {
			Before, After []string
			Refusals      []struct {
				Line   int
				Reason string
			}
			UsesChild, Unchanged bool
		}
		if err := json.Unmarshal(output, &result); err != nil {
			t.Fatalf("invalid style oracle: %v\n%s", err, output)
		}
		if len(result.Before) != 0 {
			t.Fatalf("invalid original project-policy control: %s", output)
		}
		if len(result.Refusals) != 0 {
			if !result.Unchanged {
				t.Fatalf("refused wiring changed the source: %s", output)
			}
			for _, site := range result.Refusals {
				if site.Line < 1 || site.Reason == "" {
					t.Fatalf("unexplained wiring refusal: %s", output)
				}
			}
			ExpectPending(t, migrationSourceChildLintTarget, key)
			ExpectPending(t, migrationSourceChildLintTarget, specCorpusKey(t))
			return
		}
		if !result.UsesChild {
			t.Fatalf("launcher never exercised source-child wiring: %s", output)
		}
		rule := "namespace-node-imports"
		if strings.HasPrefix(key, "comment:") {
			rule = "no-low-value-comments"
		}
		if slices.Contains(result.After, rule) {
			Gap(t, migrationSourceChildLintTarget, key, "VIP-34: %q; generated helper violates the fixture's unchanged %s requirement: %s", migrationSourceChildLintQuote, rule, output)
		}
		ExpectPending(t, migrationSourceChildLintTarget, key)
		ExpectPending(t, migrationSourceChildLintTarget, specCorpusKey(t))
	})
}
