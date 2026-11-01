package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const qualifierQuote = "A written binding keeps its ordinary TypeScript meaning"

func TestEffectQualifierQuoted(t *testing.T) {
	if !strings.Contains(SpecText("005-services.md"), qualifierQuote) {
		t.Fatal(qualifierQuote)
	}
}
func FuzzEffectQualifier(f *testing.F) {
	startShortBudget(f)
	keys := []string{"implicit", "imported", "aliased-module", "local", "local-disabled"}
	for _, key := range keys {
		f.Add(key, int16(1))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, n int16) {
		TestEffectQualifierQuoted(t)
		i := slices.Index(keys, key)
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(keys)
		}
		key = keys[i]
		value := fmt.Sprint(n)
		source := "export const result = Effect.Array.head([" + value + "]);"
		expected := []int32{}
		config := DefaultConfig
		switch key {
		case "imported":
			source = "import { Effect } from \"effect\";" + source
			expected = append(expected, 2339)
		case "aliased-module":
			source = "import { Array as Arr } from \"effect\";export const result = Arr.head([" + value + "]);"
		case "local", "local-disabled":
			source = "const Effect = { Array: { head: (xs: number[]): number => xs.length } }; export const result: number = Effect.Array.head([" + value + "]);"
		}
		if key == "local-disabled" {
			config = strings.TrimSuffix(config, "\n}") + ",\n\"vibe\":{\"effectModules\":false}\n}"
		}
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var got []int32
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				got = append(got, d.Code())
			}
		}
		if !slices.Equal(got, expected) {
			Gap(t, "FuzzEffectQualifier", key, "chapter 005 %q: want %v, got %v; %s", qualifierQuote, expected, got, source)
		}
		ExpectPending(t, "FuzzEffectQualifier", key)
		ExpectPending(t, "FuzzEffectQualifier", specCorpusKey(t))
	})
}
