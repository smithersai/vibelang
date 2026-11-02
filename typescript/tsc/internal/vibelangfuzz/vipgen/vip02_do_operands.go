package vipgen

import (
	"fmt"
	"strings"
)

// VIP-2: "A `do` or `match` inside a larger expression runs where
// JavaScript evaluates that expression, and how the compiler keeps that is
// its choice." So everything JavaScript does before the do, in source
// order, is done before the do's statements run: a spread before it is
// iterated, an object spread copies its properties, a computed key is
// converted to a property key, an untagged template converts each earlier
// substitution to a string, and a tag is read with its receiver (RC-25 to
// RC-29). The construct nests array, call and constructor spreads, object
// spreads, computed keys, templates and tagged templates around do
// expressions, with operands from do_operands.ts that log what they do and
// the shared state they see, and may throw. The reference is the same
// expression with each do written as an immediately invoked arrow, which
// JavaScript runs where it stands; its body holds no yield, so the arrow
// changes nothing else.

// doOperandsModule is do_operands.ts. Each operand logs each step with
// box.n, which each do sets, so a step that moves past a do logs another
// value. show renders a result without running user code. Each says
// @throws {never}, so a throw is a defect in both prints, as an unexpected
// exception in effect code is.
const doOperandsModule = `import { ev } from "vip-events"

export const box = { n: 1 }
const sym = Symbol("k")

/** @throws {never} */
export function fail(label: string): never {
  throw new Error(label)
}

/** @throws {never} */
export function it(id: string, n: number, bad: number): Iterable<number> {
  return {
    [Symbol.iterator](): Iterator<number> {
      ev("open:" + id + ":" + box.n)
      let i = 0
      return {
        next(): IteratorResult<number> {
          ev("next:" + id + ":" + i + ":" + box.n)
          if (i === bad) throw new Error("next:" + id)
          if (i < n) {
            i++
            return { value: i * 10 + box.n, done: false }
          }
          return { value: undefined, done: true }
        },
      }
    },
  }
}

/** @throws {never} */
export function src(id: string, bad: boolean): { readonly x: number; y: string } {
  const o = {
    get x(): number {
      ev("get:" + id + ":" + box.n)
      if (bad) throw new Error("get:" + id)
      return box.n
    },
    y: id,
    [sym]: id,
  }
  return o
}

/** @throws {never} */
export function key(id: string, mode: string): string {
  const k = {
    [Symbol.toPrimitive](hint: string): string | symbol {
      ev("key:" + id + ":" + hint + ":" + box.n)
      if (mode === "throw") throw new Error("key:" + id)
      return mode === "symbol" ? sym : "k" + box.n
    },
  }
  return k as unknown as string
}

/** @throws {never} */
export function str(id: string, bad: boolean): string {
  const s = {
    toString(): string {
      ev("str:" + id + ":" + box.n)
      if (bad) throw new Error("str:" + id)
      return "s" + box.n
    },
  }
  return s as unknown as string
}

export type Tag = (this: { name: string }, s: TemplateStringsArray, ...v: unknown[]) => string

/** @throws {never} */
export function tagger(id: string, bad: boolean): { name: string; readonly tag: Tag } {
  return {
    name: id,
    get tag(): Tag {
      ev("tag-get:" + id + ":" + box.n)
      if (bad) throw new Error("tag-get:" + id)
      const saved = box.n
      return function (this: { name: string }, s: TemplateStringsArray, ...v: unknown[]): string {
        ev("tag:" + id + ":" + saved + ":" + this.name)
        return s.raw.join("|") + "<" + v.map(show).join(",") + ">" + saved
      }
    },
  }
}

/** @throws {never} */
export function fn(id: string, ...xs: unknown[]): string {
  ev("call:" + id + ":" + box.n)
  return id + "(" + xs.map(show).join(",") + ")"
}

export class Ctor {
  id: string
  xs: unknown[]
  /** @throws {never} */
  constructor(id: string, ...xs: unknown[]) {
    ev("new:" + id + ":" + box.n)
    this.id = id
    this.xs = xs
  }
}

/** @throws {never} */
export function constructorBox(id: string, bad: boolean): { readonly C: typeof Ctor } {
  return {
    get C(): typeof Ctor {
      ev("ctor-get:" + id + ":" + box.n)
      if (bad) throw new Error("ctor-get:" + id)
      const saved = box.n
      return class extends Ctor {
        constructor(name: string, ...xs: unknown[]) {
          super(name, ...xs)
          this.xs.push(saved)
        }
      }
    },
  }
}

/** @throws {never} */
export function show(v: unknown): string {
  if (v instanceof Ctor) return "new " + v.id + "(" + v.xs.map(show).join(",") + ")"
  if (Array.isArray(v)) {
    const parts: string[] = []
    for (let i = 0; i < v.length; i++) parts.push(i in v ? show(v[i]) : "<hole>")
    return "[" + parts.join(",") + "]"
  }
  if (typeof v === "function") return "fn"
  if (typeof v === "symbol") return "@" + String(v.description)
  if (typeof v === "object" && v !== null) {
    const record = v as Record<PropertyKey, unknown>
    const keys = Reflect.ownKeys(v).map((k) => (typeof k === "symbol" ? "@" + String(k.description) : k) + ":" + show(record[k]))
    return "{" + keys.join(",") + "}"
  }
  return typeof v === "string" ? JSON.stringify(v) : String(v)
}
`

func init() {
	Register(&Construct{
		Key: "vip02.do-operand-finish", VIP: 2,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{{
			VIP: 2, Template: "yield* Effect.succeed(‹n›)",
			Quote:   "A `do` or `match` inside a larger expression runs where JavaScript evaluates that expression, and how the compiler keeps that is its choice.",
			Reading: "The reference writes each do as an immediately invoked arrow, which JavaScript runs where the do stands, after every operand before it is finished: spreads iterated, object spreads copied, computed keys converted, substitutions converted to strings and tags read. Its body holds no yield.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.UseEffect()
			g.AddFile("do_operands.ts", doOperandsModule, "box", "Ctor", "constructorBox", "fail", "fn", "it", "key", "show", "src", "str", "tagger")
			o := &doOperands{g: g}
			e := o.context(0, true)
			body := func(vibe bool, run string) string {
				return fmt.Sprintf("box.n = 1; const done = %s Effect.succeed(1); return show(%s) + done", run, e(vibe))
			}
			return []Stmt{&catchEdge{vibe: body(true, "try"), ref: body(false, "yield*")}}
		},
	})
}

// A doPiece prints part of the expression: the VibeLang print, with do
// expressions, when vibe is set, and the reference otherwise.
type doPiece func(vibe bool) string

func doText(s string) doPiece { return func(bool) string { return s } }

// doOperands writes one expression; ids numbers its operands and dos its do
// expressions, so every log line names its source.
type doOperands struct {
	g        *Gen
	ids, dos int
}

const doOperandsDepth = 2

func (o *doOperands) id() string { o.ids++; return fmt.Sprintf("o%d", o.ids) }

// bad is true when an operand throws. An exhausted input throws nowhere.
func (o *doOperands) bad() bool { return o.g.Chance(6) }

func (o *doOperands) badString() string { return fmt.Sprint(o.bad()) }

// do writes a do expression that logs, sets box.n and gives a number, or,
// now and then, throws: do { ev("do1"); box.n = 2; 2 }, whose reference is
// (() => { ev("do1"); box.n = 2; return 2 })().
func (o *doOperands) do() doPiece {
	o.dos++
	n := o.dos + 1
	label := fmt.Sprintf("do%d", o.dos)
	body := fmt.Sprintf("ev(%q); box.n = %d", label, n)
	last := fmt.Sprint(n)
	if o.g.Chance(8) {
		last = fmt.Sprintf("fail(%q)", label)
	}
	return func(vibe bool) string {
		if vibe {
			return fmt.Sprintf("do { %s; %s }", body, last)
		}
		return fmt.Sprintf("(() => { %s; return %s })()", body, last)
	}
}

// leaf writes an operand that is not a context: a do, a read of box.n, a
// call or a number.
func (o *doOperands) leaf() doPiece {
	switch o.g.Intn(4) {
	case 0:
		return o.do()
	case 1:
		return doText("box.n")
	case 2:
		return doText(fmt.Sprintf("fn(%q)", o.id()))
	}
	return doText(fmt.Sprint(o.g.Intn(10)))
}

// value writes an element, argument, property value or substitution: a
// leaf or, below the depth limit, another context.
func (o *doOperands) value(depth int) doPiece {
	if depth < doOperandsDepth && o.g.Chance(3) {
		return o.context(depth+1, o.g.Chance(2))
	}
	return o.leaf()
}

// items writes 2 to 4 items, at least one a do when must is set (the last,
// on an exhausted input), and the others with item.
func (o *doOperands) items(must bool, item func(last bool) doPiece) []doPiece {
	count := 2 + o.g.Intn(3)
	forced := count - 1 - o.g.Intn(count)
	out := make([]doPiece, count)
	for i := range out {
		if must && i == forced {
			out[i] = nil
			continue
		}
		out[i] = item(i == count-1)
	}
	return out
}

func doJoin(parts []doPiece, sep string) doPiece {
	return func(vibe bool) string {
		s := make([]string, len(parts))
		for i, p := range parts {
			s[i] = p(vibe)
		}
		return strings.Join(s, sep)
	}
}

// spread writes ...it(id, n, bad), an iterable of n numbers whose next
// throws at bad when the operand throws.
func (o *doOperands) spread() doPiece {
	n := 1 + o.g.Intn(3)
	bad := -1
	if o.bad() {
		bad = o.g.Intn(n + 1)
	}
	return doText(fmt.Sprintf("...it(%q, %d, %d)", o.id(), n, bad))
}

// context writes an array, a call, a constructor call, an object, a
// template or a tagged template holding do expressions, one of them sure
// when must is set. On an exhausted input it is [...it("o1", 1, -1), do].
func (o *doOperands) context(depth int, must bool) doPiece {
	switch o.g.Intn(6) {
	case 0, 1, 2:
		kind := o.g.Intn(3)
		parts := o.items(must, func(last bool) doPiece {
			switch o.g.Intn(4) {
			case 0:
				return o.spread()
			case 1:
				if kind == 0 && !last {
					return doText("") // an elision
				}
			}
			return o.value(depth)
		})
		for i := range parts {
			if parts[i] == nil {
				parts[i] = o.do()
			}
		}
		list := doJoin(parts, ", ")
		id := o.id()
		constructor := "Ctor"
		if kind == 2 && o.g.Chance(2) {
			constructor = fmt.Sprintf("constructorBox(%q, %s)", o.id(), o.badString())
			if o.g.Chance(2) {
				constructor += ".C"
			} else {
				constructor += "[\"C\"]"
			}
		}
		return func(vibe bool) string {
			switch kind {
			case 1:
				return fmt.Sprintf("fn(%q, %s)", id, list(vibe))
			case 2:
				return fmt.Sprintf("new (%s)(%q, %s)", constructor, id, list(vibe))
			}
			return "[" + list(vibe) + "]"
		}
	case 3:
		names := 0
		property := func(v doPiece) doPiece {
			names++
			k := fmt.Sprintf("p%d: ", names)
			return func(vibe bool) string { return k + v(vibe) }
		}
		parts := o.items(must, func(bool) doPiece {
			switch o.g.Intn(3) {
			case 0:
				return doText(fmt.Sprintf("...src(%q, %s)", o.id(), o.badString()))
			case 1:
				mode := []string{"string", "string", "symbol"}[o.g.Intn(3)]
				if o.bad() {
					mode = "throw"
				}
				k := fmt.Sprintf("[key(%q, %q)]: ", o.id(), mode)
				v := o.value(depth)
				return func(vibe bool) string { return k + v(vibe) }
			}
			return property(o.value(depth))
		})
		for i := range parts {
			if parts[i] == nil {
				parts[i] = property(o.do())
			}
		}
		list := doJoin(parts, ", ")
		return func(vibe bool) string { return "({ " + list(vibe) + " })" }
	}
	tagged := o.g.Intn(2) == 1
	parts := o.items(must, func(bool) doPiece {
		if o.g.Chance(2) {
			return doText(fmt.Sprintf("str(%q, %s)", o.id(), o.badString()))
		}
		return o.value(depth)
	})
	for i := range parts {
		if parts[i] == nil {
			parts[i] = o.do()
		}
	}
	tag := ""
	if tagged {
		tag = fmt.Sprintf("tagger(%q, %s)", o.id(), o.badString())
		if o.g.Chance(2) {
			tag += "[\"tag\"]"
		} else {
			tag += ".tag"
		}
	}
	return func(vibe bool) string {
		var b strings.Builder
		b.WriteString(tag + "`a")
		for i, p := range parts {
			fmt.Fprintf(&b, "${%s}%c", p(vibe), 'b'+rune(i))
		}
		b.WriteString("`")
		return b.String()
	}
}
