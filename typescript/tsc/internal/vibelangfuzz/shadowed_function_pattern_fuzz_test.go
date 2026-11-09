package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const shadowedFunctionTarget = "FuzzShadowedFunctionPatternAdmission"
const shadowedFunctionQuote = "A bare call-only pattern requires a return type assignable to `boolean`; an extractor requires `Iterable<unknown> | false`."

func TestShadowedFunctionPatternAdmissionQuoted(t *testing.T) {
	if !strings.Contains(SpecText("004-match.md"), shadowedFunctionQuote) {
		t.Fatal("class-pattern signature rule changed")
	}
}

type shadowedFunctionCase struct {
	key, typ, form string
	rejected       bool
}

var shadowedFunctionCases = []shadowedFunctionCase{
	{"number-arm", "(s: unknown) => number", "arm", true},
	{"void-is", "(s: unknown) => void", "is", true},
	{"object-extractor", "(s: unknown) => {}", "extract", true},
	{"boolean-arm", "(s: unknown) => boolean", "arm", false},
	{"false-is", "(s: unknown) => false", "is", false},
	{"iterable-extractor", "(s: unknown) => Iterable<unknown> | false", "extract", false},
	{"never-extractor", "(s: unknown) => never", "extract", false},
	{"any-is", "any", "is", true},
	{"unknown-arm", "unknown", "arm", true},
	{"object-arm", "{}", "arm", true},
	{"boolean-extractor", "(s: unknown) => boolean", "extract", true},
	{"iterable-arm", "(s: unknown) => Iterable<unknown> | false", "arm", true},
}

// The same resolved local signatures follow the chapter's admission rule
// regardless of a binding's spelling or lexical home. No runtime oracle is
// inferred from the compiler's output.
func FuzzShadowedFunctionPatternAdmission(f *testing.F) {
	startShortBudget(f)
	for _, c := range shadowedFunctionCases {
		f.Add(c.key, uint8(0), uint8(0))
		f.Add(c.key, uint8(1), uint8(1))
	}
	names := []string{"Function", "Matcher", "Array"}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, spelling, home uint8) {
		TestShadowedFunctionPatternAdmissionQuoted(t)
		if key == "" {
			return
		}
		c := shadowedFunctionCases[int(key[0])%len(shadowedFunctionCases)]
		for _, candidate := range shadowedFunctionCases {
			if candidate.key == key {
				c = candidate
			}
		}
		name := names[int(spelling)%len(names)]
		expr := "s is " + name
		if c.form == "arm" {
			expr = "match (s) { when " + name + ": 1; default: 0; }"
		}
		if c.form == "extract" {
			expr = "match (s) { when " + name + "(let x): x; default: 0; }"
		}
		source := ""
		switch home % 4 {
		case 0:
			source = "export function f(s: unknown, " + name + ": " + c.typ + ") { return " + expr + " }"
		case 1:
			source = "declare const " + name + ": " + c.typ + "; export function f(s: unknown) { return " + expr + " }"
		case 2:
			source = "export function f(s: unknown) { const " + name + "=null! as " + c.typ + "; return " + expr + " }"
		case 3:
			source = "export namespace N { declare const " + name + ": " + c.typ + "; export function f(s: unknown) { return " + expr + " } }"
		}
		files := map[string]string{"main.vibe": source}
		var r *Result
		var err error
		within(t, "compile", func() { r, err = w.Compile(t.Context(), Project{Files: files}) })
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		count := 0
		for _, d := range r.Diagnostics {
			if d.Source() == "EK" && d.Code() == 702 {
				count++
			}
			if d.Source() == "EK" && d.Code() == 107 {
				Gap(t, shadowedFunctionTarget, "local:"+c.key, "local binding %s received the global constructor ban: %s\n%s", name, d.MessageText(), Archive(files))
				return
			}
		}
		want := 0
		if c.rejected {
			want = 1
		}
		if count != want {
			Gap(t, shadowedFunctionTarget, fmt.Sprintf("%s/%s/home%d", c.key, name, home%4), "%s; want %d EK0702, got %d\n%s", shadowedFunctionQuote, want, count, Archive(files))
		}
	})
}
