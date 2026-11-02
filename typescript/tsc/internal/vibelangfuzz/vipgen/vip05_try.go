package vipgen

import "strings"

// VIP-5: "`try e` runs the Effect `e` inside an `effect` function or block
// and gives its success value. A failure propagates to the enclosing
// Effect". Inside Effect.gen that is yield*, which VIP-5 names as prior art.

func init() {
	Register(&Construct{
		Key:      "vip05.try",
		VIP:      5,
		Requires: []string{"vip01.effect-function"},
		Citations: []Citation{{
			VIP:      5,
			Template: "yield* ‹e›",
			Quote:    "`try e` runs the Effect `e` inside an `effect` function or block and gives its success value. A failure propagates to the enclosing Effect",
			Reading:  "VIP-5 shows no Effect TS; it names Effect's `yield*` as prior art, and yield* inside Effect.gen runs an Effect, gives its success value and propagates its failure.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			v := g.Name("v")
			g.UseEffect()
			first := &Event{Label: g.Label()}
			run := &Const{Name: v, Value: &Try{X: &EffectCall{Fn: "sync", Arg: &Thunk{Label: g.Label(), Value: &Num{Value: 1}}}}}
			s.Locals = append(s.Locals, v)
			// The rest of main follows, and a minimal program returns v.
			return []Stmt{first, run, &Event{Label: g.Label()}}
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			switch g.Intn(3) {
			case 1:
				v := g.Name("v")
				st := &Const{Name: v, Value: &Try{X: g.Operand(s, true)}}
				s.Locals = append(s.Locals, v)
				return st
			case 2:
				if !s.Fn.Void {
					return &Return{Value: &Try{X: g.Operand(s, true)}}
				}
			}
			return tryOperationStatement(s, g.Operand(s, false))
		},
	})
}

// tryOperationStatement preserves the numeric helper contract even when a
// failure or defect cannot return at runtime. A bare terminal yield has void
// return type in Effect.gen; returning the never-valued yield does not.
func tryOperationStatement(s *Scope, x Expr) Stmt {
	call, ok := x.(*EffectCall)
	fatal := ok && (call.Fn == "fail" || call.Fn == "die")
	if fatal && !s.Fn.Void {
		return &Return{Value: &Try{X: x}}
	}
	return &ExprStmt{X: &Try{X: x}, EndsBlock: fatal}
}

func init() {
	Register(&Construct{
		Key: "vip05.try-fatal-result", VIP: 5,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{{
			VIP: 5, Template: "yield* ‹e›",
			Quote:   "`try e` runs the Effect `e` inside an `effect` function or block and gives its success value. A failure propagates to the enclosing Effect",
			Reading: "A generated numeric helper returns that success value. A terminal fail or die is never-valued; returning its yield preserves the numeric operand contract, while a bare terminal yield infers void in TypeScript. This tests generator validity without changing the Exit oracle.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			fn := "fail"
			if g.Intn(2) != 0 {
				fn = "die"
			}
			h := &Func{Name: g.Name("fatal")}
			h.Body = []Stmt{&Event{Label: g.Label()}, tryOperationStatement(&Scope{Fn: h}, &EffectCall{Fn: fn, Arg: &Num{Value: 1}})}
			v := g.Name("value")
			s.Locals = append(s.Locals, v)
			return []Stmt{&LocalFunc{Func: h}, &Const{Name: v, Type: "number", Value: &Try{X: &Call{Name: h.Name}}}}
		},
	})
}

// A Try is `try e`, read as `yield* e`.
type Try struct{ X Expr }

func (t *Try) Vibe(w *Writer) {
	w.Write("try ")
	w.Node(t.X)
}

func (t *Try) Effect(w *Writer) {
	w.Write("yield* ")
	w.Node(t.X)
}

// No Effect function is needed for Promise semantics: this is a plain-main
// pair, and both prints use the same ordinary JavaScript async forms.
func init() {
	Register(&Construct{
		Key: "vip05.async-forms-plain", VIP: 5, Plain: true,
		Citations: []Citation{
			{VIP: 5, Template: "await Promise.resolve(‹p›)", Quote: "`await` keeps exactly JavaScript's meaning",
				Reading: "VIP-5 preserves Promise await. The pair awaits already fulfilled Promises in order, without racing them."},
			{VIP: 1, Template: "async function ‹f›(‹p› = ‹default›)", Quote: "`async` marks a Promise function",
				Reading: "VIP-1 keeps TypeScript async declarations, expressions, arrows and methods; defaults, hoisting and receivers keep JavaScript's meaning."},
		},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			name := g.Name("Async")
			code := strings.ReplaceAll(asyncFormsSource, "NAME", name)
			g.AddDecl(&Code{V: code, E: code})
			return []Stmt{&Event{Label: g.Label()}, &AsyncFormsReturn{Name: name + "Run"}}
		},
	})
}

const asyncFormsSource = `
async function NAMEDecl(p = (ev("default"), 1)) {
 ev("declaration")
 return await Promise.resolve(p)
}
const NAMEExpr = async function(p = 2) {
 ev("expression")
 return await Promise.resolve(p)
}
const NAMEArrow = async (p = 3) => {
 ev("arrow")
 return await Promise.resolve(p)
}
const NAMEObject = {
 n: 4,
 async m(p = 1) {
  ev("object")
  const a = async (q = 0) => this.n + p + q
  return await a()
 }
}
class NAMEClass {
 n = 5
 async m(p = 1) { ev("class"); return await Promise.resolve(this.n + p) }
 static async m(p = 6) { ev("static"); return await Promise.resolve(p) }
}
async function NAMEReject() { throw "rejected" }
async function NAMERun() {
 const h = await hoisted()
 async function hoisted() { return 1 }
 try { await NAMEReject() } catch (e) { if (e !== "rejected") return -999; ev("rejection") }
 return h + (await NAMEDecl()) + (await NAMEExpr()) + (await NAMEArrow()) +
  (await NAMEObject.m()) + (await new NAMEClass().m()) + (await NAMEClass.m())
}
`

type AsyncFormsReturn struct{ Name string }

func (a *AsyncFormsReturn) Ends() bool { return true }
func (a *AsyncFormsReturn) Vibe(w *Writer) {
	w.Write("return Effect.all([Effect.promise(() => " + a.Name + "()), Effect.exit(Effect.promise(() => " + strings.TrimSuffix(a.Name, "Run") + "Reject()))])")
}
func (a *AsyncFormsReturn) Effect(w *Writer) { a.Vibe(w) }

func init() {
	Register(&Construct{
		Key: "vip05.try-composition", VIP: 5,
		Requires: []string{"vip01.effect-function"},
		Citations: []Citation{{VIP: 5, Template: "yield* ‹e›", Quote: "`try e` runs the Effect `e` inside an `effect` function or block and gives its success value.",
			Reading: "The reference uses the VIP's Effect operation, preserving the enclosing JavaScript evaluation order and completion."}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()

			return []Stmt{&catchEdge{vibe: "const obj = { run: () => Effect.succeed(3) }; const a = try\n obj.run() + 4; return a", ref: "const obj = { run: () => Effect.succeed(3) }; const a = (yield* obj.run()) + 4; return a"}}
		},
	})
}
