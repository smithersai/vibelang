package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const arrayIterableTypesTarget = "FuzzArrayPatternIterableTypes"
const arrayIterableTypesQuote = "| array \x60[let a, let b]\x60 | members that are iterable | the element type of the subject's iterable (tuple element types for a tuple) |"

func arrayIterableTypesQuotes(tb testing.TB) {
	tb.Helper()
	if !strings.Contains(SpecText("004-match.md"), arrayIterableTypesQuote) {
		tb.Fatalf("array pattern typing rule changed: %q", arrayIterableTypesQuote)
	}
}

func TestArrayPatternIterableTypesQuoted(t *testing.T) { arrayIterableTypesQuotes(t) }

// Broad object types use an Iterable<unknown> guard before the for-of control.
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
		// Keyed corpus files cover every shape and option combination.
		f.Add(row.key, uint8(0))
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
		variant %= 8
		header := fmt.Sprintf("type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;"+
			"function same<A,B>(_:Equal<A,B>):void{};declare const s: %s;", row.subject)
		check := fmt.Sprintf("same<typeof value,%s>(true);", row.element)
		native := header + "for(const value of s){" + check + "}"
		if !row.native {
			native = header + "declare function isIterable(value:unknown):value is Iterable<unknown>;" +
				"if(isIterable(s)){for(const value of s){" + check + "}}"
		}
		custom := []string{
			"match (s) {when [let value,...]: do {" + check + "undefined};default: undefined;}",
			"if (s is [let value,...]) {" + check + "}",
			"match ({box:s}) {when {box:[let value,...]}: do {" + check + "undefined};default: undefined;}",
			"match (s) {when [, ...let value]: do {same<typeof value,(" + row.element + ")[]>(true);undefined};default: undefined;}",
		}[variant%4]
		custom = header + custom
		compile := func(file, source string) []string {
			config := fmt.Sprintf("{\"compilerOptions\":{\"target\":\"ES2022\",\"lib\":[\"ES2022\"],\"module\":\"NodeNext\",\"strict\":true,\"noUncheckedIndexedAccess\":%t,\"skipLibCheck\":true,\"types\":[]},\"files\":[\""+file+"\"]}", variant >= 4)
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
				Gap(t, arrayIterableTypesTarget, "native:"+row.key, "the for-of control fails: %v\n%s", errors, native)
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
