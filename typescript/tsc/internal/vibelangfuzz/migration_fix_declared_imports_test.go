package vibelangfuzz

import (
	"context"
	"crypto/sha256"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const migrationFixImportsTarget = "FuzzMigrationFixDeclaredImports"

// The migrate flow renames an Effect TypeScript file to .vibe and runs
// vibelang --fix; Chapter 7's quick-fix rule (migrationDeclarationFixQuote)
// then requires the declaration stock tsc writes for the original. A fix
// that takes the last code use of an import out of the file must keep the
// import while the declaration still writes it: t3code's apps/server
// AgentDeviceShim wrote Effect.fn("…")(function* …) under import * as Effect
// from "effect/Effect", --fix removed the import with the generator, and the
// declaration imported { Effect } from "effect" instead (drive-t3code-server
// 12:03Z). The programs vary the import form, its alias, and the program form
// the fix rewrites; the oracle is stock tsc's declaration of the original
// under the migration gate's own comparison.
func migrationFixImportPrograms() []string {
	var sources []string
	for _, alias := range []string{"Effect", "Fx"} {
		for _, form := range []string{"import * as %s from \"effect/Effect\"\n", "import { Effect as %s } from \"effect\"\n"} {
			prefix := fmt.Sprintf(form, alias)
			if alias == "Effect" && strings.Contains(form, "{") {
				prefix = "import { Effect } from \"effect\"\n"
			}
			for _, body := range []string{
				"export const ensure = %s.fn(\"ensure\")(function* (n: number) {\n  return n + 1\n})\n",
				"export const ensure = %s.fn(function* (n: number) {\n  return n + 1\n})\n",
				"export const two = () => %s.gen(function* () {\n  return 2\n})\n",
				"export function count(n: number) {\n  return %s.gen(function* () {\n    return n\n  })\n}\n",
				"export const example = %s.fn(\"example\")(function* (prefix = \"x\") {\n  return prefix as string\n})\n",
			} {
				sources = append(sources, prefix+strings.ReplaceAll(body, "%s", alias))
			}
		}
	}
	return sources
}

func FuzzMigrationFixDeclaredImports(f *testing.F) {
	startShortBudget(f)
	programs := migrationFixImportPrograms()
	if testing.Short() && !toolsFuzzing() {
		// The corpus keeps the t3code witness; campaigns explore all 20.
		programs = []string{programs[2], programs[7], programs[11], programs[16], programs[4], programs[9], programs[14], programs[19]}
	}
	for _, source := range programs {
		f.Add(source)
	}
	tsc := StockTypeScript(f)
	api := declarationIdentityAPI(f)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, source string) {
		TestMigrationDeclarationFixQuoted(t)
		if len(source) > 4<<10 {
			return
		}
		known := slices.Contains(migrationFixImportPrograms(), source)
		toolsGuard(t, migrationFixImportsTarget, func() {
			module := `{"type":"module"}`
			stock := emitDeclarationIdentityStock(t, w, tsc, Project{Files: map[string]string{"main.ts": source, "package.json": module}})
			defer os.RemoveAll(stock)
			files := map[string]string{"main.vibe": source, "package.json": module}
			before := toolsCompile(t, w, migrationFixImportsTarget, files)
			defer before.Remove()
			config := toolsConfig(w, before.Dir)
			if before.Program == nil || config == nil || len(config.Errors) > 0 {
				t.Skip("not an admissible source project")
			}
			var result *vibelang.FixResult
			toolsRun(t, migrationFixImportsTarget, "fix", source, nil, func() {
				result = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
			})
			if result.Err != nil {
				Gap(t, migrationFixImportsTarget, "fix:converge", "Chapter 7: --fix failed: %v\n%s", result.Err, source)
			}
			fixed := maps.Clone(files)
			for name, file := range result.Files {
				fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
			}
			after := toolsCompile(t, w, migrationFixImportsTarget, fixed)
			defer after.Remove()
			if !toolsErrorFree(after) {
				if known {
					t.Fatalf("--fix must migrate the witness: %v\n%s", SortedKeys(Keys(after.Dir, after.Diagnostics)), fixed["main.vibe"])
				}
				t.Skip("--fix leaves an error: not a source the migration keeps")
			}
			current := filepath.Join(after.Dir, "__fixed_declarations")
			for name, text := range after.Outputs {
				if rel, ok := strings.CutPrefix(name, "out/"); ok && isDeclaration(name) {
					if err := writeInside(current, rel, text); err != nil {
						t.Fatal(err)
					}
				}
			}
			ctx, cancel := context.WithTimeout(t.Context(), 2*HangLimit)
			defer cancel()
			diff, err := compareIdentityDeclarations(ctx, api, filepath.Join(stock, "out"), current)
			if err != nil {
				t.Fatal(err)
			}
			key := fmt.Sprintf("declaration:%x", sha256.Sum256([]byte(source)))
			if diff != "" {
				Gap(t, migrationFixImportsTarget, key, "Chapter 7: %q\nstock tsc's declaration of the original (-) and of the fixed .vibe (+) differ:\n%s\noriginal:\n%s\nfixed:\n%s", migrationDeclarationFixQuote, diff, source, fixed["main.vibe"])
			}
			ExpectPending(t, migrationFixImportsTarget, key)
			ExpectPending(t, migrationFixImportsTarget, specCorpusKey(t))
		})
	})
}
