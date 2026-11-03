package vipgen

import "fmt"

// Erased TypeScript wrappers retain member references (chapter 002,
// Evaluation order: call a captured method "with `this` as `o`").
func init() {
	Register(&Construct{
		Key: "vip02.do-wrapped-receiver-plain", VIP: 2, Plain: true,
		Citations: []Citation{{VIP: 2, Template: "(() => { return ‹value› })()",
			Quote:   "It runs now and gives its last statement's value",
			Reading: "Chapter 002 preserves native callee evaluation, receiver identity and operand order. The reference erases TypeScript-only wrappers and uses an immediate arrow for a no-jump do operand, retaining the native member reference.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt { return []Stmt{wrappedDoReceiver(g, s)} },
		Stmt:  wrappedDoReceiver,
	})
}

func wrappedDoReceiver(g *Gen, s *Scope) Stmt {
	g.UseEffect()
	name := g.Name("wrappedReceiver")
	base, changed, arg := 1+g.Intn(20), 21+g.Intn(20), 1+g.Intn(9)
	member := []string{"obj.m", "obj[\"m\"]"}[g.Intn(2)]
	wrappers := []string{member + "!", "(" + member + " as Fn)", "(" + member + " satisfies Fn)", "(<Fn>" + member + ")", "((" + member + "! as Fn) satisfies Fn)"}
	callee := wrappers[g.Intn(len(wrappers))]
	value := fmt.Sprintf("do { ev(\"argument\"); original.n = %d; obj = { n: 999, get m(): Fn { return () => 999 } }; %d }", changed, arg)
	twin := fmt.Sprintf("(() => { ev(\"argument\"); original.n = %d; obj = { n: 999, get m() { return () => 999 } }; return %d })()", changed, arg)
	for depth := g.Intn(3); depth > 0; depth-- {
		value = "do { (" + value + ") }"
	}
	vibe := fmt.Sprintf(`function %s(): string {
 type Fn = (x: number) => number;
 let obj = { n: %d, get m(): Fn {
   ev("get");
   const fn = function(this: {n: number}, x: number): number { ev("method"); return this.n + x };
   Object.defineProperty(fn, "bind", { get() { ev("wrong-bind"); return () => 999 } });
   return fn;
 }};
 const original = obj;
 try { const value = %s(%s); return String(value) }
 catch(e) { return e instanceof Error ? e.name : String(e) }
}`, name, base, callee, value)
	ref := fmt.Sprintf(`function %s() {
 let obj = { n: %d, get m() {
   ev("get");
   const fn = function(x) { ev("method"); return this.n + x };
   Object.defineProperty(fn, "bind", { get() { ev("wrong-bind"); return () => 999 } });
   return fn;
 }};
 const original = obj;
 try { const value = %s(%s); return String(value) }
 catch(e) { return e instanceof Error ? e.name : String(e) }
}`, name, base, member, twin)
	g.AddDecl(&Code{V: vibe, E: ref})
	return &wrappedDoReceiverCall{Name: name}
}

type wrappedDoReceiverCall struct{ Name string }

func (c *wrappedDoReceiverCall) Vibe(w *Writer)   { c.print(w) }
func (c *wrappedDoReceiverCall) Effect(w *Writer) { c.print(w) }
func (c *wrappedDoReceiverCall) Ends() bool       { return true }
func (c *wrappedDoReceiverCall) print(w *Writer) {
	w.Write(fmt.Sprintf("return Effect.suspend(() => { ev(\"wrapped-receiver:\"+%s()); return Effect.succeed(0) })", c.Name))
}
