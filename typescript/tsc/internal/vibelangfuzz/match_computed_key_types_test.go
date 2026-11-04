package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestComputedPatternKeyTypesQuoted(t *testing.T) {
	for _, quote := range []string{
		"For each property retain key evaluation, presence check, cached value read, sub-pattern and binding initialization in order; copy rest afterward.",
		"A `let` binding has the type TypeScript gives the value it is bound to in the counterpart.",
	} {
		if !strings.Contains(SpecText("004-match.md"), quote) {
			t.Fatalf("004-match.md no longer says %q", quote)
		}
	}
}

// Capturing the runtime key must preserve literal and unique-symbol indexing,
// binding types, and generated-name hygiene in statement and inline homes.
// Runtime observations belong to vip07.computed-key-once-plain.
func TestComputedPatternKeyTypes(t *testing.T) {
	w := NewWorkspace(t)
	keys := []struct{ name, setup, key string }{
		{"member", "const keys = { get name(): \"value\" { return \"value\" } };", "keys.name"},
		{"element", "const keys = { name: \"value\" as const };", "keys[\"name\"]"},
		{"identifier", "const key = \"value\" as const;", "key"},
		{"symbol", "const token = Symbol(); const keys: { name: typeof token } = { name: token };", "keys.name"},
		{"symbol-identifier", "const token = Symbol(); const key: typeof token = token;", "key"},
		{"symbol-element", "const token = Symbol(); const keys: { name: typeof token } = { name: token };", "keys[\"name\"]"},
		{"numeric", "const keys = { name: 1 as const };", "keys.name"},
	}
	homes := []string{"return", "arrow", "field", "if-is", "expression-is", "inline", "match-or", "match-not"}
	for _, key := range keys {
		for _, home := range homes {
			t.Run(key.name+"/"+home, func(t *testing.T) {
				property := "\"value\""
				if strings.HasPrefix(key.name, "symbol") {
					property = "[token]"
				}
				if key.name == "numeric" {
					property = "1"
				}
				head := key.setup + " const s = {" + property + ": 7 as const, other: 8 as const};" +
					" const $matchKey2 = 11, $matchKey3 = 12;"
				pattern := "{ [" + key.key + "]: let value }"
				match := "match(s){when " + pattern + ": value; default: 7 as const;}"
				var source string
				switch home {
				case "return":
					source = "function probe(): 7 { return " + match + " }"
				case "arrow":
					source = "const probe = (): 7 => " + match + ";"
				case "field":
					source = "class Probe { value: 7 = " + match + " }"
				case "if-is":
					source = "function probe(): 7 { if(s is " + pattern + ") { const exact: 7 = value; return exact; } return 7; }"
				case "expression-is":
					source = "const ok: boolean = s is { [" + key.key + "]: 7 };"
				case "match-or":
					source = "const ok: boolean = match(s) { when { [" + key.key + "]: 7 } or { [" + key.key + "]: 7 }: true; default: false; };"
				case "match-not":
					source = "const ok: boolean = match(s) { when not { [" + key.key + "]: 7 }: true; default: false; };"
				case "inline":
					source = "const ok: boolean = s is ({ [" + key.key + "]: 7 } or { [" + key.key + "]: 7 });"
				}
				source = head + source + " const hygiene: 23 = ($matchKey2 + $matchKey3) as 23; export {}"
				r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
				if err != nil {
					t.Fatal(err)
				}
				defer r.Remove()
				for _, d := range r.Diagnostics {
					if d.Category() == diagnostics.CategoryError {
						t.Fatalf("unexpected diagnostic %d: %v", d.Code(), d)
					}
				}
			})
		}
	}
	for _, typ := range []string{"literal", "symbol"} {
		for _, home := range []string{"method", "field", "inline", "match-or-field"} {
			t.Run("this-"+typ+"/"+home, func(t *testing.T) {
				head := "const token = Symbol(); class Probe {"
				if typ == "literal" {
					head += "readonly key = \"value\" as const; readonly subject = {value: 7 as const};"
				} else {
					head += "readonly key: typeof token = token; readonly subject = {[token]: 7 as const};"
				}
				expr := "match(this.subject){when {[this.key]: let value}: value; default: 7 as const;}"
				switch home {
				case "method":
					head += "read():7 {return " + expr + "}"
				case "field":
					head += "value:7 = " + expr + ";"
				case "match-or-field":
					head += "value:boolean = match(this.subject) { when {[this.key]:7} or {[this.key]:7}: true; default: false; };"
				case "inline":
					head += "read():boolean {return this.subject is ({[this.key]:7} or {[this.key]:7});}"
				}
				r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": head + "} export {}"}})
				if err != nil {
					t.Fatal(err)
				}
				defer r.Remove()
				for _, d := range r.Diagnostics {
					if d.Category() == diagnostics.CategoryError {
						t.Fatalf("unexpected diagnostic %d: %v", d.Code(), d)
					}
				}
			})
		}
	}

}

// The runtime conversion must not add TS2352 at a generated assertion. Invalid
// source keys keep precisely the native in-operator diagnostics.
func TestComputedPatternKeyNativeDiagnostics(t *testing.T) {
	w := NewWorkspace(t)
	for _, typ := range []string{"boolean", "bigint", "object", "() => string", "null", "undefined", "unknown", "string | object", "string", "number", "symbol", "any"} {
		t.Run(typ, func(t *testing.T) {
			var codes [][]int32
			for _, native := range []bool{true, false} {
				expr, file := "key in subject", "main.ts"
				if !native {
					expr, file = "subject is {[key]:if(true)}", "main.vibe"
				}
				source := "export function probe(subject: object, key: " + typ + ") { return " + expr + "; }"
				r, err := w.Compile(t.Context(), Project{Files: map[string]string{file: source}})
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
				slices.Sort(got)
				codes = append(codes, got)
			}
			if !slices.Equal(codes[0], codes[1]) {
				t.Fatalf("native %v, pattern %v", codes[0], codes[1])
			}
		})
	}
}
