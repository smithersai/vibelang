package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// Fuzz coverage for spec loop round 3 (lane sl3-apply). Each target reads its
// rule from the chapter at test time (RULES.md 1, 4, 9 and 10), picks a shape
// from a keyed input (RULES.md 11), and reports a disagreement through Gap
// under a precise key. Fuzz coverage for OPUS-1, OPUS-2, OPUS-5 and OPUS-10 is
// fuzz-findings' claim.

func r3Errors(diags []*ast.Diagnostic) []string {
	var out []string
	for _, d := range diags {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		source := d.Source()
		if source == "" {
			source = "TS"
		}
		out = append(out, fmt.Sprintf("%s%04d", source, d.Code()))
	}
	return out
}

func r3Pick(data []byte, names []string) int {
	if key, ok := strings.CutPrefix(string(data), "key:"); ok {
		if i := slices.Index(names, key); i >= 0 {
			return i
		}
	}
	if len(data) == 0 {
		return 0
	}
	return int(data[0]) % len(names)
}

func r3Quoted(tb testing.TB, chapter string, quotes ...string) {
	tb.Helper()
	text := SpecText(chapter)
	for _, q := range quotes {
		if !strings.Contains(text, q) {
			tb.Fatalf("%s no longer says %q", chapter, q)
		}
	}
}

func r3Seeds(f *testing.F, names []string) {
	for _, name := range names {
		f.Add([]byte("key:" + name))
	}
}

// ---------------------------------------------------------------------------
// OPUS-6 (decided detail 78): a bare fixed pattern covers its case.

const fixedCoverageQuote = "covers its case when it is bare, or when its argument list has the required length and every argument pattern is a bare `let` or `const` binding."

type fixedSubject struct{ name, typ, first, second string }

var fixedSubjects = []fixedSubject{
	{"option", "Option.Option<number>", "Option.Some", "Option.None"},
	{"exit", "Exit.Exit<number, string>", "Exit.Success", "Exit.Failure"},
	{"result", "Result.Result<number, string>", "Result.Success", "Result.Failure"},
}

// fixedForms are the spellings of one arm's pattern and whether it covers.
var fixedForms = []struct {
	name, suffix string
	covers       bool
}{
	{"bare", "", true},
	{"let", "(let v)", true},
	{"const", "(const v)", true},
	{"empty", "()", false},
	{"literal", "(1)", false},
	{"two", "(let a, let b)", false},
	{"guarded", " and if (flag)", false},
	{"let-guarded", "(let v) and if (flag)", false},
}

func fixedNames() []string {
	var names []string
	for _, s := range fixedSubjects {
		for _, form := range fixedForms {
			for _, rest := range []string{"both", "alone"} {
				names = append(names, s.name+"/"+form.name+"/"+rest)
			}
		}
	}
	return names
}

func TestFixedCoverageQuoted(t *testing.T) { r3Quoted(t, "004-match.md", fixedCoverageQuote) }

func FuzzFixedPatternCoverage(f *testing.F) {
	startShortBudget(f)
	r3Quoted(f, "004-match.md", fixedCoverageQuote)
	names := fixedNames()
	r3Seeds(f, names)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		i := r3Pick(data, names)
		both := i%2 == 0
		form := fixedForms[(i/2)%len(fixedForms)]
		s := fixedSubjects[i/(2*len(fixedForms))]
		arms := "when " + s.first + form.suffix + ": 1;"
		if both {
			arms += " when " + s.second + ": 2;"
		}
		source := "declare const flag: boolean\nexport function f(x: " + s.typ + ") {\n  return match (x) { " + arms + " }\n}\n"
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		left := !both || !form.covers
		reported := slices.Contains(r3Errors(r.Diagnostics), "EK4701")
		if left != reported {
			Gap(t, "FuzzFixedPatternCoverage", "coverage:"+form.name, "004-match: %s; %s: want EK4701=%v, got %v:\n%s", fixedCoverageQuote, names[i], left, r3Errors(r.Diagnostics), source)
		}
	})
}

// ---------------------------------------------------------------------------
// OPUS-9 (decided detail 186): a scope flag needs --fix somewhere in the list.

const fixScopeQuote = "Either flag requires `--fix` somewhere in the argument list, before or after it; alone, each is an unknown compiler option (`TS5023`)."

func TestFixScopeFlagsQuoted(t *testing.T) {
	r3Quoted(t, "../vips/0034-compiler-and-tooling.md", fixScopeQuote)
}

func FuzzFixScopeFlags(f *testing.F) {
	startShortBudget(f)
	r3Quoted(f, "../vips/0034-compiler-and-tooling.md", fixScopeQuote)
	pool := []string{"--fix", "--fix-migration-only", "--fix-vip-only", "--noEmit", "--strict", "--FIX", "--FIX-VIP-ONLY"}
	for _, seed := range [][]byte{{1}, {2}, {1, 0}, {0, 2}, {1, 2}, {1, 2, 0}, {3, 1}, {3, 1, 4, 0}, {6}, {6, 5}, {3, 4}} {
		f.Add(seed)
	}
	w := &Workspace{fs: osvfs.FS()}
	dir := f.TempDir()
	f.Fuzz(func(t *testing.T, data []byte) {
		var args []string
		for _, b := range data[:min(len(data), 6)] {
			args = append(args, pool[int(b)%len(pool)])
		}
		if len(args) == 0 {
			return
		}
		options := cliOptions(w, dir, args)
		if options == nil {
			return
		}
		scope := slices.ContainsFunc(args, func(a string) bool { return strings.HasPrefix(strings.ToLower(a), "--fix-") })
		unknown := false
		for _, e := range options.Errors {
			unknown = unknown || e.Code() == 5023
		}
		if want := scope && !cliHasFix(args); want != unknown {
			Gap(t, "FuzzFixScopeFlags", "scope", "VIP-34: %s; %v: want TS5023=%v, got %v", fixScopeQuote, args, want, options.Errors)
		}
	})
}

// ---------------------------------------------------------------------------
// OPUS-4: restore in a for concurrent item region is EK2202; the limit, the
// iterable and a plain loop keep their enclosing rule.

const restoreItemQuote = "or inside any `for concurrent` head binding initialization or body: the nested Effect, or each item's Effect, is outside the enclosing mask's control."

var restorePlacements = []struct{ name, statements, want string }{
	{"head-default", "for concurrent (const { n = do { restore { try p }; 1 } } of xs) { n }", "EK2202"},
	{"head-nested-default", "for concurrent (const { a: { n = do { restore { try p }; 1 } } = {} } of xs) { n }", "EK2202"},
	{"head-computed-key", `for concurrent (const { [do { restore { try p }; "n" }]: n } of xs) { n }`, "EK2202"},
	{"body", "for concurrent (const x of xs) { restore { try p } }", "EK2202"},
	{"body-limit-one", "for concurrent (1) (const x of xs) { restore { try p } }", "EK2202"},
	{"body-nested-do", "for concurrent (const x of xs) { const v = do { restore { try p }; 1 }; v }", "EK2202"},
	{"body-inner-mask", "for concurrent (const x of xs) { uninterruptible { restore { try p } } }", "EK2202"},
	{"effect-block", "const e = effect { restore { try p } }; try e", "EK2202"},
	{"effect-arrow", "const e = effect () => { restore { try p } }; try e()", "EK2202"},
	{"effect-function", "const e = effect function () { restore { try p } }; try e()", "EK2202"},
	{"direct", "restore { try p }", ""},
	{"do-block", "const v = do { restore { try p }; 1 }; v", ""},
	{"plain-for-body", "for (const x of xs) { restore { try p } }", ""},
	{"plain-for-of-head", "for (const { n = do { restore { try p }; 1 } } of xs) { n }", ""},
}

func TestRestoreItemPlacementQuoted(t *testing.T) { r3Quoted(t, "002-running.md", restoreItemQuote) }

func FuzzRestoreItemPlacement(f *testing.F) {
	startShortBudget(f)
	r3Quoted(f, "002-running.md", restoreItemQuote)
	masks := []struct{ name, open, close string }{
		{"mask", "uninterruptible { ", " }"},
		{"two-masks", "uninterruptible { uninterruptible { ", " } }"},
		{"interruptible-outside", "uninterruptible { interruptible { uninterruptible { ", " } } }"},
	}
	var names []string
	for _, r := range restorePlacements {
		for _, m := range masks {
			names = append(names, r.name+"/"+m.name)
		}
	}
	r3Seeds(f, names)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		i := r3Pick(data, names)
		r, m := restorePlacements[i/len(masks)], masks[i%len(masks)]
		source := "declare const p: Effect.Effect<number>\nexport effect function f(xs: Array<{ n?: number; a?: { n?: number } }>) {\n  " + m.open + r.statements + m.close + "\n}\n"
		result, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		errs := r3Errors(result.Diagnostics)
		if r.want == "" {
			if slices.Contains(errs, "EK2202") || slices.Contains(errs, "EK2111") {
				Gap(t, "FuzzRestoreItemPlacement", "valid:"+r.name, "002-running: %s should stay legal, got %v:\n%s", r.name, errs, source)
			}
			return
		}
		if !slices.Contains(errs, r.want) {
			Gap(t, "FuzzRestoreItemPlacement", "missing:EK2202", "002-running: %s; %s reports %v:\n%s", restoreItemQuote, r.name, errs, source)
			return
		}
		ExpectPending(t, "FuzzRestoreItemPlacement", "missing:EK2202")
	})
}

// ---------------------------------------------------------------------------
// OPUS-8 (decided detail 249): binding homes at a catch parameter and a
// for concurrent limit, plus the post-guard home control from detail 245.

var isHomeQuotes = []string{
	"A binding in a `for concurrent` limit belongs to the nearest home that encloses the loop, because the limit runs before the head environment exists",
	"The same holds for a catch clause's parameter, whose environment is distinct from the catch Block ([VIP-7](../vips/0007-match.md#binding-homes-and-redeclarations)).",
	"An `if` head belongs to the home that contains the `if` statement;",
}

var isHomePublicQuotes = []string{
	"Two top-level patterns that bind one name in the same lexical home are a redeclaration",
	"The statement body of `if`, `else`, `for`",
	"A binding in a `for concurrent` limit belongs to the nearest home that encloses the loop",
	"The same holds for a catch clause's parameter, whose environment is distinct from the catch Block",
}

func requireIsHomeQuotes(t testing.TB) {
	r3Quoted(t, "004-match.md", isHomeQuotes...)
	r3Quoted(t, "../vips/0007-match.md", isHomePublicQuotes...)
}

var isHomePositions = []struct{ name, source, want, key string }{
	{"catch-default", `try { work() } catch ({ code = (1 is let c) }: any) {}`, "EK0705", "catch:EK0705"},
	{"catch-nested-default", `try { work() } catch ({ a: { code = (1 is const c) } }: any) {}`, "EK0705", "catch:EK0705"},
	{"catch-computed-key", `try { work() } catch ({ [(1 is let c) ? "x" : "y"]: value }: any) {}`, "EK0705", "catch:EK0705"},
	{"catch-array-default", `try { work() } catch ([a = (1 is let c)]: any) {}`, "EK0705", "catch:EK0705"},
	{"catch-binding-free", `try { work() } catch ({ code = (1 is Number) }: any) {}`, "", "catch:free"},
	{"catch-body", `try { work() } catch (e: any) { if (e is { code: let c }) return c }`, "", "catch:body"},
	{"guard-after-if", `const input: unknown = { code: 1 }; if (!(input is { code: let c })) return 0; c`, "", "guard:home"},
}

func TestIsHomesQuoted(t *testing.T) { requireIsHomeQuotes(t) }

func FuzzIsHomePositions(f *testing.F) {
	startShortBudget(f)
	requireIsHomeQuotes(f)
	wrappers := []struct{ name, pre, post string }{
		{"function", "export function f(): unknown { ", " ; return 0 }\n"},
		{"arrow", "export const f = (): unknown => { ", " ; return 0 }\n"},
		{"method", "export class C { m(): unknown { ", " ; return 0 } }\n"},
		{"effect", "export effect function f(): unknown!! { ", " ; return 0 }\n"},
	}
	var names []string
	for _, p := range isHomePositions {
		for _, wr := range wrappers {
			names = append(names, p.name+"/"+wr.name)
		}
	}
	names = append(names, "limit-home")
	r3Seeds(f, names)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		i := r3Pick(data, names)
		if names[i] == "limit-home" {
			source := "export effect function f(xs: number[]) {\n  for concurrent ((2 is let n) ? n : 1) (const x of xs) { x }\n  return n\n}\n"
			r, err := w.Compile(t.Context(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			if errs := r3Errors(r.Diagnostics); len(errs) > 0 {
				Gap(t, "FuzzIsHomePositions", "limit:home", "004-match: %s; reports %v:\n%s", isHomeQuotes[0], errs, source)
				return
			}
			ExpectPending(t, "FuzzIsHomePositions", "limit:home")
			return
		}
		p, wr := isHomePositions[i/len(wrappers)], wrappers[i%len(wrappers)]
		source := "declare function work(): void\n" + wr.pre + p.source + wr.post
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		errs := r3Errors(r.Diagnostics)
		switch {
		case p.want == "" && len(errs) > 0:
			Gap(t, "FuzzIsHomePositions", p.key, "004-match: %s should compile, reports %v:\n%s", p.name, errs, source)
		case p.want != "" && !slices.Contains(errs, p.want):
			Gap(t, "FuzzIsHomePositions", p.key, "004-match: %s; %s reports %v:\n%s", isHomeQuotes[1], p.name, errs, source)
		case p.want != "":
			ExpectPending(t, "FuzzIsHomePositions", p.key)
		}
	})
}

// ---------------------------------------------------------------------------
// OPUS-7 (decided detail 247): a syntax rejection uses its owning VIP's code.

var ownerCodeQuotes = map[string]string{
	"EK0109": "| `EK0109` | a recognized `effect` arrow head that breaks its required form: a typed or generic bare parameter; parenthesize the parameters | 1 |",
	"EK0202": "| `EK0202` | a `break` or `continue` whose target is outside the block of an `effect { … }` expression | 2 |",
	"EK0512": "`catch` mixed with `??`, `\\|\\|` or `&&` without parentheses, or a member access or call after a function-expression handler; parenthesize | 5 |",
	"EK1505": "| `EK1505` | a member of a `schema` body that is not a `Field` | 15 |",
	"EK1606": "| `EK1606` | a malformed `data` variant or a payload member that is not a `Field` | 16 |",
}

const ownerPrelude = "declare const a: Effect.Effect<number, string>\ndeclare const b: number | undefined\n"

var ownerShapes = []struct{ name, source, want string }{
	{"coalesce-before", "export effect function f() { return b ?? a catch () => 1 }\n", "EK0512"},
	{"or-before", "export effect function f() { return b || a catch () => 1 }\n", "EK0512"},
	{"and-before", "export effect function f() { return b && a catch () => 1 }\n", "EK0512"},
	{"coalesce-after", "export effect function f() { return a catch function () { return 1 } ?? 2 }\n", "EK0512"},
	{"member-after", "export effect function f() { return a catch function () { return 1 }.call(a) }\n", "EK0512"},
	{"call-after", "export effect function f() { return a catch function () { return 1 }() }\n", "EK0512"},
	{"index-after", "export effect function f() { return a catch function () { return [1] }[0] }\n", "EK0512"},
	{"arrow-owns-coalesce", "export effect function f() { return a catch () => b ?? 1 }\n", ""},
	{"paren-left", "export effect function f() { return b ?? (a catch () => 1) }\n", ""},
	{"paren-whole", "export effect function f() { return (a catch function () { return 1 }) }\n", ""},
	{"typed-head", "export const f = effect x: number!! => x\n", "EK0109"},
	{"generic-head", "export const f = effect <T> x => x\n", "EK0109"},
	{"paren-head", "export const f = effect (x: number): number!! => x\n", ""},
	{"paren-generic-head", "export const f = effect <T>(x: T) => x\n", ""},
	{"contextual-effect", "export function f() { const effect = (x: number) => x; return effect(1) }\n", ""},
	{"block-break", "export effect function f(xs: number[]) { for (const x of xs) { const e = effect { break }; try e } }\n", "EK0202"},
	{"block-continue", "export effect function f(xs: number[]) { for (const x of xs) { const e = effect { continue }; try e } }\n", "EK0202"},
	{"block-labeled", "export effect function f(xs: number[]) { l: for (const x of xs) { const e = effect { break l }; try e } }\n", "EK0202"},
	{"block-inner-break", "export effect function f() { const e = effect { for (const x of [1]) { break } }; try e }\n", ""},
	{"block-return", "export const e = effect { return 1 }\n", ""},
	{"schema-method", "schema S { m(): string }\n", "EK1505"},
	{"schema-index", "schema S { [k: string]: number }\n", "EK1505"},
	{"schema-ok", "schema S { n: number }\n", ""},
	{"data-parens", "data D { A(x: number) }\n", "EK1606"},
	{"data-method", "data D { A { m(): void } }\n", "EK1606"},
	{"data-ok", "data D { A { n: number }; B }\n", ""},
}

func TestOwnerSyntaxCodesQuoted(t *testing.T) {
	for _, quote := range ownerCodeQuotes {
		r3Quoted(t, "900-appendices.md", quote)
	}
}

func FuzzOwnerSyntaxCodes(f *testing.F) {
	startShortBudget(f)
	for _, quote := range ownerCodeQuotes {
		r3Quoted(f, "900-appendices.md", quote)
	}
	names := make([]string, len(ownerShapes))
	for i, s := range ownerShapes {
		names[i] = s.name
	}
	r3Seeds(f, names)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		s := ownerShapes[r3Pick(data, names)]
		source := ownerPrelude + s.source
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		errs := r3Errors(r.Diagnostics)
		if s.want == "" {
			if len(errs) > 0 {
				Gap(t, "FuzzOwnerSyntaxCodes", "valid:"+s.name, "Appendix B: %s should compile; it reports %v:\n%s", s.name, errs, source)
			}
			return
		}
		bare := slices.ContainsFunc(errs, func(e string) bool { return e == "TS1005" || e == "TS1109" || e == "TS1134" })
		if !slices.Contains(errs, s.want) || bare {
			Gap(t, "FuzzOwnerSyntaxCodes", "missing:"+s.want, "Appendix B: %s; %s reports %v:\n%s", ownerCodeQuotes[s.want], s.name, errs, source)
			return
		}
		ExpectPending(t, "FuzzOwnerSyntaxCodes", "missing:"+s.want)
	})
}

// ---------------------------------------------------------------------------
// OPUS-3 and loop round 1, OPUS-1 (decided detail 246): a pipe input can't end
// in an open arrow handler. The compiler's output for each sentence must equal
// its output for the fully parenthesized greedy reading: two inputs the spec
// says are one program. The grammar lab has no pipe productions, so it can't
// count these derivations.

var loopR3PipeEdgeQuotes = []string{
	"It is a Syntax Error if the input of a [PipeExpression](#pipeexpression) ends in an open arrow handler",
	"Parentheses around the handler or the whole `catch` expression, a `NonArrowHandler` and a block-bodied arrow close the handler",
}

var pipeEdgeSentences = []struct{ name, source, greedy string }{
	{"head", "a catch () => b |> % + 1", "a catch (() => (b |> % + 1))"},
	{"right-edge", "a |> % catch () => b |> % + 1", "a |> (% catch (() => (b |> % + 1)))"},
	{"two-links", "a |> % |> % catch () => b |> % + 1", "(a |> %) |> (% catch (() => (b |> % + 1)))"},
	{"three-after", "a |> % catch () => b |> % + 1 |> % * 2", "a |> (% catch (() => ((b |> % + 1) |> % * 2)))"},
	{"effect-arrow", "a |> % catch effect () => b |> % + 1", "a |> (% catch (effect () => (b |> % + 1)))"},
	{"closed-paren", "(a catch () => b) |> % + 1", "(a catch (() => b)) |> % + 1"},
	{"closed-paren-input", "(a |> % catch () => b) |> % + 1", "(a |> (% catch (() => b))) |> % + 1"},
	{"closed-handler", "a catch function () { return 1 } |> % + 1", "(a catch function () { return 1 }) |> % + 1"},
	{"block-arrow", "a catch () => { return 1 } |> % + 1", "(a catch (() => { return 1 })) |> % + 1"},
	{"block-effect-arrow", "a catch effect () => { return 1 } |> % + 1", "(a catch (effect () => { return 1 })) |> % + 1"},
	{"pipe-only", "a |> % |> % ", "(a |> %) |> %"},
}

func TestPipeEdgeQuoted(t *testing.T) { r3Quoted(t, "900-appendices.md", loopR3PipeEdgeQuotes...) }

func FuzzPipeRightEdge(f *testing.F) {
	startShortBudget(f)
	r3Quoted(f, "900-appendices.md", loopR3PipeEdgeQuotes...)
	names := make([]string, len(pipeEdgeSentences))
	for i, s := range pipeEdgeSentences {
		names[i] = s.name
	}
	r3Seeds(f, names)
	w := NewWorkspace(f)
	const prelude = "declare const a: Effect.Effect<number, string>\ndeclare const b: number\nexport effect function f() { return "
	f.Fuzz(func(t *testing.T, data []byte) {
		s := pipeEdgeSentences[r3Pick(data, names)]
		left, err := w.Compile(t.Context(), Single(prelude+s.source+" }\n"))
		if err != nil {
			t.Fatal(err)
		}
		right, err := w.Compile(t.Context(), Single(prelude+s.greedy+" }\n"))
		if err != nil {
			t.Fatal(err)
		}
		if errs := r3Errors(left.Diagnostics); len(errs) > 0 {
			Gap(t, "FuzzPipeRightEdge", "accepted:"+s.name, "900-appendices: %s must compile, reports %v", s.source, errs)
			return
		}
		if left.Outputs["main.js"] != right.Outputs["main.js"] {
			Gap(t, "FuzzPipeRightEdge", "reading:"+s.name, "900-appendices: %s; %q and %q emit differently:\n%s\n---\n%s", loopR3PipeEdgeQuotes[0], s.source, s.greedy, left.Outputs["main.js"], right.Outputs["main.js"])
		}
	})
}

// ---------------------------------------------------------------------------
// OPUS-3 (decided detail 246): an arrow as a whole pipe body, EffectArrow
// included, reads as the pinned covering restriction wherever the arrow sits.

const pipeArrowBodyQuote = "arrow bodies, an `EffectArrow` included, reject a body"

func TestPipeArrowBodyQuoted(t *testing.T) { r3Quoted(t, "900-appendices.md", pipeArrowBodyQuote) }

func FuzzPipeArrowBody(f *testing.F) {
	startShortBudget(f)
	r3Quoted(f, "900-appendices.md", pipeArrowBodyQuote)
	shapes := []struct {
		name, source string
		bad          bool
	}{
		{"plain", "1 |> () => %", true},
		{"async", "1 |> async () => %", true},
		{"effect", "1 |> effect () => %", true},
		{"effect-block-body", "1 |> effect () => { return % }", true},
		{"paren-plain", "1 |> (() => %)", false},
		{"paren-effect", "1 |> (effect () => %)", false},
		{"array-callable", "1 |> [%, effect () => 0]", false},
	}
	names := make([]string, len(shapes))
	for i, s := range shapes {
		names[i] = s.name
	}
	r3Seeds(f, names)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		s := shapes[r3Pick(data, names)]
		source := "export const v = " + s.source + "\n"
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		errs := r3Errors(r.Diagnostics)
		if !s.bad {
			if len(errs) > 0 {
				Gap(t, "FuzzPipeArrowBody", "valid:"+s.name, "900-appendices: %s should compile, reports %v", s.source, errs)
			}
			return
		}
		if len(errs) == 0 {
			Gap(t, "FuzzPipeArrowBody", "accepted:"+s.name, "900-appendices: %s; %s compiles", pipeArrowBodyQuote, s.source)
		}
	})
}
