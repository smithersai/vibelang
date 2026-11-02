package vibelangfuzz

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// Owner-block diagnostics for chapter 2 rules the compiler used to report
// with TypeScript's codes (decided detail 247): EK2202 for restore in a for
// concurrent item region or across a function boundary, EK0202 for a jump out
// of an effect block, and EK0201 for a do expression without a completion
// value. Each target reads its rule from the chapter and keys its corpus by
// the rule's name.

func chapterSays(t testing.TB, chapter, quote string) {
	t.Helper()
	text, err := os.ReadFile(SpecPath(chapter))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), quote) {
		t.Fatalf("%s no longer says %q", chapter, quote)
	}
}

// keyedChoice picks the entry of keys named by data, or by its first byte for
// an unkeyed input, and returns the index and the bytes after the key.
func keyedChoice(keys []string, data []byte) (int, []byte) {
	choice, tail := 0, data
	if len(data) > 0 {
		choice = int(data[0]) % len(keys)
		tail = data[1:]
	}
	for i, key := range keys {
		if string(data) == key {
			return i, nil
		}
		if rest, ok := strings.CutPrefix(string(data), key+":"); ok {
			return i, []byte(rest)
		}
	}
	return choice, tail
}

func codesOf(diagnostics []*ast.Diagnostic, codes ...int32) map[int32]int {
	seen := map[int32]int{}
	for _, d := range diagnostics {
		for _, code := range codes {
			if d.Code() == code && (IsEK(d) || code > 1000 && !IsEK(d)) {
				seen[code]++
			}
		}
	}
	return seen
}

const restorePlacementTarget = "FuzzRestorePlacement"
const restorePlacementQuote = "the nested Effect, or each item's Effect, is outside the enclosing mask's control"

func TestRestorePlacementQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", restorePlacementQuote)
}

// A restore site is checked under no mask and under an enclosing
// uninterruptible block. "inline" sites run on the enclosing fiber: masked
// they report nothing, unmasked EK2111. "boundary" sites are their own
// Effects: under an outer mask they report EK2202, otherwise EK2111. "item"
// sites are a for concurrent item region, EK2202 either way (VIP-22, amended
// 2026-10-30 and 2026-10-31).
func FuzzRestorePlacement(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "002-running.md", restorePlacementQuote)
	sites := []struct{ key, body, kind string }{
		{"limit", "for concurrent(do { restore { }; 2 }) (const x of [1]) { x }", "inline"},
		{"iterable", "for concurrent (const x of do { restore { }; [1] }) { x }", "inline"},
		{"nested-do", "const v = do { restore { }; 1 }", "inline"},
		{"plain-for", "for (const x of [1]) { restore { } }", "inline"},
		{"interruptible", "interruptible { restore { } }", "inline"},
		{"head-default", "for concurrent (const { n = do { restore { }; 1 } } of [{ n: 1 }]) { n }", "item"},
		{"body", "for concurrent (const x of [1]) { restore { } }", "item"},
		{"inner-mask", "for concurrent (const x of [1]) { uninterruptible { restore { } } }", "item"},
		{"effect-block", "const e = effect { restore { } }", "boundary"},
		{"effect-arrow", "const e = effect () => { restore { } }", "boundary"},
		{"function", "effect function g() { restore { } }", "boundary"},
		{"method", "const o = { effect m() { restore { } } }", "boundary"},
		{"producer", "effect function* g() { restore { } }", "boundary"},
	}
	keys := make([]string, len(sites))
	for i, site := range sites {
		keys[i] = site.key
		f.Add([]byte(site.key + ":\x00"))
		f.Add([]byte(site.key + ":\x01"))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		choice, tail := keyedChoice(keys, data)
		masked := len(tail) > 0 && tail[0]%2 == 1
		site := sites[choice]
		body := site.body
		if masked {
			body = "uninterruptible { " + body + " }"
		}
		source := "import { Effect } from \"effect\";\nexport effect function f() { " + body + " }"
		r, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var want int32
		switch site.kind {
		case "item":
			want = 2202
		case "boundary":
			want = 2111
			if masked {
				want = 2202
			}
		case "inline":
			if !masked {
				want = 2111
			}
		}
		key := "rule:" + site.key
		if masked {
			key += ":masked"
		}
		got := codesOf(r.Diagnostics, 2111, 2202)
		ok := len(got) == 0 && want == 0 || len(got) == 1 && got[want] == 1
		if !ok {
			Gap(t, restorePlacementTarget, key, "%s; expected EK%04d (0: none), got EK2111 x%d, EK2202 x%d\n%s\n%v", restorePlacementQuote, want, got[2111], got[2202], source, Keys(r.Dir, r.Diagnostics))
		}
		ExpectPending(t, restorePlacementTarget, key)
		ExpectPending(t, restorePlacementTarget, specCorpusKey(t))
	})
}

const effectBlockJumpTarget = "FuzzEffectBlockJumps"
const effectBlockJumpQuote = "whose target is outside the block"

func TestEffectBlockJumpsQuoted(t *testing.T) {
	chapterSays(t, "900-appendices.md", effectBlockJumpQuote)
}

// A break or continue whose target is outside its effect block is EK0202 and
// hides TypeScript's TS1107; one whose target is inside the block is ordinary
// code, and one inside a source function in the block is TypeScript's own
// function-boundary error (decided detail 247).
func FuzzEffectBlockJumps(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "900-appendices.md", effectBlockJumpQuote)
	sites := []struct{ key, body, want string }{
		{"break-out", "effect { if (x > 1) break; return x }", "EK0202"},
		{"continue-out", "effect { if (x > 1) continue; return x }", "EK0202"},
		{"labeled-break-out", "effect { for (const y of [1]) { break outer } return x }", "EK0202"},
		{"labeled-continue-out", "effect { if (x) continue outer; return x }", "EK0202"},
		{"nested-loop-out", "effect { for (const y of [x]) { if (y) break outer } return x }", "EK0202"},
		{"break-in", "effect { for (const y of [x]) { if (y) break } return x }", ""},
		{"continue-in", "effect { for (const y of [x]) { if (y) continue } return x }", ""},
		{"switch-in", "effect { switch (x) { case 1: break } return x }", ""},
		{"labeled-in", "effect { inner: for (const y of [x]) { if (y) continue inner } return x }", ""},
		{"arrow-inside", "effect { const g = () => { break }; return x }", "TS1107"},
	}
	keys := make([]string, len(sites))
	for i, site := range sites {
		keys[i] = site.key
		f.Add([]byte(site.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		choice, _ := keyedChoice(keys, data)
		site := sites[choice]
		source := "import { Effect } from \"effect\";\nexport effect function f(xs: number[]) { outer: for (const x of xs) { const e = " + site.body + "; try e } }"
		r, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var ek, ts int
		for _, d := range r.Diagnostics {
			switch {
			case IsEK(d) && d.Code() == 202:
				ek++
			case !IsEK(d) && d.Code() == 1107:
				ts++
			}
		}
		var ok bool
		switch site.want {
		case "EK0202":
			ok = ek == 1 && ts == 0
		case "TS1107":
			ok = ek == 0 && ts == 1
		default:
			ok = ek == 0 && ts == 0 && !HasError(r.Diagnostics)
		}
		key := "rule:" + site.key
		if !ok {
			Gap(t, effectBlockJumpTarget, key, "%s; expected %q, got EK0202 x%d, TS1107 x%d\n%s\n%v", effectBlockJumpQuote, site.want, ek, ts, source, Keys(r.Dir, r.Diagnostics))
		}
		ExpectPending(t, effectBlockJumpTarget, key)
		ExpectPending(t, effectBlockJumpTarget, specCorpusKey(t))
	})
}

const doCompletionTarget = "FuzzDoCompletion"
const doCompletionQuote = "EndsInIterationOrBareIfOrDeclaration"

func TestDoCompletionQuoted(t *testing.T) { ownerDoCompletionRules(t) }
func ownerDoCompletionRules(t testing.TB) {
	t.Helper()
	chapterSays(t, "002-running.md", doCompletionQuote)
	chapterSays(t, "002-running.md", "For `Statement : VariableStatement`, the pinned predicate returns `isLast`.")
	chapterSays(t, "002-running.md", "`var` in a `do` expression in a parameter list is `EK0203`.")
	const grammar = `StatementListItem :
        Declaration

      Statement :
        VariableStatement

      LabelledItem :
        FunctionDeclaration
    </emu-grammar>
    <emu-alg>
      1. Return _isLast_.`
	draft, err := os.ReadFile(SpecPath("../vips/tc39-do-expressions/spec.emu"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(draft), grammar) {
		t.Fatal("VIP-2's pinned VariableStatement rule no longer returns isLast; reconcile the oracle")
	}
}

// A do expression whose block ends in an iteration statement, a bare if or a
// declaration is EK0201 at the parser, never TypeScript's TS1109; a block
// ending in an expression, an if with an else, a throw or a nested block that
// ends well is admitted (VIP-2, decided detail 247).
func FuzzDoCompletion(f *testing.F) {
	startShortBudget(f)
	ownerDoCompletionRules(f)
	sites := []struct {
		key, last string
		bad       bool
	}{
		{"let", "let n = 1", true},
		{"const", "const n = 1", true},
		{"function", "function g() { return 1 }", true},
		{"class", "class C { }", true},
		{"for", "for (let i = 0; i < 1; i++) { }", true},
		{"for-of", "for (const x of [1]) { }", true},
		{"while", "while (false) { }", true},
		{"do-while", "do { } while (false)", true},
		{"bare-if", "if (c) { 1 }", true},
		{"nested-block-let", "{ let n = 1 }", true},
		{"nested-if-let", "if (c) { 1 } else { let n = 1 }", true},
		{"expression", "1", false},
		{"if-else", "if (c) { 1 } else { 2 }", false},
		{"throw", "throw new Error(\"x\")", false},
		{"nested-block", "{ 1 }", false},
		{"loop-then-expression", "for (const x of [1]) { } 7", false},
		{"trailing-empty", "3;;;", false},
		{"only-empty", ";", false},
		{"labeled-block", "label: { 1 }", false},
		{"labeled-loop", "label: for (;;) { break label }", true},
		{"switch-empty", "switch (0) { }", false},
		{"switch-clause-expression", "switch (0) { case 0: 1; default: 2 }", false},
		{"switch-clause-let", "switch (0) { case 0: let n = 1 }", true},
		{"switch-clause-bare-if", "switch (0) { default: if (c) { 1 } }", true},
		{"var", "var n = 1", true},
		{"break", "break", false},
		{"continue", "continue", false},
		{"var-trailing-empty", "var n = 1; ;", true},
		{"var-trailing-block", "var n = 1; {}", true},
		{"var-nested", "{ var n = 1 }", true},
		{"var-nested-empty", "{ var n = 1; {} }", true},
		{"var-multiple", "var a = 1, n = 2", true},
		{"var-then-value", "var n = 1; n", false},
		{"var-then-value-empty", "var n = 1; n; {}; ;", false},
		{"var-nested-then-value", "{ var n = 1; n }", false},
		{"parameter-var", "var n = 1; n", false},
	}
	for _, key := range []string{"d1", "d2", "d3", "d4", "d5", "d6", "position", "conditional", "logical", "finally", "parameter", "nested", "invalid", "outer-completion", "outer-receiver", "outer-conditional", "outer-finally", "outer-invalid", "outer-return", "outer-bindings", "user-prefixed-auto", "user-never-iteration", "empty-captures", "empty-source", "empty-source-filled", "literal-captures", "context-captures", "source-literal", "type"} {
		sites = append(sites, struct {
			key, last string
			bad       bool
		}{"never-" + key, "", false})
	}
	keys := make([]string, len(sites))
	for i, site := range sites {
		keys[i] = site.key
		if strings.HasPrefix(site.key, "never-") {
			// These keys have a checked-in canonical corpus entry. Go runs
			// that entry in short mode too; do not compile it twice.
			if _, err := os.Stat(filepath.Join("testdata", "fuzz", doCompletionTarget, site.key)); err != nil {
				f.Fatal(err)
			}
			continue
		}
		f.Add([]byte(site.key))
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		choice, tail := keyedChoice(keys, data)
		site := sites[choice]
		if key, ok := strings.CutPrefix(site.key, "never-"); ok {
			if key == "type" {
				checkDoNeverCompletionType(t, tail)
				ExpectPending(t, doCompletionTarget, specCorpusKey(t))
				return
			}
			checkDoNeverCompletion(t, NewWorkspace(t), StockTypeScript(t), key, tail)
			ExpectPending(t, doCompletionTarget, specCorpusKey(t))
			return
		}
		var wantCode int32
		if site.bad {
			wantCode = parser.DoEndsCode
		}
		type probe struct {
			scope, source string
			code          int32
		}
		probes := []probe{{"module", "declare const c: boolean\nexport const v = do { " + site.last + " }\n", wantCode}}
		if site.key == "parameter-var" {
			probes = []probe{{"parameter", "export function f(value = do { " + site.last + " }) { return value }", parser.DoParameterVarCode}}
		} else if strings.HasPrefix(site.key, "var") {
			for _, context := range []struct{ name, head string }{{"plain", "function"}, {"effect", "effect function"}} {
				probes = append(probes, probe{context.name, "export " + context.head + " f() { const value = do { " + site.last + " }; return value }", wantCode})
			}
		}
		for _, sample := range probes {
			file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, sample.source)
			var matching, other int
			for _, diagnostic := range file.Diagnostics() {
				if IsEK(diagnostic) && diagnostic.Code() == sample.code {
					matching++
				} else {
					other++
				}
			}
			wantCount := 0
			want := "no parse diagnostics"
			if sample.code != 0 {
				wantCount = 1
				want = fmt.Sprintf("one EK%04d", sample.code)
			}
			key := "rule:" + site.key
			if sample.scope != "module" && sample.scope != "parameter" {
				key += ":" + sample.scope
			}
			if matching != wantCount || other != 0 {
				Gap(t, doCompletionTarget, key, "%s; %s context wants %s, got matching x%d and other x%d\n%s\n%v", doCompletionQuote, sample.scope, want, matching, other, sample.source, file.Diagnostics())
			}
			ExpectPending(t, doCompletionTarget, key)
		}
		ExpectPending(t, doCompletionTarget, specCorpusKey(t))
	})
}

const doLoopHeadTarget = "FuzzDoLoopHead"
const doLoopHeadQuote = "a `break` or `continue` in a loop head's `do` that leaves it unlabeled or targets that loop"

func TestDoLoopHeadQuoted(t *testing.T) { chapterSays(t, "900-appendices.md", doLoopHeadQuote) }

// Appendix B owns EK0205. All consecutive labels denote this loop;
// a jump to a genuinely enclosing statement or a local loop is exempt.
// Exercise each head position, both jumps and every label in chains of
// one to three labels, with keyed inputs and optional nested source blocks.
func FuzzDoLoopHead(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "900-appendices.md", doLoopHeadQuote)
	type site struct {
		key, head, labels, keyword, target string
	}
	var sites []site
	for _, head := range []struct{ key, text string }{
		{"while", "while ($do) {}"},
		{"do-while", "do {} while ($do);"},
		{"for-initializer", "for ($do; false;) {}"},
		{"for-declaration", "for (let v = $do; false;) {}"},
		{"for-condition", "for (; $do;) {}"},
		{"for-update", "for (; false; $do) {}"},
		{"for-of", "for (const v of $do) {}"},
		{"for-in", "for (const v in $do) {}"},
		{"for-binding-default", "for (const { v = $do } of [{}]) {}"},
	} {
		for length := 1; length <= 3; length++ {
			var labels []string
			for i := 0; i < length; i++ {
				labels = append(labels, fmt.Sprintf("label%d", i))
			}
			for _, keyword := range []string{"break", "continue"} {
				for _, target := range append(append([]string{"unlabeled"}, labels...), "enclosing", "local", "local-loop", "function") {
					key := fmt.Sprintf("%s-%d-%s-%s", head.key, length, keyword, target)
					sites = append(sites, site{key, head.text, strings.Join(labels, ": ") + ": ", keyword, target})
				}
			}
		}
	}
	keys := make([]string, len(sites))
	for i, s := range sites {
		keys[i] = s.key
		f.Add([]byte(s.key))
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		choice, tail := keyedChoice(keys, data)
		s := sites[choice]
		jump := s.keyword + " " + s.target + ";"
		if s.target == "unlabeled" {
			jump = s.keyword + ";"
		}
		body, want := jump, 1
		switch s.target {
		case "enclosing":
			want = 0
		case "local":
			body, want = "local: while (true) { "+jump+" }", 0
		case "local-loop":
			body, want = "while (true) { "+s.keyword+"; }", 0
		case "function":
			body, want = "function g() { while (true) { "+s.keyword+"; } }", 0
		}
		if len(tail) > 0 {
			for depth := 0; depth < int(tail[0]%4); depth++ {
				body = "{ " + body + " }"
			}
		}
		loop := s.labels + strings.ReplaceAll(s.head, "$do", "do { "+body+" [] }")
		source := "function f() { enclosing: while (true) { " + loop + " } }"
		file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
		got, other := 0, 0
		for _, d := range file.Diagnostics() {
			if IsEK(d) && d.Code() == parser.DoLoopHeadCode {
				got++
			} else if !IsEK(d) || d.Code() != parser.DoBoundaryCode {
				other++
			}
		}
		// Some head positions also retain the distinct EK0204 lowering
		// limitation. The oracle asserts the owning early error regardless.
		key := "rule:" + s.key
		if got != want || other != 0 {
			Gap(t, doLoopHeadTarget, key, "%s; want EK0205 x%d, got x%d and %d other errors\n%s\n%v", doLoopHeadQuote, want, got, other, source, file.Diagnostics())
		}
		ExpectPending(t, doLoopHeadTarget, key)
		ExpectPending(t, doLoopHeadTarget, specCorpusKey(t))
	})
}
