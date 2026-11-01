package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const legacyAliasQuote = "The `EK4856` transition selects the resolved legacy symbol, never the identifier spelling"

func TestLegacyEffectAliasQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), legacyAliasQuote) {
		t.Fatal(legacyAliasQuote)
	}
}
func FuzzLegacyEffectAlias(f *testing.F) {
	startShortBudget(f)
	keys := []string{"legacy-global", "local-type", "imported-type"}
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, shape uint8) {
		TestLegacyEffectAliasQuoted(t)
		i := slices.Index(keys, key)
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(keys)
		}
		key = keys[i]
		typ := []string{"number", "string", "number | string", "readonly number[]"}[int(shape)%4]
		use := "export let result: Effect<" + typ + ">;"
		files := map[string]string{}
		switch key {
		case "local-type":
			use = "type Effect<A> = { value:A };" + use
		case "imported-type":
			use = "import type { Effect } from \"./native.js\";" + use
			files["native.ts"] = "export type Effect<A> = { value:A };"
		}
		files["main.vibe"] = use
		r, err := w.Compile(t.Context(), Project{Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		warnings, errors := 0, []string{}
		for _, d := range r.Diagnostics {
			if d.Source() == "EK" && d.Code() == 4856 {
				warnings++
			}
			if d.Category() == diagnostics.CategoryError {
				errors = append(errors, fmt.Sprint(d))
			}
		}
		want := 0
		if key == "legacy-global" {
			want = 1
		}
		if warnings != want || len(errors) != 0 {
			Gap(t, "FuzzLegacyEffectAlias", key, "chapter 007 %q: want %d EK4856 and no errors; got %d, %v; %s", legacyAliasQuote, want, warnings, errors, use)
		}
		ExpectPending(t, "FuzzLegacyEffectAlias", key)
		ExpectPending(t, "FuzzLegacyEffectAlias", specCorpusKey(t))
	})
}
