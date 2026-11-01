package vipgen

import (
	"fmt"
	"strconv"
)

// Chapter 000-intro: "**TypeScript's meaning outside Effect code.** Plain
// functions, `async` functions, `await`, `throw`, `using`, classes, `do`
// expressions and the pipe operator keep their TypeScript or pinned TC39
// meaning." effectscript-75 / RC-23 applies this to IteratorClose: an incoming
// throw wins by identity, including when nested iterator closers also throw.
// Each print records that identity with === against the original singletons;
// FuzzVIPDifferential compares it and the complete ordered trace with stock tsc.
func init() {
	Register(&Construct{
		Key: "vip31.for-of-close-plain", VIP: 31, Plain: true,
		Citations: []Citation{{
			VIP: 31, Template: "for (const ‹x› of ‹items›)",
			Quote:   "Compiled output gives the same `Exit` as the Effect TypeScript shown in each VIP",
			Reading: "Chapter 000-intro preserves TypeScript's meaning outside Effect code (effectscript-75, RC-23). Stock tsc emits the native twin; each twin catches locally and records the thrown value's identity and iterator events for the existing Exit comparator.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt { return []Stmt{forOfClose(g, s)} },
		Stmt:  forOfClose,
	})
}

func forOfClose(g *Gen, s *Scope) Stmt {
	name, makeName, boomName := g.Name("closeProbe"), g.Name("makeIterator"), g.Name("boom")
	// Keep helpers in ordinary TypeScript: their throws must stay JavaScript
	// exceptions, including when the surrounding generated program is plain.
	g.AddFile(makeName+".ts", fmt.Sprintf(`export function %s(error: unknown): never { throw error }
export function %s(events: string[], label: string, fail: unknown, close: number): Iterable<number> {
  events.push(label + ":open")
  return { [Symbol.iterator]() {
    let i = 0
    return {
      next() { events.push(label + ":next:" + i); return i < 2 ? { done: false, value: i++ } : { done: true, value: 0 } },
      get return() {
        events.push(label + ":return")
        if (close === 2) throw fail
        return () => { events.push(label + ":close"); if (close === 0) throw fail; return close === 3 ? 1 as any : { done: true, value: 0 } }
      }
    }
  } }
}
`, boomName, makeName), makeName, boomName)
	depth := 1 + g.Intn(3)
	var loops func(int) string
	loops = func(level int) string {
		item, label, alias := g.Name("item"), g.Name("outer"), g.Name("inner")
		close, before, after := g.Intn(4), g.Intn(3), g.Intn(3)
		jump := g.Intn(4)
		body := fmt.Sprintf("events.push(%q); if (%s === %d) %s(errors[0]);", fmt.Sprintf("body:%d", level), item, before, boomName)
		if level < depth {
			body += loops(level + 1)
		}
		body += fmt.Sprintf("if (%s === %d) %s(errors[0]);", item, after, boomName)
		switch jump {
		case 0:
			body += "break " + label + ";"
		case 1:
			body += "continue " + alias + ";"
		case 2:
			body += "return 7;"
		}
		return fmt.Sprintf("%s: %s: for (const %s of %s(events, %q, errors[%d], %d)) { %s }",
			label, alias, item, makeName, fmt.Sprintf("loop:%d", level), level, close, body)
	}
	loop := loops(1)
	// Throw undefined as well as object singletons: a truthiness or sentinel
	// check must not silently turn a pending undefined throw into success.
	values := "[{}, {}, {}, {}]"
	if g.Intn(2) != 0 {
		values = "[undefined, null, false, 0]"
	}
	source := fmt.Sprintf(`function %s(): string {
  const events: string[] = []
  const errors: unknown[] = %s
  function run(): number { %s; return -1 }
  let identity = -1, threw = false, result = -1
  try { result = run() } catch (e) { threw = true; identity = errors.findIndex(value => value === e) }
  return JSON.stringify([threw, identity, result, events])
}`, name, values, loop)
	ts := g.Name("stock")
	reference := fmt.Sprintf(`const %s = (await import("node:module")).createRequire(import.meta.resolve("effect"))("typescript");
const %s = new Function(%q, %q, "return " + %s.transpileModule(%s, { compilerOptions: { target: %s.ScriptTarget.ES2022, module: %s.ModuleKind.ESNext } }).outputText)(%s, %s);`,
		ts, name, makeName, boomName, ts, strconv.Quote(source), ts, ts, makeName, boomName)
	// Observe the caught result at module initialization. Passing a possibly
	// throwing helper call through the generated main's inferred Effect
	// return would additionally test implicit function-kind inference. Only
	// the probe's local trace runs here; the shared event is logged by main.
	observed := g.Name("observed")
	bind := "\nconst " + observed + " = " + name + "()"
	g.AddDecl(&Code{V: source + bind, E: reference + bind})
	return &forOfCloseObservation{Observed: observed}
}

// Report the plain probe through the Effect the existing worker runs. This
// keeps both call-time traces empty without exercising the separately pending
// implicit function-kind inference of an unannotated main.
type forOfCloseObservation struct{ Observed string }

func (o *forOfCloseObservation) Vibe(w *Writer)   { o.print(w) }
func (o *forOfCloseObservation) Effect(w *Writer) { o.print(w) }
func (o *forOfCloseObservation) Ends() bool       { return true }
func (o *forOfCloseObservation) print(w *Writer) {
	w.Write("return Effect.sync(() => { ev(" + o.Observed + "); return 0 })")
}
