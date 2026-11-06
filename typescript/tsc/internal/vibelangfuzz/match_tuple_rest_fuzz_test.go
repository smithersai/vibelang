package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

const tupleRestTarget = "FuzzMatchTupleRest"
const tupleRestQuote = "| array \x60[let a, let b]\x60 | members that are iterable | the element type of the subject's iterable (tuple element types for a tuple) |"
const tupleRestTypingQuote = "Patterns type as the TypeScript counterpart this chapter shows for them, under the project's compiler options"

func tupleRestQuotes(tb testing.TB) {
	tb.Helper()
	for _, quote := range []string{tupleRestQuote, tupleRestTypingQuote} {
		if !strings.Contains(SpecText("004-match.md"), quote) {
			tb.Fatalf("tuple binding rule changed: %q", quote)
		}
	}
}
func TestMatchTupleRestQuoted(t *testing.T) { tupleRestQuotes(t) }

var tupleRestRows = []struct {
	key, subject string
	max          uint8
}{
	{"empty", "[]", 0},
	{"fixed", "[number,string,boolean]", 3},
	{"readonly", "readonly [number,string,boolean]", 3},
	{"optional", "[number?,string?]", 2},
	{"optional-tail", "[number,string?]", 2},
	{"prefix-rest", "[number,...string[]]", 3},
	{"multi-prefix", "readonly [number,boolean,...string[]]", 3},
	{"rest-tail", "[...number[],string]", 3},
	{"both-fixed", "[boolean,...number[],string]", 3},
	{"array", "number[]", 3},
	{"tuple-union", "[number,string]|[boolean,number]", 2},
	{"any", "any", 3},
	{"actual-undefined", "[number|undefined,string]", 2},
	{"named", "readonly [start:number,end?:string]", 2},
	{"array-union", "number[]|string[]", 3},
	{"tuple-array", "[number,string]|boolean[]", 2},
	{"tuple-set", "readonly [number,string]|Set<boolean>", 2},
	{"array-set", "number[]|Set<string>", 3},
}

func FuzzMatchTupleRest(f *testing.F) {
	startShortBudget(f)
	tupleRestQuotes(f)
	var keys []string
	for _, row := range tupleRestRows {
		keys = append(keys, row.key)
		f.Add(row.key, uint8(0), uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, index, variant uint8) {
		rowIndex := slices.Index(keys, key)
		if rowIndex < 0 {
			if key == "" {
				return
			}
			rowIndex = int(key[0]) % len(keys)
		}
		row := tupleRestRows[rowIndex]
		index %= row.max + 1
		variant %= 3
		prefix := strings.Repeat(",", int(index))
		header := "export {};type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;" +
			"function same<A,B>(_:Equal<A,B>):void{};" +
			fmt.Sprintf("function native(s:%s){const [%s...value]=s;return value};declare const s:%s;", row.subject, prefix, row.subject)
		check := "same<typeof value,ReturnType<typeof native>>(true);"
		native := header + "const value=native(s);" + check
		custom := header + []string{
			"match(s){when [" + prefix + "...let value]:do{" + check + "undefined};default:undefined;}",
			"if(s is [" + prefix + "...let value]){" + check + "}",
			"match({box:s}){when {box:[" + prefix + "...let value]}:do{" + check + "undefined};default:undefined;}",
		}[variant]
		compile := func(file, source string) []string {
			config := "{\"compilerOptions\":{\"target\":\"ES2022\",\"lib\":[\"ES2022\"],\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"types\":[]},\"files\":[\"" + file + "\"]}"
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{file: source, "package.json": servicesPackage}, Config: config})
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
		precise := fmt.Sprintf("%s:%d:%d", row.key, index, variant)
		if errors := compile("main.ts", native); len(errors) != 0 {
			Gap(t, tupleRestTarget, "native:"+precise, "native destructuring control fails: %v", errors)
			return
		}
		if errors := compile("main.vibe", custom); len(errors) != 0 {
			Gap(t, tupleRestTarget, "custom:"+precise, "%s: %v\n%s", tupleRestQuote, errors, custom)
			return
		}
		ExpectPending(t, tupleRestTarget, "native:"+precise)
		ExpectPending(t, tupleRestTarget, "custom:"+precise)
		ExpectPending(t, tupleRestTarget, specCorpusKey(t))
	})
}
