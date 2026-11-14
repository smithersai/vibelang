package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestCatchOutsideDiagnosticsQuoted(t *testing.T) {
	for _, rule := range []struct{ chapter, quote string }{
		{"002-running.md", "| `catch` outside effect code | `EK0504` |"},
		{"007-tooling.md", "Native lexical, syntax and static errors keep their `TS` codes, as in TypeScript, including independent errors in embedded expressions and types."},
	} {
		if !strings.Contains(SpecText(rule.chapter), rule.quote) {
			t.Fatalf("%s no longer says %q", rule.chapter, rule.quote)
		}
	}
}

// Rejecting the catch's placement must retain the TypeScript diagnostics of
// its authored operands. Compare those diagnostics, including their source
// spans, with the same operands checked separately in an ordinary TS function.
func FuzzCatchOutsideDiagnostics(f *testing.F) {
	startShortBudget(f)
	kinds := []string{"body-assignment", "body-argument", "left-argument", "left-property", "left-body", "return-annotation", "valid"}
	contexts := []string{"plain", "async", "nested"}
	handlers := []string{"arrow", "function", "effect"}
	for i, kind := range kinds {
		for j, home := range contexts {
			f.Add(kind + "|" + home + "|" + handlers[(i+j)%len(handlers)])
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestCatchOutsideDiagnosticsQuoted(t)
		parts := strings.Split(key, "|")
		pick := func(options []string, at int) string {
			if at < len(parts) {
				for _, option := range options {
					if parts[at] == option {
						return option
					}
				}
				if len(parts[at]) > 0 {
					return options[int(parts[at][0])%len(options)]
				}
			}
			return options[0]
		}
		kind, home, form := pick(kinds, 0), pick(contexts, 1), pick(handlers, 2)
		left, body := "load(1)", "return 0"
		wantNative := 1
		switch kind {
		case "body-assignment":
			body = "const n: number = \"bad\"; return n"
		case "body-argument":
			body = "return needsNumber(\"bad\")"
		case "left-argument":
			left = "load(\"bad\")"
		case "left-property":
			left = "loadObject({ value: \"bad\" })"
		case "left-body":
			left = "load((() => { const n: number = \"bad\"; return n })())"
		case "valid":
			wantNative = 0
		}
		if kind == "return-annotation" && form == "effect" {
			form = "arrow"
		}
		handler, twinHandler := "(e: string) => { "+body+" }", "(e: string) => { "+body+" }"
		switch form {
		case "function":
			handler, twinHandler = "function (e: string) { "+body+" }", "function (e: string) { "+body+" }"
		case "effect":
			handler = "effect " + handler
		}
		if kind == "return-annotation" {
			if form == "function" {
				handler = "function (e: string): string { return 0 }"
			} else {
				handler = "(e: string): string => 0"
			}
			twinHandler = handler
		}
		prefix := "import { Effect } from \"effect\";\ndeclare function load(n: number): Effect.Effect<number, string>;\ndeclare function loadObject(n: { value: number }): Effect.Effect<number, string>;\nfunction needsNumber(n: number) { return n }\n"
		statement := "return " + left + " catch " + handler
		source := prefix + "export function main() { " + statement + " }"
		switch home {
		case "async":
			source = prefix + "export async function main() { " + statement + " }"
		case "nested":
			source = prefix + "export effect function main() { const callback = () => { " + statement + " }; return 0 }"
		}
		twin := prefix + "export function main() { " + left + "; const handler = " + twinHandler + "; return 0 }"
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "twin.ts": twin}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		var actual, reference []string
		placement := 0
		for _, d := range result.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if inFile(d, "main.vibe") && IsEK(d) && d.Code() == 504 {
				placement++
				continue
			}
			text := source
			if inFile(d, "twin.ts") {
				text = twin
			}
			diagnostic := fmt.Sprintf("%s%d:%s", d.Source(), d.Code(), text[d.Pos():d.End()])
			if inFile(d, "twin.ts") {
				reference = append(reference, diagnostic)
			} else {
				actual = append(actual, diagnostic)
			}
		}
		slices.Sort(actual)
		slices.Sort(reference)
		precise := kind + "|" + home + "|" + form
		if placement != 1 || len(reference) != wantNative || !slices.Equal(actual, reference) {
			Gap(t, "FuzzCatchOutsideDiagnostics", precise, "chapters 2 and 7 require one EK0504 and the independent TS diagnostics: EK0504=%d actual=%v twin=%v\n%s", placement, actual, reference, source)
		}
	})
}
