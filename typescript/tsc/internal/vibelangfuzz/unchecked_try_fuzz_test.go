package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const uncheckedTryDeclarationsTarget = "FuzzUncheckedTryDeclarations"
const uncheckedTryDeclarationsQuote = "Declarations are exactly what idiomatic Effect TypeScript would declare."
const uncheckedTryDelegationQuote = "`try e` is `yield* e`. It runs `e` and gives its success value."

func TestUncheckedTryDeclarationsQuoted(t *testing.T) {
	for chapter, quote := range map[string]string{"001-functions.md": uncheckedTryDeclarationsQuote, "002-running.md": uncheckedTryDelegationQuote} {
		if !strings.Contains(SpecText(chapter), quote) {
			t.Fatalf("%s no longer says %q", chapter, quote)
		}
	}
}

// This is a static declaration oracle, not a runtime differential. VIP-27
// requires the public success type of try to match the native yield* twin.
func FuzzUncheckedTryDeclarations(f *testing.F) {
	startShortBudget(f)
	forms := []string{"identifier", "parentheses", "property", "element", "conditional", "call", "effect-any", "effect-number", "call-parentheses", "call-property", "call-element", "call-conditional"}
	for _, form := range forms {
		f.Add(form, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, form string, depth uint8) {
		TestUncheckedTryDeclarationsQuoted(t)
		found := false
		for _, key := range forms {
			if form == key {
				found = true
			}
		}
		if !found {
			if form == "" {
				return
			}
			form = forms[int(form[0])%len(forms)]
		}
		operand, parameter := "value", "value: any"
		switch form {
		case "parentheses":
			operand = "(value)"
		case "property":
			operand = "value.program"
		case "element":
			operand = "value[0]"
		case "conditional":
			operand = "(flag ? value : value)"
			parameter += ", flag: boolean"
		case "call":
			operand = "value()"
		case "call-parentheses":
			operand = "(value())"
		case "call-property":
			operand = "value.read()"
		case "call-element":
			operand = "value[\"read\"]()"
		case "call-conditional":
			operand = "(flag ? value : value)()"
			parameter += ", flag: boolean"
		case "effect-any":
			parameter = "value: Effect.Effect<any>"
		case "effect-number":
			parameter = "value: Effect.Effect<number>"
		}
		prefix := "import { Effect } from 'effect';\n"
		vibeBody, tsBody := "return try "+operand, "return yield* "+operand
		if depth%2 != 0 {
			vibeBody = "const result = try " + operand + "; return [result] as const"
			tsBody = "const result = yield* " + operand + "; return [result] as const"
		}
		sources := []string{prefix + "export effect function run(" + parameter + ") { " + vibeBody + " }", prefix + "export function run(" + parameter + ") { return Effect.gen(function* () { " + tsBody + " }) }"}
		results := []*Result{}
		for i, source := range sources {
			name := "main.vibe"
			if i == 1 {
				name = "main.ts"
			}
			var result *Result
			var err error
			config := fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"singleThreaded":true,"declaration":true,"outDir":"out"},"files":[%q]}`, name)
			within(t, "compile", func() {
				result, err = w.Compile(t.Context(), Project{Files: map[string]string{name: source}, Config: config})
			})
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			if HasError(result.Diagnostics) {
				t.Fatalf("invalid declaration witness: %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
			}
			results = append(results, result)
		}
		// Compare the complete public declaration text, including any/unknown and
		// both failure/environment channels; no normalization can erase the bug.
		declaration := func(r *Result) string {
			for name, text := range r.Outputs {
				if strings.HasSuffix(name, "/main.d.ts") {
					return text
				}
			}
			t.Fatal("missing declaration")
			return ""
		}
		got, want := declaration(results[0]), declaration(results[1])
		key := fmt.Sprintf("%s:%d", form, depth%2)
		if got != want {
			Gap(t, uncheckedTryDeclarationsTarget, key, "VIP-27: %q; VIP-5: %q\ngot %s\nwant %s", uncheckedTryDeclarationsQuote, uncheckedTryDelegationQuote, got, want)
		}
		ExpectPending(t, uncheckedTryDeclarationsTarget, key)
		ExpectPending(t, uncheckedTryDeclarationsTarget, specCorpusKey(t))
	})
}
