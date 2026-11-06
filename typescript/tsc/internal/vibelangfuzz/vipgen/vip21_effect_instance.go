package vipgen

import (
	"strconv"
	"strings"
)

func init() {
	Register(&Construct{
		Key: "vip21.project-effect-instance", VIP: 21,
		Requires:  []string{"vip01.effect-function", "vip02.effect-block", "vip05.try", "vip21.producer"},
		Citations: []Citation{{VIP: 21, Template: "Stream.callback(‹args›)", Quote: "It compiles to Effect's `Stream.callback` with one element of buffer."}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			var out []Stmt
			for mode := range 4 {
				out = append(out, producerProjectInstance(g, mode))
			}
			return out
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			if s.Depth >= maxDepth {
				return nil
			}
			return producerProjectInstance(g, g.Intn(4))
		},
	})
}

func producerProjectInstance(g *Gen, mode int) Stmt {
	g.UseEffect()
	g.UseModule("Fiber", true)
	g.UseModule("Stream", true)
	g.UseModule("Queue", false)
	body := `const Effect = { forkChild: 0 }; void Effect; for (let item=0;item<$COUNT$;item++) yield (try $P$owns(owner,item)) && $MARKER$`
	refBody := `function $P$make(owner, marker=()=>true) { return Stream.callback(queue => $P$ns.gen(function* () { for(let item=0;item<$COUNT$;item++) yield* Queue.offer(queue,(yield* $P$owns(owner,item))&&marker()) }).pipe($P$ns.andThen(Queue.end(queue))),{bufferSize:1,strategy:"suspend"}) }`
	declaration, reference, stream, mutate := "", "", "$P$factory($P$owner)", ""
	switch mode {
	case 0:
		declaration = "effect function* $P$factory(owner:number) { " + strings.ReplaceAll(body, "$MARKER$", "true") + " }"
		reference = "function $P$factory(owner) { return $P$make(owner) }"
	case 1:
		declaration = "const $P$factory = effect function* (owner:number) { " + strings.ReplaceAll(body, "$MARKER$", "true") + " };"
		reference = "const $P$factory = function(owner) { return $P$make(owner) };"
	case 2:
		declaration = "const $P$box = { marker:false, effect *probeItems(owner:number) { " + strings.ReplaceAll(body, "$MARKER$", "this.marker") + " } };"
		reference = "const $P$box = { marker:false, probeItems(owner) { return $P$make(owner,()=>this.marker) } };"
		stream = "$P$box.probeItems($P$owner)"
		mutate = "$P$box.marker=true;"
	case 3:
		declaration = "class $P$Box { marker=false; effect *probeItems(owner:number) { " + strings.ReplaceAll(body, "$MARKER$", "this.marker") + " } } const $P$box = new $P$Box();"
		reference = "class $P$Box { marker=false; probeItems(owner) { return $P$make(owner,()=>this.marker) } } const $P$box = new $P$Box();"
		stream = "$P$box.probeItems($P$owner)"
		mutate = "$P$box.marker=true;"
	}
	vibe := `{ const $P$ns=Effect;
 effect function $P$owns(owner:number,item:number) { const current=try $P$ns.fiberId; const child=try $P$ns.forkChild($P$ns.succeed(item)); const okay=owner<current&&current<child.id; try Fiber.join(child); return okay; }
 $DECLARATION$
 const $P$anchor=try $P$ns.forkChild(effect { const $P$owner=try $P$ns.fiberId; const stream=$STREAM$; $MUTATE$ return try Stream.runCollect(stream); });
 const values=try Fiber.join($P$anchor); ev($LABEL$+JSON.stringify([values.length,values.every(x=>x)])); }`
	ref := `{ const $P$ns=Effect;
 function $P$owns(owner,item) { return $P$ns.gen(function* () { const current=yield* $P$ns.fiberId; const child=yield* $P$ns.forkChild($P$ns.succeed(item)); const okay=owner<current&&current<child.id; yield* Fiber.join(child); return okay; }); }
 $REFBODY$ $REFERENCE$
 const $P$anchor=yield* $P$ns.forkChild($P$ns.gen(function* () { const $P$owner=yield* $P$ns.fiberId; const stream=$STREAM$; $MUTATE$ return yield* Stream.runCollect(stream); }));
 const values=yield* Fiber.join($P$anchor); ev($LABEL$+JSON.stringify([values.length,values.every(x=>x)])); }`
	replace := strings.NewReplacer("$DECLARATION$", declaration, "$REFBODY$", refBody, "$REFERENCE$", reference, "$STREAM$", stream, "$MUTATE$", mutate)
	vibe, ref = replace.Replace(vibe), replace.Replace(ref)
	replace = strings.NewReplacer("$P$", g.Name("producer"), "$COUNT$", strconv.Itoa(2+g.Intn(3)), "$LABEL$", strconv.Quote(g.Label()+":"))
	return &catchEdge{vibe: replace.Replace(vibe), ref: replace.Replace(ref)}
}
