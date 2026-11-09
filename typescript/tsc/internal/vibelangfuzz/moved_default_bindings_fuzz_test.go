package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const movedBindingsTarget = "FuzzMovedDefaultBindings"
const movedBindingsQuote = "ordinary TypeScript syntax keeps its own diagnostics."

func TestMovedDefaultBindingsQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", movedBindingsQuote)
}

var movedBindingHomes = []string{"function", "expression", "arrow", "object-method", "class-method", "async", "effect", "producer"}
var movedBindingKinds = []struct{ key, body string }{
	{"let", "let a = 2;"},
	{"const", "const a = 2;"},
	{"class", "class a {}"},
	{"enum", "enum a { value }"},
	{"function", "function a() {}"},
	{"object-binding", "let { a } = { a: 2 };"},
	{"array-binding", "let [a] = [2];"},
	{"type-only", "type a = number;"},
}

func FuzzMovedDefaultBindings(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "001-functions.md", movedBindingsQuote)
	w := NewWorkspace(f)
	for _, home := range movedBindingHomes {
		for i, kind := range movedBindingKinds {
			for _, scope := range []string{"direct", "nested"} {
				f.Add(home+":"+kind.key+":"+scope, uint8(i))
			}
		}
	}
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		parts := strings.Split(key, ":")
		home := movedBindingHomes[int(variant)%len(movedBindingHomes)]
		kind := movedBindingKinds[int(variant)%len(movedBindingKinds)]
		nested := variant&1 != 0
		if len(parts) == 3 {
			if slices.Contains(movedBindingHomes, parts[0]) {
				home = parts[0]
			}
			for _, candidate := range movedBindingKinds {
				if candidate.key == parts[1] {
					kind = candidate
					break
				}
			}
			nested = parts[2] == "nested"
		}
		scope := "direct"
		body := kind.body
		if nested {
			scope = "nested"
			body = "{ " + body + " }"
		}
		key = home + ":" + kind.key + ":" + scope
		program := func(value string, vibe bool) string {
			params := "a: number = " + value
			switch home {
			case "expression":
				return "export const f = function(" + params + ") { " + body + " }"
			case "arrow":
				return "export const f = (" + params + ") => { " + body + " }"
			case "object-method":
				return "export const box = { method(" + params + ") { " + body + " } }"
			case "class-method":
				return "export class Box { method(" + params + ") { " + body + " } }"
			case "async":
				return "export async function f(" + params + ") { " + body + " }"
			case "effect":
				if vibe {
					return "export effect function f(" + params + ") { " + body + " }"
				}
			case "producer":
				if vibe {
					return "export effect function* f(" + params + ") { " + body + " }"
				}
				return "export function* f(" + params + ") { " + body + " }"
			}
			return "export function f(" + params + ") { " + body + " }"
		}
		check := func(file, source string) []string {
			r, err := w.CompileOrdered(t.Context(), Project{Files: map[string]string{file: source}, Config: fmt.Sprintf(errorTwinConfig, file)}, OrderTsc, true)
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			var errors []string
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					errors = append(errors, fmt.Sprintf("%s %s", diagnosticCodeName(d.Source(), d.Code()), d.MessageText()))
				}
			}
			slices.Sort(errors)
			return errors
		}
		want := check("main.ts", program("1", false))
		got := check("main.vibe", program("do { if (false) return; 1 }", true))
		if !slices.Equal(got, want) {
			Gap(t, movedBindingsTarget, key, "%s\nnative diagnostics %v; moved-default diagnostics %v", movedBindingsQuote, want, got)
		}
	})
}
