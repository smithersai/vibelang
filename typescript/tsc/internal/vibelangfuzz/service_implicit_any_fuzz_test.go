package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const serviceAnyQuote = "an omitted type follows TypeScript's `noImplicitAny`"

func TestServiceImplicitAnyQuoted(t *testing.T) {
	text := SpecText("005-services.md")
	for _, q := range []string{serviceAnyQuote, "VibeLang adds no diagnostic of its own", "TS7010", "TS7008"} {
		if !strings.Contains(text, q) {
			t.Fatal(q)
		}
	}
}
func FuzzServiceImplicitAny(f *testing.F) {
	startShortBudget(f)
	rules := []struct {
		key, member string
		strict      bool
		code        int32
	}{
		{"method-omitted-strict", "read()", true, 7010},
		{"method-omitted-loose", "read()", false, 0},
		{"method-explicit-any", "read(): any", true, 0},
		{"method-explicit-number", "read(): number", true, 0},
		{"property-omitted-strict", "value", true, 7008},
		{"property-omitted-loose", "value", false, 0},
		{"optional-method-omitted", "read?()", true, 7010},
		{"generic-method-omitted", "read<T>(x:T)", true, 7010},
	}
	for _, r := range rules {
		f.Add(r.key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, shape uint8) {
		TestServiceImplicitAnyQuoted(t)
		i := slices.IndexFunc(rules, func(r struct {
			key, member string
			strict      bool
			code        int32
		}) bool {
			return r.key == key
		})
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(rules)
		}
		r := rules[i]
		separator := []string{"\n", ";\n", ";"}[int(shape)%3]
		source := "export service Reader { static readonly key = \"batch/Reader\";" + separator + r.member + separator + "}\n"
		config := strings.Replace(DefaultConfig, "\"strict\": true,", "\"strict\": true, \"noImplicitAny\": "+fmt.Sprint(r.strict)+",", 1)
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		var got []int32
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				got = append(got, d.Code())
			}
		}
		expected := []int32{}
		if r.code != 0 {
			expected = append(expected, r.code)
		}
		if !slices.Equal(got, expected) {
			Gap(t, "FuzzServiceImplicitAny", r.key, "chapter 005 %q: want %v, got %v; %s", serviceAnyQuote, expected, got, source)
		}
		ExpectPending(t, "FuzzServiceImplicitAny", r.key)
		ExpectPending(t, "FuzzServiceImplicitAny", specCorpusKey(t))
	})
}
