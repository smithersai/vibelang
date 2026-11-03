package vipgen

import "fmt"

// The reference uses native lexical arrows inside Effect.sync. JavaScript
// itself supplies the derived constructor's uninitialized receiver and the
// ordering of its check before a computed super key. No compiler helper is
// used as the oracle.
func init() {
	for _, shape := range []string{"block", "arrow", "super-key", "static", "scope", "mask", "restore", "provide", "nested-arrow"} {
		Register(&Construct{
			Key:      "vip01.lazy-this-" + shape,
			VIP:      1,
			Requires: []string{"vip01.effect-function"},
			Citations: []Citation{{
				VIP:      1,
				Template: "Effect.sync(() =>",
				Quote:    "Building the Effect reads none of them.",
				Reading:  "001-functions.md Bindings: native lexical arrows defer receiver reads until reached, including before super(). Each generated witness runs both branches before super and repeats the reached branch after super.",
			}},
			Focus: func(g *Gen, s *Scope) []Stmt {
				name, value := g.Name("lazyThis"), g.Name("value")
				n, fallback := 1+g.Intn(50), 1+g.Intn(50)
				build := func(vibe bool) string {
					annotation, param := "", "read"
					if vibe {
						annotation, param = ": number[]", "read: boolean"
					}
					body := fmt.Sprintf("if (read) return this.value; return %d", fallback)
					prefix, suffix := "", ""
					switch shape {
					case "super-key":
						body = fmt.Sprintf("if (read) return super[(keys++, \"value\")]; return %d", fallback)
					case "scope":
						if vibe {
							prefix = "const child = fork Effect.succeed(0); "
						}
					case "mask":
						if vibe {
							prefix, suffix = "uninterruptible { ", " }"
						}
					case "restore":
						if vibe {
							prefix, suffix = "uninterruptible { restore { ", " } }"
						}
					case "provide":
						if vibe {
							prefix, suffix = "provide Layer.empty { ", " }"
						}
					}
					expression := "Effect.sync(() => { " + body + " })"
					if vibe {
						expression = "effect { " + prefix + "try Effect.succeed(0); " + body + suffix + " }"
					}
					if vibe && shape == "nested-arrow" {
						expression = fmt.Sprintf("effect { const inner = effect (innerRead: boolean) => { try Effect.succeed(0); if (innerRead) return this.value; return %d }; return try inner(read) }", fallback)
					}
					factory := "const make = (" + param + ") => " + expression + ";"
					if shape == "arrow" && vibe {
						factory = "const make = effect (" + param + ") => { try Effect.succeed(0); " + body + " };"
					}
					static := ""
					if shape == "static" {
						expression = "Effect.sync(() => super.value)"
						field := ""
						if vibe {
							expression, field = "effect { try Effect.succeed(0); return super.value }", "static program: number!!;"
						}
						static = "class Static extends Base { " + field + " static { this.program = " + expression + " } }; out.push(run(Static.program));"
					}
					typ := ""
					if vibe {
						typ = ": unknown!!"
					}
					// A successful read and a ReferenceError produce different numeric
					// contributions, so failures, timing, keys and repeat runs are visible.
					return fmt.Sprintf(`function %s() {
 let keys = 0
 const out%s = []
 const run = (p%s) => {
  const x = Effect.runSyncExit(p)
  if (x._tag === "Success") return Number(x.value)
  return x.cause.reasons.some(r => r._tag === "Die" && r.defect instanceof ReferenceError) ? -100 : -1000
 }
 class Base { get value() { return %d }; static value = %d }
 class Derived extends Base {
  constructor() {
   %s
   const p = make(true)
   out.push(run(make(false)), run(p))
   super()
   out.push(run(p), run(p))
  }
 }
 new Derived()
 %s
 return out.reduce((a, b) => a + b, 0) + keys * 10000
}`, name, annotation, typ, n, n, factory, static)
				}
				g.UseEffect()
				if shape == "provide" {
					g.UseModule("Layer", true)
				}
				g.AddDecl(&Code{V: build(true), E: build(false)})
				s.Locals = append(s.Locals, value)
				return []Stmt{&Const{Name: value, Type: "number", Value: &Call{Name: name}}}
			},
		})
	}
}

const lazyReceiverNamingQuote = "A value-only evaluation of an anonymous function or class cannot gain a name from a private variable or assignment; preserve a name the source explicitly requests."

func init() {
	for _, mode := range []string{"field-literal", "field-private", "field-computed", "field-factory", "parameter-default", "binding-default", "binding-effect"} {
		Register(&Construct{
			Key:      "vip01.lazy-this-name-" + mode,
			VIP:      1,
			Requires: []string{"vip01.effect-function"},
			Citations: []Citation{{
				VIP: 1, Template: "Effect.sync(() =>",
				Quote:   "Building the Effect reads none of them.",
				Reading: "001-functions.md Source names: " + lazyReceiverNamingQuote + " Native field and parameter initializers supply the name before the callable is observed; their receiver remains lexical.",
			}},
			Focus: func(g *Gen, s *Scope) []Stmt {
				name, value := g.Name("lazyNames"), g.Name("value")
				n, fallback := 1+g.Intn(50), 1+g.Intn(50)
				build := func(vibe bool) string {
					annotation := ""
					body := fmt.Sprintf("if (flag) return this.value; return %d", fallback)
					arrow := "(flag) => Effect.sync(() => { " + body + " })"
					effect := "Effect.sync(() => this.value)"
					if vibe {
						annotation = ": unknown!!"
						arrow = "effect (flag: boolean) => { try Effect.succeed(0); " + body + " }"
						effect = "effect { try Effect.succeed(0); return this.value }"
					}
					member := "read = " + arrow + "; program() { return this.read }"
					expected := "read"
					switch mode {
					case "field-private":
						member, expected = "#read = "+arrow+"; program() { return this.#read }", "#read"
					case "field-computed":
						member = "[\"read\"] = " + arrow + "; program() { return this.read }"
					case "field-factory":
						if vibe {
							arrow = "(flag: boolean) => effect { try Effect.succeed(0); " + body + " }"
						}
						member = "read = " + arrow + "; program() { return this.read }"
					case "parameter-default":
						member = "program(read = " + arrow + ") { return read }"
					case "binding-default":
						member = "program({ read = " + arrow + " } = {}) { return read }"
					case "binding-effect":
						member = "program({ p = " + effect + " }) { return p }"
					}
					tail := fmt.Sprintf("const p = new Field().program(); return (p.name === %q ? 0 : 10000) + run(p(false)) + run(p(true))", expected)
					if mode == "binding-effect" {
						tail = "return run(new Field().program({}))"
					}
					return fmt.Sprintf("function %s() {\n const run = (p%s) => { const x = Effect.runSyncExit(p); return x._tag === \"Success\" ? Number(x.value) : -1000 };\n class Base { value = %d }; class Field extends Base { %s };\n %s\n}", name, annotation, n, member, tail)
				}
				g.UseEffect()
				g.AddDecl(&Code{V: build(true), E: build(false)})
				s.Locals = append(s.Locals, value)
				return []Stmt{&Const{Name: value, Type: "number", Value: &Call{Name: name}}}
			},
		})
	}
}
