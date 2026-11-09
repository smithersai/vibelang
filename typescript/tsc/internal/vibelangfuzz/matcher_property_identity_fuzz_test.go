package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

const matcherPropertyQuote = "Other return types, and callees with neither signature (`any`, `unknown`, `Function`, non-callable objects), are `EK0702`"

func TestMatcherPropertyIdentityQuoted(t *testing.T) {
	if !strings.Contains(SpecText("004-match.md"), matcherPropertyQuote) {
		t.Fatal("matcher admission rule changed")
	}
}
func FuzzMatcherPropertyIdentity(f *testing.F) {
	startShortBudget(f)
	keys := []string{"unrelated-symbol", "string", "number", "other-well-known-symbol", "protocol-alias"}
	for _, key := range keys {
		f.Add(key, uint8(0), uint8(0), uint8(0))
		f.Add(key, uint8(2), uint8(1), uint8(1))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, form, home, spelling uint8) {
		TestMatcherPropertyIdentityQuoted(t)
		if key == "" {
			return
		}
		selected := keys[int(key[0])%len(keys)]
		for _, candidate := range keys {
			if key == candidate {
				selected = key
			}
		}
		binding := map[string]string{
			"unrelated-symbol":        `const customMatcher=Symbol("other");`,
			"string":                  `const customMatcher="customMatcher";`,
			"number":                  `const customMatcher=17;`,
			"other-well-known-symbol": `const customMatcher=Symbol.toStringTag;`,
			"protocol-alias":          `const customMatcher:typeof Symbol.customMatcher=Symbol.customMatcher;`,
		}[selected]
		name := []string{"Matcher", "Predicate"}[spelling%2]
		setup := binding + "const " + name + `={[customMatcher](s:unknown):number[]{return [1]}};`
		expr := "s is " + name
		if form%3 == 1 {
			expr = "match(s){when " + name + ":1;default:0;}"
		}
		if form%3 == 2 {
			expr = "match(s){when " + name + "(let x):x;default:0;}"
		}
		source := setup + "export function inspect(s:unknown):unknown{return " + expr + "}"
		if home%2 == 1 {
			source = "export function inspect(s:unknown):unknown{" + setup + "return " + expr + "}"
		}
		files := map[string]string{"main.vibe": source}
		var r *Result
		var err error
		within(t, "compile", func() { r, err = w.Compile(t.Context(), Project{Files: files}) })
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		count := 0
		for _, d := range r.Diagnostics {
			if d.Source() == "EK" && d.Code() == 702 {
				count++
				continue
			}
			if d.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzMatcherPropertyIdentity", "unexpected:"+selected, "%s\n%s", d.String(), Archive(files))
				return
			}
		}
		want := 1
		if selected == "protocol-alias" {
			want = 0
		}
		if count != want {
			Gap(t, "FuzzMatcherPropertyIdentity", fmt.Sprintf("%s/form%d/home%d", selected, form%3, home%2), "%s; want %d EK0702, got %d\n%s", matcherPropertyQuote, want, count, Archive(files))
		}
	})
}
