package vibelangfuzz

import (
	"fmt"
	"regexp"
	"strings"
	"testing"
)

const effectLambdaSelfValueQuote = "An inferred type takes its success from what the function returns"
const effectLambdaSelfRecursiveQuote = "A recursive function whose type can't be inferred gets TypeScript's own TS7022, TS7023 or TS7024"

func effectLambdaSelfValueQuoted(t testing.TB) {
	text := SpecText("001-functions.md")
	for _, quote := range []string{effectLambdaSelfValueQuote, effectLambdaSelfRecursiveQuote} {
		if !strings.Contains(text, quote) {
			t.Fatalf("chapter 001 lost %q", quote)
		}
	}
}

func TestEffectLambdaSelfValueQuoted(t *testing.T) { effectLambdaSelfValueQuoted(t) }

var effectLambdaSelfValues = []struct{ key, body string }{
	{"equality", "f === f"},
	{"inequality", "f !== f"},
	{"typeof", "typeof f"},
	{"conditional", "f === f ? 1 : 2"},
	{"array-value", "[f][0] === f"},
	{"object-value", "({ value: f }).value === f"},
}

func FuzzEffectLambdaSelfValue(f *testing.F) {
	startShortBudget(f)
	effectLambdaSelfValueQuoted(f)
	for _, row := range effectLambdaSelfValues {
		for _, kind := range []string{"arrow", "named", "named-own", "annotated"} {
			f.Add([]byte(row.key + "/" + kind))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		const target = "FuzzEffectLambdaSelfValue"
		defer recoverCompilerPanic(t, target)
		index := 0
		if len(data) != 0 {
			index = int(data[0]) % (len(effectLambdaSelfValues) * 4)
		}
		for i, row := range effectLambdaSelfValues {
			for j, kind := range []string{"arrow", "named", "named-own", "annotated"} {
				if string(data) == row.key+"/"+kind {
					index = i*4 + j
				}
			}
		}
		row, kind := effectLambdaSelfValues[index/4], index%4
		body := row.body
		if kind == 2 {
			body = regexp.MustCompile(`\bf\b`).ReplaceAllString(body, "own")
		}
		native := "export const f = () => Effect.gen(function* () { return " + body + " })"
		vibe := "export const f = effect () => " + body
		if kind == 1 || kind == 2 {
			native = "export const f = function own() { return Effect.gen(function* () { return " + body + " }) }"
			vibe = "export const f = effect function own() { return " + body + " }"
		}
		if kind == 3 {
			native = "export const f = (): Effect.Effect<unknown> => Effect.gen(function* () { return " + body + " })"
			vibe = "export const f = effect (): unknown!! => " + body
		}
		for _, in := range []struct{ file, text string }{{"main.ts", native}, {"main.vibe", vibe}} {
			source := "import { Effect } from \"effect\"; " + in.text
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{in.file: source}})
			if err != nil {
				t.Fatal(err)
			}
			codes := r4Errors(r.Diagnostics)
			r.Remove()
			if len(codes) != 0 {
				if in.file == "main.ts" {
					t.Fatalf("invalid native control: %v\n%s", codes, source)
				}
				Gap(t, target, "inference:"+row.key+"/"+[]string{"arrow", "named", "named-own", "annotated"}[kind], "%s: value-only self reference must infer as its Effect.gen twin: %v\n%s", effectLambdaSelfValueQuote, codes, source)
			}
		}
	})
}

func TestEffectLambdaRecursiveReturnStillRejected(t *testing.T) {
	effectLambdaSelfValueQuoted(t)
	w := NewWorkspace(t)
	for _, body := range []string{"return try f()", "return true ? try f() : 0"} {
		source := fmt.Sprintf("export const f = effect () => { %s }", body)
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		codes := r4Errors(r.Diagnostics)
		r.Remove()
		found := false
		for _, code := range codes {
			found = found || code == "TS7022" || code == "TS7023" || code == "TS7024"
		}
		if !found {
			t.Fatalf("%s: expected native recursive-inference diagnostic, got %v", source, codes)
		}
	}
}
