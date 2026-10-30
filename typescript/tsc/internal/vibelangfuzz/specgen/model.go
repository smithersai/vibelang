// Package specgen is the spec-program generator of the VibeLang fuzz suite:
// it turns fuzz bytes into programs that are valid by Part I of the
// specification, prints each as VibeLang and as the Effect TypeScript the
// specification says it means, prints metamorphic variants, and infers each
// function's contract (Chapters 2-4, 14).
package specgen

// This file holds the program model of the spec-program generator: a
// structure-aware generator in the tradition of Csmith and YARPGen that turns
// fuzz bytes into a VibeLang program that is valid by the specification
// (Part I, Chapters 1-11), with its observable order recorded in a trace.
// Fuzzilli and other structure-aware fuzzers drive a generator's choices with
// the fuzzer's bytes, so coverage guidance works on programs that are always
// valid; swarm testing (Groce et al., ISSTA 2012) lets each input enable a
// random subset of the features.
//
// Two printers render one model: VibeLang (gen_vibe.go) and the Effect
// TypeScript that the specification says reading VibeLang as "is never wrong"
// (gen_ts.go, the left column of SKILL.md's Forms table and Appendix C). The
// Effect print is the reference: both run on the same Effect runtime and must
// end with the same Outcome and trace.

import (
	"slices"
	"sort"
)

// A Feature is one form of Part I that the generator can produce. Each names
// the chapter and decisions whose behavior it exercises.
type Feature struct {
	Name string
	Spec string
}

// Features lists every generator feature, in a fixed order: a fuzz input's
// first byte selects its focus feature by index, and the next bytes its swarm
// mask.
var Features = []Feature{
	{"call-order", "Ch 2, Ch 13 rule E1-E2 (D326): operands left to right, a call runs where it stands"},
	{"plain-function", "Ch 2, Ch 13 rule P, Ch 15 (D445): a function with no Effect operation is plain"},
	{"recursion", "Ch 14 Recursion (D52, D57, D72): a written A, inferred channels"},
	{"throw", "Ch 3 (D126): throw fails with an expected error"},
	{"throw-expression", "Ch 3 Failing in an expression (D186)"},
	{"try-catch", "Ch 3 Catching, Ch 17 catch rule (D216, D306)"},
	{"try-finally", "Ch 3 Cleanup with finally, Ch 17 finalization rule"},
	{"finally-exit", "Ch 5 table, Ch 17 (D178): finally (exit)"},
	{"catch-value", "Ch 3 Catching in an expression (D236, D237): x catch v"},
	{"catch-handler", "Ch 3 Catching in an expression (D236): x catch (e) => h"},
	{"match-literal", "Ch 3 Matching (D206): literal patterns and default"},
	{"match-guard", "SKILL rule 7, Ch 3: when let n and if (...)"},
	{"match-error", "Ch 3 Matching (D215, D346, D407): error class patterns, exhaustive"},
	{"match-data", "Ch 11 Data types (D307): data variants and exhaustive match"},
	{"match-option", "Ch 3 (D208): Option.Some and Option.None"},
	{"match-exit", "Ch 3 (D208), Ch 5 (D217): match (exit(p))"},
	{"is", "Ch 3 (D211): is narrows in an if"},
	{"error-family", "Ch 3 Error classes and families (D278, D304, D347)"},
	{"do-block", "Ch 13 Blocks as values (D187)"},
	{"pipe", "Ch 5 The pipe operator (D154, D325), Ch 13 rule E6"},
	{"loops", "Ch 2 Control flow is ordinary JavaScript"},
	{"service", "Ch 4 Using a service: S.m(args)"},
	{"service-impl", "Ch 4: S() returns the implementation, Ch 13 rule E3"},
	{"layer-succeed", "Ch 4 Writing a provider: Layer.succeed"},
	{"layer-effect", "Ch 4 Writing a provider (D188, D221): Layer.effect(S) { }"},
	{"provide-key", "Ch 4 Running with providers (D173): provide S = v { }"},
	{"provide-local", "Ch 4 (D130, D172, D362): a provide block removes what it provides from R"},
	{"await-all", "Ch 7 Await operations (D196, D377)"},
	{"await-allsettled", "Ch 7 Await operations (D258)"},
	{"await-race", "Ch 7 Await operations (D196): first to finish"},
	{"await-any", "Ch 7 Await operations (D196): first success"},
	{"for-concurrent", "Ch 7 Concurrent loops (D169, D354)"},
	{"fork-join", "Ch 7 Background work (D166, D225, D408)"},
	{"fork-block", "Ch 7: fork { } owned by the enclosing block"},
	{"retry", "Ch 5 (D320), Ch 13 rule E8: fresh locals per attempt"},
	{"exit", "Ch 3, Ch 5: exit(p) gives an Exit as data"},
	{"using", "Ch 6 (D342, D401): using releases in reverse order"},
	{"uninterruptible", "Ch 5, Ch 17 interruption rule (D180): uninterruptible { restore { } }"},
	{"mask-interrupt", "Ch 7, Ch 17 interruption rule (D180): a masked fiber finishes its block"},
	{"producer", "Ch 8 (D370, D371, D402): function* and for...of"},
	{"control-resume", "Ch 9 Handling it: try { } handle C.op(x) { resume(v) }"},
	{"control-abort", "Ch 9 Not continuing, Ch 17 abandonment rule"},
	{"hatch-sync", "Ch 10 (D148, D229, D230, D396): sync"},
	{"hatch-try", "Ch 10 (D148, D231): try with a mapper"},
	{"die", "Ch 3 Failures, defects, and interruption (D305): defects pass through catch"},
	{"unreachable-code", "Ch 2 Control flow is ordinary JavaScript: statements after a return or a throw parse and check, and never run"},
	{"do-match-value", "Ch 13 Blocks as values (D187), Appendix grammar: a do block's last statement may be a match expression"},
	{"narrowed-subject", "Ch 3 Matching (D346), Ch 11 (D307): a match over a local that TypeScript has narrowed by its initializer"},
	{"module-graph", "Ch 26 Modules, Ch 27 rule 1: calls and all contract channels cross two or three mutually importing modules"},
	// The fiber, interruption and cause forms below were added after the
	// features above, at the end, so an input's focus byte keeps its
	// feature.
	{"join-array", "Ch 7 Background work (D225, D354, D469): join [a, b], join { a, b } and a joined array literal fail fast and interrupt the other fibers"},
	{"fork-detach", "Ch 7 (D170): detach(() => p()) starts a fiber that no region owns"},
	{"fork-in", "Ch 7 (D170): forkIn(scope, () => p()) ties a fiber to a Scope the program closes"},
	{"fork-scoped", "Ch 7 (D408): Effect.forkScoped(() => p()) ties a fiber to the caller's Scope, here Effect.scoped's"},
	{"await-all-record", "Ch 7 Await operations (D196): Effect.all over an object literal keeps its keys, which VIP-18 writes try all({ … }, { concurrency: \"unbounded\" })"},
	{"interruptible", "Ch 17 interruption rule (D180, D490): interruptible { } is Effect.interruptible, also under a mask and in cleanup"},
	{"fail-cause", "Ch 17 throw rule (D406): Effect.failCause(cause) fails with every reason of an exit's cause"},
	{"is-exit", "Ch 3 Matching (D208, D211): if (x is Exit.Failure(let cause)) and Exit.Success(let v)"},
	{"is-data", "Ch 11 Data types (D211, D307): if (d is D.Variant) narrows to the variant"},
	{"custom-error-constructor", "Ch 3 Error classes and families (D278): an error's own constructor calls super with its fields"},
	{"generic-data", "Ch 11 Data types (D307): a data declaration with a type parameter"},
	{"hatch-promise", "Ch 10 (D439): sync(async (inputs) => ...) waits for a resolved or rejected promise, as Effect.promise"},
	{"hatch-try-promise", "Ch 10 (D231, D439): try(async ...) maps a rejection with its mapper, as Effect.tryPromise"},
	{"held-fiber", "Ch 7 Ownership (D408), Ch 6 (D401, D481), Ch 17 finalization and interruption rules: a fiber holding using resources, a mask and a finally is interrupted at its region's exit or by interrupt, and every cleanup runs once, in order"},
	{"cause-mix", "Ch 17 Combining causes (D305, D306): a failure and a defect in parallel branches and in a finalizer, and catch around an interrupted fiber's join"},
	{"do-yield", "Ch 13 rule L5 (D187), Ch 8 (D370): a yield inside a do block of a producer, since a do block is evaluated where it stands"},
}

// FeatureIndex returns a feature's index in Features, or -1.
func FeatureIndex(name string) int {
	return slices.IndexFunc(Features, func(f Feature) bool { return f.Name == name })
}

// A chooser turns fuzz bytes into choices. An exhausted input chooses 0
// everywhere, and every choice the generator makes is written so that 0 is
// the smallest program, so a short input is a small program.
type chooser struct {
	data []byte
	pos  int
}

func (c *chooser) byte() byte {
	if c.pos >= len(c.data) {
		return 0
	}
	b := c.data[c.pos]
	c.pos++
	return b
}

// intn returns a choice in [0, n).
func (c *chooser) intn(n int) int {
	if n <= 1 {
		return 0
	}
	return int(c.byte()) % n
}

// chance is true about once in n choices, and false on an exhausted input.
func (c *chooser) chance(n int) bool {
	return c.intn(n) == n-1
}

// A set of declaration names, such as an E or R channel's members.
type NameSet map[string]bool

func (s NameSet) add(names ...string) {
	for _, n := range names {
		s[n] = true
	}
}

func (s NameSet) union(o NameSet) {
	for n := range o {
		s[n] = true
	}
}

func (s NameSet) clone() NameSet {
	c := NameSet{}
	c.union(s)
	return c
}

func (s NameSet) Sorted() []string {
	names := make([]string, 0, len(s))
	for n := range s {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}

func (s NameSet) Equal(o NameSet) bool {
	if len(s) != len(o) {
		return false
	}
	for n := range s {
		if !o[n] {
			return false
		}
	}
	return true
}

// Declarations.

// An ErrorDecl is an `error` declaration (Ch 3, D126). Base is set for a
// family's subclass; IsBase for a family's base, which writes `_tag: string`
// (D304).
type ErrorDecl struct {
	Name   string
	Fields []string // number fields
	Base   *ErrorDecl
	IsBase bool
	// Ctor gives the class its own constructor, `constructor(raw: number)
	// { super({ n: raw * 2 + 1 }) }`, so `new E(raw)` takes one argument
	// and sets its one field from it (Ch 3, D278).
	Ctor bool
}

// AllFields returns the fields a constructor takes: the base's, then its own
// (D347).
func (e *ErrorDecl) AllFields() []string {
	if e.Base == nil {
		return e.Fields
	}
	return append(slices.Clone(e.Base.AllFields()), e.Fields...)
}

// IsA reports whether e is o or a class below it.
func (e *ErrorDecl) IsA(o *ErrorDecl) bool {
	for c := e; c != nil; c = c.Base {
		if c == o {
			return true
		}
	}
	return false
}

// A DataDecl is a `data` declaration (Ch 11, D307).
type DataDecl struct {
	Name     string
	Variants []*DataVariant
	// Generic declares a type parameter T, which the variants' first field
	// has, and every use writes D<number> (Ch 11, D307).
	Generic bool
}

type DataVariant struct {
	Data   *DataDecl
	Name   string
	Fields []string
}

// A Service is a `service` declaration (Ch 4) of number methods.
type Service struct {
	Name    string
	Methods []*Method
}

// A Method states its contract: it takes a number, succeeds with a number and
// can fail with E (Ch 4: contracts are written out).
type Method struct {
	Svc  *Service
	Name string
	E    []*ErrorDecl
}

// A Control is a `control` declaration (Ch 9) of one operation,
// op(n: number): number!!.
type Control struct {
	Name string
	Op   string
}

// An Impl implements a service: an object literal of methods, with a setup
// block when a Layer.effect builds it.
type Impl struct {
	Svc     *Service
	Setup   []Stmt // Layer.effect's setup, run when the layer is built
	Methods []*MethodImpl
}

type MethodImpl struct {
	M     *Method
	Param string
	Body  []Stmt
}

// A Provider is one element of a provide block's list (Ch 4, D173).
type Provider struct {
	Kind int // providerSucceed, providerEffect, providerKey
	Impl *Impl
}

const (
	providerSucceed = iota
	providerEffect
	providerKey
)

// Function kinds.
const (
	kindNormal   = iota // an Effect or plain function the generator writes freely
	kindQuiet           // touches no shared state, so other fibers may run it
	kindControl         // performs a control operation, only under a handler
	kindProducer        // function*, a producer (Ch 8)
	kindBump            // plain: adds to the module's counter (rule E1 probes)
	kindAcquire         // a using acquisition's acquire step
	kindRelease         // a using acquisition's release step
)

// Producer reports whether f is a producer, which returns a Stream.
func (f *Func) Producer() bool { return f.Kind == kindProducer }

// A Func is a function declaration. Annot is the base print's annotation:
// "" (inferred), "plain" (a plain return annotation, Ch 15), "plain-void" (a
// plain void annotation, for the extract variant's part of a plain function)
// or "ae" (A!E with R inferred, Ch 14).
type Func struct {
	Name      string
	Params    []string
	Body      []Stmt
	Kind      int
	Recursive bool
	Annot     string
	Export    bool
	Module    int // zero for the entry module, otherwise a generated sibling
	// Filled by inference (gen_infer.go).
	E, R  NameSet
	Plain bool // performs no Effect operation and cannot fail
	Cost  int  // an estimate of the calls one run makes
	// AlwaysFails marks a quiet function whose every run fails, and
	// NeverFails one whose runs never fail, for the await operations.
	AlwaysFails, NeverFails bool
}

// A Program is the whole model: declarations, functions and main.
type Program struct {
	Errors      []*ErrorDecl
	Datas       []*DataDecl
	Services    []*Service
	Controls    []*Control
	Funcs       []*Func // in declaration order; main is last
	Main        *Func
	ModuleCount int             // two or three for module graphs, otherwise one
	Used        map[string]bool // the features the program holds
	Enabled     map[string]bool
	Focus       string
	HasTrace    bool
	HasCount    bool
	nextLocal   int
	// Rest is the input after the generator's choices; the variants draw
	// their choices from it.
	Rest []byte
}

// Expressions. Every expression has type number unless its comment says
// otherwise.
type Expr interface{ isExpr() }

type (
	Num     struct{ V int }
	Ref     struct{ Name string }
	Counter struct{}
	Bin     struct {
		Op   string
		L, R Expr
	}
	Ternary struct {
		C    *Cond
		T, F Expr
	}
	// Call calls a function of the program; it runs if the callee is an
	// Effect (Ch 13 rule R) and is a plain call otherwise (rule P).
	Call struct {
		Fn   *Func
		Args []Expr
	}
	// SvcCall is `S.m(args)`, or `S().m(args)` when Impl is set (Ch 4, rule E3).
	SvcCall struct {
		M    *Method
		Args []Expr
		Impl bool
	}
	CtlCall struct {
		Ctl  *Control
		Args []Expr
	}
	// CatchExpr is `x catch v` (Value) or `x catch (Var) => Handler`.
	CatchExpr struct {
		X       Expr
		Value   bool
		Var     string
		Handler Expr
	}
	Match struct {
		Kind    int
		Subject Expr // for matchExit, the Call whose exit is matched
		Arms    []*Arm
		Default Expr // nil when the match is exhaustive or DefaultThrow
		// DefaultThrow writes `default: throw subject` (a catch variable).
		DefaultThrow bool
	}
	Do struct {
		Body  []Stmt
		Value Expr
	}
	// Pipe is `Head |> stage |> ...`: each stage is a Call one of whose
	// arguments is the Topic.
	Pipe struct {
		Head   Expr
		Stages []*Call
	}
	Topic     struct{}
	ThrowExpr struct {
		Left Expr // number | undefined
		Err  *ErrNew
	}
	// Maybe is `(C ? V : undefined)`, a number | undefined.
	Maybe struct {
		C *Cond
		V Expr
	}
	ErrNew struct {
		Err    *ErrorDecl
		Fields []Expr
	}
	// Sync is the sync hatch: with Inputs, `sync((a, b) => Body, ...inputs)`;
	// without, the single expression `sync(Body)` (D396). Async writes the
	// function async, `sync(async (a, b) => Body, ...inputs)` or
	// `sync(async () => Body)`, whose promise the hatch waits for (D439).
	Sync struct {
		Inputs []Expr
		Body   string
		Async  bool
	}
	// TryHatch is `Effect.try({ try: () => Number(JSON.parse(s)), catch: (e) => Err })`
	// run with try on s = Prefix + Input, or with Async Effect.tryPromise of
	// an async function (VIP-5, which replaced the try hatch of D439).
	TryHatch struct {
		Prefix string // "" parses, anything else fails
		Input  Expr
		Err    *ErrNew
		Async  bool
	}
	OptionNew struct {
		C *Cond
		V Expr
	}
	DataNew struct {
		V      *DataVariant
		Fields []Expr
	}
	// TagLen is `e._tag.length` of a catch variable.
	TagLen struct{ Var string }
	// ErrField reads a field of a narrowed catch variable.
	ErrField struct{ Var, Field string }
	// Join is `join f` (Ch 7, D225), only as a Let's initializer.
	Join struct{ Fiber string }
	// YieldNow is the prelude's `yieldNow()` (Ch 1 prelude, D151).
	YieldNow struct{}
	// ExitTag is `exit(() => Call)._tag` (Ch 3: exit gives an Exit as data).
	ExitTag struct{ Call Expr }
	// DataRef reads a local that holds a data value, as a match subject.
	DataRef struct{ Name string }
	// TagOf is `Var._tag` of a finally (exit) binding, a string.
	TagOf struct{ Var string }
	// TraceLen is `trace.length`, for a condition no run makes true.
	TraceLen struct{}
	// Paren parenthesizes an expression, so a statement does not start with
	// a keyword.
	Paren struct{ X Expr }
	// DataField reads a field of a data local that `is` has narrowed.
	DataField struct{ Var, Field string }
	// Reasons is `Var.reasons.map((r) => r._tag).join("+")`, the tags of a
	// cause's reasons in order, a string (Ch 17 Exits and causes).
	Reasons struct{ Var string }
)

func (*Num) isExpr()       {}
func (*Ref) isExpr()       {}
func (*Counter) isExpr()   {}
func (*Bin) isExpr()       {}
func (*Ternary) isExpr()   {}
func (*Call) isExpr()      {}
func (*SvcCall) isExpr()   {}
func (*CtlCall) isExpr()   {}
func (*CatchExpr) isExpr() {}
func (*Match) isExpr()     {}
func (*Do) isExpr()        {}
func (*Pipe) isExpr()      {}
func (*Topic) isExpr()     {}
func (*ThrowExpr) isExpr() {}
func (*Maybe) isExpr()     {}
func (*ErrNew) isExpr()    {}
func (*Sync) isExpr()      {}
func (*TryHatch) isExpr()  {}
func (*OptionNew) isExpr() {}
func (*DataNew) isExpr()   {}
func (*TagLen) isExpr()    {}
func (*ErrField) isExpr()  {}
func (*Join) isExpr()      {}
func (*YieldNow) isExpr()  {}
func (*ExitTag) isExpr()   {}
func (*DataRef) isExpr()   {}
func (*TagOf) isExpr()     {}
func (*TraceLen) isExpr()  {}
func (*Paren) isExpr()     {}
func (*DataField) isExpr() {}
func (*Reasons) isExpr()   {}

// A Cond is a comparison, `L Op R`.
type Cond struct {
	Op   string
	L, R Expr
}

// Match kinds.
const (
	matchLiteral = iota // a number subject: literal and guard arms, default
	matchError          // a catch variable: error class arms
	matchData           // a data value: variant arms
	matchOption         // an Option: Some and None
	matchExit           // exit(() => call): Success and Failure
)

// An Arm is one `when` clause. Lit is a literal arm's value; Class an error
// arm's class; Variant a data arm's variant; Case "Some", "None", "Success"
// or "Failure". Binds names the fields (or the matcher's value) it binds;
// GuardVar and Guard make `when let GuardVar and if (Guard)`.
type Arm struct {
	Lit      *int
	Class    *ErrorDecl
	Variant  *DataVariant
	Case     string
	Binds    []string
	Fields   []string
	GuardVar string
	Guard    *Cond
	Body     Expr
	// Throw makes the arm's body `throw new ...` instead of Body.
	Throw *ErrNew
	// FailCause makes an Exit.Failure arm's body `Effect.failCause(cause)`
	// of its binding (Ch 17, D406).
	FailCause bool
}

// Statements.
type Stmt interface{ isStmt() }

type (
	// Let declares a local; Data makes it `const Name: D = Init`, and
	// Narrow keeps TypeScript's narrowing of it by the initializer, which
	// `Init as D` otherwise prevents.
	Let struct {
		Name    string
		Mutable bool
		Init    Expr
		Data    *DataDecl
		Narrow  bool
	}
	// Reset clears the module's trace and counter at the start of main.
	Reset struct{}
	// Assign is `Name Op Value`, or `counter Op Value` when Counter is set.
	Assign struct {
		Name    string
		Counter bool
		Op      string
		Value   Expr
	}
	Trace struct {
		Label  string
		Values []Expr
	}
	If struct {
		C          *Cond
		Then, Else []Stmt
	}
	// IsIf is `if (Var is Class) { Then }`; Then ends with a return.
	IsIf struct {
		Var   string
		Class *ErrorDecl
		Then  []Stmt
	}
	For struct {
		Var  string
		N    int
		Body []Stmt
	}
	ForOf struct {
		Var   string
		Elems []int
		Body  []Stmt
	}
	Break    struct{}
	Continue struct{}
	Return   struct{ Value Expr }
	Throw    struct{ Err *ErrNew }
	Rethrow  struct{ Var string }
	ExprStmt struct{ X Expr }
	Die      struct{ Msg string }
	// Try is try/catch/finally. Catch is nil without a catch clause, Finally
	// nil without a finally; ExitVar names `finally (exit)`'s binding.
	Try struct {
		Body     []Stmt
		CatchVar string
		Catch    []Stmt
		Finally  []Stmt
		ExitVar  string
	}
	// UsingBlock is a block statement that declares `using` (Ch 6): each
	// resource is `using Name = Effect.acquireRelease(() => acq(Arg), (r) => rel(r))`.
	UsingBlock struct {
		Res  []*Resource
		Body []Stmt
	}
	Provide struct {
		Providers []*Provider
		Body      []Stmt
	}
	// Handle is `try { Body } handle Ctl.op(Param) { Clause; [if (Abort) return AbortValue]; resume(Resume) }`.
	Handle struct {
		Ctl        *Control
		Body       []Stmt
		Param      string
		Clause     []Stmt
		Abort      *Cond
		AbortValue Expr
		Resume     Expr
		Cell       string // the reference's name for its abandonment cell
	}
	// Fork is `const Name = fork Call` or `const Name = fork { Block }`.
	Fork struct {
		Name  string
		Call  Expr
		Block []Stmt
	}
	// Await is `const [Names...] = try.Op [elems]`, or
	// `const Names[0] = try.Op [elems]` for race and any (VIP-18). Keys makes
	// an all's operand an object literal, `const { k: v } = try all({ k: el }, …)`.
	Await struct {
		Op    string // all, allSettled, race, any
		Names []string
		Elems []*AwaitElem
		Keys  []string
	}
	ForConcurrent struct {
		N     int
		Var   string
		Elems []int
		Body  []Stmt
	}
	// Retry is `const Name = retry(() => { Body }, { times: Times })`.
	Retry struct {
		Name  string
		Times int
		Body  []Stmt
	}
	// Mask is `uninterruptible { Body; restore { Restore }; After }`.
	Mask struct {
		Body, Restore, After []Stmt
	}
	// MaskFork forks a fiber whose uninterruptible block signals Ready, then
	// interrupts it: the block finishes, and what follows it never runs
	// (Ch 17 interruption rule).
	MaskFork struct {
		Ready, Fiber string
		Masked       []Stmt
		Restore      bool
		After        []Stmt
	}
	ForOfProducer struct {
		Var  string
		Prod *Func
		Args []Expr
		Body []Stmt
		Cell string
	}
	Yield struct{ Value Expr }
	// MakeDeferred is `const Name = Deferred.make<void>()`.
	MakeDeferred struct{ Name string }
	// Signal is `Deferred.succeed(Ready, undefined)`.
	Signal struct{ Ready string }
	// AwaitReady is `Ready.await()` (D227).
	AwaitReady struct{ Ready string }
	// Never is `Effect.never()`, where a held fiber waits until something
	// interrupts it.
	Never struct{}
	// Interrupt is `Fiber.interrupt()`, which waits for the fiber's cleanup.
	Interrupt struct{ Fiber string }
	// Interruptible is `interruptible { Body }` (Ch 17, D180).
	Interruptible struct{ Body []Stmt }
	// UsingDecl is a `using` declaration directly in a region's block, so
	// the region releases it in reverse order with the fibers it owns
	// (Ch 7 Ownership, Ch 6).
	UsingDecl struct{ Res *Resource }
	// JoinAll joins several fibers at once (D225): the forks Fibers names,
	// or, with Literal, the array literal `const Literal = [fork ..., ...]`
	// of Elems that it binds first (D469). Keys makes the operand an object
	// literal. Names destructures the values; without names it is a
	// statement.
	JoinAll struct {
		Fibers  []string
		Literal string
		Elems   []*Fork
		Keys    []string
		Names   []string
	}
	// Lifetime starts a fiber whose lifetime the program names (Ch 7, D170,
	// D408): Kind "detach", "forkIn" (in the Scope it makes and closes) or
	// "forkScoped" (inside Effect.scoped, whose result Value binds). A Call
	// fiber is joined into Value; a Hold fiber signals Ready and waits, and
	// the end of its lifetime interrupts it. Between runs before the join or
	// the end.
	Lifetime struct {
		Kind    string
		Fiber   string
		Scope   string
		Ready   string
		Call    Expr
		Hold    []Stmt
		Between []Stmt
		Value   string
		Result  Expr // a Hold fiber's Effect.scoped result
	}
	// ExitIs binds `const Name = exit(() => Call)`, or the exit of Body's
	// program, then tests it with `is` (D208, D211): Exit.Success(let Bind)
	// or Exit.Failure(let Bind). Then runs in the narrowed branch;
	// FailCause ends it with `Effect.failCause(Bind)` (D406).
	ExitIs struct {
		Name      string
		Call      Expr
		Body      []Stmt
		Success   bool
		Bind      string
		Then      []Stmt
		FailCause bool
	}
	// DataIs is `if (Var is D.Variant) { Then }` (D211, D307).
	DataIs struct {
		Var     string
		Variant *DataVariant
		Then    []Stmt
	}
)

type Resource struct {
	Name string
	Acq  *Func
	Rel  *Func
	Arg  Expr
}

// An AwaitElem is an await operation's element: a call, a do block, or
// `do { Effect.never() }`.
type AwaitElem struct {
	X     Expr
	Body  []Stmt
	Value Expr
	Never bool
}

func (*Let) isStmt()           {}
func (*Reset) isStmt()         {}
func (*Assign) isStmt()        {}
func (*Trace) isStmt()         {}
func (*If) isStmt()            {}
func (*IsIf) isStmt()          {}
func (*For) isStmt()           {}
func (*ForOf) isStmt()         {}
func (*Break) isStmt()         {}
func (*Continue) isStmt()      {}
func (*Return) isStmt()        {}
func (*Throw) isStmt()         {}
func (*Rethrow) isStmt()       {}
func (*ExprStmt) isStmt()      {}
func (*Die) isStmt()           {}
func (*Try) isStmt()           {}
func (*UsingBlock) isStmt()    {}
func (*Provide) isStmt()       {}
func (*Handle) isStmt()        {}
func (*Fork) isStmt()          {}
func (*Await) isStmt()         {}
func (*ForConcurrent) isStmt() {}
func (*Retry) isStmt()         {}
func (*Mask) isStmt()          {}
func (*MaskFork) isStmt()      {}
func (*ForOfProducer) isStmt() {}
func (*Yield) isStmt()         {}
func (*MakeDeferred) isStmt()  {}
func (*Signal) isStmt()        {}
func (*AwaitReady) isStmt()    {}
func (*Never) isStmt()         {}
func (*Interrupt) isStmt()     {}
func (*Interruptible) isStmt() {}
func (*UsingDecl) isStmt()     {}
func (*JoinAll) isStmt()       {}
func (*Lifetime) isStmt()      {}
func (*ExitIs) isStmt()        {}
func (*DataIs) isStmt()        {}
