package vipgen

import "testing"

// Opaque producer probes need the common numeric function completion even
// when the surrounding program also enables throw-only bodies.
func TestProducerProjectEffectProbesKeepNumericReturns(t *testing.T) {
	g := &Gen{c: chooser{data: []byte{1, 2, 3}}, used: map[string]bool{}, modules: map[string]bool{}, files: map[string]string{}, imports: map[string][]string{}, narrowed: map[string]int{}}
	g.on = []*Construct{Lookup("vip04.throw-only-body")}
	for mode := range 4 {
		scope := &Scope{Fn: &Func{Name: "f"}}
		body := g.finish(scope, []Stmt{producerProjectInstance(g, mode)})
		if _, ok := body[len(body)-1].(*Return); !ok {
			t.Fatalf("producer/%d finishes with %T, want a return", mode, body[len(body)-1])
		}
	}
}
