package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Chapter 4's generated reads follow established extraction presence. Only
// the two access options preserve these types across settings; project typing
// options apply normally to the counterpart and are tested differentially.
const matchBindingElementQuote = "the element type of the subject's iterable (tuple element types for a tuple)"

const matchBindingObjectQuote = "`tracking`: the narrowed subject's property type"

// An is binds as a match arm does: chapter 4's `is` expressions.
const matchBindingIsQuote = "`subject is P` evaluates the subject once and returns the pattern's Boolean result, using the same cache and finishing rules as `match`."

// matchBindingForms are the forms a pattern binds in: a match arm, and an is
// in an if head, whose bindings and subject reads the parser hoists to the
// block (Smithers agent/fs Incur.vibe: a hoisted read of an array element
// took another name than its declaration, TS2552 on $match6).
var matchBindingForms = []string{"match", "is"}

// matchBindingOptions are the compiler options a program must not depend on.
var matchBindingAccessOptions = []string{
	"noUncheckedIndexedAccess",
	"noPropertyAccessFromIndexSignature",
}

var matchBindingPatterns = []struct {
	key, quote string
	decl       string // declarations, with T for the element type
	subject    string
	pattern    string
	binds      string // v's type, when it is not T
}{
	{key: "exit-success", quote: "| fixed `Exit.Failure(let c)`, `Result.Success(let v)` |", subject: "Exit.Exit<T, string>", pattern: "Exit.Success(let v)"},
	{key: "exit-failure", quote: "`c`: `Cause.Cause<E>`; `v`: `A`", subject: "Exit.Exit<string, T>", pattern: "Exit.Failure(let v)", binds: "Cause.Cause<T>"},
	{key: "result-success", quote: "`c`: `Cause.Cause<E>`; `v`: `A`", subject: "Result.Result<T, string>", pattern: "Result.Success(let v)"},
	{key: "result-failure", quote: "`c`: `Cause.Cause<E>`; `v`: `A`", subject: "Result.Result<string, T>", pattern: "Result.Failure(let v)"},
	{key: "option-some", quote: "`v`: `A` for `Option<A>`; `unknown` for an `unknown` subject", subject: "Option.Option<T>", pattern: "Option.Some(let v)"},
	{key: "array-first", quote: matchBindingElementQuote, subject: "T[]", pattern: "[let v]"},
	{key: "array-second", quote: matchBindingElementQuote, subject: "readonly T[]", pattern: "[let u, let v]"},
	{key: "array-rest", quote: matchBindingElementQuote, subject: "T[]", pattern: "[let v, ...]"},
	{key: "array-nested", quote: matchBindingElementQuote, subject: "T[][]", pattern: "[[let v]]"},
	{key: "array-literal-beside", quote: matchBindingElementQuote, subject: "(T | 1)[]", pattern: "[1, let v]", binds: "T | 1"},
	{key: "tuple-variadic", quote: matchBindingElementQuote, subject: "readonly [string, ...T[]]", pattern: "[let u, let v]"},
	{key: "object-index", quote: matchBindingObjectQuote, subject: "Record<string, T>", pattern: "{ a: let v }"},
	{key: "object-shorthand", quote: matchBindingObjectQuote, subject: "Record<string, T>", pattern: "{ let v }"},
	{key: "object-string-key", quote: matchBindingObjectQuote, subject: "Record<string, T>", pattern: "{ \"a\": let v }"},
	{key: "object-nested", quote: matchBindingObjectQuote, subject: "Record<string, Record<string, T>>", pattern: "{ a: { b: let v } }"},
	{key: "object-beside-test", quote: matchBindingObjectQuote, subject: "Record<string, T | 1>", pattern: "{ kind: 1, v: let v }", binds: "T | 1"},
	{key: "object-in-array", quote: matchBindingObjectQuote, subject: "Record<string, T>[]", pattern: "[{ let v }]"},
	{key: "array-in-object", quote: matchBindingElementQuote, subject: "{ xs: T[] }", pattern: "{ xs: [let v] }"},
	{key: "error-class", quote: "`e`: those subject members; otherwise the declared `NotFound`", decl: "error Missing { readonly n: T }", subject: "Missing | string", pattern: "Missing(let v)", binds: "Missing"},
	{key: "error-class-field", quote: "`e`: those subject members; otherwise the declared `NotFound`", decl: "error Missing { readonly v: T }", subject: "Missing | string", pattern: "Missing({ let v })"},
	{key: "array-extractor", quote: "elements of the subject array or typed array (`number` or `bigint`)", subject: "T[]", pattern: "Array(let v)"},
	{key: "array-extractor-rest", quote: "elements of the subject array or typed array (`number` or `bigint`)", subject: "T[]", pattern: "Array(let u, let v, ...)"},
	{key: "call-extractor-list", quote: "extractor `p(let x)`: an element of its declared return iterable, excluding `false`", decl: "function list(s: unknown): false | T[] { return false }", subject: "unknown", pattern: "list(let v)"},
	{key: "call-extractor-iterable", quote: "extractor `p(let x)`: an element of its declared return iterable, excluding `false`", decl: "function items(s: unknown): false | Iterable<T> { return false }", subject: "unknown", pattern: "items(let u, let v)"},
	{key: "class-matcher-list", quote: "elements of the declared extraction iterable, excluding `false`", decl: "class M { static [customMatcher](s: unknown): false | T[] { return false } }", subject: "unknown", pattern: "M(let v)"},
}

// The element types. A generic element cannot reach a declaration's own T.
var matchBindingTypes = []string{"number", "A", "string | null", "{ readonly n: number }", "readonly string[]", "number | undefined"}

func matchBindingProgram(i, j int, form string) string {
	p := matchBindingPatterns[i]
	element := matchBindingTypes[j]
	if p.decl != "" && element == "A" {
		element = "number"
	}
	fill := func(text string) string { return strings.ReplaceAll(text, "T", "("+element+")") }
	binds := p.binds
	if binds == "" {
		binds = "T"
	}
	binds = fill(binds)
	body := "  return match (s) { when " + p.pattern + ": v; default: fallback; }\n"
	if form == "is" {
		body = "  if (s is " + p.pattern + ") return v\n  return fallback\n"
	}
	return fill(p.decl) + "\nexport function f<A>(s: " + fill(p.subject) + ", fallback: " + binds + "): " + binds + " {\n" + body + "}\n"
}

func matchBindingConfig(option string) string {
	if option == "" {
		return ""
	}
	config := strings.Replace(DefaultConfig, `"strict": true,`, `"strict": true, "`+option+`": true,`, 1)
	return strings.TrimSuffix(config, "\n}") + ",\n  \"files\": [\"main.vibe\"]\n}"
}

func matchBindingsChapter(f testing.TB) string {
	chapter, err := os.ReadFile(SpecPath("004-match.md"))
	if err != nil {
		f.Fatal(err)
	}
	for _, p := range matchBindingPatterns {
		if !strings.Contains(string(chapter), p.quote) {
			f.Fatalf("%s: chapter 4 no longer says %q", p.key, p.quote)
		}
	}
	if !strings.Contains(string(chapter), matchBindingIsQuote) {
		f.Fatalf("chapter 4 no longer says %q", matchBindingIsQuote)
	}
	return string(chapter)
}

func TestMatchBindingTypesQuoted(t *testing.T) {
	text := matchBindingsChapter(t)
	if strings.Contains(text, "These types hold under every compiler option") || !strings.Contains(text, "Other options change a binding as they change its counterpart's value") {
		t.Fatal("pattern option rule changed")
	}
}

func FuzzMatchBindingTypes(f *testing.F) {
	startShortBudget(f)
	matchBindingsChapter(f)
	for i, p := range matchBindingPatterns {
		f.Add([]byte(p.key + "/" + matchBindingTypes[i%len(matchBindingTypes)]))
		f.Add([]byte("is:" + p.key + "/" + matchBindingTypes[(i+1)%len(matchBindingTypes)]))
	}
	w := NewWorkspace(f)
	errorsOf := func(t *testing.T, source, option string) []string {
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}, Config: matchBindingConfig(option)})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var found []string
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				found = append(found, fmt.Sprintf("%s%d: %s", d.Source(), d.Code(), d.String()))
			}
		}
		return found
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		i, j, form := 0, 0, "match"
		if len(data) > 0 {
			i = int(data[0]) % len(matchBindingPatterns)
		}
		if len(data) > 1 {
			j = int(data[1]) % len(matchBindingTypes)
		}
		if len(data) > 2 {
			form = matchBindingForms[int(data[2])%len(matchBindingForms)]
		}
		// A key without a form prefix is a match, as before forms were added.
		for _, candidate := range matchBindingForms {
			prefix := candidate + ":"
			if candidate == "match" {
				prefix = ""
			}
			for pi, p := range matchBindingPatterns {
				for ti, element := range matchBindingTypes {
					if string(data) == prefix+p.key+"/"+element {
						i, j, form = pi, ti, candidate
					}
				}
			}
		}
		p := matchBindingPatterns[i]
		source := matchBindingProgram(i, j, form)
		formKey := ""
		if form != "match" {
			formKey = form + ":"
		}
		key := formKey + p.key + "/" + matchBindingTypes[j]
		if found := errorsOf(t, source, ""); len(found) != 0 {
			Gap(t, "FuzzMatchBindingTypes", "control:"+formKey+p.key, "chapter 4: %s; the binding's type is rejected:\n%s\n%s", p.quote, source, strings.Join(found, "\n"))
			return
		}
		for _, option := range matchBindingAccessOptions {
			if found := errorsOf(t, source, option); len(found) != 0 {
				Gap(t, "FuzzMatchBindingTypes", option+":"+formKey+p.key, "chapter 4: %s; %s under %s:\n%s\n%s", p.quote, key, option, source, strings.Join(found, "\n"))
				return
			}
			ExpectPending(t, "FuzzMatchBindingTypes", option+":"+formKey+p.key)
		}
		ExpectPending(t, "FuzzMatchBindingTypes", "control:"+formKey+p.key)
		ExpectPending(t, "FuzzMatchBindingTypes", specCorpusKey(t))
	})
}

// The option still governs a read the source writes: only a pattern's own
// reads follow its length test.
func TestMatchBindingWrittenReadStaysUnchecked(t *testing.T) {
	matchBindingsChapter(t)
	w := NewWorkspace(t)
	r, err := w.Compile(t.Context(), Project{
		Files:  map[string]string{"main.vibe": "export function f(s: number[]): number {\n  return match (s) { when [let v]: s[0]; default: 0; }\n}\n"},
		Config: matchBindingConfig("noUncheckedIndexedAccess"),
	})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	for _, d := range r.Diagnostics {
		if d.Code() == 2322 {
			return
		}
	}
	t.Fatalf("s[0] in an arm lost the option's undefined: %v", r.Diagnostics)
}
