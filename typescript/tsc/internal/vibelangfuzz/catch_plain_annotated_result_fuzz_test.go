package vibelangfuzz

import (
	"strings"
	"testing"
)

const plainAnnotatedResultQuote = "| an arrow or `function` expression | plain function | what the function returns |"

func TestPlainCatchAnnotatedResultQuoted(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), plainAnnotatedResultQuote) {
		t.Fatal("plain handler result quote changed")
	}
}

type plainAnnotatedResult struct {
	key, annotation, value, check string
	effect                        bool
	want                          []string
}

var plainAnnotatedResults = []plainAnnotatedResult{
	{"effect", "E.Effect<number>", "E.succeed(7)", "E.Effect<number>", true, nil},
	{"alias", "Job", "E.succeed(7)", "Job", true, nil},
	{"bangs", "number!!", "E.succeed(7)", "E.Effect<number>", true, nil},
	{"sync", "E.Effect<number>", "E.sync(() => 7)", "E.Effect<number>", true, nil},
	{"union", "E.Effect<number> | E.Effect<number, string>", "E.succeed(7)", "E.Effect<number, string>", true, nil},
	{"number", "number", "7", "number", false, nil},
	{"string", "string", "\"s\"", "string", false, nil},
	{"mismatch", "E.Effect<string>", "E.succeed(7)", "unknown", false, []string{"TS2322"}},
}

var plainAnnotatedForms = []string{"function", "named", "arrow", "block"}

// plainAnnotatedHandler writes a plain handler of form returning value under
// annotation, optionally with a typed parameter and source parentheses.
func plainAnnotatedHandler(form, annotation, value string, typed, grouped bool) string {
	parameter := ""
	if typed {
		parameter = "e: string"
	}
	var handler string
	switch form {
	case "function":
		handler = "function (" + parameter + "): " + annotation + " { return " + value + " }"
	case "named":
		handler = "function recover(" + parameter + "): " + annotation + " { return " + value + " }"
	case "block":
		handler = "(" + parameter + "): " + annotation + " => { return " + value + " }"
	default:
		handler = "(" + parameter + "): " + annotation + " => " + value
	}
	if grouped {
		handler = "(" + handler + ")"
	}
	return handler
}

// plainAnnotatedCase reads a keyed input, form/result, falling back to the
// key's bytes for an input that names no case.
func plainAnnotatedCase(key string) (string, plainAnnotatedResult) {
	formKey, resultKey, _ := strings.Cut(key, "/")
	form, result := -1, -1
	for i, f := range plainAnnotatedForms {
		if f == formKey {
			form = i
		}
	}
	for i, r := range plainAnnotatedResults {
		if r.key == resultKey {
			result = i
		}
	}
	if form < 0 || result < 0 {
		sum := 0
		for _, b := range []byte(key) {
			sum += int(b)
		}
		form, result = sum%len(plainAnnotatedForms), (sum/len(plainAnnotatedForms))%len(plainAnnotatedResults)
	}
	return plainAnnotatedForms[form], plainAnnotatedResults[result]
}

// A plain handler's written return type is its own result, which catch gives
// unrun: the annotation must not be read as an effect function's contract.
func FuzzPlainCatchAnnotatedResult(f *testing.F) {
	startShortBudget(f)
	for _, form := range plainAnnotatedForms {
		for i, result := range plainAnnotatedResults {
			f.Add(form+"/"+result.key, uint8(i))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, flags uint8) {
		TestPlainCatchAnnotatedResultQuoted(t)
		form, result := plainAnnotatedCase(key)
		handler := plainAnnotatedHandler(form, result.annotation, result.value, flags&1 != 0, flags&2 != 0)
		use := "r"
		if result.effect {
			use = "try r"
		}
		source := "import { Effect as E } from \"effect\"; type Job = E.Effect<number>; export effect function main() { const r = E.fail(\"x\") catch " + handler + "; const check: " + result.check + " = r; void check; return " + use + " }"
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		got := r3Errors(r.Diagnostics)
		r.Remove()
		if strings.Join(got, " ") != strings.Join(result.want, " ") {
			Gap(t, "FuzzPlainCatchAnnotatedResult", form+"/"+result.key, "a plain handler's annotation types its own result; want errors %v, got %v: %s", result.want, got, source)
		}
	})
}

// The Effect TypeScript counterpart of a plain handler: Effect.catch(x,
// () => Effect.succeed(h())), with h's annotation describing h's result.
func TestPlainCatchAnnotatedResultNative(t *testing.T) {
	TestPlainCatchAnnotatedResultQuoted(t)
	w := NewWorkspace(t)
	source := "import { Effect as E } from \"effect\"; const h = function (): E.Effect<number> { return E.succeed(7) }; export const main = E.gen(function* () { const r = yield* E.catch(E.fail(\"x\"), () => E.succeed(h())); const check: E.Effect<number> = r; return yield* check })"
	r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.ts": source}})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	if got := r3Errors(r.Diagnostics); len(got) != 0 {
		t.Fatalf("native counterpart errors: %v", got)
	}
}
