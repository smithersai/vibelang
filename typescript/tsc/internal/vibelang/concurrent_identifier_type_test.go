package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"strings"
	"testing"
)

func TestConcurrentIdentifierAny(t *testing.T) {
	for _, row := range []struct{ key, prefix, generic, params, items, body string }{
		{"direct", "", "", "rows:any", "rows", "const checked:number=item.n;void checked"},
		{"alias", "type Rows=any;", "", "rows:Rows", "rows", "const checked:number=item.n;void checked"},
		{"assertion", "", "", "rows:unknown", "(rows as any)", "const checked:number=item.n;void checked"},
		{"whole-value", "", "", "rows:any", "rows", "const checked:number=item;void checked"},
		{"generic-bound", "", "<T extends Iterable<any>>", "rows:T", "rows", "const checked:number=item.n;void checked"},
	} {
		for _, kind := range []string{"const", "let"} {
			for _, limit := range []string{"", "(1)", "(\"unbounded\")"} {
				t.Run(fmt.Sprintf("%s/%s/%s", row.key, kind, limit), func(t *testing.T) {
					source := fmt.Sprintf("%s export effect function main%s(%s){for concurrent%s(%s item of %s){%s}}", row.prefix, row.generic, row.params, limit, kind, row.items, row.body)
					if errors := errorsOf(t, source); len(errors) != 0 {
						t.Fatalf("native any head rejected: %v\n%s", errors, source)
					}
				})
			}
		}
	}
}

func TestConcurrentIdentifierHeadControls(t *testing.T) {
	for _, source := range []string{
		"export effect function main(rows:any){for concurrent(let item of rows){item=1;const checked:number=item.n;void checked}}",
		"export effect function main(rows:any){for concurrent(const item of rows){const item=1;const checked:number=item;void checked}}",
		"export effect function main(rows:Array<{n:number}>){for concurrent(const $concurrentItem of rows){const checked:number=$concurrentItem.n;void checked}}",
		"export effect function main(rows:Array<{n:number}>){const $concurrentItem=9;for concurrent(const item of rows){const outside:number=$concurrentItem;const checked:number=item.n;void outside;void checked}}",
	} {
		if errors := errorsOf(t, source); len(errors) != 0 {
			t.Errorf("native head control rejected: %v\n%s", errors, source)
		}
	}
}

func TestConcurrentIdentifierNarrowing(t *testing.T) {
	for _, row := range []struct {
		key, generic, params, body string
		code                       int32
	}{
		{"any-string", "", "rows:any", "if(typeof item==='string'){const checked:number=item;void checked}", 2322},
		{"any-number", "", "rows:any", "if(typeof item==='number'){const checked:string=item;void checked}", 2322},
		{"typed", "", "rows:number[]", "const checked:number=item.n;void checked", 2339},
		{"generic-typed", "<T extends Iterable<number>>", "rows:T", "const checked:number=item.n;void checked", 2339},
		{"unknown-item", "", "rows:Iterable<unknown>", "const checked:number=item.n;void checked", 18046},
		{"unknown-operand", "", "rows:unknown", "void item", 1901},
		{"const-write", "", "rows:any", "item=1", 2588},
	} {
		t.Run(row.key, func(t *testing.T) {
			source := fmt.Sprintf("export effect function main%s(%s){for concurrent(const item of rows){%s}}", row.generic, row.params, row.body)
			errors := errorsOf(t, source)
			if len(errors) != 1 || errors[0].Code() != row.code {
				t.Fatalf("want exactly diagnostic %d, got %v\n%s", row.code, errors, source)
			}
		})
	}
}

func TestConcurrentIdentifierHover(t *testing.T) {
	for _, row := range []struct{ kind, typ, want string }{
		{"const", "readonly string[]", "const item: string"},
		{"let", "readonly number[]", "let item: number"},
		{"const", "any", "const item: any"},
		{"let", "Iterable<any>", "let item: any"},
	} {
		t.Run(row.kind+"/"+row.typ, func(t *testing.T) {
			source := fmt.Sprintf("export effect function main(rows:%s){for concurrent(%s item of rows){void item}}", row.typ, row.kind)
			_, file, service, _ := editorProgram(t, source)
			uri := lsconv.FileNameToDocumentURI(file.FileName())
			for _, needle := range []string{row.kind + " item", "void item"} {
				for _, shift := range []int{len(needle) - 4, len(needle) - 3} {
					shown := hoverText(t, service, uri, positionOf(source, needle, shift))
					if !strings.Contains(shown, row.want) {
						t.Errorf("hover on %q: want %q, got %q", needle, row.want, shown)
					}
				}
			}
			shown := hoverText(t, service, uri, positionOf(source, "of rows", 4))
			if !strings.Contains(shown, "rows: "+row.typ) {
				t.Errorf("operand hover: %q", shown)
			}
		})
	}
}

func TestConcurrentIdentifierUnusedUnderscore(t *testing.T) {
	for _, kind := range []string{"const", "let"} {
		for _, body := range []string{"", "void _item", "const _local=1"} {
			for _, parameters := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/%s/%t", kind, body, parameters), func(t *testing.T) {
					source := fmt.Sprintf("export effect function main(rows:number[]){for concurrent(%s _item of rows){%s}}", kind, body)
					program, file, _, _ := editorProgram(t, source)
					program.Options().NoUnusedLocals = core.TSTrue
					program.Options().NoUnusedParameters = core.IfElse(parameters, core.TSTrue, core.TSFalse)
					var codes []int32
					for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
						if d.Category() == diagnostics.CategoryError {
							codes = append(codes, d.Code())
						}
					}
					if body == "const _local=1" {
						if len(codes) != 1 || codes[0] != 6133 {
							t.Fatalf("ordinary body local must remain TS6133: %v", codes)
						}
					} else if len(codes) != 0 {
						t.Fatalf("native underscore head rejected: %v", codes)
					}
				})
			}
		}
	}
}
