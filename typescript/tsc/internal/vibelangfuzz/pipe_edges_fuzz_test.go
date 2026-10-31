package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// The edges of a pipe, read from Appendix A at test time. Two consumers of a
// ShortCircuitExpression can follow a pipe body or an arrow handler's concise
// body: a conditional's ? and a pipe's |>. The rules give every such source
// one reading or a syntax error:
//
//   - a ? right after a pipe body is EK2301 (an unparenthesized conditional at
//     either end of a pipe);
//   - a |> after a catch with an arrow handler belongs to the arrow's body.
//
// The generator builds an expression tree, prints it with the parentheses the
// rules require plus random optional ones, and leaves out the parentheses at
// exactly the two EK2301 edges when the input asks. The oracle is the tree:
// the compiler must report one EK2301 per ? it left bare and, when it leaves
// none, compile cleanly and run to the value the tree evaluates to.
var pipeEdgeQuotes = []string{
	"an unparenthesized conditional at either end of a pipe",
	"It is a Syntax Error if the `ShortCircuitExpression` of a `PipeExpression` is a `CatchExpression` whose handler is an `ArrowHandler`; the `|>` then belongs to the arrow's body",
}

func pipeEdgesAppendix(tb testing.TB) {
	text := SpecText("900-appendices.md")
	for _, quote := range pipeEdgeQuotes {
		if !strings.Contains(text, quote) {
			tb.Fatalf("Appendix A/B no longer says %q", quote)
		}
	}
	_, section := appendixBRows(text)
	row := ""
	for _, line := range strings.Split(section, "\n") {
		if strings.HasPrefix(line, "| `EK2301` |") {
			row = line
		}
	}
	if !strings.Contains(row, pipeEdgeQuotes[0]) || !strings.Contains(row, "| 23 |") {
		tb.Fatalf("Appendix B no longer gives VIP-23's EK2301 to %q", pipeEdgeQuotes[0])
	}
}

func TestPipeEdgesQuoted(t *testing.T) { pipeEdgesAppendix(t) }

type pipeEdgeKind int

const (
	pipeLit pipeEdgeKind = iota
	pipeTopic
	pipeAdd   // a + k
	pipeCall  // f(a), f(n) = n + 1
	pipeCond  // a ? b : c
	pipePipe  // a |> b, b holding the topic
	pipeCatch // ok(k) or bad() catch () => a
)

type pipeEdge struct {
	kind    pipeEdgeKind
	k       int
	a, b, c *pipeEdge
	fails   bool // pipeCatch: the head fails, so the handler runs
	bare    bool // pipeCond test or pipePipe body: leave out the parentheses EK2301 asks for
	paren   bool // optional parentheses around this node where they change nothing
	inPlain bool // inside an arrow handler's body, plain code: no catch
}

// pipeEdgeBytes reads choices from fuzz input, then zeros.
type pipeEdgeBytes struct {
	data []byte
	at   int
}

func (b *pipeEdgeBytes) next(n int) int {
	if b.at >= len(b.data) {
		return 0
	}
	v := int(b.data[b.at]) % n
	b.at++
	return v
}

// gen builds an expression; topic says whether a pipe's topic is in scope and
// must appear at least once (need).
func (b *pipeEdgeBytes) gen(depth int, topic, need, plain bool) *pipeEdge {
	if depth <= 0 {
		if need || (topic && b.next(2) == 0) {
			return &pipeEdge{kind: pipeTopic}
		}
		return &pipeEdge{kind: pipeLit, k: b.next(4)}
	}
	paren := b.next(4) == 0
	choices := 6
	if plain || need {
		choices = 5 // a handler is plain code, and its body can't hold the outer topic
	}
	switch b.next(choices) {
	case 0:
		return &pipeEdge{kind: pipeAdd, a: b.gen(depth-1, topic, need, plain), k: 1 + b.next(3), paren: paren}
	case 1:
		return &pipeEdge{kind: pipeCall, a: b.gen(depth-1, topic, need, plain), paren: paren}
	case 2:
		// A topic needed below goes in the test, so both branches may omit it.
		return &pipeEdge{kind: pipeCond, a: b.gen(depth-1, topic, need, plain), b: b.gen(depth-1, topic, false, plain), c: b.gen(depth-1, topic, false, plain), bare: b.next(3) == 0, paren: paren}
	case 3, 4:
		head := b.gen(depth-1, topic, need, plain)
		return &pipeEdge{kind: pipePipe, a: head, b: b.gen(depth-1, true, true, plain), bare: b.next(3) == 0, paren: paren}
	default:
		// A handler is a nested function: the outer topic stays out of it.
		return &pipeEdge{kind: pipeCatch, k: b.next(4), fails: b.next(2) == 0, a: b.gen(depth-1, false, false, true), paren: paren}
	}
}

// eval is the tree's value: numbers, with JavaScript's truthiness.
func (e *pipeEdge) eval(topic int) int {
	switch e.kind {
	case pipeLit:
		return e.k
	case pipeTopic:
		return topic
	case pipeAdd:
		return e.a.eval(topic) + e.k
	case pipeCall:
		return e.a.eval(topic) + 1
	case pipeCond:
		if e.a.eval(topic) != 0 {
			return e.b.eval(topic)
		}
		return e.c.eval(topic)
	case pipePipe:
		return e.b.eval(e.a.eval(topic))
	default:
		if e.fails {
			return e.a.eval(0)
		}
		return e.k
	}
}

// print writes e, counting in bare each ? it leaves directly after a pipe
// body.
func (e *pipeEdge) print(sb *strings.Builder, bare *int) {
	open := e.paren && e.kind != pipeLit && e.kind != pipeTopic
	if open {
		sb.WriteString("(")
	}
	switch e.kind {
	case pipeLit:
		fmt.Fprint(sb, e.k)
	case pipeTopic:
		sb.WriteString("%")
	case pipeAdd:
		e.a.closed(sb, bare)
		fmt.Fprintf(sb, " + %d", e.k)
	case pipeCall:
		sb.WriteString("f(")
		e.a.print(sb, bare)
		sb.WriteString(")")
	case pipeCond:
		if e.bare && e.a.kind == pipePipe && !e.a.paren {
			// (x |> b) ? … without its parentheses: EK2301 at this ?. A bare
			// conditional body there would make this ? its else branch's.
			e.a.printPipe(sb, bare, false)
			*bare++
		} else {
			e.a.closed(sb, bare)
		}
		sb.WriteString(" ? ")
		e.b.branch(sb, bare)
		sb.WriteString(" : ")
		e.c.branch(sb, bare)
	case pipePipe:
		e.printPipe(sb, bare, true)
	default:
		if e.fails {
			sb.WriteString("bad()")
		} else {
			fmt.Fprintf(sb, "ok(%d)", e.k)
		}
		sb.WriteString(" catch () => ")
		// The concise body extends as far as an assignment expression, a
		// trailing pipe included (Appendix A, PipeExpression).
		e.a.branch(sb, bare)
	}
	if open {
		sb.WriteString(")")
	}
}

// printPipe writes a |> b without outer parentheses; bareBody allows the
// body's EK2301 edge.
func (e *pipeEdge) printPipe(sb *strings.Builder, bare *int, bareBody bool) {
	switch {
	case e.a.kind == pipePipe && !e.a.paren:
		e.a.printPipe(sb, bare, bareBody) // left-associated chain
	default:
		e.a.closed(sb, bare)
	}
	sb.WriteString(" |> ")
	switch {
	case bareBody && e.bare && e.b.kind == pipeCond && !e.b.paren:
		// x |> (t ? a : b) without its parentheses: EK2301 at the ?.
		e.b.a.closed(sb, bare)
		*bare++
		sb.WriteString(" ? ")
		e.b.b.branch(sb, bare)
		sb.WriteString(" : ")
		e.b.c.branch(sb, bare)
	default:
		// A body is never an unparenthesized pipe, conditional or catch.
		e.b.closed(sb, bare)
	}
}

// closed writes e where an operator follows it: anything looser than a
// binary operand is parenthesized.
func (e *pipeEdge) closed(sb *strings.Builder, bare *int) {
	switch e.kind {
	case pipeLit, pipeTopic, pipeCall:
		e.print(sb, bare)
	default:
		if e.paren {
			e.print(sb, bare)
			return
		}
		sb.WriteString("(")
		e.print(sb, bare)
		sb.WriteString(")")
	}
}

// branch writes e as a conditional branch or an arrow body, an
// AssignmentExpression: a pipe and a conditional stand there bare.
func (e *pipeEdge) branch(sb *strings.Builder, bare *int) {
	switch e.kind {
	case pipeCatch:
		e.closed(sb, bare) // a catch in a branch could swallow a following : or |>
	default:
		e.print(sb, bare)
	}
}

// pipeEdgeSeeds are the keyed inputs: each names one edge.
var pipeEdgeSeeds = map[string]*pipeEdge{
	"pipe-conditional-test": {kind: pipeCond, bare: true,
		a: &pipeEdge{kind: pipePipe, a: &pipeEdge{kind: pipeLit, k: 1}, b: &pipeEdge{kind: pipeCall, a: &pipeEdge{kind: pipeTopic}}},
		b: &pipeEdge{kind: pipeLit, k: 1}, c: &pipeEdge{kind: pipeLit, k: 2}},
	"pipe-conditional-test-parenthesized": {kind: pipeCond,
		a: &pipeEdge{kind: pipePipe, a: &pipeEdge{kind: pipeLit, k: 1}, b: &pipeEdge{kind: pipeCall, a: &pipeEdge{kind: pipeTopic}}},
		b: &pipeEdge{kind: pipeLit, k: 1}, c: &pipeEdge{kind: pipeLit, k: 2}},
	"pipe-conditional-body": {kind: pipePipe, bare: true, a: &pipeEdge{kind: pipeLit, k: 0},
		b: &pipeEdge{kind: pipeCond, a: &pipeEdge{kind: pipeTopic}, b: &pipeEdge{kind: pipeLit, k: 1}, c: &pipeEdge{kind: pipeLit, k: 2}}},
	"pipe-conditional-body-parenthesized": {kind: pipePipe, a: &pipeEdge{kind: pipeLit, k: 0},
		b: &pipeEdge{kind: pipeCond, a: &pipeEdge{kind: pipeTopic}, b: &pipeEdge{kind: pipeLit, k: 1}, c: &pipeEdge{kind: pipeLit, k: 2}}},
	"pipe-in-branches": {kind: pipeCond, a: &pipeEdge{kind: pipeLit, k: 1},
		b: &pipeEdge{kind: pipePipe, a: &pipeEdge{kind: pipeLit, k: 3}, b: &pipeEdge{kind: pipeAdd, a: &pipeEdge{kind: pipeTopic}, k: 1}},
		c: &pipeEdge{kind: pipePipe, a: &pipeEdge{kind: pipeLit, k: 2}, b: &pipeEdge{kind: pipeAdd, a: &pipeEdge{kind: pipeTopic}, k: 2}}},
	"catch-arrow-pipe-body": {kind: pipeCatch, k: 5,
		a: &pipeEdge{kind: pipePipe, a: &pipeEdge{kind: pipeLit, k: 0}, b: &pipeEdge{kind: pipeAdd, a: &pipeEdge{kind: pipeTopic}, k: 1}}},
	"catch-arrow-pipe-body-fails": {kind: pipeCatch, fails: true,
		a: &pipeEdge{kind: pipePipe, a: &pipeEdge{kind: pipeLit, k: 0}, b: &pipeEdge{kind: pipeAdd, a: &pipeEdge{kind: pipeTopic}, k: 1}}},
	"catch-parenthesized-then-pipe": {kind: pipePipe, a: &pipeEdge{kind: pipeCatch, k: 5, a: &pipeEdge{kind: pipeLit, k: 0}},
		b: &pipeEdge{kind: pipeAdd, a: &pipeEdge{kind: pipeTopic}, k: 1}},
	"catch-arrow-conditional-body": {kind: pipeCatch, fails: true,
		a: &pipeEdge{kind: pipeCond, a: &pipeEdge{kind: pipeLit, k: 1}, b: &pipeEdge{kind: pipeLit, k: 3}, c: &pipeEdge{kind: pipeLit, k: 4}}},
	"pipe-chain-conditional-test": {kind: pipeCond, bare: true,
		a: &pipeEdge{kind: pipePipe, a: &pipeEdge{kind: pipePipe, a: &pipeEdge{kind: pipeLit, k: 1}, b: &pipeEdge{kind: pipeCall, a: &pipeEdge{kind: pipeTopic}}},
			b: &pipeEdge{kind: pipeAdd, a: &pipeEdge{kind: pipeTopic}, k: 1}},
		b: &pipeEdge{kind: pipeLit, k: 1}, c: &pipeEdge{kind: pipeLit, k: 2}},
}

const pipeEdgePrelude = `error Oops {}
function f(n: number): number { return n + 1 }
effect function ok(n: number): number!Oops { return n }
effect function bad(): number!Oops { throw new Oops() }
export effect function main() {
  return `

func FuzzPipeEdges(f *testing.F) {
	startShortBudget(f)
	pipeEdgesAppendix(f)
	for key := range pipeEdgeSeeds {
		f.Add([]byte(key))
	}
	f.Add([]byte{2, 3, 0, 1, 4, 3, 0, 2, 1})
	w := NewWorkspace(f)
	node, err := NewNode(w.Dir)
	if err != nil {
		Missing(f, "%v", err)
	}
	f.Cleanup(node.Close)
	f.Fuzz(func(t *testing.T, data []byte) {
		tree, keyed := pipeEdgeSeeds[string(data)]
		if !keyed {
			b := &pipeEdgeBytes{data: data}
			tree = b.gen(1+b.next(3), false, false, false)
		}
		var sb strings.Builder
		bare := 0
		tree.print(&sb, &bare)
		source := pipeEdgePrelude + sb.String() + "\n}\n"
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		reported, errors := 0, []string{}
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if IsEK(d) && d.Code() == 2301 {
				reported++
			}
			errors = append(errors, fmt.Sprintf("%s%d: %s", d.Source(), d.Code(), d.String()))
		}
		if reported != bare {
			Gap(t, "FuzzPipeEdges", "ek2301-count", "Appendix B: EK2301 is %q; %d bare ? after a pipe body, %d EK2301:\n%s\n%s", pipeEdgeQuotes[0], bare, reported, source, strings.Join(errors, "\n"))
			return
		}
		if bare > 0 {
			return
		}
		if len(errors) > 0 {
			Gap(t, "FuzzPipeEdges", "control", "a pipe edge with every required parenthesis does not compile:\n%s\n%s", source, strings.Join(errors, "\n"))
			return
		}
		got := node.Run(r, "out/main.js", "main")
		want, _ := json.Marshal(tree.eval(0))
		if got.Kind != "success" || string(got.Value) != string(want) {
			Gap(t, "FuzzPipeEdges", "value", "Appendix A: %q; the tree gives %s, the program %s %s %s:\n%s", pipeEdgeQuotes[1], want, got.Kind, got.Value, got.Log, source)
			return
		}
		ExpectPending(t, "FuzzPipeEdges", "ek2301-count")
		ExpectPending(t, "FuzzPipeEdges", "control")
		ExpectPending(t, "FuzzPipeEdges", "value")
	})
}
