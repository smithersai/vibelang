package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const serviceShortcutQuote = "There is no `Users.find(id)` shorthand"

func TestServiceShorthandContextsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("005-services.md"), serviceShortcutQuote) {
		t.Fatalf("Chapter5 no longer says %q", serviceShortcutQuote)
	}
}

// VIP10 denies static member shortcuts. Check admission, rather than giving
// this retired syntax a new runtime meaning. Every rejection has the same
// get-the-service counterpart in the same catch/program context.
func FuzzServiceShorthandContexts(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"try-direct", "catch-head", "parenthesized-catch-head", "option-argument"} {
		for variant := byte(0); variant < 4; variant++ {
			f.Add(key, variant)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant byte) {
		TestServiceShorthandContextsQuoted(t)
		member := ".record"
		if variant&1 != 0 {
			member = "[\"record\"]"
		}
		tag := "Audit"
		alias := ""
		if variant&2 != 0 {
			tag = "Proxy"
			alias = "const Proxy = Audit;\n"
		}
		wrap := func(call string) string {
			switch key {
			case "try-direct":
				return "return try " + call + ";"
			case "catch-head":
				return "return " + call + " catch () => undefined;"
			case "parenthesized-catch-head":
				return "return (" + call + ") catch () => undefined;"
			case "option-argument":
				return "return try Effect.option(" + call + ");"
			}
			return ""
		}
		if wrap("x") == "" {
			return
		}
		prefix := "import * as Effect from \"effect/Effect\";\nservice Audit { record(input: {n:number}): void!! }\n" + alias
		good := prefix + "export effect function main() { const audit = try " + tag + "; " + wrap("audit"+member+"({n:1})") + " }\n"
		bad := prefix + "export effect function main() { " + wrap(tag+member+"({n:1})") + " }\n"
		compile := func(source string) []string {
			result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "package.json": servicesPackage}})
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			var errors []string
			for _, d := range result.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					errors = append(errors, fmt.Sprint(d))
				}
			}
			return errors
		}
		if errors := compile(good); len(errors) != 0 {
			t.Fatalf("get-service control must compile: %v\n%s", errors, good)
		}
		feature := fmt.Sprintf("reject:%s:%d", key, variant&3)
		if len(compile(bad)) == 0 {
			Gap(t, "FuzzServiceShorthandContexts", feature, "VIP10/chapter5: %s; a static shortcut compiled in %s:\n%s", serviceShortcutQuote, key, bad)
		}
		ExpectPending(t, "FuzzServiceShorthandContexts", feature)
		ExpectPending(t, "FuzzServiceShorthandContexts", specCorpusKey(t))
	})
}
