package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const metaPropertyPatternTarget = "FuzzMetaPropertyPattern"
const metaPropertyPatternChapter = "../vips/tc39-pattern-matching/spec.emu"
const metaPropertyPatternQuote = "PatternMatchingMemberExpression[Yield, Await] :\n        `this`\n        MetaProperty\n"

// Each key places import.meta or new.target in a pattern position.
var metaPropertyPatternKeys = []string{"import-value", "import-strict", "import-relational", "import-is", "new-strict", "new-class", "new-function", "new-not"}

func metaPropertyPatternQuoted(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText(metaPropertyPatternChapter), metaPropertyPatternQuote) {
		t.Fatal("pattern member expression authority changed")
	}
}
func TestMetaPropertyPatternQuoted(t *testing.T) { metaPropertyPatternQuoted(t) }

// A static acceptance check: each form is admitted by the quoted production
// and compiles without errors. The paired compiler case checks the results.
func FuzzMetaPropertyPattern(f *testing.F) {
	startShortBudget(f)
	metaPropertyPatternQuoted(f)
	for _, key := range metaPropertyPatternKeys {
		for mode := uint8(0); mode < 4; mode++ {
			f.Add(key, mode)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		if !slices.Contains(metaPropertyPatternKeys, key) {
			key = metaPropertyPatternKeys[int(mode)%len(metaPropertyPatternKeys)]
		}
		mode %= 4
		pattern := map[string]string{
			"import-value":      "import.meta.url",
			"import-strict":     "=== import.meta.url",
			"import-relational": "< import.meta.url",
			"import-is":         "import.meta.url",
			"new-strict":        "=== new.target",
			"new-class":         "new.target",
			"new-function":      "!== new.target",
			"new-not":           "not (=== new.target)",
		}[key]
		if mode&1 != 0 {
			pattern = "(" + pattern + ")"
		}
		if mode&2 != 0 {
			if key == "new-not" && mode&1 == 0 {
				pattern = "(" + pattern + ")" // not and and cannot share a level
			}
			pattern = pattern + " and let v"
		}
		test := "match (s) { when " + pattern + ": 1; default: 0; }"
		if key == "import-is" {
			test = "(s is " + pattern + ") ? 1 : 0"
		}
		var source string
		switch {
		case key == "new-function":
			source = "export function f(this: unknown, s: unknown) { return " + test + " }\n"
		case strings.HasPrefix(key, "new-"):
			source = "export class C { n: number; constructor(s: unknown) { this.n = " + strings.Replace(test, "match (s)", "match (key === \"new-class\" ? this : s)", 1) + " } }\n"
			source = "const key: string = \"" + key + "\"\n" + source
		default:
			source = "export function f(s: unknown) { return " + test + " }\n"
		}
		gapKey := fmt.Sprintf("meta:%s:%d", key, mode)
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "package.json": "{\"type\":\"module\"}"}, Config: "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"noEmit\":true,\"types\":[]},\"files\":[\"main.vibe\"]}"})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				Gap(t, metaPropertyPatternTarget, gapKey, "%s: unexpected %s\n%s", strings.TrimSpace(metaPropertyPatternQuote), specDiagnosticText(d), source)
				return
			}
		}
	})
}
