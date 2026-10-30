package vibelangfuzz

import (
	"bytes"
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

const serviceDefaultExportQuote = "| `export default service S { }` | `EK0905` | `export default` takes a function, class or expression, as in ECMAScript; write `export { S as default }` |"

//gate:spec-tests
func TestServiceDefaultExportQuoted(t *testing.T) {
	if !strings.Contains(SpecText("005-services.md"), serviceDefaultExportQuote) {
		t.Fatal("service default-export oracle's quoted rule changed")
	}
}

// FuzzServiceDefaultExport tests the rejection's neighbourhood without treating
// contextual identifiers as declarations. A named declaration and an explicit
// default-export alias are the spec's valid controls. Each source retains a
// following export, so recovery cannot swallow the rest of the module.
func FuzzServiceDefaultExport(f *testing.F) {
	startShortBudget(f)
	for mode := byte(0); mode < 4; mode++ {
		for flags := byte(0); flags < 4; flags++ {
			f.Add(append([]byte("export-default|"), mode, flags, flags, flags))
		}
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		if !strings.Contains(SpecText("005-services.md"), serviceDefaultExportQuote) {
			t.Fatal("quoted service default-export rule changed")
		}
		data = bytes.TrimPrefix(data, []byte("export-default|"))
		b := func(i int) byte {
			if i < len(data) {
				return data[i]
			}
			return 0
		}
		gap := []string{" ", "\n", " /* before */ ", " /* before\n */ "}[b(1)%4]
		name := "Missing"
		if b(2)&1 != 0 {
			name = "async"
		}
		nameGap := " "
		if b(2)&2 != 0 {
			nameGap = " /* name */ "
		}
		body := " {}"
		if b(2)&4 != 0 {
			body = " { value: number }"
		}
		decl := "service" + nameGap + name + body
		mode := b(0) % 4
		source := "export default" + gap + decl
		wantStatements := 2
		switch mode {
		case 1:
			source = "export " + decl
		case 2:
			source = decl + "\nexport { " + name + " as default }"
			wantStatements = 3
		case 3:
			expr := []string{"service", "service as number", "service satisfies number", "service(1)"}[b(3)%4]
			source = "const service: any = 1;\nexport default" + gap + expr
			wantStatements = 3
		}
		if b(2)&8 != 0 {
			source = "/** documentation */\n" + source
		}
		source += "\nexport const kept = 1\n"
		file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
		ds := file.Diagnostics()
		if mode == 0 {
			if len(ds) != 1 || ds[0].Source() != "EK" || ds[0].Code() != 905 {
				t.Fatalf("chapter 5 requires one EK0905, got %v:\n%s", ds, source)
			}
		} else if len(ds) != 0 {
			t.Fatalf("valid control rejected: %v:\n%s", ds, source)
		}
		if !ast.IsExternalModule(file) || len(file.Statements.Nodes) != wantStatements {
			t.Fatal(fmt.Sprintf("recovery lost the module or following declaration: %d statements:\n%s", len(file.Statements.Nodes), source))
		}
	})
}
