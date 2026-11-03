package vipgen

import "fmt"

// RC-43: JavaScript logical assignment reads its reference once and returns
// either that read or the RHS, even when a setter stores a different value.
func init() {
	Register(&Construct{
		Key: "vip02.do-logical-global-accessor-plain", VIP: 2, Plain: true,
		Citations: []Citation{{
			VIP: 2, Template: "‹global accessor› ||= (() => { return ‹value› })()",
			Quote:   "A `do` or `match` inside a larger expression runs where JavaScript evaluates that expression, and how the compiler keeps that is its choice.",
			Reading: "Native logical assignments retain GetValue, short-circuiting and PutValue, including their abrupt completions. Only no-jump do blocks become arrow IIFEs in the independent native twin. The existing comparator observes the result, stored value and getter/RHS/setter events.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt { return []Stmt{doLogicalGlobalAccessor(g, s)} },
		Stmt:  doLogicalGlobalAccessor,
	})
}

func doLogicalGlobalAccessor(g *Gen, s *Scope) Stmt {
	g.AddFile("logical-accessor.ts", logicalAccessorFixture, "observeLogical", "logicalAbrupt")
	target, name, observed := g.Name("logicalGlobal"), g.Name("logicalProbe"), g.Name("logicalObserved")
	operator := []string{"||=", "&&=", "??="}[g.Intn(3)]
	initial := []string{"0", "2", "null", "undefined", "false", "\"\"", "\"yes\""}[g.Intn(7)]
	failure, step, depth, value := g.Intn(4), g.Intn(2), g.Intn(4), 1+g.Intn(20)
	expr := func(native bool) string {
		body := fmt.Sprintf("events.push(\"rhs\"); logicalAbrupt(%t); ", failure == 2)
		v := fmt.Sprint(value)
		for i := 0; i <= depth; i++ {
			if native {
				v = "(() => { " + body + "return " + v + "; })()"
			} else {
				v = "(do { " + body + v + " })"
			}
			body = ""
		}
		return v
	}
	source := func(native bool) string {
		declaration, annotation := "declare let "+target+": any; ", ": unknown"
		if native {
			declaration, annotation = "", ""
		}
		return fmt.Sprintf("%sfunction %s()%s { return observeLogical(%q, %s, %d, %d, (events) => { return %s %s %s; }) }; const %s = %s();",
			declaration, name, annotation, target, initial, step, failure, target, operator, expr(native), observed, name)
	}
	g.AddDecl(&Code{V: source(false), E: source(true)})
	return &doLogicalAccessorEvent{Observed: observed}
}

type doLogicalAccessorEvent struct{ Observed string }

func (o *doLogicalAccessorEvent) Vibe(w *Writer)   { o.print(w) }
func (o *doLogicalAccessorEvent) Effect(w *Writer) { o.print(w) }
func (o *doLogicalAccessorEvent) Ends() bool       { return false }
func (o *doLogicalAccessorEvent) print(w *Writer) {
	w.Write("ev(\"logical-accessor:\" + JSON.stringify(" + o.Observed + "))")
}

const logicalAccessorFixture = `/** Native fixture intentionally hides throws from the Vibe checker.
 * @throws {never}
 */
export function logicalAbrupt(fail: boolean): void { if (fail) throw new Error("rhs") }
/** @throws {never} */
export function observeLogical(key: string, initial: any, step: number, failure: number, run: (events: string[]) => any) {
  const events: string[] = []
  let state = initial, result: any = "abrupt", error: string | null = null
  Object.defineProperty(globalThis, key, {
    configurable: true,
    get() {
      events.push("get:" + String(state))
      if (failure === 1) throw new Error("get")
      const old = state
      if (step) state = Number(state) + step
      return old
    },
    set(value: any) {
      events.push("set:" + String(value))
      if (failure === 3) throw new Error("set")
      state = value + 100
    }
  })
  try { result = run(events) }
  catch (e) { error = e instanceof Error ? e.message : String(e) }
  finally { delete (globalThis as any)[key] }
  return {result, state, events, error}
}
`
