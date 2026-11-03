package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfuzz/vipgen"
)

const softKeywordTarget = "FuzzSoftKeywordBindings"

var softKeywordQuotes = []struct{ chapter, quote string }{
	{"900-appendices.md", "An `IdentifierReference`, `BindingIdentifier` or `LabelIdentifier` can't be `fork` or `join`"},
	{"900-appendices.md", "Class field and enum member initializers parse with `[~Effect]`, even inside an effect function."},
	{"900-appendices.md", "Static blocks inherit `[?Effect]` for keyword reservation, but cannot execute Effects."},
	{"900-appendices.md", "Anything else is ordinary TypeScript, where the word is an identifier:"},
	{"900-appendices.md", "Each word below is a keyword only before the tokens listed, on the same line, and an ordinary identifier everywhere else."},
	{"900-appendices.md", "`try` and `catch` are reserved words already; VibeLang gives them expression forms under `[+Effect]`."},
	{"900-appendices.md", "VibeLang's grammar is TypeScript's, plus three TC39 proposals and the productions below."},
	{"002-running.md", "contextual keywords followed by `{` on the same line, and statements in effect code."},
}

func TestSoftKeywordsQuoted(t *testing.T) { softKeywordsQuoted(t) }
func softKeywordsQuoted(t testing.TB) {
	for _, q := range softKeywordQuotes {
		if !strings.Contains(SpecText(q.chapter), q.quote) {
			t.Fatalf("%s no longer says %q", q.chapter, q.quote)
		}
	}
}

// Fail the spec gate if a newly documented contextual word has no matrix row.
func TestSoftKeywordInventoryQuoted(t *testing.T) {
	appendix := SpecText("900-appendices.md")
	section := strings.Split(strings.Split(appendix, "### Contextual keywords")[1], "### Productions")[0]
	words := regexp.MustCompile("`([A-Za-z]+)`")
	for _, row := range strings.Split(section, "\n") {
		if !strings.HasPrefix(row, "| `") {
			continue
		}
		cell := strings.Split(row, "|")[1]
		for _, match := range words.FindAllStringSubmatch(cell, -1) {
			if !slices.Contains(vipgen.SoftKeywordWords, match[1]) {
				t.Errorf("Appendix A contextual word %s has no matrix row", match[1])
			}
		}
	}
	for _, word := range []string{"service", "error", "schema", "data", "fork", "join", "try", "catch", "do"} {
		if !slices.Contains(vipgen.SoftKeywordWords, word) {
			t.Errorf("missing reserved/declaration word %s", word)
		}
	}
}
func softKeywordHasCode(ds []*ast.Diagnostic, code int32) bool {
	return slices.ContainsFunc(ds, func(d *ast.Diagnostic) bool { return d.Source() == "EK" && d.Code() == code })
}

var softKeywordStructured = regexp.MustCompile(`(?:\bruntime\.fork|\bforkChild|\bFiber\.join|\bfork_[0-9]+|\$join(?:_[0-9]+)?|\$fork(?:_[0-9]+)?)\s*\(`)

func softKeywordCodes(ds []*ast.Diagnostic) []string {
	var codes []string
	for _, d := range ds {
		if d.Category() == diagnostics.CategoryError {
			codes = append(codes, fmt.Sprintf("%s:%d", d.Source(), d.Code()))
		}
	}
	slices.Sort(codes)
	return slices.Compact(codes)
}

// softKeywordNativeDiagnostics compares a .vibe twin with its .ts twin. A source
// native TypeScript rejects must stay rejected, though recovery after invalid
// syntax may report other codes. A source it accepts must keep its code set, with
// one exception: await as an identifier. TypeScript's parser leaves that to its
// checker or accepts it, but it is a SyntaxError in the ES modules VibeLang emits,
// and the .vibe parser rejects it, so a rejection there is right.
func softKeywordNativeDiagnostics(s vipgen.SoftKeywordShape, got, native []*ast.Diagnostic) bool {
	if HasError(native) {
		return HasError(got)
	}
	if s.Word == "await" && s.Form != "property" && HasError(got) {
		return true
	}
	return slices.Equal(softKeywordCodes(got), softKeywordCodes(native))
}
func softKeywordCheck(t *testing.T, w *Workspace, s vipgen.SoftKeywordShape, emit bool) {
	t.Helper()
	v, ts := s.Sources()
	key := s.Key()
	if key == "fork:const:effect:called" {
		sources := []*string{&v, &ts}
		for i, ext := range []string{"vibe", "ts"} {
			raw, err := os.ReadFile(filepath.Join("testdata", "soft-keywords", "opencode-local-fork-binding."+ext))
			if err != nil {
				t.Fatal(err)
			}
			*sources[i] = string(raw)
		}
	}
	gaps := &Gaps{Target: softKeywordTarget, Input: key}
	// Reservation is a compiler diagnostic contract, not a requirement that
	// ParseSourceFile alone report it. Always run the compiler for these shapes.
	if s.ReservedBinding() || ((s.Word == "fork" || s.Word == "join") && (s.Home == "effect" || s.Home == "static-effect") && s.Form == "import") {
		emit = true
	}
	if !emit {
		got := parseAs(parseKinds[0], v).Diagnostics()
		control := parseAs(parseKinds[2], ts).Diagnostics()
		if !softKeywordNativeDiagnostics(s, got, control) {
			gaps.Add("parse:"+key, "ordinary TypeScript twin differs: vibe %v; ts %v\n%s", SortedKeys(Keys("/fuzz", got)), SortedKeys(Keys("/fuzz", control)), v)
		}
		gaps.Finish(t)
		ExpectPending(t, softKeywordTarget, "parse:"+key)
		return
	}
	compile := func(file, src string) *Compilation {
		c, err := w.CompileOrdered(t.Context(), Project{Files: map[string]string{file: src, "soft-keyword-helper.ts": vipgen.SoftKeywordHelper}, Config: `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"outDir":"out","noCheck":false},"vibe":{"effectModules":false}}`}, OrderTsc, true)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(c.Remove)
		return c
	}
	// An identical .ts source uses native TypeScript syntax and no VibeLang parser.
	got := compile("main.vibe", v)
	if s.ReservedBinding() {
		if !softKeywordHasCode(got.Diagnostics, 1702) {
			gaps.Add("binding:"+key, "required EK1702; got %v\n%s\nemitted:\n%s", SortedKeys(Keys(got.Dir, got.Diagnostics)), v, got.Outputs["out/main.js"])
		}
	} else {
		native := compile("main.ts", ts)
		// Import-bound fork/join references in Effect code are operators, not local
		// reserved bindings, and have operand rules.
		operator := (s.Word == "fork" || s.Word == "join") && (s.Home == "effect" || s.Home == "static-effect") && s.Form == "import"
		bannedCatch := (s.Home == "effect" || s.Home == "static-effect") && s.Form == "catch"
		if operator {
			if !HasError(got.Diagnostics) {
				gaps.Add("operator:"+key, "a reserved operation with a non-Effect, non-Fiber operand must fail\n%s\nemitted:\n%s", v, got.Outputs["out/main.js"])
			}
		} else if bannedCatch {
			// A try statement in Effect code has its own rule, EK0503. Here the catch
			// parameter is an ordinary binding: its use must stay a use of it.
			if operation := softKeywordStructured.FindString(got.Outputs["out/main.js"]); operation != "" && !HasError(got.Diagnostics) {
				gaps.Add("catch:"+key, "catch parameter use emitted structured operation %q\n%s", operation, got.Outputs["out/main.js"])
			}
		} else {
			if !softKeywordNativeDiagnostics(s, got.Diagnostics, native.Diagnostics) {
				gaps.Add("diagnostics:"+key, "TypeScript twin: %v; VibeLang: %v\n%s", SortedKeys(Keys(native.Dir, native.Diagnostics)), SortedKeys(Keys(got.Dir, got.Diagnostics)), v)
			}
			if !s.EffectResult() && !HasError(native.Diagnostics) {
				if got.Outputs["out/main.js"] != native.Outputs["out/main.js"] {
					gaps.Add("emit:"+key, "identifier emit must equal native TypeScript\nTS:\n%s\nVibe:\n%s", native.Outputs["out/main.js"], got.Outputs["out/main.js"])
				}
			}
		}
	}
	gaps.Finish(t)
	for _, prefix := range []string{"binding:", "emit:", "diagnostics:", "operator:", "catch:"} {
		ExpectPending(t, softKeywordTarget, prefix+key)
	}
}
func FuzzSoftKeywordBindings(f *testing.F) {
	startShortBudget(f)
	softKeywordsQuoted(f)
	shapes := vipgen.SoftKeywordShapes()
	// Every shape is a cheap parser oracle; a covering sample additionally checks
	// diagnostics and emit. Campaign mutations can select full compilation for any
	// keyed shape, without changing a saved corpus when the word list grows.
	for i, s := range shapes {
		if !testing.Short() || i%31 == 0 {
			f.Add(s.Key(), false)
		}
	}
	for i, w := range vipgen.SoftKeywordWords {
		s := vipgen.SoftKeywordShape{Word: w, Form: vipgen.SoftKeywordForms[i%len(vipgen.SoftKeywordForms)], Home: vipgen.SoftKeywordHomes[i%len(vipgen.SoftKeywordHomes)], Use: vipgen.SoftKeywordUses[i%len(vipgen.SoftKeywordUses)]}
		f.Add(s.Key(), true)
	}
	workspace := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, emit bool) {
		if len(key) > 512 {
			t.Skip("oversized shape key")
		}
		defer recoverCompilerPanic(t, softKeywordTarget)
		s := vipgen.SoftKeywordShapeFor(key)
		softKeywordCheck(t, workspace, s, emit)
		ExpectPending(t, softKeywordTarget, specCorpusKey(t))
	})
}
func TestSoftKeywordMatrix(t *testing.T) {
	for kind := ast.KindFirstKeyword; kind <= ast.KindLastKeyword; kind++ {
		word := scanner.TokenToString(kind)
		if word == "" || !slices.Contains(vipgen.SoftKeywordWords, word) {
			t.Errorf("inherited TypeScript keyword %q has no matrix row", word)
		}
	}

	shapes := vipgen.SoftKeywordShapes()
	seen := map[string]bool{}
	for _, s := range shapes {
		if seen[s.Key()] || vipgen.SoftKeywordShapeFor(s.Key()) != s {
			t.Fatal("unstable shape", s.Key())
		}
		seen[s.Key()] = true
	}
	t.Logf("%d words × %d bindings × %d positions × %d uses = %d generated shapes", len(vipgen.SoftKeywordWords), len(vipgen.SoftKeywordForms), len(vipgen.SoftKeywordHomes), len(vipgen.SoftKeywordUses), len(shapes))
	if len(shapes) != len(vipgen.SoftKeywordWords)*10*8*3 {
		t.Fatal(fmt.Sprint(len(shapes)))
	}
}
