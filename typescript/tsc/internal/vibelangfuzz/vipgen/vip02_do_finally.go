package vipgen

import (
	"fmt"
	"strconv"
)

// VIP-2: "do uses the source block's normal completion values and
// UpdateEmpty flow, including locally consumed jumps" (with code formatting
// in the citation below). The pinned TC39 proposal delegates TryStatement,
// StatementList and LabelledEvaluation to native ECMAScript. Native eval of
// the identical statement text is an independent completion-value oracle;
// only the TypeScript reference uses eval, never the VibeLang program.
func init() {
	Register(&Construct{
		Key: "vip02.do-finally-completion-plain", VIP: 2, Plain: true,
		Citations: []Citation{{
			VIP: 2, Template: "eval(‹source›)",
			Quote:   "`do` uses the source block's normal completion values and `UpdateEmpty` flow, including locally consumed jumps.",
			Reading: "VIP-2 pins TC39 do block completion. The reference evaluates identical native try/catch/finally and labeled statements with JavaScript eval, whose result is their completion value; no compiler lowering is reused.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt { return []Stmt{doFinallyCompletion(g, s)} },
		Stmt:  doFinallyCompletion,
	})
}

func doFinallyCompletion(g *Gen, s *Scope) Stmt {
	name := g.Name("completion")
	source := doFinallyNest(g, 1+g.Intn(3), nil)
	wrap := func(expr, annotation string) string {
		return fmt.Sprintf("function %s()%s { try { return { kind: \"normal\", value: %s }; } catch (error) { return { kind: \"throw\", value: error }; } }", name, annotation, expr)
	}
	g.AddDecl(&Code{V: wrap("do { "+source+" }", ": unknown"), E: wrap("eval("+strconv.Quote(source)+")", "")})
	return &doFinallyEvent{Name: name}
}

func doFinallyNest(g *Gen, depth int, parents []string) string {
	label := g.Name("finalizerLabel")
	labels := append(append([]string{}, parents...), label)
	block := func(finalizer bool) string {
		if depth > 1 && g.Intn(3) == 1 {
			return doFinallyNest(g, depth-1, labels)
		}
		value := 1 + g.Intn(20)
		if finalizer {
			value += 100 // Keep the finalizer distinguishable from try/catch.
		}
		target := labels[g.Intn(len(labels))]
		choice := g.Intn(8)
		if finalizer {
			choice = (choice + 2) % 8 // The zero-byte probe is the RC-30 witness.
		}
		switch choice {
		case 0:
			return fmt.Sprintf("%d;", value)
		case 1:
			return ""
		case 2:
			return fmt.Sprintf("%d; break %s;", value, target)
		case 3:
			return "break " + target + ";"
		case 4:
			return fmt.Sprintf("throw %d;", value)
		case 5:
			return fmt.Sprintf("%d; if (true) { break %s; } else {}", value, target)
		case 6:
			return fmt.Sprintf("internal: { %d; break internal; }", value)
		default:
			return fmt.Sprintf("%d; switch (0) {}", value)
		}
	}
	body, handler, finalizer := block(false), block(false), block(true)
	if g.Intn(2) == 0 {
		return fmt.Sprintf("%s: { try { %s } catch { %s } finally { %s } }", label, body, handler, finalizer)
	}
	return fmt.Sprintf("%s: { try { %s } finally { %s } }", label, body, finalizer)
}

type doFinallyEvent struct{ Name string }

func (e *doFinallyEvent) Vibe(w *Writer)   { e.print(w) }
func (e *doFinallyEvent) Effect(w *Writer) { e.print(w) }
func (e *doFinallyEvent) Ends() bool       { return false }
func (e *doFinallyEvent) print(w *Writer) {
	w.Write("ev(\"completion:\" + JSON.stringify(" + e.Name + "()))")
}
