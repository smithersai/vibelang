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

// compileReadDeclaration returns the declaration of read and the program's errors.
func compileReadDeclaration(t *testing.T, w *Workspace, file, source string) (string, []string) {
	t.Helper()
	config := "{\"compilerOptions\":{\"target\":\"ES2022\",\"lib\":[\"ES2023\",\"DOM\"],\"module\":\"NodeNext\",\"strict\":true,\"declaration\":true,\"skipLibCheck\":true,\"types\":[]},\"files\":[\"" + file + "\"]}"
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
	for name, output := range r.Outputs {
		if strings.HasSuffix(name, ".d.ts") {
			for line := range strings.SplitSeq(output, "\n") {
				if strings.HasPrefix(line, "export declare function read") {
					return line, errors
				}
			}
		}
	}
	return "", errors
}

var inlinePropertyChainNarrowing = []struct{ key, subject, pattern, native, read string }{
	{"or", "{ kind: string }", "{ kind: \"a\" or \"b\" }", "s.kind===\"a\"||s.kind===\"b\"", "s.kind"},
	{"nested-or", "{ inner: { kind: string } }", "{ inner: { kind: \"a\" or \"b\" } }", "s.inner.kind===\"a\"||s.inner.kind===\"b\"", "s.inner.kind"},
	{"literal-union", "{ kind: \"a\" | \"b\" | \"c\" }", "{ kind: \"a\" or \"b\" }", "s.kind===\"a\"||s.kind===\"b\"", "s.kind"},
	{"tagged", "{ _tag: \"a\", x: number } | { _tag: \"b\", y: string } | { _tag: \"c\" }", "{ _tag: \"a\" or \"b\" }", "s._tag===\"a\"||s._tag===\"b\"", "s"},
}

// An inline test of a property path reads the written reference, so its
// narrowing is the narrowing of the same || test in tsc.
func FuzzInlinePropertyChainNarrowing(f *testing.F) {
	startShortBudget(f)
	for _, entry := range inlinePropertyChainNarrowing {
		f.Add(entry.key)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		if key == "" {
			return
		}
		index := slices.IndexFunc(inlinePropertyChainNarrowing, func(entry struct{ key, subject, pattern, native, read string }) bool { return entry.key == key })
		if index < 0 {
			index = int(key[0]) % len(inlinePropertyChainNarrowing)
		}
		entry := inlinePropertyChainNarrowing[index]
		header := "declare const s:" + entry.subject + ";"
		native, errors := compileReadDeclaration(t, w, "main.ts", header+"export function read(){if("+entry.native+"){return ["+entry.read+"]}return undefined}")
		if len(errors) != 0 || native == "" {
			Gap(t, "FuzzInlinePropertyChainNarrowing", "native:"+entry.key, "the counterpart fails: %v", errors)
			return
		}
		custom, errors := compileReadDeclaration(t, w, "main.vibe", header+"export function read(){if(s is "+entry.pattern+"){return ["+entry.read+"]}return undefined}")
		if len(errors) != 0 || custom != native {
			Gap(t, "FuzzInlinePropertyChainNarrowing", "type:"+entry.key, "%s\nnative: %s\ncustom: %s\nerrors: %v", entry.pattern, native, custom, errors)
			return
		}
		ExpectPending(t, "FuzzInlinePropertyChainNarrowing", "native:"+entry.key)
		ExpectPending(t, "FuzzInlinePropertyChainNarrowing", "type:"+entry.key)
		ExpectPending(t, "FuzzInlinePropertyChainNarrowing", specCorpusKey(t))
	})
}
