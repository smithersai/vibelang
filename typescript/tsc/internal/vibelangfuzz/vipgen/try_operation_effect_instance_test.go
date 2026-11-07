package vipgen

import "testing"

// Each opaque allocator probe can reach its end. The common finisher must
// still give the enclosing numeric function a value, including throw-only mode.
func TestTryOperationEffectProbesKeepNumericReturns(t *testing.T) {
	g := &Gen{c: chooser{data: []byte{1, 2, 3}}, used: map[string]bool{}, modules: map[string]bool{}, files: map[string]string{}, imports: map[string][]string{}, narrowed: map[string]int{}}
	g.on = []*Construct{Lookup("vip04.throw-only-body")}
	for _, operation := range []string{"race", "any", "allSettled"} {
		for mode := range 7 {
			scope := &Scope{Fn: &Func{Name: "f"}}
			body := g.finish(scope, []Stmt{operationProjectInstance(g, operation, mode)})
			if _, ok := body[len(body)-1].(*Return); !ok {
				t.Fatalf("%s/%d finishes with %T, want a return", operation, mode, body[len(body)-1])
			}
		}
	}
}
