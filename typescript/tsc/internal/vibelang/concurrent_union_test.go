package vibelang

import (
	"fmt"
	"testing"
)

func TestConcurrentUnionIteration(t *testing.T) {
	for _, row := range []struct{ key, typ, binding, body string }{
		{"arrays", "string[] | number[]", "item", "const checked:string|number=item;void checked"},
		{"containers", "number[] | Set<string>", "item", "const checked:string|number=item;void checked"},
		{"readonly", "readonly string[] | readonly number[]", "item", "const checked:string|number=item;void checked"},
		{"iterables", "Iterable<string> | Iterable<number>", "item", "const checked:string|number=item;void checked"},
		{"generators", "Generator<string> | Generator<number>", "item", "const checked:string|number=item;void checked"},
		{"tuples", "[string,number][] | Set<[number,string]>", "[first,second]", "const a:string|number=first;const b:string|number=second;void a;void b"},
		{"objects", "Array<{kind:'n',value:number}> | Set<{kind:'s',value:string}>", "item", "if(item.kind==='n'){item.value.toFixed()}else{item.value.toUpperCase()}"},
		{"nullable-items", "Array<string|null> | Set<number|undefined>", "item", "const checked:string|number|null|undefined=item;void checked"},
	} {
		for _, kind := range []string{"const", "let"} {
			for _, limit := range []string{"", "(1)", "(\"unbounded\")"} {
				t.Run(fmt.Sprintf("%s/%s/%s", row.key, kind, limit), func(t *testing.T) {
					source := fmt.Sprintf("export effect function main(rows:%s){for concurrent%s(%s %s of rows){%s}}", row.typ, limit, kind, row.binding, row.body)
					if errors := errorsOf(t, source); len(errors) != 0 {
						t.Fatalf("native Iterable union rejected: %v\n%s", errors, source)
					}
				})
			}
		}
	}
}

func TestConcurrentUnionIterationErrors(t *testing.T) {
	for _, row := range []struct {
		key, typ, body string
		code           int32
	}{
		{"number-only-method", "string[]|number[]", "item.toFixed()", 2339},
		{"string-only-method", "number[]|Set<string>", "item.toUpperCase()", 2339},
		{"wrong-assignment", "readonly string[]|readonly number[]", "const checked:boolean=item;void checked", 2322},
		{"independent-name", "number[]|Set<string>", "void item;missing()", 2304},
		{"mixed-operand", "number[]|number", "void item", 1901},
	} {
		t.Run(row.key, func(t *testing.T) {
			source := fmt.Sprintf("export effect function main(rows:%s){for concurrent(const item of rows){%s}}", row.typ, row.body)
			errors := errorsOf(t, source)
			if len(errors) != 1 || errors[0].Code() != row.code {
				t.Fatalf("want one diagnostic %d, got %v\n%s", row.code, errors, source)
			}
		})
	}
}
