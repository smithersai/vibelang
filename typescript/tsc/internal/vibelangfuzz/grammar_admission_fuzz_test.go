package vibelangfuzz

import (
	"context"
	"fmt"
	"hash/fnv"
	"strings"
	"sync"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// Appendix A is an admission rule, not an implementation-derived allowlist.
// The implication includes programs with type/name/placement errors: those
// errors do not authorize a syntax absent from the language.
const grammarAdmissionQuote = "VibeLang's grammar is TypeScript's, plus three TC39 proposals and the productions below."
const grammarAdmissionRecoveryQuote = "parses, then the top-level-shorthand rule rejects it"
const grammarTopicQuote = "%` is the topic: the left side's value, evaluated once."

func TestGrammarAdmissionQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarAdmissionQuote) {
		t.Fatal("Appendix A admission quote changed; review the oracle")
	}
	if !strings.Contains(SpecText(grammarAppendix), grammarAdmissionRecoveryQuote) {
		t.Fatal("Appendix A shorthand recovery quote changed; review syntax rejection")
	}
	// The topic grammar is incorporated from the pinned proposal, not TS.
	if !strings.Contains(SpecText("../vips/0023-pipe.md"), grammarTopicQuote) {
		t.Fatal("VIP-23 topic quote changed; review the external grammar")
	}
}

var admissionLab = sync.OnceValues(func() (*grammarLab, error) {
	return grammarNewGrammarLab(SpecText(grammarAppendix), grammarAppendix)
})

// Keyed witnesses stay keyed when the valid seed list is reordered. Mutations
// operate only in the explicitly bounded TS subset of the grammar lab. A
// mismatch can be a compiler admission bug OR an incomplete lab; minimize and
// classify before adding a pending line.
var grammarAdmissionSeeds = []struct{ key, source string }{
	{"plain", "const n = 1;"},
	{"effect", "effect function f(p) { return try p; }"},
	{"block", "const p = effect { return 1; };"},
	{"catch-arrow", "effect function f(p) { return p catch () => 1; }"},
	{"fork", "effect function f(p) { return fork p; }"},
	{"join", "effect function f(p) { return join p; }"},
	{"pipe", "const n = 1 |> % + 1;"},
	{"pipe-chain", "const n = 1 |> % + 1 |> % * 2;"},
	{"function-kind", "function f(p) { return try p; }"},
	{"try-function-fork", "try function f(p) { return fork\nfork p; }"},
	{"catch-value", "effect function f(p) { return p catch 1; }"},
	{"throw-expression", "function f(x, e) { return x ?? throw e; }"},
	{"throw-expression-return", "effect function f(p) { return throw try p; }"},
	{"inline-module", "module M { export const n = 1; }"},
	{"inline-module-no-name", "module { export const n = 1; }"},
	{"service-shape", "service Port: number;"},
	{"layer-declaration", "service S { n: number } layer Live: S { n: 1 }"},
	{"trailing-block", "function f() { return g(1) { return 2; }; }"},
	{"trailing-block-bare", "M {}"},
	{"async-shorthand", "async f() { return 1; }"},
}

func FuzzGrammarAdmission(f *testing.F) {
	startShortBudget(f)
	w := NewWorkspace(f)
	for _, s := range grammarAdmissionSeeds {
		f.Add([]byte("key:" + s.key + "\n" + s.source))
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) == 0 || len(data) > 1024 {
			t.Skip("bounded grammar subset")
		}
		key, source := grammarAdmissionInput(data)
		checkGrammarAdmission(t, w, key, source)
	})
}

func grammarAdmissionInput(data []byte) (string, string) {
	if strings.HasPrefix(string(data), "key:") {
		if head, source, ok := strings.Cut(string(data), "\n"); ok {
			key := strings.TrimPrefix(head, "key:")
			for _, seed := range grammarAdmissionSeeds {
				if seed.key == key {
					if seed.source == source {
						return "admission:" + key, source
					}
					return grammarAdmissionMutate(seed.source, []byte(source))
				}
			}
		}
	}
	s := grammarAdmissionSeeds[int(data[0])%len(grammarAdmissionSeeds)]
	return grammarAdmissionMutate(s.source, data)
}

func grammarAdmissionMutate(seed string, data []byte) (string, string) {
	toks := grammarLexSource(seed)
	// Insert/delete/replace/duplicate a token, or move a line boundary.
	// Punctuation and contextual words deliberately cross form boundaries.
	words := []string{"catch", "throw", "effect", "async", "join", "fork", "try", "|>", "%", "{", "}", "(", ")", ";", "=>", "??", "1"}
	for i := 1; i+2 < len(data) && i < 25; i += 3 {
		if len(toks) == 0 {
			break
		}
		at := int(data[i+1]) % len(toks)
		choice := grammarLexSource(words[int(data[i+2])%len(words)])[0]
		switch data[i] % 5 {
		case 0:
			toks = append(toks[:at], append([]grammarToken{choice}, toks[at:]...)...)
		case 1:
			toks = append(toks[:at], toks[at+1:]...)
		case 2:
			toks[at] = choice
		case 3:
			toks[at].nl = !toks[at].nl
		case 4:
			copyToken := toks[at]
			toks = append(toks[:at], append([]grammarToken{copyToken}, toks[at:]...)...)
		}
	}
	// A generated mismatch is not hidden by its seed's known gap: source
	// mutations get their own key, and corpus replay adds its precise key.
	source := grammarSpell(toks)
	return grammarAdmissionMutationKey(source), source
}

func grammarAdmissionMismatch(source string) (bool, string) {
	file := parseAs(parseKind{"/fuzz/main.vibe", core.ScriptKindTS}, source)
	if len(file.Diagnostics()) != 0 {
		return false, "compiler syntax error"
	}
	lab, err := admissionLab()
	if err != nil {
		return true, err.Error()
	}
	toks := grammarLexSource(source)
	r := lab.read(lab.g, toks, grammarParseMode{prose: true, names: true})
	if r.count == 0 {
		return true, "compiler reports no syntax rejection, but Appendix A has no derivation (check compiler admission or lab coverage)"
	}
	return false, ""
}

func checkGrammarAdmission(t *testing.T, w *Workspace, key, source string) {
	t.Helper()
	g := &Gaps{Target: "FuzzGrammarAdmission", Input: source}
	mismatch, detail := grammarAdmissionMismatch(source)
	if mismatch {
		// Only an absent derivation needs a full check. Type/name errors do not
		// excuse it, but compiler syntax rejection does. EK4618 is the explicit
		// EffectShorthand recovery rule (EK0103 after renumbering): Appendix A says it "parses, then the
		// top-level-shorthand rule rejects it", even though its diagnostic is
		// produced by the checker.
		result, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		if result.Program != nil && HasError(result.Program.GetSyntacticDiagnostics(context.Background(), nil)) {
			mismatch = false
		}
		var observed []string
		for _, d := range result.Diagnostics {
			observed = append(observed, fmt.Sprintf("%s%d[category=%v]", d.Source(), d.Code(), d.Category()))
			if grammarAdmissionSyntaxDiagnostic(d) {
				mismatch = false
			}
		}
		if len(observed) == 0 {
			observed = []string{"none"}
		}
		detail += "\ncompiler diagnostics: " + strings.Join(observed, ", ")
	}
	if mismatch {
		if form := grammarAdmissionForm(source); form != "" {
			key = form
		}
		g.Add(key, "%s\nprogram:\n%s", detail, source)
	}
	if !mismatch {
		ExpectPending(t, g.Target, key)
	}
	corpus := ""
	if name := corpusFile(t, g.Target); name != "" {
		corpus = "corpus:" + name
	}
	g.FinishInput(t, corpus)
}

// This is a grammar-lab regression, independent of compiler behavior. Without
// the pinned topic primary or longest-match |> token these valid pipes have
// no derivation. Keep TS-only recognition separate.
func TestGrammarAdmissionPipes(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range []string{
		"const n = 1 |> % + 1;",
		"const n = 1 |> % + 1 |> % * 2;",
		"const n = 1 |> (% |> % + 1);",
		"const n = 5 |> % % 2;",
	} {
		t.Run(source, func(t *testing.T) {
			toks := grammarLexSource(source)
			if r := lab.read(lab.g, toks, grammarParseMode{prose: true, names: true}); r.count == 0 {
				t.Fatal("Appendix A's pinned Hack pipe has no derivation")
			}
			if r := lab.read(lab.ts, toks, grammarParseMode{}); r.count != 0 {
				t.Fatal("Hack pipe leaked into inherited TypeScript")
			}
		})
	}
}

// Corpus keys name the syntax that is actually present, rather than the seed
// selected before mutation. Known gaps therefore cover their own neighbourhood
// while a new form still receives an independent mutation key.
func grammarAdmissionForm(source string) string {
	ts := grammarLexSource(source)
	for i, tok := range ts {
		// EffectFunction = EffectModifier [no LineTerminator here] "function":
		// `effect` on the line before is its own statement after ASI.
		if tok.kind != 'w' || tok.text != "function" || i > 0 && ts[i-1].text == "effect" && !tok.nl {
			continue
		}
		body := i + 1
		for body < len(ts) && ts[body].text != "{" {
			body++
		}
		execution := false
		for j := body + 1; j < len(ts); j++ {
			if ts[j].text == "{" {
				break
			}
			if ts[j].text == "}" {
				if execution {
					return "admission:function-kind"
				}
				break
			}
			if ts[j].kind == 'w' && ts[j].text == "try" && j+1 < len(ts) && ts[j+1].text != "{" {
				execution = true
			}
		}
	}
	for i, tok := range ts {
		if tok.kind != 'w' {
			continue
		}
		next := func(n int) string {
			if i+n < len(ts) {
				return ts[i+n].text
			}
			return ""
		}
		switch tok.text {
		case "catch":
			if i+1 < len(ts) && (ts[i+1].kind == 'n' || ts[i+1].kind == 's') {
				return "admission:catch-value"
			}
		case "throw":
			if i > 0 && ts[i-1].text == "??" {
				return "admission:throw-expression"
			}
		case "service":
			if i+2 < len(ts) && ts[i+1].kind == 'w' && next(2) == ":" {
				return "admission:service-shape"
			}
		case "layer":
			if i+2 < len(ts) && ts[i+1].kind == 'w' && next(2) == ":" {
				return "admission:layer-declaration"
			}
		}
	}
	// These records classify a known mismatch; they do not decide admission.
	// Appendix A remains the independent oracle above. A trailing block may
	// follow a bare name, a member or a call.
	_, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{
		FileName: "/fuzz/main.vibe", PathKey: "/fuzz/main.vibe",
	}, source)
	for _, form := range forms {
		switch form.Kind {
		case parser.VibeSyntaxPrefix:
			// The parser records expression-position throw only. Native
			// throw statements stay distinct, including in Effect code.
			start, end := form.Word.Pos(), form.Word.End()
			if start < 0 || start > end || end > len(source) {
				continue
			}
			word := source[start:end]
			if word == "throw" {
				return "admission:throw-expression"
			}
			if word != "fork" && word != "join" {
				continue
			}
			// Only group prefixes outside every explicit Effect span. Nested
			// ordinary callables in an Effect span stay independent mutations.
			insideEffect := false
			for _, enclosing := range forms {
				if enclosing.Kind == parser.VibeSyntaxEffect && enclosing.Range.Pos() <= start && start < enclosing.Range.End() {
					insideEffect = true
				}
			}
			operand := grammarLexSource(source[end:])
			if insideEffect || len(operand) == 0 || operand[0].nl {
				continue
			}
			// A same-line name/literal juxtaposition cannot be an inherited
			// TS call, member, binary expression, tagged template or ASI.
			next := operand[0]
			if next.kind == 'w' {
				switch next.text {
				case "as", "satisfies", "in", "instanceof", "of":
					continue
				}
				return "admission:" + word + "-outside-effect"
			}
			if next.kind == 'n' || next.kind == 's' {
				return "admission:" + word + "-outside-effect"
			}
		case parser.VibeSyntaxBlockParam:
			return "admission:trailing-block"
		case parser.VibeSyntaxModule:
			return "admission:inline-module"
		}
	}
	return ""
}

func TestGrammarAdmissionMutationKeys(t *testing.T) {
	for _, key := range []string{"catch-value", "throw-expression", "inline-module", "service-shape", "layer-declaration"} {
		for _, seed := range grammarAdmissionSeeds {
			if seed.key != key {
				continue
			}
			if got := grammarAdmissionForm(seed.source); got != "admission:"+key {
				t.Errorf("%s: key %s", key, got)
			}
		}
	}
	if got := grammarAdmissionForm("effect\nfunction f(p) { return try p; }"); got != "admission:function-kind" {
		t.Errorf("effect before a line break is not a modifier: %s", got)
	}
	if got := grammarAdmissionForm("effect function f(p) { return try p; }"); got != "" {
		t.Errorf("same-line effect modifier classified as %s", got)
	}
	if got := grammarAdmissionForm("function f(p) { return fork\nfork p; }"); got != "admission:fork-outside-effect" {
		t.Errorf("outside-Effect prefix not keyed: %s", got)
	}
	for _, source := range []string{"const n = throw 1;", "effect function f(p) { return throw try p; }", "const n = (throw e);"} {
		if got := grammarAdmissionForm(source); got != "admission:throw-expression" {
			t.Errorf("throw expression family not keyed: %s: %s", source, got)
		}
	}
	for _, source := range []string{"function f() {}", "if (ok) { x(); }", "g(1)\n{}", "const x = 'catch 1';", "const x = 'module M {';", "const x = a ?? b;", "function f() { throw e; }", "effect function f() { throw e; }", "function f(p) { return fork(p); }", "function f(p) { return fork + p; }", "effect function f(p) { return fork p; }", "function f(p) { return effect () => fork p; }"} {
		if key := grammarAdmissionForm(source); key != "" {
			t.Errorf("%q classified as %s", source, key)
		}
	}
	for _, source := range []string{"M {}", "o.m {}", "g(1) {}"} {
		if got := grammarAdmissionForm(source); got != "admission:trailing-block" {
			t.Errorf("%s: %s", source, got)
		}
	}
	if got := grammarAdmissionForm("module { export const n = 1; }"); got != "admission:inline-module" {
		t.Fatalf("nameless module: %s", got)
	}
	a := []byte{0, 0, 1, 2, 1, 2, 3}
	key, source := grammarAdmissionInput(a)
	if !strings.HasPrefix(key, "mutation:") || source == "" {
		t.Fatal("mutation was not keyed independently")
	}
	key, source = grammarAdmissionInput([]byte("key:plain\nconst n = 1;"))
	if key != "admission:plain" || source != "const n = 1;" {
		t.Fatal("keyed witness did not replay")
	}
	// A fuzz mutation of the text after a key must stay in the generator's
	// bounded token language, rather than becoming arbitrary TypeScript.
	for _, name := range []string{"plain", "unknown"} {
		_, bounded := grammarAdmissionInput([]byte("key:" + name + "\nc&A00"))
		if bounded == "c&A00" || strings.Contains(bounded, "&") {
			t.Fatal("keyed source escaped the bounded token generator")
		}
	}
	changedKey, _ := grammarAdmissionInput([]byte("key:plain\nconst n = 1 ** 2;"))
	if changedKey == key || !strings.HasPrefix(changedKey, "mutation:") {
		t.Fatal("mutating a keyed program reused its original witness key")
	}
}

func grammarAdmissionMutationKey(source string) string {
	h := fnv.New64a()
	_, _ = h.Write([]byte(source))
	return fmt.Sprintf("mutation:%016x", h.Sum64())
}

// Positive controls ensure a grammar-lab omission cannot silently become a
// pending compiler gap when Appendix A factors a modifier or parameter.
func TestGrammarAdmissionCore(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	for _, seed := range grammarAdmissionSeeds {
		switch seed.key {
		case "plain", "effect", "block", "catch-arrow", "fork", "join", "pipe", "pipe-chain":
			t.Run(seed.key, func(t *testing.T) {
				if r := lab.read(lab.g, grammarLexSource(seed.source), grammarParseMode{prose: true, names: true}); r.count == 0 {
					t.Fatalf("valid Appendix A control has no derivation: %s", seed.source)
				}
			})
		}
	}
}

// Appendix A's parameter/handler/declaration syntax is sometimes diagnosed
// by checker recovery. Operand/type diagnostics (EK0502, EK1704, etc.) are
// deliberately absent: they do not excuse an undefined grammar form.
func grammarAdmissionSyntaxCode(code int32) bool {
	switch code {
	case 103, 4618: // EffectShorthand (the latter is the compatibility code).
		return true
	case 501, 504, 1701, 1001: // [+Effect] placement; EK1001 is legacy module-level try rejection.
		return true
	case 509: // CatchHandler must be a function literal.
		return true
	case 4408: // Legacy module recovery rejects a missing name; this admits no module form.
		return true
	case 906: // ServiceDeclaration requires its body.
		return true
	case 1101: // VIP-11 (amended 2026-11-01): a trailing block is the error EK1101.
		return true
	case 1007: // VIP-23 keeps TC39's topic grammar: % outside a pipe body is an early error.
		return true
	}
	return false
}

// A warning or a non-syntax error is not a syntax rejection, even if a
// diagnostic uses a recovery code or shares its number with another source.
func grammarAdmissionSyntaxDiagnostic(d *ast.Diagnostic) bool {
	if d.Category() != diagnostics.CategoryError {
		return false
	}
	if IsEK(d) {
		return grammarAdmissionSyntaxCode(d.Code())
	}
	if d.Source() != "" {
		return false
	}
	// TypeScript parses declaration modifiers and empty declaration lists for
	// recovery, then rejects
	// their position/order/duplication in checker/grammarchecks.go. These
	// exact structural diagnostics (including TS1123's empty list) reject syntax; type/name/module errors
	// such as TS1064, TS1192, TS2304 and TS2322 deliberately remain outside.
	switch d.Code() {
	case 1024, 1028, 1029, 1030, 1031, 1038, 1040, 1042, 1044,
		1070, 1071, 1079, 1089, 1090, 1123, 1184, 1187, 1242, 1243, 1248,
		1273, 1274, 1275, 1277, 1317, 1433, 1491, 1495, 18010, 18019:
		return true
	// checkGrammarModuleElementContext (checker/grammarchecks.go): an import,
	// export, export assignment, namespace or ambient module declaration
	// outside a source file or module block, e.g. `{ export = 1 }` (TS1231).
	case 1231, 1232, 1233, 1234, 1235, 1258, 1473, 1474:
		return true
	}
	return false
}

func TestGrammarAdmissionDiagnostics(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		category     diagnostics.Category
		code         int32
		want         bool
	}{
		{"recovery-error", "EK", diagnostics.CategoryError, 103, true},
		{"legacy-module-error", "EK", diagnostics.CategoryError, 4408, true},
		{"legacy-top-level-error", "EK", diagnostics.CategoryError, 1001, true},
		{"legacy-top-level-warning", "EK", diagnostics.CategoryWarning, 1001, false},
		{"native-top-level-code-collision", "", diagnostics.CategoryError, 1001, false},
		{"legacy-module-warning", "EK", diagnostics.CategoryWarning, 4408, false},
		{"recovery-warning", "EK", diagnostics.CategoryWarning, 103, false},
		{"recovery-suggestion", "EK", diagnostics.CategorySuggestion, 103, false},
		{"native-code-collision", "", diagnostics.CategoryError, 501, false},
		{"native-modifier-error", "", diagnostics.CategoryError, 1042, true},
		{"native-empty-declaration", "", diagnostics.CategoryError, 1123, true},
		{"native-empty-declaration-warning", "", diagnostics.CategoryWarning, 1123, false},
		{"external-empty-code-collision", "other", diagnostics.CategoryError, 1123, false},
		{"native-modifier-warning", "", diagnostics.CategoryWarning, 1042, false},
		{"external-modifier-code-collision", "other", diagnostics.CategoryError, 1042, false},
		{"ek-modifier-code-collision", "EK", diagnostics.CategoryError, 1042, false},
		{"native-duplicate-modifier", "", diagnostics.CategoryError, 1030, true},
		{"native-modifier-order", "", diagnostics.CategoryError, 1029, true},
		{"native-modifier-placement", "", diagnostics.CategoryError, 1184, true},
		{"native-module-element-context", "", diagnostics.CategoryError, 1231, true},
		{"native-module-element-context-warning", "", diagnostics.CategoryWarning, 1231, false},
		{"external-module-element-code-collision", "other", diagnostics.CategoryError, 1231, false},
		{"ek-module-element-code-collision", "EK", diagnostics.CategoryError, 1231, false},
		{"native-module-type-error", "", diagnostics.CategoryError, 1192, false},
		{"native-return-type-error", "", diagnostics.CategoryError, 1064, false},
		{"native-name-error", "", diagnostics.CategoryError, 2304, false},
		{"native-type-error", "", diagnostics.CategoryError, 2322, false},
		{"operand-error", "EK", diagnostics.CategoryError, 502, false},
		{"fiber-type-error", "EK", diagnostics.CategoryError, 1704, false},
		{"trailing-block-error", "EK", diagnostics.CategoryError, 1101, true},
		{"trailing-block-warning", "EK", diagnostics.CategoryWarning, 1101, false},
		{"topic-outside-pipe-error", "EK", diagnostics.CategoryError, 1007, true},
		{"topic-outside-pipe-warning", "EK", diagnostics.CategoryWarning, 1007, false},
		{"native-topic-code-collision", "", diagnostics.CategoryError, 1007, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			d := ast.NewExternalDiagnostic(nil, core.TextRange{}, tc.source, tc.category, tc.code, tc.name)
			if got := grammarAdmissionSyntaxDiagnostic(d); got != tc.want {
				t.Fatalf("syntax rejection = %v; want %v", got, tc.want)
			}
		})
	}
}
