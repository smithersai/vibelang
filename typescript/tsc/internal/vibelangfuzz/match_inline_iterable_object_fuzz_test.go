package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const inlineIterableTypesTarget = "FuzzInlineIterableObjectTypes"
const inlineIterableTypesQuote = "Inside an arm the subject narrows as the arm's test narrows in TypeScript"

func TestInlineIterableObjectTypesQuoted(t *testing.T) {
	arrayIterableTypesQuotes(t)
	if !strings.Contains(SpecText("004-match.md"), inlineIterableTypesQuote) {
		t.Fatalf("inline object typing rule changed: %q", inlineIterableTypesQuote)
	}
}

func FuzzInlineIterableObjectTypes(f *testing.F) {
	startShortBudget(f)
	arrayIterableTypesQuotes(f)
	type row struct{ key, subject, other string }
	var rows []row
	for _, shape := range []struct{ key, subject string }{
		{"array", "Part[]"}, {"readonly", "readonly Part[]"},
		{"iterable", "Iterable<Part>"}, {"generator", "Generator<Part,void,unknown>"},
	} {
		for _, other := range []struct{ key, value string }{
			{"number", "2"}, {"string", "string"}, {"nullable", "null | undefined"},
		} {
			rows = append(rows, row{shape.key + "/" + other.key, shape.subject, other.value})
			f.Add(shape.key+"/"+other.key, uint8(0))
		}
	}
	var keys []string
	for _, row := range rows {
		keys = append(keys, row.key)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		index := slices.Index(keys, key)
		if index < 0 {
			if key == "" {
				return
			}
			index = int(key[0]) % len(rows)
		}
		row := rows[index]
		variant %= 18
		header := "export {};type Part={value:number} | " + row.other + ";"
		native := header + "function read(s:" + row.subject + "){for(const item of s){if(typeof item===\"object\"&&item!==null&&\"value\" in item){const value:number=item.value;void value}}}"
		patterns := []string{
			"function read(s:" + row.subject + "){return s is [{value:0}]}",
			"function read(s:" + row.subject + "){return s is not [{value:0}]}",
			"function read(s:" + row.subject + "){return s is ([{value:0}] or [{value:1}])}",
			"function read(s:" + row.subject + "){return s is [{value:0}?]}",
			"function read(s:" + row.subject + "){return match(s){when ([{value:0}] or []):true;default:false;}}",
			"function read(s:" + row.subject + "){return match(s){when not [{value:0}]:true;default:false;}}",
			"function read(s:" + row.subject + "){return match(s){when [{let value}] or [{let value}]:do{const n:number=value;n};default:0;}}",
			"declare const s:" + row.subject + ";class Holder{ok=s is [{value:0}];static ok=s is [{value:0}]}",
			"function read(s:" + row.subject + "){return s is [{value?:0}]}",
		}
		compile := func(file, source string) []string {
			config := fmt.Sprintf("{\"compilerOptions\":{\"target\":\"ES2022\",\"lib\":[\"ES2023\"],\"module\":\"NodeNext\",\"strict\":true,\"noUncheckedIndexedAccess\":%t,\"skipLibCheck\":true,\"types\":[]},\"files\":[%q]}", variant >= 9, file)
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
		precise := fmt.Sprintf("%s:%d", row.key, variant)
		if errors := compile("main.ts", native); len(errors) != 0 {
			Gap(t, inlineIterableTypesTarget, "native:"+precise, "native object control fails: %v", errors)
			return
		}
		if errors := compile("main.vibe", header+patterns[variant%9]); len(errors) != 0 {
			Gap(t, inlineIterableTypesTarget, "custom:"+precise, "%s: %v\n%s", inlineIterableTypesQuote, errors, patterns[variant%9])
			return
		}
		ExpectPending(t, inlineIterableTypesTarget, "native:"+precise)
		ExpectPending(t, inlineIterableTypesTarget, "custom:"+precise)
		ExpectPending(t, inlineIterableTypesTarget, specCorpusKey(t))
	})
}
