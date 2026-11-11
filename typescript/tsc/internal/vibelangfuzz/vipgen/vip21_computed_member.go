package vipgen

import "fmt"

// Producer keys and decorators execute at definition; only the body belongs
// to the Stream. Compare their events and repeated consumption with VIP-21's
// native Stream.callback counterpart.
func init() {
	Register(&Construct{
		Key: "vip21.computed-member", VIP: 21,
		Requires: []string{"vip01.effect-function", "vip05.try", "vip21.producer", "vip23.pipe"},
		Citations: []Citation{
			{VIP: 21, Template: "Stream.callback(‹args›)",
				Quote:   "The shorthand `effect *name()` exists only for methods, as `async *gen()` does in TypeScript.",
				Reading: "Computed names and identity decorators keep ordinary member definition order; only the method body becomes the VIP's Stream.callback."},
			classMemberKeyCitation,
			classDecoratorCitation,
		},
		Focus: func(g *Gen, s *Scope) []Stmt { return []Stmt{producerComputedMember(g)} },
		Stmt:  func(g *Gen, s *Scope) Stmt { return producerComputedMember(g) },
	})
}

func producerComputedMember(g *Gen) *Code {
	g.UseEffect()
	g.UseModule("Stream", true)
	g.UseModule("Queue", false)
	keyEvent, decoratorEvent, bodyEvent := g.Label(), g.Label(), g.Label()
	keyRef := fmt.Sprintf("(ev(%q), \"values\")", keyEvent)
	key := ""
	switch g.Intn(5) {
	case 0:
		key = fmt.Sprintf("\"values\" |> (ev(%q), %%)", keyEvent)
	case 1:
		key = fmt.Sprintf("match (\"values\") { when \"values\": (ev(%q), \"values\"); default: \"unused\"; }", keyEvent)
	case 2:
		key = fmt.Sprintf("(\"values\" is String) ? (ev(%q), \"values\") : \"unused\"", keyEvent)
	case 3:
		key = fmt.Sprintf("do { ev(%q); \"values\"; }", keyEvent)
	default:
		key = fmt.Sprintf("try Effect.sync(() => { ev(%q); return \"values\" as const })", keyEvent)
		keyRef = fmt.Sprintf("yield* Effect.sync(() => { ev(%q); return \"values\" })", keyEvent)
	}
	shape := g.Intn(4) // object, class, static class, decorated class
	object, class := g.Name("object"), g.Name("Class")
	value := g.Intn(20)
	method := fmt.Sprintf("effect *[(%s) as \"values\"]() { ev(%q); yield this.value }", key, bodyEvent)
	nativeMethod := fmt.Sprintf("[%s]() { const self = this; return Stream.callback(q => Effect.gen(function*() { ev(%q); yield* Queue.offer(q, self.value) }).pipe(Effect.andThen(Queue.end(q))), { bufferSize: 1, strategy: \"suspend\" }) }", keyRef, bodyEvent)
	vibe := fmt.Sprintf("const %s = { value: %d, %s };", object, value, method)
	ref := fmt.Sprintf("const %s = { value: %d, %s };", object, value, nativeMethod)
	if shape != 0 {
		static, receiver, decorator := "", "new "+class+"()", ""
		if shape == 2 {
			static, receiver = "static ", class
		}
		if shape == 3 {
			// Identity application has no effect; evaluating its expression
			// precedes the key on both sides.
			decorator = fmt.Sprintf("@(do { ev(%q); <V>(value: V, _context: unknown): V => value; } |> %%) ", decoratorEvent)
			keyRef = fmt.Sprintf("(ev(%q), %s)", decoratorEvent, keyRef)
			nativeMethod = fmt.Sprintf("[%s]() { const self = this; return Stream.callback(q => Effect.gen(function*() { ev(%q); yield* Queue.offer(q, self.value) }).pipe(Effect.andThen(Queue.end(q))), { bufferSize: 1, strategy: \"suspend\" }) }", keyRef, bodyEvent)
		}
		vibe = fmt.Sprintf("class %s { %svalue = %d; %s%s%s }; const %s = %s as unknown as { value: number; values(): Stream.Stream<number> };", class, static, value, decorator, static, method, object, receiver)
		ref = fmt.Sprintf("class %s { %svalue = %d; %s%s }; const %s = %s;", class, static, value, static, nativeMethod, object, receiver)
	}
	stream, first, second := g.Name("stream"), g.Name("first"), g.Name("second")
	tail := func(run string) string {
		return fmt.Sprintf("const %s = %s.values(); ev(\"created\"); %s.value += 1; const %s = %s Stream.runCollect(%s); %s.value += 1; const %s = %s Stream.runCollect(%s); ev(\"first\" + %s[0]); ev(\"second\" + %s[0]);", stream, object, object, first, run, stream, object, second, run, stream, first, second)
	}
	return &Code{V: vibe + tail("try"), E: ref + tail("yield*")}
}
