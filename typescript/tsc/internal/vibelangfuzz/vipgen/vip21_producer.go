package vipgen

import (
	"slices"
	"strings"
)

// VIP-21: producers. "`effect function*` returns a Stream, as `async
// function*` returns an AsyncIterable. `yield x` emits `x`, and `try` runs
// Effects (VIP-5)." Its Effect TS, as corrected on 2026-10-29: const p = ()
// => Stream.callback((queue) => Effect.gen(function* () { yield*
// Queue.offer(queue, x) … }).pipe(Effect.andThen(Queue.end(queue))), {
// bufferSize: 1, strategy: "suspend" }).
//
// A producer is a module-level declaration, never a Func: main must return
// an Effect, and a producer's call gives a Stream. A producer yields at most
// maxYields elements and contains no loop, so every Stream is finite. It
// runs on the fiber Stream.callback starts and may run one element ahead of
// its consumer, as VIP-21 says; that interleaving is part of the Effect TS
// the VIP shows, so both prints' event logs must agree on it.

// maxYields bounds the elements a producer emits.
const maxYields = 3

func init() {
	Register(&Construct{
		Key:      "vip21.producer",
		VIP:      21,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{
			{
				VIP:      21,
				Template: `const ‹p› = (‹params›) => Stream.callback((queue) => Effect.gen(function* () { yield* Queue.offer(queue, ‹x›) yield* Effect.sleep(‹d›) yield* Queue.offer(queue, ‹y›) }).pipe(Effect.andThen(Queue.end(queue))), { bufferSize: 1, strategy: "suspend" })`,
				Quote:    "It compiles to Effect's `Stream.callback` with one element of buffer, so the producer may run one element ahead of the consumer.",
			},
			{
				VIP:      21,
				Template: "return",
				Quote:    "`return value` in a producer is a compile error, because a Stream has no return value. A bare `return` ends the stream.",
				Reading:  "VIP-21 shows no return in its Effect TS. A bare return ends the body's Effect.gen, and the Effect.andThen(Queue.end(queue)) after it ends the stream.",
			},
			{
				VIP:      21,
				Template: "Stream.runCollect(‹p›())",
				Quote:    "`effect function*` returns a Stream, as `async function*` returns an AsyncIterable.",
				Reading:  "VIP-21 consumes its producer with for try (VIP-20). So that a producer runs without VIP-20, the suite also runs one with Effect's own Stream.runCollect and Stream.runCount, written Stream.x as the skeleton writes Effect's functions.",
			},
		},
		// The probe is VIP-21's example with a bare return before a third
		// element, run by Stream.runCollect: main succeeds with [1, 2].
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			g.UseModule("Stream", true)
			p := &Producer{Name: g.Name("p")}
			p.Body = []Stmt{
				&Event{Label: g.Label()},
				&Yield{Value: &Num{Value: 1}},
				sleepMs(1),
				&Event{Label: g.Label()},
				&Yield{Value: &Num{Value: 2}},
				&If{Cond: &Compare{Op: ">", A: &Num{Value: 1}, B: &Num{Value: 0}}, Then: []Stmt{&Return{}}},
				&Yield{Value: &Num{Value: 3}},
			}
			g.declareProducer(p)
			return []Stmt{&Return{Value: &Try{X: &ModCall{Mod: "Stream", Fn: "runCollect", Args: []Expr{&Call{Name: p.Name}}}}}}
		},
		Operand: func(g *Gen, s *Scope, number bool) Expr {
			call := g.ProducerCall(s)
			if call == nil {
				return nil
			}
			g.UseModule("Stream", true)
			fn := "runCount"
			if !number && g.Chance(2) {
				fn = "runCollect"
			}
			return &ModCall{Mod: "Stream", Fn: fn, Args: []Expr{call}}
		},
	})
}

// ProducerCall declares a producer whose body may use what s may call, and
// returns a call of it with numbers from s, or nil when s is too deep for
// another body.
func (g *Gen) ProducerCall(s *Scope) Expr {
	if s.Depth >= maxDepth {
		return nil
	}
	p := &Producer{Name: g.Name("p")}
	for range g.Intn(maxParams + 1) {
		p.Params = append(p.Params, g.Name("p"))
	}
	// A bare return ends the stream (VIP-21), so the body is that of a void
	// function; Locals hold the producer's parameters only, as it is
	// declared at module level.
	body := &Scope{Fn: &Func{Name: p.Name, Params: p.Params, Void: true}, Locals: slices.Clone(p.Params), Callable: s.Callable, Depth: s.Depth + 1}
	for range 1 + g.Intn(maxYields) {
		if ends(p.Body) {
			break
		}
		if g.Chance(2) {
			p.Body = append(p.Body, g.Stmt(body))
			if ends(p.Body) {
				break
			}
		}
		var yield Stmt = &Yield{Value: g.Num(body)}
		if g.Chance(4) {
			yield = &If{Cond: g.Cond(body), Then: []Stmt{yield}}
		}
		if g.Chance(4) {
			g.UseEffect()
			p.Body = append(p.Body, sleepMs(1+g.Intn(3)))
		}
		p.Body = append(p.Body, yield)
	}
	g.declareProducer(p)
	call := &Call{Name: p.Name}
	for range p.Params {
		call.Args = append(call.Args, g.Num(s))
	}
	return call
}

// declareProducer adds a producer to the module, after any its body
// declared, and records the modules its reference names.
func (g *Gen) declareProducer(p *Producer) {
	g.Use("vip21.producer")
	g.UseModule("Stream", false)
	g.UseModule("Queue", false)
	g.AddDecl(p)
}

// A Producer is `effect function* p0(p1: number) { … }`, read as `const p0
// = (p1) => Stream.callback((queue) => Effect.gen(function* () { …
// }).pipe(Effect.andThen(Queue.end(queue))), { bufferSize: 1, strategy:
// "suspend" })`.
type Producer struct {
	Name   string
	Params []string
	Body   []Stmt
}

func (p *Producer) Vibe(w *Writer) {
	params := make([]string, len(p.Params))
	for i, name := range p.Params {
		params[i] = name + ": number"
	}
	w.Write("effect function* " + p.Name + "(" + strings.Join(params, ", ") + ") ")
	w.Block(p.Body)
}

func (p *Producer) Effect(w *Writer) {
	w.Write("const " + p.Name + " = (" + strings.Join(p.Params, ", ") + ") => Stream.callback((queue) => Effect.gen(function* () ")
	w.Block(p.Body)
	w.Write(`).pipe(Effect.andThen(Queue.end(queue))), { bufferSize: 1, strategy: "suspend" })`)
}

// A Yield is `yield x` in a producer, read as `yield* Queue.offer(queue, x)`.
type Yield struct{ Value Expr }

func (y *Yield) Vibe(w *Writer) {
	w.Write("yield ")
	w.Node(y.Value)
}

func (y *Yield) Effect(w *Writer) {
	w.Write("yield* Queue.offer(queue, ")
	w.Node(y.Value)
	w.Write(")")
}

func (y *Yield) Ends() bool { return false }
