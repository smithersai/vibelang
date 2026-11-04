package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"testing"
)

func TestObjectMemberKeyContext(t *testing.T) {
	for _, tc := range []struct {
		name, body, owner string
		calls             int
	}{
		{"method", "const o = {[try Effect.succeed('m')](){}}", "outer", 1},
		{"getter", "const o = {get [try Effect.succeed('m')](){return 1}}", "outer", 1},
		{"setter", "const o = {set [try Effect.succeed('m')](x:number){}}", "outer", 1},
		{"effect-method", "const o = {effect [try Effect.succeed('m')](){return 1}}", "outer", 1},
		{"property-control", "const o = {[try Effect.succeed('m')]:1}", "outer", 1},
		{"method-body", "const o = {m(){return try Effect.succeed(1)}}", "m", 0},
		{"effect-body", "const o = {effect m(){return try Effect.succeed(1)}}", "m", 0},
		{"getter-body", "const o = {get m(){return try Effect.succeed(1)}}", "m", 0},
		{"method-default", "const o = {effect m(x=try Effect.succeed(1)){}}", "", 0},
		{"arrow-body", "const o = {m:()=>try Effect.succeed(1)}", "<anonymous>", 0},
		{"nested-function", "function inner(){const o = {[try Effect.succeed('m')](){}}}", "inner", 0},
		{"nested-key-function", "const o = {[(function inner(){return try Effect.succeed('m')})()](){}}", "inner", 0},
		{"class-heritage-control", "class C extends (try Effect.succeed(class {})) {}", "outer", 1},
		{"class-heritage-nested-callable-control", "class C extends (function inner(){return try Effect.succeed(class {})})() {}", "inner", 0},
		{"field-initializer", "class C {value=try Effect.succeed(1)}", "", 0},
		{"static-block", "class C {static {try Effect.succeed(1)}}", "", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, "effect function outer(){"+tc.body+"}", core.ScriptKindTS)
			count := 0
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				if isTry(n) {
					count++
					got := ""
					if owner := effectCodeOwner(n); owner != nil {
						got = "<anonymous>"
						if owner.Name() != nil {
							got = owner.Name().Text()
						}
					}
					if got != tc.owner {
						t.Errorf("owner %q, want %q: %s", got, tc.owner, tc.body)
					}
				}
				return n.ForEachChild(visit)
			}
			f.AsNode().ForEachChild(visit)
			if count != 1 {
				t.Fatalf("found %d try calls, want1", count)
			}
			for _, running := range []bool{false, true} {
				planned := 0
				cb := func(n *ast.Node) bool {
					if isTry(n) {
						planned++
					}
					return false
				}
				fn := f.AsNode().Statements()[0]
				if running {
					(&analyzer{}).forEachRunningCallInBody(fn, cb)
				} else {
					forEachCallInBody(fn, cb)
				}
				if planned != tc.calls {
					t.Errorf("running=%v: planned %d, want %d", running, planned, tc.calls)
				}
			}
		})
	}
}
