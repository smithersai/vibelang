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

func TestMigrationDeclarationScopesQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", "Every `.vibe` module has a declaration, its sidecar")
	chapterSays(t, "001-functions.md", "changes no diagnostic, type, emitted statement, declaration or run-time observation.")
}

func FuzzMigrationDeclarationScopes(f *testing.F) {
	startShortBudget(f)
	keys := []string{"body", "unrecorded-body", "wrong-body", "plain-sidecar", "foreign-body", "unmigrated-body", "renamed-foreign", "recorded-output", "protected-test"}
	for _, key := range keys {
		f.Add(key, uint8(0))
		f.Add(key, uint8(15))
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMigrationDeclarationScopesQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
		defer cancel()
		command := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "migration_declaration_scopes.mjs"), key, strconv.Itoa(int(mode&15)))
		command.Dir = Root()
		output, err := command.CombinedOutput()
		if err != nil {
			t.Fatalf("migration model: %v; context=%v\n%s", err, ctx.Err(), output)
		}
		var result struct{ OK, Unchanged bool }
		if err := json.Unmarshal(output, &result); err != nil {
			t.Fatalf("invalid migration receipt: %v\n%s", err, output)
		}
		if !result.Unchanged {
			t.Fatalf("source-preservation control failed: %s", output)
		}
		gapKey := "scope:" + key
		if !result.OK {
			Gap(t, "FuzzMigrationDeclarationScopes", gapKey, "classify required generated module declarations without admitting foreign artifacts\n%s", output)
		}
		ExpectPending(t, "FuzzMigrationDeclarationScopes", gapKey)
		ExpectPending(t, "FuzzMigrationDeclarationScopes", specCorpusKey(t))
	})
}
