package vibelangfuzz

import (
	"strings"
	"testing"
)

const namedTupleTypeQuote = "Names not defined here (`Block`, `Type`, `UnaryExpression`, `ConciseBody`, \u2026) are TypeScript's or ECMAScript's."

func TestNamedTupleTypeQuoted(t *testing.T) {
	if !strings.Contains(SpecText("900-appendices.md"), namedTupleTypeQuote) {
		t.Fatalf("native Type grammar quote changed: %q", namedTupleTypeQuote)
	}
}

func failuresNamedTupleLabelCases() []*failCase {
	var cases []*failCase
	for _, row := range []struct{ key, body string }{
		{"optional", "const tuple:[label?:number]=[];"},
		{"readonly", "const tuple:readonly[label?:number]=[];"},
		{"assertion", "const tuple=[] as [label?:number];"},
		{"same-name", "const tuple:[n?:typeof n]=[];"},
		{"rest", "const tuple:[head:number,...tail:number[]]=[n];"},
		{"generic", "type Tuple<T>=[head:T,...tail:T[]];const tuple:Tuple<number>=[n];"},
		{"callback", "const tuple:[callback?:(n:number)=>number]=[];"},
		{"object", "const tuple:[label?:{value:number}]=[];"},
	} {
		for _, kind := range []string{"declaration", "method"} {
			decl := "effect function inspect(n:number){" + row.body + "return n}"
			body := "try inspect(1)"
			if kind == "method" {
				decl = "const holder={effect inspect(n:number){" + row.body + "return n}}"
				body = "try holder.inspect(1)"
			}
			cases = append(cases, &failCase{Name: "type-only-tuple-label-" + row.key + "-" + kind, Chapter: "900-appendices.md", Quote: namedTupleTypeQuote, VIP: 1, Decls: decl, Body: body})
		}
	}
	return cases
}
