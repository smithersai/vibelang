package vipgen

import "fmt"

// The reference constructs lexical cells directly, including unreachable
// declarations for cells that must remain in TDZ. It does not use is lowering.
func init() {
	Register(&Construct{
		Key: "vip07.do-while-is-homes-plain", VIP: 7, Plain: true,
		Citations: []Citation{{
			VIP: 7, Template: "for (;;) { ‹body› }",
			Quote:   "Every complete condition evaluation, including after `continue`, starts with fresh uninitialized cells.",
			Reading: "Each condition gets a new lexical cell. Initial-body closures retain the uninitialized initial cell; skipped bindings stay uninitialized. Explicit native closures model these cells independently.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt { return []Stmt{doWhileIsHomes(g, s)} },
		Stmt:  doWhileIsHomes,
	})
}

func init() {
	Register(&Construct{
		Key: "vip07.for-test-is-cells-plain", VIP: 7, Plain: true,
		Citations: []Citation{{
			VIP: 7, Template: "for (;;) { ‹body› }",
			Quote:   "a `test` or `update` binding is a fresh cell in each iteration environment.",
			Reading: "Explicit native lexical cells model test bindings independently of the compiler. A skipped test binding remains uninitialized, and prior closures keep their original cells.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt { return []Stmt{forTestIsHomes(g, s)} },
		Stmt:  forTestIsHomes,
	})
}

func doWhileIsHomes(g *Gen, s *Scope) Stmt { return loopIsHomes(g, s, true) }
func forTestIsHomes(g *Gen, s *Scope) Stmt { return loopIsHomes(g, s, false) }
func loopIsHomes(g *Gen, _ *Scope, postTest bool) Stmt {
	seed, limit := 1+g.Intn(20), 1+g.Intn(5)
	skip, jump := g.Intn(3), g.Intn(3)
	kind := []string{"let", "const"}[g.Intn(2)]
	name := g.Name("doHome")
	start := fmt.Sprintf("function %s(){const cell=%d;let tests=0,turns=0;const tail:number[]=[],reads:Array<()=>unknown>=[],conditions:Array<()=>unknown>=[],writes:Array<()=>unknown>=[];function safe(f:()=>unknown){try{return f()}catch(e){return e instanceof ReferenceError?\"tdz\":\"other\"}}", name, seed+100)
	nativeStart := fmt.Sprintf("function %s(){const cell=%d;let tests=0,turns=0;const tail=[],reads=[],conditions=[],writes=[];function safe(f){try{return f()}catch(e){return e instanceof ReferenceError?\"tdz\":\"other\"}}function fresh(){return {read:()=>cell,write:()=>++cell};let cell}", name, seed+100)
	skipTest := "false"
	if skip != 0 {
		skipTest = fmt.Sprintf("tests%%%d===0", 1+skip)
	}
	jumpBody := ""
	if jump == 1 {
		jumpBody = "if(turns===2)continue outer;"
	}
	if jump == 2 {
		jumpBody = "if(turns===3)break outer;"
	}
	body := "turns++;reads.push(()=>cell);" + jumpBody + "tail.push(turns);"
	if kind == "let" {
		body = "writes.push(()=>++cell);" + body
	}
	test := fmt.Sprintf("++tests<=%d&&(%s||((tests+%d) is %s cell and if((conditions.push(()=>cell),cell>0))))", limit, skipTest, seed, kind)
	loop := "outer:do{" + body + "}while(" + test + ");"
	if !postTest {
		loop = "outer:for(;" + test + ";){" + body + "}"
	}
	source := start + loop + "return JSON.stringify([tests,turns,cell,tail,writes.map(safe),reads.map(safe),conditions.map(safe)])}"
	// Run the body with the previous condition's cell; create the next one
	// only after the body, and never overwrite an earlier closure's cell.
	nativeBody := "turns++;reads.push(current.read);"
	if jump == 2 {
		nativeBody += "if(turns===3)break;"
	}
	if jump == 1 {
		nativeBody += "if(turns!==2)"
	}
	nativeBody += "tail.push(turns);"
	if kind == "let" {
		nativeBody = "writes.push(current.write);" + nativeBody
	}
	next := fmt.Sprintf("if(++tests>%d)break;if(%s){current=fresh()}else{%s cell=tests+%d;conditions.push(()=>cell);current={read:()=>cell,write:()=>++cell};}", limit, skipTest, kind, seed)
	nativeLoop := nativeBody + next
	if !postTest {
		nativeLoop = next + nativeBody
	}
	reference := nativeStart + "let current=fresh();for(;;){" + nativeLoop + "}return JSON.stringify([tests,turns,cell,tail,writes.map(safe),reads.map(safe),conditions.map(safe)])}"
	g.AddDecl(&Code{V: source, E: reference})
	return &doWhileIsHomesCall{Name: name}
}

type doWhileIsHomesCall struct{ Name string }

func (c *doWhileIsHomesCall) Vibe(w *Writer)   { c.print(w) }
func (c *doWhileIsHomesCall) Effect(w *Writer) { c.print(w) }
func (c *doWhileIsHomesCall) Ends() bool       { return true }
func (c *doWhileIsHomesCall) print(w *Writer) {
	w.Write(fmt.Sprintf("return Effect.suspend(()=>{ev(\"do-while-home:\"+%s());return Effect.succeed(0)})", c.Name))
}
