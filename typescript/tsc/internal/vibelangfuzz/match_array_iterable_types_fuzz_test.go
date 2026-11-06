package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const arrayRestTypesQuote = "A `let` binding has the type TypeScript gives the value it is bound to in the counterpart."

const arrayIterableTypesTarget = "FuzzArrayPatternIterableTypes"
const arrayIterableTypesQuote = "| array \x60[let a, let b]\x60 | members that are iterable | the element type of the subject's iterable (tuple element types for a tuple) |"

func arrayIterableTypesQuotes(tb testing.TB) {
	tb.Helper()
	if !strings.Contains(SpecText("004-match.md"), arrayIterableTypesQuote) || !strings.Contains(SpecText("004-match.md"), arrayRestTypesQuote) {
		tb.Fatalf("array pattern typing rule changed: %q", arrayIterableTypesQuote)
	}
}

func TestArrayPatternIterableTypesQuoted(t *testing.T) { arrayIterableTypesQuotes(t) }

// Broad object types use an Iterable<unknown> guard before the native control.
// Known noniterable members are excluded under the quoted array-pattern rule.
var arrayIterableTypeRows = []struct {
	key, subject, element string
	native                bool
}{
	{"array", "number[]", "number", true},
	{"readonly-array", "readonly string[]", "string", true},
	{"iterable", "Iterable<number>", "number", true},
	{"string", "string", "string", true},
	{"set", "Set<boolean>", "boolean", true},
	{"map", "Map<string, number>", "[string, number]", true},
	{"generator", "Generator<number, string, void>", "number", true},
	{"typed-array", "Uint8Array", "number", true},
	{"union", "Set<string> | number[]", "string | number", true},
	{"nested-union", "Iterable<string> | Iterable<number>", "string | number", true},
	{"any", "any", "any", true},
	{"unknown", "unknown", "unknown", false},
	{"empty-object", "{}", "unknown", false},
	{"object", "object", "unknown", false},
	{"tagged-object", "{readonly label: string}", "unknown", false},
	{"callable", "(() => void)", "unknown", false},
	{"index-record", "Record<string, number>", "unknown", false},
	{"open-union", "Set<number> | {readonly label: string}", "number", false},
	{"partly-iterable", "number | string[]", "string", false},
}

func FuzzArrayPatternIterableTypes(f *testing.F) {
	startShortBudget(f)
	arrayIterableTypesQuotes(f)
	var keys []string
	for _, row := range arrayIterableTypeRows {
		keys = append(keys, row.key)
		// Keyed corpus files also cover shape and option combinations.
		f.Add(row.key, uint8(0))
	}
	for _, variant := range []uint8{3, 7, 8, 9, 10, 11, 12, 13, 14, 15} {
		f.Add("any", variant)
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
		row := arrayIterableTypeRows[index]
		variant %= 16
		header := fmt.Sprintf("type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;"+
			"function same<A,B>(_:Equal<A,B>):void{};declare const s: %s;", row.subject)
		check := fmt.Sprintf("same<typeof value,%s>(true);", row.element)
		restType := "(" + row.element + ")[]"
		// A rest over any keeps native TypeScript's any type. Rest bindings
		// over known iterables remain arrays of their inferred element type.
		if row.key == "any" {
			restType = "any"
		}
		restCheck := "same<typeof value," + restType + ">(true);"
		shape := variant%4 + variant/8*4
		nativeBody := "for(const value of s){" + check + "}"
		restPatterns := map[uint8]string{
			3: "[, ...value]", 4: "[...value]", 5: "[, , ...value]",
			6: "[first, ...value]", 7: "[, ...value]",
		}
		if pattern, rest := restPatterns[shape]; rest {
			// The native control must extract a rest, not merely iterate one
			// element: that does not establish the type of a rest binding.
			nativeBody = "{const " + pattern + "=s;" + restCheck + "}"
		}
		native := header + nativeBody
		if !row.native {
			native = header + "declare function isIterable(value:unknown):value is Iterable<unknown>;" +
				"if(isIterable(s)){" + nativeBody + "}"
		}
		custom := []string{
			"match (s) {when [let value,...]: do {" + check + "undefined};default: undefined;}",
			"if (s is [let value,...]) {" + check + "}",
			"match ({box:s}) {when {box:[let value,...]}: do {" + check + "undefined};default: undefined;}",
			"match (s) {when [, ...let value]: do {" + restCheck + "undefined};default: undefined;}",
			"match (s) {when [...let value]: do {" + restCheck + "undefined};default: undefined;}",
			"match (s) {when [, , ...let value]: do {" + restCheck + "undefined};default: undefined;}",
			"match (s) {when [let first, ...let value]: do {" + restCheck + "undefined};default: undefined;}",
			"if (s is [, ...let value]) {" + restCheck + "}",
		}[shape]
		custom = header + custom
		compile := func(file, source string) []string {
			config := fmt.Sprintf("{\"compilerOptions\":{\"target\":\"ES2022\",\"lib\":[\"ES2022\"],\"module\":\"NodeNext\",\"strict\":true,\"noUncheckedIndexedAccess\":%t,\"skipLibCheck\":true,\"types\":[]},\"files\":[\""+file+"\"]}", variant&4 != 0)
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{file: "export {};" + source, "package.json": servicesPackage}, Config: config})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			var errors []string
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					errors = append(errors, fmt.Sprintf("%s%d: %s", d.Source(), d.Code(), d.String()))
				}
			}
			return errors
		}
		precise := fmt.Sprintf("%s:%d", row.key, variant)
		if row.key != "partly-iterable" {
			if errors := compile("main.ts", native); len(errors) != 0 {
				Gap(t, arrayIterableTypesTarget, "native:"+row.key, "the native binding control fails: %v\n%s", errors, native)
				return
			}
		}
		if errors := compile("main.vibe", custom); len(errors) != 0 {
			Gap(t, arrayIterableTypesTarget, "custom:"+precise, "%s: %v\n%s", arrayIterableTypesQuote, errors, custom)
			return
		}
		ExpectPending(t, arrayIterableTypesTarget, "native:"+row.key)
		ExpectPending(t, arrayIterableTypesTarget, "custom:"+precise)
		ExpectPending(t, arrayIterableTypesTarget, specCorpusKey(t))
	})
}
