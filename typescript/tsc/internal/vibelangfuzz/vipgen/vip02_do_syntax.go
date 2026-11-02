package vipgen

import (
	"fmt"
	"strings"
)

// No-jump do operands have a native arrow-IIFE oracle. Dynamic import is
// observed only synchronously (operand events and its Promise), so no promise
// race or host module-loading timing enters the differential result.
func init() {
	for _, shape := range []string{"specifier", "options", "both", "nested"} {
		Register(&Construct{
			Key: "vip02.do-import-" + shape + "-plain", VIP: 2, Plain: true,
			Citations: []Citation{{
				VIP: 2, Template: "(() => { ‹body›; return ‹value› })()",
				Quote:   "It runs now and gives its last statement's value",
				Reading: "No outward jumps, var, await or yield occur in these do operands; the native reference replaces each do with an immediately invoked arrow returning its completion value. Native import syntax evaluates the operands in order.",
			}},
			Focus: func(g *Gen, s *Scope) []Stmt {
				spec := fmt.Sprintf("%q", []string{"effect", "effect/Option"}[g.Intn(2)])
				options := "(ev(\"options\"), { with: {} })"
				path := "(ev(\"specifier\"), " + spec + ")"
				wrap := func(event, value string) string {
					depth := 1 + g.Intn(4)
					for i := 0; i < depth; i++ {
						value = "(do { ev(" + fmt.Sprintf("%q", event) + "); " + value + " })"
					}
					return value
				}
				// Choose the nesting once, then replace just the do delimiters
				// in the native twin. Its event count is identical.
				arg := func(event, value string) (string, string) {
					v := wrap(event, value)
					return v, doSyntaxIIFE(v)
				}
				vpath, rpath := path, path
				voptions, roptions := options, options
				if shape != "options" {
					vpath, rpath = arg("specifier", spec)
				}
				if shape != "specifier" {
					voptions, roptions = arg("options", "({ with: {} })")
				}
				v, r := "import("+vpath, "import("+rpath
				if shape != "specifier" {
					v += ", " + voptions
					r += ", " + roptions
				}
				v += ")"
				r += ")"
				if shape == "nested" {
					v = "do { ev(\"outer\"); " + v + " }"
					r = "(() => { ev(\"outer\"); return " + r + " })()"
				}
				finish := func(x string) string {
					return "const p = " + x + "; p.then(() => undefined, () => undefined); return p instanceof Promise"
				}
				name := g.Name("dynamic")
				g.AddDecl(&FixedPair{
					Source:    "function " + name + "(): boolean { " + finish(v) + " }",
					Reference: "function " + name + "() { " + finish(r) + " }",
				})
				return []Stmt{&doSyntaxRun{Name: name}}
			},
		})
	}
}

// The input consists only of generated nested do wrappers. Work inside out;
// the last semicolon before each generated value is outside inner wrappers.
func doSyntaxIIFE(source string) string {
	start := strings.Index(source, "do {")
	if start < 0 {
		return source
	}
	depth, end, last := 1, start+4, start+4
	for depth != 0 {
		switch source[end] {
		case '{':
			depth++
		case '}':
			depth--
		case ';':
			if depth == 1 {
				last = end + 1
			}
		}
		end++
	}
	return source[:start] + "(() => {" + doSyntaxIIFE(source[start+4:last]) +
		" return " + doSyntaxIIFE(source[last:end-1]) + " })()" + doSyntaxIIFE(source[end:])
}

func init() {
	// Each expression is a context in which a syntactic reference might reach
	// callee or spill. No-jump do bodies have the same native IIFE oracle.
	for _, shape := range []struct{ key, vibe, ref string }{
		{"meta", `const x = import.meta.url[DO(ev("key"); "length")]; const xs = [import.meta.url, DO(ev("after"); 3)]; return [typeof x, typeof xs[0]]`,
			`const x = import.meta.url[DO(ev("key"); "length")]; const xs = [import.meta.url, DO(ev("after"); 3)]; return [typeof x, typeof xs[0]]`},
		{"new-target", `class C { result: unknown[]; constructor() { const xs = [new.target, DO(ev("after"); 3)]; const name = new.target[DO(ev("key"); "name")]; this.result = [xs[0] === C, name] } }; return new C().result`,
			`class C { constructor() { const xs = [new.target, DO(ev("after"); 3)]; const name = new.target[DO(ev("key"); "name")]; this.result = [xs[0] === C, name] } }; return new C().result`},
		{"super-computed", `class B { get value(): number { ev("get"); return N } }; class C extends B { read(): number { return super[DO(ev("key"); "value")] } }; return new C().read()`,
			`class B { get value() { ev("get"); return N } }; class C extends B { read() { return super[DO(ev("key"); "value")] } }; return new C().read()`},
		{"super-assignment", `class B { own = 0; set x(n: number) { ev("set"); this.own = n } }; class C extends B { write(): number { super.x = DO(ev("rhs"); N); super[DO(ev("key"); "x")] = DO(ev("rhs2"); N); const other = { set x(n: number) { ev("alternate-base") } }; super.x = DO(ev("change-base"); Object.setPrototypeOf(C.prototype, other); N); return this.own } }; return new C().write()`,
			`class B { own = 0; set x(n) { ev("set"); this.own = n } }; class C extends B { write() { super.x = DO(ev("rhs"); N); super[DO(ev("key"); "x")] = DO(ev("rhs2"); N); const other = { set x(n) { ev("alternate-base") } }; super.x = DO(ev("change-base"); Object.setPrototypeOf(C.prototype, other); N); return this.own } }; return new C().write()`},
		{"super-tdz", `class B { f(n: number): number { ev("wrong-call"); return n } }; class C extends B { result: boolean; constructor() { let blocked = false; try { super[DO(ev("wrong-key"); "f")](DO(ev("wrong-argument"); N)) } catch (error) { blocked = error instanceof ReferenceError }; super(); this.result = blocked } }; return new C().result`,
			`class B { f(n) { ev("wrong-call"); return n } }; class C extends B { constructor() { let blocked = false; try { super[DO(ev("wrong-key"); "f")](DO(ev("wrong-argument"); N)) } catch (error) { blocked = error instanceof ReferenceError }; super(); this.result = blocked } }; return new C().result`},
		{"super-call", `class B { constructor(readonly value: number) { ev("base") }; f(n: number): number { ev("call"); return this.value + n } }; class C extends B { constructor() { super(DO(ev("argument"); N)) }; read(): number { return super.f(DO(ev("method-argument"); 3)) } }; return new C().read()`,
			`class B { constructor(value) { this.value = value; ev("base") }; f(n) { ev("call"); return this.value + n } }; class C extends B { constructor() { super(DO(ev("argument"); N)) }; read() { return super.f(DO(ev("method-argument"); 3)) } }; return new C().read()`},
		{"super-tag", "class B { value = N; tag(ss: TemplateStringsArray, n: number): number { ev(\"tag\"); return this.value + n } }; class C extends B { read(): number { return super[DO(ev(\"key\"); \"tag\")]`v:${DO(ev(\"substitution\"); 3)}` } }; return new C().read()",
			"class B { value = N; tag(ss, n) { ev(\"tag\"); return this.value + n } }; class C extends B { read() { return super[DO(ev(\"key\"); \"tag\")]`v:${DO(ev(\"substitution\"); 3)}` } }; return new C().read()"},
		{"tag", `let tag = (ss: TemplateStringsArray, n: number): number => { ev("tag"); return n }; const x = tag` + "`" + `v:${DO(ev("substitution"); tag = (): number => 99; N)}` + "`" + `; return x`,
			`let tag = (ss, n) => { ev("tag"); return n }; const x = tag` + "`" + `v:${DO(ev("substitution"); tag = () => 99; N)}` + "`" + `; return x`},
		{"optional", `const no = null as { f: (n: number) => number, x?: number } | null; const yes = { x: N, f(n: number): number { ev("call"); return this.x + n } }; const a = no?.[DO(ev("wrong-key"); "x")]; const b = no?.f(DO(ev("wrong-call"); 1)); const c = yes?.f(DO(ev("selected"); 3)); const d = delete no?.[DO(ev("wrong-delete"); "x")]; return [a === undefined, b === undefined, c, d]`,
			`const no = null; const yes = { x: N, f(n) { ev("call"); return this.x + n } }; const a = no?.[DO(ev("wrong-key"); "x")]; const b = no?.f(DO(ev("wrong-call"); 1)); const c = yes?.f(DO(ev("selected"); 3)); const d = delete no?.[DO(ev("wrong-delete"); "x")]; return [a === undefined, b === undefined, c, d]`},
		{"delete-value", `const box = { x: N }; const a = delete (DO(ev("direct"); box)); const b = delete (true ? DO(ev("conditional"); box) : box); const c = delete (false || DO(ev("logical"); box)); return [a, b, c, box.x]`,
			`const box = { x: N }; const a = delete (DO(ev("direct"); box)); const b = delete (true ? DO(ev("conditional"); box) : box); const c = delete (false || DO(ev("logical"); box)); return [a, b, c, box.x]`},
		{"delete", `const target: { x?: number } = { x: N }; const box = new Proxy(target, { get(o, k): unknown { ev("wrong-get"); return Reflect.get(o, k) }, deleteProperty(o, k): boolean { ev("delete"); return Reflect.deleteProperty(o, k) } }); const a = delete box[DO(ev("key"); "x")]; target.x = N; const b = delete (DO(ev("object"); box)).x; return [a, b, Object.hasOwn(target, "x")]`,
			`const target = { x: N }; const box = new Proxy(target, { get(o, k) { ev("wrong-get"); return Reflect.get(o, k) }, deleteProperty(o, k) { ev("delete"); return Reflect.deleteProperty(o, k) } }); const a = delete box[DO(ev("key"); "x")]; target.x = N; const b = delete (DO(ev("object"); box)).x; return [a, b, Object.hasOwn(target, "x")]`},
	} {
		Register(&Construct{
			Key: "vip02.do-syntax-" + shape.key + "-plain", VIP: 2, Plain: true,
			Citations: []Citation{{
				VIP: 2, Template: "(() => { ‹body›; return ‹value› })()",
				Quote:   "It runs now and gives its last statement's value",
				Reading: "Each no-jump do is replaced by a native arrow IIFE returning the final expression. The surrounding native syntax preserves references, lexical meta-properties, receivers, optional short-circuiting and delete without reading the deleted property.",
			}},
			Focus: func(g *Gen, s *Scope) []Stmt {
				name := g.Name("syntax")
				n := fmt.Sprint(g.Intn(100))
				depth := 1 + g.Intn(4)
				expand := func(source string, vibe bool) string {
					source = strings.ReplaceAll(source, " N", " "+n)
					if vibe {
						// The native reference is JavaScript; its IIFE return
						// needs no TypeScript literal-preserving annotation.
						for _, key := range []string{"url", "name", "value", "x", "f", "length", "tag"} {
							source = strings.ReplaceAll(source, fmt.Sprintf("%q)", key), fmt.Sprintf("%q as const)", key))
						}
					}
					for strings.Contains(source, "DO(") {
						start := strings.Index(source, "DO(")
						end, nesting := start+3, 1
						for nesting != 0 {
							switch source[end] {
							case '(':
								nesting++
							case ')':
								nesting--
							}
							end++
						}
						body := source[start+3 : end-1]
						for i := 0; i < depth; i++ {
							body = "(do { " + body + " })"
						}
						if !vibe {
							body = doSyntaxIIFE(body)
						}
						source = source[:start] + body + source[end:]
					}
					return source
				}
				prefix := ""
				if shape.key == "delete-value" || shape.key == "super-tdz" {
					// TypeScript rejects value deletion and early super access.
					// These probes opt out of those static errors to check
					// native JavaScript emission and receiver validation.
					prefix = "// @ts-ignore\n"
				}
				g.AddDecl(&FixedPair{
					Source:    prefix + "function " + name + "(): unknown { " + expand(shape.vibe, true) + " }",
					Reference: "function " + name + "() { " + expand(shape.ref, false) + " }",
				})
				return []Stmt{&doSyntaxRun{Name: name}}
			},
		})
	}
}

// Run the ordinary helper under the same cold Effect in both printers. The
// oracle concerns the helper's native expressions, independently of how the
// enclosing factory is inferred.
type doSyntaxRun struct{ Name string }

func (s *doSyntaxRun) Vibe(w *Writer)   { w.Write("return Effect.sync(() => " + s.Name + "())") }
func (s *doSyntaxRun) Effect(w *Writer) { s.Vibe(w) }
func (s *doSyntaxRun) Ends() bool       { return true }
