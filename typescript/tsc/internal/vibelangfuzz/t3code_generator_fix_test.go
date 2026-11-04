package vibelangfuzz

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const t3CodeGeneratorTarget = "FuzzT3CodeGeneratorFix"
const t3CodeGeneratorQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."

func TestT3CodeGeneratorFixQuoted(t *testing.T) {
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), t3CodeGeneratorQuote) {
		t.Fatalf("chapter 7 no longer says %q", t3CodeGeneratorQuote)
	}
}

// Minimized from DesktopConnectionCatalogStore's migrateSavedEnvironmentRecords.
// This static oracle compares declarations with the .ts twin through the
// migration API-identity checker, rather than trusting inferred assignability.
func t3CodeGeneratorSource(key string, n byte) string {
	value := fmt.Sprintf("%d", int(n)%7)
	typ, returned := "{ readonly schemaVersion: "+value+" }", "{ schemaVersion: "+value+" }"
	if strings.HasSuffix(key, "tag") {
		typ, returned = "{ readonly tag: \"saved\"; readonly values: readonly string[] }", "{ tag: \"saved\", values: [] }"
	}
	annotation := ": Effect.fn.Return<Catalog>"
	destination := ""
	if strings.HasPrefix(key, "contextual") {
		annotation = ""
		destination = ": (records: readonly string[]) => Effect.Effect<Catalog>"
	}
	return "import * as Effect from \"effect/Effect\"\ntype Catalog = " + typ + "\nexport const migrate" + destination + " = Effect.fn(\"migrate\")(function* (records: readonly string[])" + annotation + " {\n const targets: string[] = []\n for (const record of records) targets.push(record)\n yield* Effect.succeed(0)\n return " + returned + "\n})\n"
}

func FuzzT3CodeGeneratorFix(f *testing.F) {
	startShortBudget(f)
	keys := []string{"annotated-version", "annotated-tag", "contextual-version", "contextual-tag"}
	// Keyed corpus files cover each shape without duplicating short seeds.
	w := NewWorkspace(f)
	api := declarationIdentityAPI(f)
	f.Fuzz(func(t *testing.T, key string, n byte) {
		if !slices.Contains(keys, key) {
			key = keys[int(n)%len(keys)]
		}
		TestT3CodeGeneratorFixQuoted(t)
		source := t3CodeGeneratorSource(key, n)
		twin := toolsCompile(t, w, t3CodeGeneratorTarget, map[string]string{"main.ts": source})
		defer twin.Remove()
		if !toolsErrorFree(twin) {
			t.Fatalf("invalid .ts twin: %v\n%s", SortedKeys(Keys(twin.Dir, twin.Diagnostics)), source)
		}
		before := toolsCompile(t, w, t3CodeGeneratorTarget, map[string]string{"main.vibe": source})
		defer before.Remove()
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
		fixed := source
		for name, file := range result.Files {
			if filepath.Base(name.AsString()) == "main.vibe" {
				fixed = file.Text
			}
		}
		if strings.Contains(fixed, "function*") {
			Gap(t, t3CodeGeneratorTarget, key, "chapter 7: safe span rewrite refused: %+v\n%s", result.Refused, source)
		}
		after := toolsCompile(t, w, t3CodeGeneratorTarget, map[string]string{"main.vibe": fixed})
		defer after.Remove()
		if !toolsErrorFree(after) {
			Gap(t, t3CodeGeneratorTarget, key, "chapter 7: fixed program has errors: %v\n%s", SortedKeys(Keys(after.Dir, after.Diagnostics)), fixed)
		}
		baseline, current := t.TempDir(), t.TempDir()
		for _, side := range []struct {
			dir    string
			result *Result
		}{{baseline, twin}, {current, after}} {
			count := 0
			for name, text := range side.result.Outputs {
				if strings.HasPrefix(name, "out/") && isDeclaration(name) {
					if err := writeInside(side.dir, strings.TrimPrefix(name, "out/"), text); err != nil {
						t.Fatal(err)
					}
					count++
				}
			}
			if count == 0 {
				t.Fatal("no declaration output")
			}
		}
		ctx, cancel := context.WithTimeout(t.Context(), 2*HangLimit)
		defer cancel()
		diff, err := compareIdentityDeclarations(ctx, api, baseline, current)
		if err != nil {
			t.Fatal(err)
		}
		if diff != "" {
			Gap(t, t3CodeGeneratorTarget, key, "chapter 7: declaration identity changed:\n%s\n%s", diff, fixed)
		}
	})
}
