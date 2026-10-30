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
// runs on the fiber Stream.callback starts and may run up to two elements ahead of
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
				Quote:    "It compiles to Effect's `Stream.callback` with one element of buffer, so the producer may run up to two elements ahead of the consumer: one in the buffer and one waiting to be offered.",
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

func init() {
	Register(&Construct{
		Key: "vip21.yield-value", VIP: 21,
		Requires: []string{"vip01.effect-function", "vip05.try", "vip21.producer"},
		Citations: []Citation{{VIP: 21, Template: "Stream.callback((queue) => Effect.gen(function* () { ‹body› }).pipe(Effect.andThen(Queue.end(queue))), { bufferSize: 1, strategy: \"suspend\" })",
			Quote:   "A bare `return` ends the stream.",
			Reading: "Chapter 2 specifies yield as (yield* Queue.offer(queue, x), undefined); bare return still executes the Queue.end chained after the producer body."}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			g.UseModule("Stream", true)
			g.UseModule("Queue", false)
			return []Stmt{&catchEdge{
				vibe: "effect function* p() { const a = yield 1; ev(a === undefined ? \"undefined\" : \"wrong\"); yield 2; return; yield 99 }; const xs = try Stream.runCollect(p()); return xs",
				ref:  "const p = () => Stream.callback((queue) => Effect.gen(function* () { const a = (yield* Queue.offer(queue, 1), undefined); ev(a === undefined ? \"undefined\" : \"wrong\"); yield* Queue.offer(queue, 2); return; yield* Queue.offer(queue, 99) }).pipe(Effect.andThen(Queue.end(queue))), { bufferSize: 1, strategy: \"suspend\" }); const xs = yield* Stream.runCollect(p()); return xs",
			}}
		},
	})
}

func init() {
	Register(&Construct{
		Key: "vip21.two-ahead", VIP: 21,
		Requires: []string{"vip01.effect-function", "vip05.try", "vip21.producer", "vip20.for-try"},
		Citations: []Citation{{VIP: 21, Template: "Stream.callback((queue) => Effect.gen(function* () { ‹body› }).pipe(Effect.andThen(Queue.end(queue))), { bufferSize: 1, strategy: \"suspend\" })",
			Quote:   "the producer may run up to two elements ahead of the consumer: one in the buffer and one waiting to be offered.",
			Reading: "Four offers and a consumer that sleeps at its first element expose buffered and suspended offers in the event log; break cancels the producer rather than undoing events already logged."}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			g.UseModule("Stream", true)
			g.UseModule("Queue", false)
			return []Stmt{&catchEdge{
				vibe: "effect function* p() { for (const n of [1, 2, 3, 4]) { ev(\"offer\" + n); yield n; ev(\"offered\" + n) } }; for try (const x of p()) { ev(\"take\" + x); try Effect.sleep(2); break }; return 1",
				ref:  "const p = () => Stream.callback((queue) => Effect.gen(function* () { for (const n of [1, 2, 3, 4]) { ev(\"offer\" + n); yield* Queue.offer(queue, n); ev(\"offered\" + n) } }).pipe(Effect.andThen(Queue.end(queue))), { bufferSize: 1, strategy: \"suspend\" }); yield* Stream.runForEachWhile(p(), (x) => Effect.gen(function* () { ev(\"take\" + x); yield* Effect.sleep(2); return false })); return 1",
			}}
		},
	})
}

func init() {
	Register(&Construct{
		Key: "vip21.failure", VIP: 21,
		Requires: []string{"vip01.effect-function", "vip05.try", "vip21.producer"},
		Citations: []Citation{{VIP: 21, Template: "Effect.‹operation›(‹args›)", Quote: "`effect function*` returns a Stream, as `async function*` returns an AsyncIterable.",
			Reading: "The reference uses the VIP's Effect operation, preserving the enclosing JavaScript evaluation order and completion."}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			g.UseModule("Stream", true)
			g.UseModule("Queue", true)
			return []Stmt{&catchEdge{vibe: "effect function* p() { yield 1; try Effect.fail(7); yield 99 }; return try Stream.runCollect(p())", ref: "const p = () => Stream.callback((queue) => Effect.gen(function* () { yield* Queue.offer(queue, 1); yield* Effect.fail(7); yield* Queue.offer(queue, 99) }).pipe(Effect.andThen(Queue.end(queue))), { bufferSize: 1, strategy: \"suspend\" }); return yield* Stream.runCollect(p())"}}
		},
	})
}

func init() {
	Register(&Construct{
		Key: "vip21.method", VIP: 21,
		Requires: []string{"vip01.effect-function", "vip05.try", "vip21.producer"},
		Citations: []Citation{{VIP: 21, Template: "Stream.callback(‹args›)",
			Quote:   "The shorthand `effect *name()` exists only for methods, as `async *gen()` does in TypeScript.",
			Reading: "A generic static producer method has the same Stream.callback body as VIP-21's function; ordinary member modifiers and type parameters erase."}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			g.UseModule("Stream", true)
			g.UseModule("Queue", false)
			return []Stmt{&catchEdge{
				vibe: "class C { public static effect *values<T>(value: T): Stream.Stream<T> { yield value; return } }; return try Stream.runCollect(C.values<number>(7))",
				ref:  "class C { static values(value) { return Stream.callback((queue) => Effect.gen(function* () { yield* Queue.offer(queue, value); return }).pipe(Effect.andThen(Queue.end(queue))), { bufferSize: 1, strategy: \"suspend\" }) } }; return yield* Stream.runCollect(C.values(7))",
			}}
		},
	})
}

func init() {
	Register(&Construct{
		Key: "vip21.member-modifiers", VIP: 21,
		Requires: []string{"vip01.effect-function", "vip05.try", "vip21.producer"},
		Citations: []Citation{{VIP: 21, Template: "Stream.callback(‹args›)",
			Quote:   "The shorthand `effect *name()` exists only for methods, as `async *gen()` does in TypeScript.",
			Reading: "Each method keeps TypeScript's access and override rules; its producer body is the same Stream.callback as the VIP's function."}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			g.UseModule("Stream", true)
			g.UseModule("Queue", false)
			return []Stmt{&catchEdge{
				vibe: "class Base { protected effect *values<T>(v: T) { yield v } }; class C extends Base { protected override effect *values<T>(v: T) { yield v }; private effect *hidden() { yield 2 }; run() { return Stream.concat(this.values(1), this.hidden()) } }; return try Stream.runCollect(new C().run())",
				ref:  "class Base { values(v) { return Stream.callback(q => Effect.gen(function* () { yield* Queue.offer(q, v) }).pipe(Effect.andThen(Queue.end(q))), { bufferSize: 1, strategy: \"suspend\" }) } }; class C extends Base { values(v) { return Stream.callback(q => Effect.gen(function* () { yield* Queue.offer(q, v) }).pipe(Effect.andThen(Queue.end(q))), { bufferSize: 1, strategy: \"suspend\" }) }; hidden() { return Stream.callback(q => Effect.gen(function* () { yield* Queue.offer(q, 2) }).pipe(Effect.andThen(Queue.end(q))), { bufferSize: 1, strategy: \"suspend\" }) }; run() { return Stream.concat(this.values(1), this.hidden()) } }; return yield* Stream.runCollect(new C().run())",
			}}
		},
	})
}

func init() {
	Register(&Construct{
		Key: "vip21.lexical-receiver", VIP: 21,
		Requires: []string{"vip01.effect-function", "vip05.try", "vip21.producer"},
		Citations: []Citation{{VIP: 21, Template: "Stream.callback(‹args›)", Quote: "`effect function*` returns a Stream, as `async function*` returns an AsyncIterable.",
			Reading: "The reference uses the VIP's Effect operation and chapter 2's enclosing-statement, lexical-capture and JavaScript evaluation-order rules; no operand is read again after a later operand runs."}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			g.UseModule("Stream", true)
			g.UseModule("Queue", false)
			return []Stmt{&catchEdge{vibe: "class Base { value() { return 2 } }; class C extends Base { n = 5; effect *values() { ev(\"yield\" + this.n); yield this.n; try Effect.sleep(1); yield super.value() } }; const c = new C(); const stream = c.values(); ev(\"created\"); c.n = 7; const first = try Stream.runCollect(stream); c.n = 9; const second = try Stream.runCollect(stream); return [first, second]", ref: "class Base { value() { return 2 } }; class C extends Base { n = 5; values() { const self = this; const parentValue = () => super.value(); return Stream.callback(q => Effect.gen(function* () { ev(\"yield\" + self.n); yield* Queue.offer(q, self.n); yield* Effect.sleep(1); yield* Queue.offer(q, parentValue()) }).pipe(Effect.andThen(Queue.end(q))), { bufferSize: 1, strategy: \"suspend\" }) } }; const c = new C(); const stream = c.values(); ev(\"created\"); c.n = 7; const first = yield* Stream.runCollect(stream); c.n = 9; const second = yield* Stream.runCollect(stream); return [first, second]"}}
		},
	})
}
