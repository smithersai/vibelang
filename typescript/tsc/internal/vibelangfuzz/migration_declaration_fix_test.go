package vibelangfuzz

import (
	"context"
	"crypto/sha256"
	"fmt"
	"maps"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const migrationDeclarationFixTarget = "FuzzMigrationDeclarationFix"
const migrationDeclarationFixQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."

// These are minimized migration witnesses, not snapshots of today's compiler.
// Chapter 7 requires equality before and after a safe fix. Compare through the
// migration gate's canonicalization, including imports that assignability alone
// cannot distinguish. Runtime equivalence remains in FuzzVIPDifferential.
func migrationDeclarationWitnesses() map[string]string {
	return map[string]string{
		"alchemy-conditional-alias": "import * as DateTime from \"effect/DateTime\"\ntype NonNull<V> = V extends DateTime.Utc ? string : V\nexport type FieldFilter<V> = { eq: NonNull<V> }\n",
		"alchemy-metric-module":     "import * as Metric from \"effect/Metric\"\nexport interface Tracked<M extends Metric.Metric<number, any>> { readonly metric: M }\n",
		"opencode-type-modifier":    "import type { HttpClientResponse } from \"effect/http\"\nexport interface Options { readonly response: HttpClientResponse.HttpClientResponse }\n",
		"foldkit-type-only":         "import type { Duration, Scope } from \"effect\"\nexport interface Options { readonly duration: Duration.Duration; readonly scope: Scope.Scope }\n",
	}
}

// Vary import form, namespace alias, type operation and nesting. Every generated
// source is checked against the same preservation rule, rather than predicting
// which import the implementation decides is removable.
func migrationDeclarationVariants() []string {
	var sources []string
	for _, module := range []string{"DateTime", "Duration"} {
		member := "Utc"
		if module == "Duration" {
			member = "Duration"
		}
		for _, alias := range []string{module, "ClockValue"} {
			for _, typeOnly := range []bool{false, true} {
				kind := ""
				if typeOnly {
					kind = "type "
				}
				prefix := fmt.Sprintf("import %s* as %s from \"effect/%s\"\n", kind, alias, module)
				typ := alias + "." + member
				for _, body := range []string{
					"export type Result<V> = V extends " + typ + " ? true : false\n",
					"export type Result = keyof " + typ + "\n",
					"type Hidden<V> = V extends " + typ + " ? string : V\nexport interface Result<V> { readonly nested: { value: Hidden<V> } }\n",
				} {
					sources = append(sources, prefix+body)
				}
			}
		}
	}
	return sources
}

func TestMigrationDeclarationFixQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), migrationDeclarationFixQuote) {
		t.Fatalf("Chapter 7 no longer says %q; update the oracle", migrationDeclarationFixQuote)
	}
}

func checkMigrationDeclarationFix(t *testing.T, w *Workspace, api, archive string) {
	t.Helper()
	TestMigrationDeclarationFixQuoted(t)
	toolsGuard(t, migrationDeclarationFixTarget, func() {
		files := toolsUnarchive(archive)
		if toolsMainFile(files) == "" || toolsTooLarge(files) {
			t.Skip("not an admissible source project")
		}
		before := toolsCompile(t, w, migrationDeclarationFixTarget, files)
		defer before.Remove()
		config := toolsConfig(w, before.Dir)
		if before.Program == nil || config == nil || len(config.Errors) > 0 || !toolsErrorFree(before) {
			t.Skipf("not a well-typed original project: %v", SortedKeys(Keys(before.Dir, before.Diagnostics)))
		}
		var result *vibelang.FixResult
		toolsRun(t, migrationDeclarationFixTarget, "fix", archive, nil, func() {
			result = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
		})
		if result.Err != nil {
			Gap(t, migrationDeclarationFixTarget, "fix:converge", "Chapter 7: --fix failed: %v\n%s", result.Err, archive)
		}
		fixed := maps.Clone(files)
		for name, file := range result.Files {
			rel := strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")
			if _, own := files[rel]; !own || !strings.HasSuffix(rel, ".vibe") {
				Gap(t, migrationDeclarationFixTarget, "fix:scope", "Chapter 7: --fix changed non-source %s\n%s", rel, archive)
			}
			fixed[rel] = file.Text
		}
		after := before
		if len(result.Files) > 0 {
			after = toolsCompile(t, w, migrationDeclarationFixTarget, fixed)
			defer after.Remove()
			if !toolsErrorFree(after) {
				Gap(t, migrationDeclarationFixTarget, "fix:new-error", "Chapter 7: --fix broke a well-typed source: %v\n%s\nfixed:\n%s", SortedKeys(Keys(after.Dir, after.Diagnostics)), archive, Archive(fixed))
			}
		}
		baseline, current := t.TempDir(), t.TempDir()
		for _, side := range []struct {
			dir    string
			result *Result
		}{{baseline, before}, {current, after}} {
			count := 0
			for name, text := range side.result.Outputs {
				if !strings.HasPrefix(name, "out/") || !isDeclaration(name) {
					continue
				}
				if err := writeInside(side.dir, strings.TrimPrefix(name, "out/"), text); err != nil {
					t.Fatal(err)
				}
				count++
			}
			if count == 0 {
				t.Skip("project emits no public declarations")
			}
		}
		ctx, cancel := context.WithTimeout(t.Context(), 2*HangLimit)
		defer cancel()
		diff, err := compareIdentityDeclarations(ctx, api, baseline, current)
		if err != nil {
			t.Fatal(err)
		}
		if diff != "" {
			// Each minimized source has its own key: one known import defect
			// cannot suppress a different failure discovered by mutation.
			Gap(t, migrationDeclarationFixTarget, fmt.Sprintf("declaration:%x", sha256.Sum256([]byte(archive))),
				"Chapter 7: %q\n%s\nsource:\n%s\nfixed:\n%s", migrationDeclarationFixQuote, diff, archive, Archive(fixed))
		}
		ExpectPending(t, migrationDeclarationFixTarget, specCorpusKey(t))
	})
}

func TestMigrationDeclarationFixWitnesses(t *testing.T) {
	w := NewWorkspace(t)
	api := declarationIdentityAPI(t)
	for name, source := range migrationDeclarationWitnesses() {
		var child *testing.T
		t.Run(name, func(t *testing.T) {
			child = t
			checkMigrationDeclarationFix(t, w, api, Archive(map[string]string{"main.vibe": source}))
		})
		if child.Skipped() {
			if _, pending := Pending(migrationDeclarationFixTarget, "corpus:"+name); !pending {
				t.Errorf("%s: minimized migration witness was not admitted", name)
			}
		}
	}
}

func FuzzMigrationDeclarationFix(f *testing.F) {
	startShortBudget(f)
	variants := migrationDeclarationVariants()
	if testing.Short() && !toolsFuzzing() {
		// Corpus files retain all four original witnesses. Four additional
		// combinations bound short-run cost; campaigns explore all 24.
		variants = []string{variants[1], variants[5], variants[10], variants[21]}
	}
	for _, source := range variants {
		f.Add(Archive(map[string]string{"main.vibe": source}))
	}
	w := NewWorkspace(f)
	api := declarationIdentityAPI(f)
	f.Fuzz(func(t *testing.T, archive string) {
		checkMigrationDeclarationFix(t, w, api, archive)
	})
}
