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

// Neither Effect-instance probe returns, but the generator reads it as ending
// its block. A numeric function around one finished with void, and the caller's
// arithmetic on the result did not compile.
func TestEffectInstanceProbesReturnTheirFunctionValue(t *testing.T) {
	g := &Gen{c: chooser{data: []byte{1, 2, 3}}, used: map[string]bool{}, modules: map[string]bool{}, files: map[string]string{}, imports: map[string][]string{}, narrowed: map[string]int{}}
	for _, probe := range []Stmt{allProjectInstance(g, 0), concurrentProjectInstance(g, 0)} {
		seq, ok := g.finishProbe(&Scope{Fn: &Func{}}, probe).(*Seq)
		if !ok {
			t.Fatal("a numeric function needs a return after its probe")
		}
		if _, ok := seq.Stmts[len(seq.Stmts)-1].(*Return); !ok {
			t.Fatalf("last statement is %T, want a return", seq.Stmts[len(seq.Stmts)-1])
		}
		if g.finishProbe(&Scope{Fn: &Func{Void: true}}, probe) != probe {
			t.Error("a void function needs no value")
		}
		if g.finishProbe(&Scope{Fn: &Func{}, NoReturn: true}, probe) != probe {
			t.Error("a scope that forbids return must keep the bare probe")
		}
	}
}
