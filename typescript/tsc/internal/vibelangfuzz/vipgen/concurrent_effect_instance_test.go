package vipgen

import (
	"os/exec"
	"strings"
	"testing"
)

func TestConcurrentProjectEffectReferenceSyntax(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node.js is required to parse the reference module")
	}
	source := PrintEffect(Probe("vip19.project-effect-instance"))
	cmd := exec.CommandContext(t.Context(), node, "--check", "--input-type=module")
	cmd.Stdin = strings.NewReader(source)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("reference must be executable JavaScript: %v\n%s\n%s", err, output, source)
	}
}

// A probe reads as ending its block but reaches its end. Under the throw-only
// construct, a function around one finished with void, and the caller's arithmetic
// on the result did not compile. Only a real throw may end a body without a value.
func TestFinishKeepsTheValueOfABodyThatEndsInAProbe(t *testing.T) {
	g := &Gen{c: chooser{data: []byte{1, 2, 3}}, used: map[string]bool{}, modules: map[string]bool{}, files: map[string]string{}, imports: map[string][]string{}, narrowed: map[string]int{}}
	g.on = []*Construct{Lookup("vip04.throw-only-body")}
	s := &Scope{Fn: &Func{Name: "f"}}
	body := g.finish(s, []Stmt{allProjectInstance(g, 0)})
	if _, ok := body[len(body)-1].(*Return); !ok {
		t.Fatalf("a probe's body ends in %T, want a return", body[len(body)-1])
	}
	thrown := g.finish(s, []Stmt{&Throw{Value: &Num{Value: 1}}})
	if len(thrown) != 1 {
		t.Fatalf("a throw-only body must stay as written, got %d statements", len(thrown))
	}
}
