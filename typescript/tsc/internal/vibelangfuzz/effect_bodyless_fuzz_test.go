package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const effectBodylessTarget = "FuzzEffectBodylessAdmission"
const effectBodylessQuote = "a recognized `effect` modifier on an `abstract` declaration, in an ambient `declare` context, or on an `interface` or type literal member"
const effectOverloadQuote = "A signature without a return annotation exposes `any`, as a bodyless `async` signature does"

func TestEffectBodylessQuoted(t *testing.T) {
	for _, quote := range []string{effectBodylessQuote, effectOverloadQuote} {
		if !strings.Contains(SpecText("001-functions.md"), quote) {
			t.Fatalf("chapter 1 no longer says %q", quote)
		}
	}
	if !strings.Contains(SpecText("005-services.md"), serviceEffectBodylessQuote) {
		t.Fatalf("chapter 5 no longer says %q", serviceEffectBodylessQuote)
	}
}

const serviceEffectBodylessQuote = "A bodyless `effect find(id: string): User!NotFound` or `async find(): Promise<User>` is `EK0902`"

func FuzzEffectBodylessAdmission(f *testing.F) {
	startShortBudget(f)
	forms := []string{"interface-index", "literal-index", "interface-after-readonly", "literal-after-readonly", "ambient-function", "ambient-method", "ambient-namespace", "abstract", "interface-method", "literal-method", "interface-property", "literal-property", "overload", "identifier", "service", "shape-service", "service-identifier"}
	for _, form := range forms {
		f.Add(form, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, form string, mutation uint8) {
		TestEffectBodylessQuoted(t)
		index := -1
		for i, key := range forms {
			if form == key {
				index = i
			}
		}
		if index < 0 {
			if form == "" {
				return
			}
			index = int(form[0]) % len(forms)
			form = forms[index]
		}
		member := "read(): number!!"
		if mutation%3 == 1 {
			member = "read?<T>(x: T): number!!"
		}
		if mutation%3 == 2 {
			member = "[Symbol.iterator](): number!!"
		}
		source := ""
		want := 1
		code := int32(108)
		switch form {
		case "ambient-function":
			source = "declare effect function read(): number!!;"
		case "ambient-method":
			source = "declare class C { effect " + member + " }"
		case "ambient-namespace":
			source = "declare namespace A { namespace B { effect function read(): number!!; } }"
		case "abstract":
			source = "abstract class C { abstract effect " + member + " }"
		case "interface-method":
			source = "interface C { effect " + member + " }"
		case "literal-method":
			source = "type C = { effect " + member + " }"
		case "interface-property":
			source = "interface C { effect value?: number }"
		case "literal-property":
			source = "type C = { effect value: number }"
		case "interface-index":
			source = "interface C { effect [key: string]: number }"
		case "literal-index":
			source = "type C = { effect [key: string]: number }"
		case "interface-after-readonly":
			source = "interface C { readonly effect value: number }"
		case "literal-after-readonly":
			source = "type C = { readonly effect value: number }"
		case "overload":
			source = "effect function read(): number!!; effect function read() { return 1 }"
			want = 0
		case "service":
			source = "export service C { static readonly key = \"fuzz/service\"; effect " + member + " }"
			code = 902
		case "shape-service":
			source = "export service C: {} { static readonly key = \"fuzz/service-shape\"; effect " + member + " }"
			code = 902
		case "service-identifier":
			source = "export service C { static readonly key = \"fuzz/service-identifier\"; effect(): number!! }"
			want = 0
		case "identifier":
			source = "interface C { effect(): number }; type D = { effect: number }"
			want = 0
		}
		source += "\nexport {}"
		var result *Result
		var err error
		within(t, "compile", func() { result, err = w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}}) })
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		key := fmt.Sprintf("%s:%d", form, mutation%3)
		count := 0
		for _, d := range result.Diagnostics {
			if IsEK(d) && d.Code() == code {
				count++
			} else if d.Category().Name() == "error" {
				Gap(t, effectBodylessTarget, key, "unexpected diagnostic %s%d: %s; Functions: %q; Services: %q\n%s", d.Source(), d.Code(), d.MessageText(), effectBodylessQuote, serviceEffectBodylessQuote, source)
			}
		}
		if count != want {
			Gap(t, effectBodylessTarget, key, "Functions: %q; Services: %q; want %d EK%04d, got %d\n%s", effectBodylessQuote, serviceEffectBodylessQuote, want, code, count, source)
		}
		ExpectPending(t, effectBodylessTarget, key)
	})
}
