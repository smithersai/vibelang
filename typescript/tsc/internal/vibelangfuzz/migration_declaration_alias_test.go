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

const migrationDeclarationAliasTarget = "FuzzMigrationDeclarationAlias"
const migrationDeclarationAliasQuote = "each export's type identical to `tsc`'s in both directions"

func TestMigrationDeclarationAliasQuoted(t *testing.T) {
	if !strings.Contains(SpecText("001-functions.md"), migrationDeclarationAliasQuote) {
		t.Fatal("the declaration type identity contract changed")
	}
}

func migrationDeclarationAliasDependencies(t testing.TB) {
	t.Helper()
	if _, err := os.Stat(filepath.Join(Root(), "docs/tools/node_modules/typescript/package.json")); err != nil {
		Missing(t, "install the declaration oracle's TypeScript API with (cd docs/tools && bun install)")
	}
}

func checkMigrationDeclarationAlias(t *testing.T, binary, key string, shape uint8, controls bool) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
	defer cancel()
	input, err := json.Marshal(map[string]any{"key": key, "shape": shape, "compiler": binary, "controls": controls})
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "migration_declaration_alias.mjs"))
	cmd.Dir, cmd.Stdin = Root(), strings.NewReader(string(input))
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("declaration alias oracle: exit=%v context=%v\n%s", err, ctx.Err(), output)
	}
	var result struct {
		Errors    []any
		Unchanged bool
		Controls  []struct {
			Name string
			OK   bool
		}
		Self, StockSelf  struct{ ComparisonComplete, Identical bool }
		Version          string
		DeclarationFiles int
	}
	if err := json.Unmarshal(output, &result); err != nil {
		t.Fatalf("invalid declaration alias receipt: %v\n%s", err, output)
	}
	if len(result.Errors) != 0 || !result.Unchanged || result.DeclarationFiles != 2 {
		t.Fatalf("original declaration fixture or frozen-byte guard failed: %s", output)
	}
	expectedControls := 0
	if controls {
		expectedControls = 6
	}
	if len(result.Controls) != expectedControls {
		t.Fatalf("missing strict declaration controls: %s", output)
	}
	for _, control := range result.Controls {
		if !control.OK {
			t.Fatalf("declaration control %s failed: %s", control.Name, output)
		}
	}
	if !result.Self.ComparisonComplete || !result.Self.Identical {
		Gap(t, migrationDeclarationAliasTarget, "self:"+key, "Chapter 001 %q: successfully emitted unchanged declarations must compare completely and identically to themselves; stock TypeScript %s; %s", migrationDeclarationAliasQuote, result.Version, output)
	}
	ExpectPending(t, migrationDeclarationAliasTarget, "self:"+key)
	ExpectPending(t, migrationDeclarationAliasTarget, specCorpusKey(t))
}

func TestMigrationDeclarationAliasWitness(t *testing.T) {
	TestMigrationDeclarationAliasQuoted(t)
	migrationDeclarationAliasDependencies(t)
	checkMigrationDeclarationAlias(t, cliBuild(t, t.TempDir()), "namespace-ts", 0, true)
}

// The matrix exercises every route once without charging unrelated safety
// controls to every mutation. Both emitters must still accept every fixture.
func TestMigrationDeclarationAliasForms(t *testing.T) {
	TestMigrationDeclarationAliasQuoted(t)
	migrationDeclarationAliasDependencies(t)
	binary := cliBuild(t, t.TempDir())
	for _, key := range []string{"namespace-ts", "namespace-js", "named-ts", "named-js", "interface-ts", "no-suffix-ts"} {
		t.Run(key, func(t *testing.T) { checkMigrationDeclarationAlias(t, binary, key, 0, false) })
	}
}

func FuzzMigrationDeclarationAlias(f *testing.F) {
	startShortBudget(f)
	migrationDeclarationAliasDependencies(f)
	binary := cliBuild(f, f.TempDir())
	keys := []string{"namespace-ts", "namespace-js", "named-ts", "named-js", "interface-ts", "no-suffix-ts"}
	for _, key := range []string{"namespace-ts", "named-js"} {
		f.Add(key, uint8(0))
	}
	f.Fuzz(func(t *testing.T, key string, shape uint8) {
		TestMigrationDeclarationAliasQuoted(t)
		key = strings.TrimPrefix(key, "key:")
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		checkMigrationDeclarationAlias(t, binary, key, shape, false)
	})
}
