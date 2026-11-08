package vipgen

import (
	"fmt"
	"strings"
)

func init() {
	for _, shape := range []string{"object", "array", "nested", "assignment", "multiple", "yield-value"} {
		Register(&Construct{
			Key: "vip21.binding-default-yield-" + shape, VIP: 21,
			Requires: []string{"vip01.effect-function", "vip05.try", "vip21.producer"},
			Citations: []Citation{
				{VIP: 2, Template: "Effect.gen(function* () { ‹body› })", Quote: "A default's `try` and `yield` run in the enclosing effect function", Reading: "A native binding pattern evaluates its default at the original property or iterator step. The reference runs that default in Effect.gen and offers each producer value to the same queue."},
				{VIP: 21, Template: "Stream.callback((queue) => Effect.gen(function* () { ‹body› }).pipe(Effect.andThen(Queue.end(queue))), { bufferSize: 1, strategy: \"suspend\" })", Quote: "`yield x` emits `x`, and `try` runs Effects (VIP-5).", Reading: "The reference keeps sequential Queue.offer, bufferSize 1, suspension and Queue.end. Events observe skipped defaults, getter reads, iterator closing and the undefined value of yield."},
			},
			Focus: func(g *Gen, s *Scope) []Stmt { return []Stmt{producerBindingDefaultYield(g, shape)} },
			Stmt:  func(g *Gen, s *Scope) Stmt { return producerBindingDefaultYield(g, shape) },
		})
	}
}

func producerBindingDefaultYield(g *Gen, shape string) Stmt {
	g.UseEffect()
	g.UseModule("Stream", true)
	g.UseModule("Queue", false)
	name := g.Name("bindingProducer")
	emitted, value := 1+g.Intn(20), 1+g.Intn(20)
	present := g.Intn(2) == 1
	vibeDefault := fmt.Sprintf("do { ev(\"default\"); const accepted=yield %d; if(accepted!==undefined)ev(\"wrong\"); %d }", emitted, value)
	refDefault := fmt.Sprintf("(yield* Effect.gen(function*(){ev(\"default\");const accepted=(yield* Queue.offer(queue,%d),undefined);if(accepted!==undefined)ev(\"wrong\");return %d}))", emitted, value)
	var pattern string
	switch shape {
	case "object":
		pattern = fmt.Sprintf("const input:{readonly n?:number}={get n(){ev(\"get\");return %t?3:undefined}};const{n=@default@}=input;", present)
	case "array":
		pattern = fmt.Sprintf("function* input(){try{ev(\"open\");yield %t?3:undefined;ev(\"next\");yield 4}finally{ev(\"close\")}};const[n=@default@]=input();", present)
	case "nested":
		pattern = fmt.Sprintf("const{box:{n=@default@}}={box:{n:%t?3:undefined}};", present)
	case "assignment":
		pattern = fmt.Sprintf("let n:number|undefined;({n=@default@}={n:%t?3:undefined});", present)
	case "multiple":
		pattern = fmt.Sprintf("const[n=@default@,second=@default@]=[%t?3:undefined] as (number|undefined)[];ev(\"second:\"+second);", present)
	case "yield-value":
		pattern = fmt.Sprintf("const{n=@default@}={n:%t?3:undefined};", present)
	}
	vibeBody := strings.ReplaceAll(pattern, "@default@", vibeDefault) + "ev(\"after\");yield n"
	// The Effect printer writes JavaScript, so source-only annotations
	// stay in the VibeLang print.
	refPattern := strings.NewReplacer(
		"const input:{readonly n?:number}", "const input",
		"let n:number|undefined", "let n",
		" as (number|undefined)[]", "",
	).Replace(pattern)
	refBody := strings.ReplaceAll(refPattern, "@default@", refDefault) + "ev(\"after\");yield* Queue.offer(queue,n)"
	return &producerBindingYieldEvent{
		vibe: "effect function* " + name + "(){" + vibeBody + "};const collected=try Stream.runCollect(" + name + "());ev(\"producer-binding:\"+JSON.stringify(collected))",
		ref:  "const " + name + "=()=>Stream.callback((queue)=>Effect.gen(function*(){" + refBody + "}).pipe(Effect.andThen(Queue.end(queue))),{bufferSize:1,strategy:\"suspend\"});const collected=yield* Stream.runCollect(" + name + "());ev(\"producer-binding:\"+JSON.stringify(collected))",
	}
}

// Each statement observes its collection without returning from the source
// function, so it also composes in void helpers and no-return regions.
type producerBindingYieldEvent struct{ vibe, ref string }

func (e *producerBindingYieldEvent) Vibe(w *Writer)   { w.Write(";{" + e.vibe + "}") }
func (e *producerBindingYieldEvent) Effect(w *Writer) { w.Write(";{" + e.ref + "}") }
func (*producerBindingYieldEvent) Ends() bool         { return false }
