package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const patternPrivateKeyTarget = "FuzzPatternPrivateNameKey"

// The pinned MatchProperty is a PropertyName. ECMA-262's PropertyName is a
// LiteralPropertyName or a ComputedPropertyName and has no PrivateIdentifier,
// so `#a` as a key is invalid pattern grammar. The native twin agrees:
// TypeScript rejects `#a` as the same PropertyName of an object literal.
const (
	patternPrivateKeyProduction = "PropertyName[?Yield, ?Await] `?`? `:` MatchPattern[?Yield, ?Await]"
	patternPrivateKeyDiagnostic = "Invalid `match`/`is` grammar and pattern-specific early errors use `EK0707` when no more specific diagnostic is assigned."
	patternPrivateFieldSlot     = "Field = \"readonly\"? PropertyName \"?\"? \":\" Type Separator"
	patternPrivateObjectSlot    = "EffectObjectMethod = EffectModifier [no LineTerminator here] PropertyName TypeParameters? Params ReturnType? Block"
	patternPrivateClassSlot     = "ProducerMethod = DecoratorList? Modifiers? EffectModifier [no LineTerminator here] \"*\" ClassElementName"
)

func TestPatternPrivateNameKeyQuoted(t *testing.T) {
	if !strings.Contains(SpecText("../vips/tc39-pattern-matching/spec.emu"), patternPrivateKeyProduction) {
		t.Fatalf("pinned matcher production changed: %s", patternPrivateKeyProduction)
	}
	if !strings.Contains(SpecText("004-match.md"), patternPrivateKeyDiagnostic) {
		t.Fatalf("Chapter 004 no longer says %q", patternPrivateKeyDiagnostic)
	}
	appendix := SpecText("900-appendices.md")
	for _, quote := range []string{patternPrivateFieldSlot, patternPrivateObjectSlot, patternPrivateClassSlot} {
		if !strings.Contains(appendix, quote) {
			t.Fatalf("Appendix A no longer says %q", quote)
		}
	}
}

type patternPrivateKeyForm struct {
	key, pattern string
	// errors is how many private keys the pattern writes.
	errors int
	// binds names the variable the pattern binds, for carriers that read it.
	binds string
}

var patternPrivateKeyForms = []patternPrivateKeyForm{
	{key: "bare", pattern: "{ #a }", errors: 1},
	{key: "optional", pattern: "{ #a? }", errors: 1},
	{key: "value", pattern: "{ #a: 1 }", errors: 1},
	{key: "optional-value", pattern: "{ #a?: 1 }", errors: 1},
	{key: "binding", pattern: "{ #a: let y }", errors: 1, binds: "y"},
	{key: "optional-binding", pattern: "{ #a?: let y }", errors: 1, binds: "y"},
	{key: "after-key", pattern: "{ b: 1, #a: 2 }", errors: 1},
	{key: "before-key", pattern: "{ #a: 2, b: 1 }", errors: 1},
	{key: "before-rest", pattern: "{ #a: 1, ...let r }", errors: 1, binds: "r"},
	{key: "two-keys", pattern: "{ #a: 1, #b: 2 }", errors: 2},
	{key: "same-name-as-key", pattern: "{ a: 1, #a: 2 }", errors: 1},
	{key: "nested-object", pattern: "{ b: { #a: 1 } }", errors: 1},
	{key: "nested-array", pattern: "[{ #a: 1 }]", errors: 1},
	{key: "or", pattern: "{ #a: 1 } or { b: 2 }", errors: 1},
	{key: "and", pattern: "{ #a: 1 } and { b: 2 }", errors: 1},
	{key: "not", pattern: "not { #a: 1 }", errors: 1},
	{key: "guarded", pattern: "{ #a: 1 } and if (true)", errors: 1},
	{key: "extractor", pattern: "Box({ #a: 1 })", errors: 1},
}

type patternPrivateKeyCarrier struct {
	key, template string
	// usesBinding carriers exist only for forms that bind a name.
	usesBinding bool
	// homed is false where a binding has no lexical home (EK4703 territory).
	homed bool
}

const patternPrivateKeyBox = "declare const Box: { [Symbol.customMatcher](v: any): any };\n"

var patternPrivateKeyCarriers = []patternPrivateKeyCarrier{
	{key: "match-expression", template: "export function f(x: any) { return match (x) { when %[1]s: 1; default: 0; }; }", homed: true},
	{key: "match-effect", template: "export effect function f(x: any) { return match (x) { when %[1]s: 1; default: 0; }; }", homed: true},
	{key: "match-uses-binding", template: "export function f(x: any) { return match (x) { when %[1]s: %[2]s; default: 0; }; }", homed: true, usesBinding: true},
	{key: "match-class-with-name", template: "export class C { #a = 1; #b = 2; m(x: any) { return [this.#a, this.#b, match (x) { when %[1]s: 1; default: 0; }]; } }", homed: true},
	{key: "is-if", template: "export function f(x: any) { if (x is %[1]s) { return 1; } return 0; }", homed: true},
	{key: "is-if-uses-binding", template: "export function f(x: any) { if (x is %[1]s) { return %[2]s; } return 0; }", homed: true, usesBinding: true},
	{key: "is-return", template: "export function f(x: any) { return x is %[1]s; }"},
	{key: "is-class-with-name", template: "export class C { #a = 1; #b = 2; m(x: any) { if (x is %[1]s) { return this.#a + this.#b; } return 0; } }", homed: true},
}

// The other slots a private name can reach. Every PropertyName slot rejects
// it, without saying which code, and a ClassElementName admits it. The
// object literal is the native twin of the pattern key.
type patternPrivateSlot struct {
	key, source string
	reject      bool
}

var patternPrivateSlots = []patternPrivateSlot{
	{"schema-field", "schema S { #a: string }", true},
	{"schema-optional", "schema S { #a?: string }", true},
	{"schema-readonly", "schema S { readonly #a: string }", true},
	{"schema-alias-type", "schema S = { #a: string }", true},
	{"schema-error-field", "schema error E { #a: string }", true},
	{"error-field", "error E { #a: string }", true},
	{"data-field", "data D { A { #a: string } }", true},
	{"service-field", "service S { #a: string }", true},
	{"service-method", "service S { #a(): string }", true},
	{"object-effect", "const o = { effect #a() { return 1; } }; export { o };", true},
	{"object-producer", "const o = { effect *#a() { yield 1; } }; export { o };", true},
	{"pattern-computed", "export function f(x: any) { return match (x) { when { [#a]: 1 }: 1; default: 0; }; }", true},
	{"pattern-binding-name", "export function f(x: any) { return match (x) { when { let #a }: 1; default: 0; }; }", true},
	{"pattern-rest", "export function f(x: any) { return match (x) { when { ...#a }: 1; default: 0; }; }", true},
	{"native-object-twin", "export class C { #a = 1; m() { return [this.#a, { #a: 1 }]; } }", true},
	{"class-effect", "export class C { effect #a() { return 1; } }", false},
	{"class-producer", "export class C { effect *#a() { yield 1; } }", false},
}

func patternPrivateKeyCases() []string {
	var keys []string
	for _, slot := range patternPrivateSlots {
		keys = append(keys, "slot/"+slot.key)
	}
	for _, carrier := range patternPrivateKeyCarriers {
		for _, form := range patternPrivateKeyForms {
			if patternPrivateKeyApplies(carrier, form) {
				keys = append(keys, carrier.key+"/"+form.key)
			}
		}
	}
	return keys
}

func patternPrivateKeyApplies(carrier patternPrivateKeyCarrier, form patternPrivateKeyForm) bool {
	if carrier.usesBinding {
		return form.binds != ""
	}
	return carrier.homed || form.binds == ""
}

func FuzzPatternPrivateNameKey(f *testing.F) {
	startShortBudget(f)
	for _, key := range patternPrivateKeyCases() {
		f.Add(key)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, input string) {
		TestPatternPrivateNameKeyQuoted(t)
		cases := patternPrivateKeyCases()
		if input == "" {
			return
		}
		key := input
		if !slices.Contains(cases, key) {
			// A key that names no case falls back to the byte index.
			key = cases[int(input[0])%len(cases)]
		}
		carrierKey, formKey, _ := strings.Cut(key, "/")
		if carrierKey == "slot" {
			patternPrivateSlotCheck(t, w, key, patternPrivateSlots[slices.IndexFunc(patternPrivateSlots, func(c patternPrivateSlot) bool { return c.key == formKey })])
			return
		}
		carrier := patternPrivateKeyCarriers[slices.IndexFunc(patternPrivateKeyCarriers, func(c patternPrivateKeyCarrier) bool { return c.key == carrierKey })]
		form := patternPrivateKeyForms[slices.IndexFunc(patternPrivateKeyForms, func(c patternPrivateKeyForm) bool { return c.key == formKey })]
		source := fmt.Sprintf(carrier.template, form.pattern, form.binds)
		if strings.Contains(form.pattern, "Box") {
			source = patternPrivateKeyBox + source
		}
		defer func() {
			if r := recover(); r != nil {
				Gap(t, patternPrivateKeyTarget, "crash:"+key, "compiler panic: %v\n%s", r, source)
			}
		}()
		codes := patternPrivateErrors(t, w, source)
		want := slices.Repeat([]int32{707}, form.errors)
		if !slices.Equal(codes, want) {
			Gap(t, patternPrivateKeyTarget, "admission:"+key, "%s; a private name is not a PropertyName; want %v, got %v\n%s", patternPrivateKeyDiagnostic, want, codes, source)
		}
		ExpectPending(t, patternPrivateKeyTarget, specCorpusKey(t))
	})
}

func patternPrivateErrors(t *testing.T, w *Workspace, source string) []int32 {
	t.Helper()
	var result *Compilation
	var err error
	within(t, "compile", func() {
		result, err = w.CompileOrdered(t.Context(), Project{Files: map[string]string{"main.vibe": source}}, OrderTsc, true)
	})
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	var codes []int32
	for _, diagnostic := range result.Diagnostics {
		if diagnostic.Category() == diagnostics.CategoryError {
			codes = append(codes, diagnostic.Code())
		}
	}
	return codes
}

func patternPrivateSlotCheck(t *testing.T, w *Workspace, key string, slot patternPrivateSlot) {
	source := slot.source + "\n"
	defer func() {
		if r := recover(); r != nil {
			Gap(t, patternPrivateKeyTarget, "crash:"+key, "compiler panic: %v\n%s", r, source)
		}
	}()
	codes := patternPrivateErrors(t, w, source)
	if slot.reject && len(codes) == 0 {
		Gap(t, patternPrivateKeyTarget, "admission:"+key, "a private name is not a PropertyName (%s); want a rejection\n%s", patternPrivateFieldSlot, source)
	}
	if !slot.reject && len(codes) != 0 {
		Gap(t, patternPrivateKeyTarget, "admission:"+key, "a ClassElementName admits a private name (%s); got %v\n%s", patternPrivateClassSlot, codes, source)
	}
	ExpectPending(t, patternPrivateKeyTarget, specCorpusKey(t))
}
