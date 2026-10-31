package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const migrationHeritageTarget = "FuzzMigrationEffectHeritage"
const migrationHeritageQuote = "A written `Effect.Effect<A, E, R>` type, except an interface's `extends` element, which `A!E!R` cannot spell"

func TestMigrationEffectHeritageQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), migrationHeritageQuote) {
		t.Fatalf("Chapter 7 no longer says %q", migrationHeritageQuote)
	}
}

func FuzzMigrationEffectHeritage(f *testing.F) {
	startShortBudget(f)
	for _, context := range []string{"direct", "nested", "alias"} {
		for _, variant := range []uint8{0, 1, 2, 4} {
			f.Add(context, variant)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, context string, variant uint8) {
		TestMigrationEffectHeritageQuoted(t)
		contexts := []string{"direct", "nested", "alias"}
		if !slices.Contains(contexts, context) {
			if context == "" {
				return
			}
			context = contexts[int(context[0])%len(contexts)]
		}
		typ := []string{"Effect.Effect<A>", "Effect.Effect<A, never>", "Effect.Effect<A, never, never>"}[int(variant)%3]
		prefix := ""
		if variant&4 != 0 {
			prefix = "import type { Effect } from \"effect\"\n"
		}
		source := fmt.Sprintf("export interface Api<A> extends %s { readonly kind: \"Api\" }", typ)
		if context == "nested" {
			source = fmt.Sprintf("export interface Api<A> extends ReadonlyArray<%s> { readonly kind: \"Api\" }", typ)
		}
		if context == "alias" {
			source = fmt.Sprintf("export type Api<A> = %s", typ)
		}
		source = prefix + source + "\n"
		var result *Result
		var err error
		within(t, "compile", func() { result, err = w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}}) })
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		found := false
		var errors []string
		for _, d := range result.Diagnostics {
			if d.Source() == "EK" && d.Code() == 4833 {
				found = true
			}
			if d.Category() == diagnostics.CategoryError {
				errors = append(errors, fmt.Sprintf("%s%d", d.Source(), d.Code()))
			}
		}
		expected := context != "direct"
		key := fmt.Sprintf("feature:%s:%d:%t", context, int(variant)%3, variant&4 != 0)
		if found != expected || len(errors) > 0 {
			Gap(t, migrationHeritageTarget, key, "Chapter 7: %q; expected EK4833=%t, got %t, errors %v\n%s", migrationHeritageQuote, expected, found, errors, source)
		}
		ExpectPending(t, migrationHeritageTarget, specCorpusKey(t))
	})
}
