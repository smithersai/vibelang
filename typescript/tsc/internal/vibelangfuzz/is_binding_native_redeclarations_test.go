package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

const isBindingNativeTarget = "FuzzIsBindingNativeRedeclarations"
const isBindingNativeQuote = "Two top-level patterns that bind one name in the same lexical home are a redeclaration, as two `let` declarations are, and report what such a `let` reports: `TS2451` beside another lexical declaration, `TS2300` beside a parameter"

func TestIsBindingNativeRedeclarationsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("004-match.md"), isBindingNativeQuote) {
		t.Fatalf("VIP-7 redeclaration rule changed: %q", isBindingNativeQuote)
	}
}

var isBindingNativeKeys = []string{"patterns", "mixed-patterns", "local-first", "local-last", "local-const", "parameter", "separate-blocks", "nested-shadow", "nested-any-shadow"}

// The native twin is an independent oracle for diagnostic identity AND count:
// both declaration sites must report, including a parameter's TS2300. Vary
// binding keyword, object/bare patterns, name and function/arrow/method/block
// homes. Unlike repeated names within one pattern, each generated binding is
// a separate top-level pattern (VIP-7, decided detail 245).
func FuzzIsBindingNativeRedeclarations(f *testing.F) {
	startShortBudget(f)
	for _, key := range isBindingNativeKeys {
		for variation := range uint8(4) {
			f.Add(key, variation*21)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variation uint8) {
		TestIsBindingNativeRedeclarationsQuoted(t)
		if !slices.Contains(isBindingNativeKeys, key) {
			if key == "" {
				return
			}
			key = isBindingNativeKeys[int(key[0])%len(isBindingNativeKeys)]
		}
		name := []string{"id", "cell", "value2"}[int(variation>>4)%3]
		keyword := []string{"let", "const"}[variation&1]
		object := variation&2 != 0
		bind := func(subject string) string {
			if object {
				return subject + " is { id: " + keyword + " " + name + " }"
			}
			return subject + " is " + keyword + " " + name
		}
		native := func(subject string) string {
			if object {
				subject += ".id"
			}
			return "let " + name + " = " + subject + ";"
		}
		pattern := func(subject string) string { return "if (" + bind(subject) + ") {}" }
		var body, twin string
		local := "let " + name + ": number = 0;"
		switch key {
		case "patterns", "mixed-patterns":
			body, twin = pattern("a")+pattern("b"), native("a")+native("b")
		case "local-first":
			body, twin = local+pattern("a"), local+native("a")
		case "local-const":
			local = "const " + name + " = 0;"
			body, twin = local+pattern("a"), local+native("a")
		case "local-last":
			body, twin = pattern("a")+local, native("a")+local
		case "parameter":
			body, twin = pattern("a"), native("a")
		case "separate-blocks":
			body, twin = "{"+pattern("a")+"}{"+pattern("b")+"}", "{"+native("a")+"}{"+native("b")+"}"
		case "nested-any-shadow":
			body, twin = "{"+pattern("b")+"}"+pattern("a"), "{"+native("b")+"}"+native("a")
		case "nested-shadow":
			body, twin = pattern("a")+"{"+pattern("b")+"}", native("a")+"{"+native("b")+"}"
		}
		typ := "number"
		if object {
			typ = "{ id: number }"
		}
		bType := typ
		if key == "mixed-patterns" {
			bType = "string"
			if object {
				bType = "{ id: string }"
			}
		}
		if key == "nested-any-shadow" {
			bType = "any"
		}
		params := "a: " + typ + ", b: " + bType
		if key == "parameter" {
			params += ", " + name + ": string"
		}
		wrap := func(body string) string {
			switch variation >> 2 & 3 {
			case 0:
				return "export function probe(" + params + ") { " + body + " }"
			case 1:
				return "export const probe = (" + params + ") => { " + body + " };"
			case 2:
				return "export class Holder { probe(" + params + ") { " + body + " } }"
			default:
				return "export function probe(" + params + ") { { " + body + " } }"
			}
		}
		reference, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.ts": wrap(twin)}})
		if err != nil {
			t.Fatal(err)
		}
		defer reference.Remove()
		result, err := w.Compile(t.Context(), Single(wrap(body)))
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		codes := func(r *Result) []int32 {
			var out []int32
			for _, d := range r.Diagnostics {
				if d.Category().Name() == "error" {
					out = append(out, d.Code())
				}
			}
			slices.Sort(out)
			return out
		}
		want, got := codes(reference), codes(result)
		if !slices.Equal(want, got) {
			Gap(t, isBindingNativeTarget, fmt.Sprintf("%s:%d", key, variation),
				"VIP-7/detail245 native declaration diagnostics %v, is diagnostics %v\n%s", want, got, wrap(body))
		}
	})
}
