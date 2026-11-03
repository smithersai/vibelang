package vipgen

import (
	"fmt"
	"strings"
)

// VIP-7, chapter 004: admission has its own static oracle in
// FuzzReviewIsBindingHomes. This construct compares cell lifetimes and copies
// with explicit lexical declarations; it never asks today's compiler to
// decide the reference program's scope.
func init() {
	Register(&Construct{
		Key: "vip07.for-each-is-homes-plain", VIP: 7, Plain: true,
		Citations: []Citation{{
			VIP: 7, Template: "for (‹head› of ‹items›) { ‹body› }",
			Quote:   "A `for…in`, `for…of`, `for await`, `for concurrent` or `for try` head expression's binding is copied into each iteration.",
			Reading: "The head has one cell. Each item copies its current value into a fresh let or const before the source body; defaults have a fresh cell per item. Explicit native declarations provide the reference.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt { return []Stmt{forEachIsHomes(g, s)} },
		Stmt:  forEachIsHomes,
	})
}

func forEachIsHomes(g *Gen, _ *Scope) Stmt {
	seed, count := 7+g.Intn(20), g.Intn(5)
	defaults, immutable := g.Intn(2) != 0, g.Intn(2) != 0
	kind := "let"
	if immutable {
		kind = "const"
	}
	jump := []string{"", "if(item===2)continue;", "if(item===2)break;"}[g.Intn(3)]
	name := g.Name("isHome")
	start := fmt.Sprintf("function %s(){const saved:Array<()=>number>=[];let steps=0;", name)
	nativeStart := fmt.Sprintf("function %s(){const saved=[];let steps=0;", name)
	finish := "return JSON.stringify([steps,saved.map(f=>f())]);}"
	var source, reference string
	if defaults {
		write := ""
		if !immutable {
			write = "cell++;"
		}
		body := "saved.push(()=>{" + write + "return cell});void item;" + jump
		source = start + fmt.Sprintf("for(const {x:item=(%d is %s cell)?cell:0} of Array.from({length:%d},()=>({} as {x?:number}))){%s}", seed, kind, count, body) + finish
		reference = nativeStart + fmt.Sprintf("for(const entry of Array.from({length:%d},()=>({}))){let cell;const {x:item=(cell=%d)}=entry;%s}", count, seed, body) + finish
	} else {
		helper := fmt.Sprintf("function items(set:(n:number)=>void):Iterable<number>{return {[Symbol.iterator](){return {next():IteratorResult<number>{set(%d+steps);return steps++<%d?{done:false,value:steps}:{done:true,value:undefined}}}}}}", seed, count)
		nativeHelper := strings.NewReplacer("set:(n:number)=>void", "set", ":Iterable<number>", "", ":IteratorResult<number>", "").Replace(helper)
		setHead, setNative, write := "cell=n", "head=n", "cell+=item;"
		if immutable {
			setHead, setNative, write = "void n", "void n", ""
		}
		body := write + "saved.push(()=>cell);" + jump
		source = start + helper + fmt.Sprintf("for(const item of (((%d as number) is %s cell)&&items(n=>{%s}))||[]){%s}", seed, kind, setHead, body) + finish
		reference = nativeStart + nativeHelper + fmt.Sprintf("{let head=%d;for(const item of items(n=>{%s})){%s cell=head;%s}}", seed, setNative, kind, body) + finish
	}
	g.AddDecl(&Code{V: source, E: reference})
	return &forEachIsHomesCall{Name: name}
}

type forEachIsHomesCall struct{ Name string }

func (c *forEachIsHomesCall) Vibe(w *Writer)   { c.print(w) }
func (c *forEachIsHomesCall) Effect(w *Writer) { c.print(w) }
func (c *forEachIsHomesCall) Ends() bool       { return true }
func (c *forEachIsHomesCall) print(w *Writer) {
	w.Write(fmt.Sprintf("return Effect.suspend(()=>{ev(\"for-each-home:\"+%s());return Effect.succeed(0)})", c.Name))
}
