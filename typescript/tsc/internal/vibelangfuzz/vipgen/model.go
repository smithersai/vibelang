// Package vipgen is the generator of FuzzVIPDifferential, the differential
// test VIP-31 asks for: it turns fuzz bytes into a program, prints the
// program as VibeLang and as the Effect TypeScript each accepted VIP shows,
// and leaves running both and comparing their Exits to the fuzz target.
//
// The language is the accepted VIPs in docs/design/vips/, not the old
// specification: "Every accepted construct is exact sugar for Effect", and
// "Compiled output gives the same Exit as the Effect TypeScript shown in each
// VIP" (VIP-31). So the reference printer writes each VIP's own Effect TS,
// never what the compiler emits, and TestVIPTemplatesCited checks at test
// time that each template is the one its VIP shows.
//
// One Go file per VIP (vipNN_<name>.go) holds its constructs: the nodes, how
// the generator writes them, and both printers. A file registers each
// construct in its init function, so a new construct is a new file, and this
// file, generate.go and core.go do not change.
package vipgen

import (
	"fmt"
	"slices"
	"strings"
)

// A Construct is one VIP construct the generator writes. Its Key,
// "vipNN.<name>", is also its pending key: testdata/pending/vip.txt lists
// "feature:<Key>" while the compiler does not implement it.
type Construct struct {
	Key string
	VIP int
	// Requires names the constructs a program needs to hold this one, such
	// as the effect function that a try statement stands in.
	Requires []string
	// Citations say where the Effect TS the reference printer writes comes
	// from (TestVIPTemplatesCited).
	Citations []Citation

	// Focus writes a minimal use of the construct at the start of main's
	// body. The probe of the construct is the program it makes from no
	// other choice (Probe), so it should show what the construct does.
	Focus func(g *Gen, s *Scope) []Stmt
	// Stmt, when set, writes one statement that uses the construct, or nil
	// when it cannot in this scope.
	Stmt func(g *Gen, s *Scope) Stmt
	// Operand, when set, writes an Effect for try to run, or nil when it
	// cannot in this scope. With number set, the Effect must succeed with a
	// number, if it succeeds.
	Operand func(g *Gen, s *Scope, number bool) Expr
	// Declare, when set, prints a function: the construct is a form of
	// function declaration (VIP-1), and a program needs one for main.
	Declare func(f *Func) Node
	// Plain is set for a construct of plain programs (Program.Plain), which
	// uses only plain code and requires only plain constructs.
	Plain bool
}

// A Citation ties a construct's reference to a VIP's words. Template is the
// Effect TS the reference printer writes, with placeholders in ‹›. Quote is
// the VIP's own words, verbatim, that give the construct its meaning.
// TestVIPTemplatesCited requires the template's tokens to appear, in order,
// in a code block of VIP; where the VIP shows no Effect TS for the
// construct, Reading says how the suite reads the quote instead, and the
// test lists every reading, so it is visible and is replaced when the VIP
// states the Effect TS.
type Citation struct {
	VIP      int
	Template string
	Quote    string
	Reading  string
}

var registry []*Construct

// Register adds a construct. Each vipNN_*.go file calls it from init.
func Register(c *Construct) {
	if slices.ContainsFunc(registry, func(o *Construct) bool { return o.Key == c.Key }) {
		panic("vipgen: construct registered twice: " + c.Key)
	}
	registry = append(registry, c)
	// Go runs the init functions of a package's files in file name order,
	// and the key orders them too, so an input's bytes choose the same
	// construct on every build.
	slices.SortFunc(registry, func(a, b *Construct) int { return strings.Compare(a.Key, b.Key) })
}

// Constructs returns every registered construct, in key order.
func Constructs() []*Construct {
	return slices.Clone(registry)
}

// Lookup returns the construct of a key, or nil.
func Lookup(key string) *Construct {
	for _, c := range registry {
		if c.Key == key {
			return c
		}
	}
	return nil
}

// Closure returns a construct's key and the keys it requires, directly or
// through another construct, in key order.
func Closure(key string) []string {
	seen := map[string]bool{}
	var visit func(string)
	visit = func(k string) {
		if seen[k] {
			return
		}
		seen[k] = true
		if c := Lookup(k); c != nil {
			for _, r := range c.Requires {
				visit(r)
			}
		}
	}
	visit(key)
	keys := make([]string, 0, len(seen))
	for k := range seen {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	return keys
}

// Enabled returns the constructs a campaign may generate: those not left out
// whose requirements are not left out either, in key order.
func Enabled(leaveOut map[string]bool) []*Construct {
	var out []*Construct
	for _, c := range registry {
		if !slices.ContainsFunc(Closure(c.Key), func(k string) bool { return leaveOut[k] }) {
			out = append(out, c)
		}
	}
	return out
}

// A Node prints itself twice: as VibeLang, and as the Effect TS its VIP
// shows. Both printers read the same immutable tree.
type Node interface {
	Vibe(w *Writer)
	Effect(w *Writer)
}

// An Expr is an expression node.
type Expr = Node

// A Stmt is a statement node. Ends reports whether control never reaches
// the statement after it, as after return or throw; the generator writes
// nothing after such a statement in its block.
type Stmt interface {
	Node
	Ends() bool
}

// A Func is one function of a program. Every function takes numbers and,
// unless Void, returns a number when it succeeds.
type Func struct {
	Name   string
	Params []string
	Body   []Stmt
	Export bool
	Void   bool
	// Form is the construct that declares the function, or nil for a plain
	// program's plain main.
	Form *Construct
}

// A Program is one generated module. It exports main, which takes nothing;
// the helpers are declared before it and call only helpers declared before
// themselves, so no program recurses.
//
// A program has one of two forms. An effect program's functions are
// declared by an effect construct, such as VIP-1's effect function. A plain
// program's main is a plain function (VIP-1: a function with neither keyword
// is "plain JavaScript"), `export function main() { …; return
// Effect.succeed(v) }` in both prints, with no helpers: its statements are
// plain code, so it compares the constructs that work there, such as VIP-23's
// pipe on numbers, before the compiler has VIP-1's declarations.
type Program struct {
	// Decls are the module's declarations, such as error and data
	// declarations (VIP-13, VIP-16), printed before its functions.
	Decls []Node
	Funcs []*Func
	// Focus is the construct the input chose; Used holds every construct
	// the program holds, which a gap's key names.
	Focus string
	Used  map[string]bool
	// Effect is set when the VibeLang print uses an Effect.* function and
	// so imports Effect.
	Effect bool
	// Modules holds the other modules of effect the reference names, true
	// for those the VibeLang print names too.
	Modules map[string]bool
	// Plain is set for a plain program, whose main runs its body when called.
	Plain bool
}

// UsedKeys returns the program's constructs, in key order.
func (p *Program) UsedKeys() []string {
	var keys []string
	for k, ok := range p.Used {
		if ok {
			keys = append(keys, k)
		}
	}
	slices.Sort(keys)
	return keys
}

// The module both prints import their event log from: ev(label) appends to
// the run's log. Its declaration says @throws {never}, so VIP-4 lets an
// effect function call it directly.
const eventsModule = "vip-events"

// PrintVibe prints the program as main.vibe.
func PrintVibe(p *Program) string {
	w := &Writer{mode: modeVibe}
	w.Line(fmt.Sprintf("import { ev } from %q", eventsModule))
	if p.Effect {
		w.Line(`import { Effect } from "effect"`)
		w.importsEffect = true
		// VIP-6: "A local declaration or import shadows one, as with any
		// global." effect's Effect module has no Array, so a program that
		// imports Effect names Effect's Array module by its own import.
		if _, ok := p.Modules[effectArrayImport]; ok {
			w.Line(fmt.Sprintf("import { %s } from \"effect\"", effectArrayImport))
		}
	}
	importModules(w, p, true)
	printFuncs(w, p)
	return w.String()
}

// PrintEffect prints the program's reference: untyped JavaScript, in
// the Effect TS each construct's VIP shows, which never passes through the
// compiler under test.
func PrintEffect(p *Program) string {
	w := &Writer{mode: modeEffect}
	w.Line(fmt.Sprintf("import { ev } from %q", eventsModule))
	w.Line(`import { Data, Effect } from "effect"`)
	importModules(w, p, false)
	printFuncs(w, p)
	return w.String()
}

// importModules imports the program's other modules of effect, in name
// order: those the VibeLang print names, or with vibe unset every one.
func importModules(w *Writer, p *Program, vibe bool) {
	var names []string
	for name, named := range p.Modules {
		if named || !vibe {
			names = append(names, name)
		}
	}
	if len(names) > 0 {
		slices.Sort(names)
		w.Line(fmt.Sprintf("import { %s } from \"effect\"", strings.Join(names, ", ")))
	}
}

func printFuncs(w *Writer, p *Program) {
	for _, d := range p.Decls {
		w.Line("")
		w.Node(d)
		w.Line("")
	}
	for _, f := range p.Funcs {
		w.Line("")
		if f.Form == nil {
			w.Node(&PlainFunction{Func: f})
		} else {
			w.Node(f.Form.Declare(f))
		}
		w.Line("")
	}
}

type mode int

const (
	modeVibe mode = iota
	modeEffect
)

// A Writer accumulates one print. Node dispatches to the print of the
// writer's mode, so a node prints its children with w.Node and never asks
// which print it is in.
type Writer struct {
	mode   mode
	b      strings.Builder
	indent int
	fresh  bool
	// importsEffect is set when the VibeLang print imports Effect from
	// effect, which shadows the global Effect (VIP-6).
	importsEffect bool
}

// ImportsEffect reports whether the VibeLang print imports Effect from
// effect, so that the global Effect and its members, such as Effect.Array,
// are shadowed by effect's own module.
func (w *Writer) ImportsEffect() bool { return w.importsEffect }

// IsVibe reports whether this is the VibeLang print.
func (w *Writer) IsVibe() bool { return w.mode == modeVibe }

// Write appends text, indenting it when it starts a line.
func (w *Writer) Write(text string) {
	if w.fresh && text != "" {
		w.b.WriteString(strings.Repeat("  ", w.indent))
		w.fresh = false
	}
	w.b.WriteString(text)
}

// Line appends text and ends the line.
func (w *Writer) Line(text string) {
	w.Write(text)
	w.b.WriteString("\n")
	w.fresh = true
}

// Node prints a node in the writer's mode.
func (w *Writer) Node(n Node) {
	if w.mode == modeVibe {
		n.Vibe(w)
	} else {
		n.Effect(w)
	}
}

// Block prints "{", each statement on its own line one level in, and "}".
func (w *Writer) Block(body []Stmt) {
	w.Line("{")
	w.indent++
	for _, s := range body {
		w.Node(s)
		w.Line("")
	}
	w.indent--
	w.Write("}")
}

// Indent runs fn one level in.
func (w *Writer) Indent(fn func()) {
	w.indent++
	fn()
	w.indent--
}

func (w *Writer) String() string { return w.b.String() }
