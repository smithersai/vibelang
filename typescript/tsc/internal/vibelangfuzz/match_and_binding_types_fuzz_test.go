package vibelangfuzz

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const andBindingTypesTarget = "FuzzAndBindingTypes"
const andBindingTypesQuote = "A `let` binding has the type TypeScript gives the value it is bound to in the counterpart."
const andBindingConjunctQuote = "| `P and Q` | both narrowings in order | both sides' bindings |"

func andBindingTypesQuotes(t testing.TB) {
	t.Helper()
	for _, quote := range []string{andBindingTypesQuote, andBindingConjunctQuote} {
		if !strings.Contains(SpecText("004-match.md"), quote) {
			t.Fatalf("match typing rule changed: %q", quote)
		}
	}
}

func TestAndBindingTypesQuoted(t *testing.T) { andBindingTypesQuotes(t) }

var andBindingTypeRows = []struct{ key, subject, pattern, predicate, source string }{
	{"string", "string", `"spec"`, `s === "spec"`, ""},
	{"string-union", "string", `("spec" or "tasks")`, `(s === "spec" || s === "tasks")`, ""},
	{"intersection", "string", `(("spec" or "tasks") and "tasks")`, `(s === "spec" || s === "tasks") && s === "tasks"`, ""},
	{"number", "number", `(1 or 2)`, `(s === 1 || s === 2)`, ""},
	{"boolean", "boolean", `true`, `s === true`, ""},
	{"null", "string | null", `null`, `s === null`, ""},
	{"object", `{_tag:"Square";side:number}|{_tag:"Circle";radius:number}`, `{_tag:"Square"}`, `s._tag === "Square"`, ""},
	{"object-or", `{_tag:"Square";side:number}|{_tag:"Rect";side:number}|{_tag:"Circle";radius:number}`, `{_tag:("Square" or "Rect")}`, `(s._tag === "Square" || s._tag === "Rect")`, ""},
	{"unchanged", "string", `if(true)`, `true`, ""},
	{"fresh-number", "number", `if(true)`, `true`, "2"},
	{"fresh-string", "string", `if(true)`, `true`, `"spec"`},
}

var andBindingComments = regexp.MustCompile(`(?s)/\*.*?\*/`)

// Compare declarations that expose the binding as a function parameter. Unlike
// returning the value directly, this retains its exact type in the public API.
// Both printers use the quoted counterpart rule, including extraction before
// the literal tests for array and object-field neighbourhoods.
func FuzzAndBindingTypes(f *testing.F) {
	startShortBudget(f)
	andBindingTypesQuotes(f)
	var keys []string
	for _, row := range andBindingTypeRows {
		keys = append(keys, row.key)
		for _, v := range []uint8{0, 1, 2, 3, 4, 5} {
			f.Add(row.key, v)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		index := slices.Index(keys, key)
		if index < 0 {
			if key == "" {
				return
			}
			index = int(key[0]) % len(keys)
		}
		row := andBindingTypeRows[index]
		variant %= 6
		pattern := row.pattern + " and let value"
		if variant&1 != 0 {
			pattern = "let value and " + row.pattern
		}
		subject, nativeValue, predicate := row.subject, "input", row.predicate
		source := row.source
		if source == "" {
			source = "s"
		}
		before := ""
		predicateRef := "input"
		switch variant / 2 {
		case 1:
			subject = "(" + subject + ")[]"
			pattern = "[" + pattern + "]"
			before = "if(input.length !== 1) return undefined; const item=input[0];"
			if row.source != "" {
				source = "[" + source + "]"
			}
			predicateRef = "item"
			nativeValue = "item"
		case 2:
			subject = "{field:" + subject + "}"
			pattern = "{field:" + pattern + "}"
			before = "const item=input.field;"
			if row.source != "" {
				source = "{field:" + source + "}"
			}
			predicateRef = "item"
			nativeValue = "item"
		}
		// Replace identifier tokens, preserving literal contents such as "spec".
		predicate = regexp.MustCompile(`\bs\b`).ReplaceAllString(row.predicate, predicateRef)
		vibe := fmt.Sprintf("export function capture(s:%s){return match(%s){when %s: (arg:typeof value)=>arg;default:undefined;}}", subject, source, pattern)
		keyword := "const"
		if row.source != "" {
			keyword = "let"
		}
		native := fmt.Sprintf("export function capture(s:%s){const input=%s;%s if(%s){%s value=%s;return (arg:typeof value)=>arg;}return undefined;}", subject, source, before, predicate, keyword, nativeValue)
		compile := func(file, source string) string {
			result, err := w.Compile(t.Context(), Project{Files: map[string]string{file: source, "package.json": servicesPackage}, Config: DefaultConfig})
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			for _, d := range result.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					Gap(t, andBindingTypesTarget, fmt.Sprintf("%s:%d:%s", row.key, variant, file), "%s: %s\n%s", andBindingTypesQuote, d.String(), source)
					return ""
				}
			}
			declaration := result.Outputs["out/main.d.ts"]
			if declaration == "" {
				t.Fatalf("missing declaration: %v", result.Outputs)
			}
			return andBindingComments.ReplaceAllString(declaration, "")
		}
		twin := compile("main.ts", native)
		binding := compile("main.vibe", vibe)
		if twin == "" || binding == "" {
			return
		}
		identity := `import {capture as native} from "./native.js"; import {capture as binding} from "./binding.js";
type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
const exact:Equal<typeof native,typeof binding>=true; export {exact};`
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{
			"native.d.ts": twin, "binding.d.ts": binding, "main.ts": identity, "package.json": servicesPackage,
		}, Config: DefaultConfig})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				Gap(t, andBindingTypesTarget, fmt.Sprintf("%s:%d", row.key, variant), "binding type differs from its TypeScript twin: %s\nnative: %s\nbinding: %s\n%s", d.String(), twin, binding, vibe)
			}
		}
	})
}
