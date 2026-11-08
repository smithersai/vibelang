package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const functionPatternTarget = "FuzzFunctionPatternReportsOnce"
const functionPatternQuote = "The global `Function` still reports `EK0107`; use a `typeof` guard."

func TestFunctionPatternReportsOnceQuoted(t *testing.T) {
	if !strings.Contains(SpecText("004-match.md"), functionPatternQuote) {
		t.Fatalf("Chapter 4 no longer says %q", functionPatternQuote)
	}
}

// Each site is a pattern position holding the global Function once, or a
// control that holds no pattern. The oracle quotes the chapter: each written
// global Function reports EK0107 once, and a pattern's report gives the
// typeof-guard advice. Comparing sites with the same count is a self-check.
type functionPatternSite struct {
	key, source string
	pattern     bool
}

var functionPatternSites = []functionPatternSite{
	{"arm", "match (s) { when Function: 1; default: 0; }", true},
	{"is", "(s is Function) ? 1 : 0", true},
	{"extractor", "match (s) { when Function(let g): 1; default: 0; }", true},
	{"array", "match (s) { when [Function]: 1; default: 0; }", true},
	{"object", "match (s) { when { f: Function }: 1; default: 0; }", true},
	{"and", "match (s) { when Function and let g: 1; default: 0; }", true},
	{"or", "match (s) { when Function or null: 1; default: 0; }", true},
	{"nested-is", "match (s) { when let g and if (g is Function): 1; default: 0; }", true},
	{"global", "match (s) { when globalThis.Function: 1; default: 0; }", true},
	{"global-is", "(s is globalThis.Function) ? 1 : 0", true},
	{"global-element", "(s is globalThis[\"Function\"]) ? 1 : 0", true},
	{"global-extractor", "match (s) { when globalThis.Function(let g): 1; default: 0; }", true},
	{"value", "Function", false},
	{"subject", "match (Function) { when let g: 1; }", false},
	{"call-argument", "[Function].length", false},
}

func FuzzFunctionPatternReportsOnce(f *testing.F) {
	startShortBudget(f)
	for _, site := range functionPatternSites {
		f.Add(site.key, uint8(1))
	}
	f.Add("arm", uint8(2))
	f.Add("is", uint8(3))
	f.Add("global", uint8(2))
	f.Add("value", uint8(2))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, repeat uint8) {
		TestFunctionPatternReportsOnceQuoted(t)
		if key == "" {
			return
		}
		site := functionPatternSites[int(key[0])%len(functionPatternSites)]
		for _, s := range functionPatternSites {
			if s.key == key {
				site = s
			}
		}
		n := int(repeat%3) + 1
		var body strings.Builder
		for i := 0; i < n; i++ {
			body.WriteString("export function f" + string(rune('a'+i)) + "(s: unknown) { return " + site.source + " }\n")
		}
		files := map[string]string{"main.vibe": body.String()}
		var r *Result
		var err error
		within(t, "compile", func() {
			r, err = w.Compile(t.Context(), Project{Files: files})
		})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var messages []string
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError && (d.Source() != "EK" || d.Code() != 107) {
				t.Fatalf("invalid generated witness: %s\n%s", d.String(), Archive(files))
			}
			if d.Source() == "EK" && d.Code() == 107 {
				messages = append(messages, d.MessageText())
			}
		}
		if len(messages) != n {
			Gap(t, functionPatternTarget, "count:"+site.key, "%s; want %d EK0107, got %d: %q\n%s", functionPatternQuote, n, len(messages), messages, Archive(files))
			return
		}
		for _, m := range messages {
			if strings.Contains(m, "typeof guard") != site.pattern {
				Gap(t, functionPatternTarget, "advice:"+site.key, "%s; pattern advice %v in %q\n%s", functionPatternQuote, site.pattern, m, Archive(files))
				return
			}
		}
	})
}
