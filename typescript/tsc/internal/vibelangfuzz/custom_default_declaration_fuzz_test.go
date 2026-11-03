package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

var customDefaultQuotes = []string{
	"`export default schema S { … }` or `export default schema S = T`; declare the name and write `export { S as default }`",
	"`export default data D { … }`; declare the name and write `export { D as default }`",
	"A `schema error` keeps the error-declaration diagnostic `EK1305`; it does not use `EK1501`.",
}

func TestCustomDefaultDeclarationQuoted(t *testing.T) {
	customDefaultQuoted(t)
}

func customDefaultQuoted(t testing.TB) {
	t.Helper()
	for _, quote := range customDefaultQuotes {
		if !strings.Contains(SpecText("006-data.md"), quote) {
			t.Fatalf("chapter 006 no longer says %q", quote)
		}
	}
}

type customDefaultRule struct {
	key, declaration string
	code             int32
}

func customDefaultRules() []customDefaultRule {
	return []customDefaultRule{
		{"schema-body", "schema Name {name:string}", 1501},
		{"schema-alias", "schema Name = string | number", 1501},
		{"schema-named-error", "schema error {name:string}", 1501},
		{"schema-contextual-name", "schema as = string", 1501},
		{"schema-error", "schema error Name {name:string}", 1305},
		{"data-body", "data Name {One; Two {name:string}}", 1603},
		{"data-generic", "data Name<T> {One {value:T}}", 1603},
		{"data-contextual-name", "data async {One}", 1603},
	}
}

// Only static admission is tested here. Each keyed input mutates trivia at
// export/default and declaration boundaries without changing the chapter's rule.
func FuzzCustomDefaultDeclaration(f *testing.F) {
	startShortBudget(f)
	customDefaultQuoted(f)
	rules := customDefaultRules()
	for _, r := range rules {
		f.Add([]byte("key:"+r.key), uint8(0))
	}
	f.Fuzz(func(t *testing.T, data []byte, mutation uint8) {
		if len(data) == 0 {
			return
		}
		index := int(data[0]) % len(rules)
		for i, r := range rules {
			if string(data) == "key:"+r.key {
				index = i
				break
			}
		}
		r := rules[index]
		gaps := []string{" ", " /* gap */ ", "\n ", "\r\n", " // gap\n"}
		gap := gaps[int(mutation)%len(gaps)]
		source := "export" + gap + "default" + gap + r.declaration + "; export const kept = 1"
		file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
		ds := file.Diagnostics()
		if len(ds) != 1 || ds[0].Source() != "EK" || ds[0].Code() != r.code || !ast.IsExternalModule(file) {
			Gap(t, "FuzzCustomDefaultDeclaration", r.key, "chapter 006 requires only EK%04d and a module boundary; got %v", r.code, ds)
		}
		// Contextual identifiers remain native expressions in both file kinds.
		for _, word := range []string{"schema", "data"} {
			for _, tail := range []string{"", " as number", " satisfies number", ".value", "(1)", "\nconst next = 2"} {
				for _, name := range []string{"/main.vibe", "/main.ts"} {
					control, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute(name), PathKey: tspath.PathKey(name)}, "export default "+word+tail)
					if len(control.Diagnostics()) != 0 {
						t.Fatalf("native expression %s%s rejected: %v", word, tail, control.Diagnostics())
					}
				}
			}
		}
	})
}
