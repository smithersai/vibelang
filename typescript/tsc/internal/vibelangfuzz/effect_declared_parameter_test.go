package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// Discover direct Effect parameters from every exported call signature in the
// pinned Effect.d.ts, including constrained duals. No hand-maintained API list.
func effectParameterCalls(t testing.TB, w *Workspace) []string {
	t.Helper()
	r, err := w.Compile(t.Context(), Project{Files: map[string]string{"inventory.ts": "import * as E from \"effect/Effect\"; export const inventory = E"}})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	if HasError(r.Diagnostics) {
		t.Fatalf("Effect inventory: %v", SortedKeys(Keys(r.Dir, r.Diagnostics)))
	}
	var module *ast.SourceFile
	for _, file := range r.Program.SourceFiles() {
		if strings.HasSuffix(string(file.FileName()), "/effect/dist/Effect.d.ts") {
			module = file
			break
		}
	}
	if module == nil {
		t.Fatal("pinned Effect.d.ts was not loaded")
	}
	c, done := r.Program.GetTypeCheckerForFile(t.Context(), module)
	defer done()
	var effectSymbol *ast.Symbol
	for _, symbol := range c.GetExportsOfModule(module.Symbol) {
		if symbol.Name() == "Effect" {
			effectSymbol = symbol
			break
		}
	}
	if effectSymbol == nil {
		t.Fatal("Effect interface missing from pinned declarations")
	}
	var effectArgument func(*checker.Type, map[*checker.Type]bool) bool
	effectArgument = func(typ *checker.Type, seen map[*checker.Type]bool) bool {
		if typ == nil || seen[typ] {
			return false
		}
		seen[typ] = true
		if typ.Flags()&checker.TypeFlagsTypeParameter != 0 {
			return effectArgument(c.GetConstraintOfTypeParameter(typ), seen)
		}
		if typ.Flags()&(checker.TypeFlagsUnion|checker.TypeFlagsIntersection) != 0 {
			return slices.ContainsFunc(typ.Types(), func(part *checker.Type) bool { return effectArgument(part, seen) })
		}
		return typ.Symbol() == effectSymbol
	}
	var calls []string
	exports := c.GetExportsOfModule(module.Symbol)
	slices.SortFunc(exports, func(a, b *ast.Symbol) int { return strings.Compare(a.Name(), b.Name()) })
	names := 0
	for _, export := range exports {
		target := export
		if target.Flags()&ast.SymbolFlagsAlias != 0 {
			target = c.GetAliasedSymbol(target)
		}
		if target.Flags()&ast.SymbolFlagsValue == 0 {
			continue
		}
		found := false
		for _, sig := range c.GetSignaturesOfType(c.GetTypeOfSymbol(target), checker.SignatureKindCall) {
			var args []string
			hasEffect := false
			for _, param := range sig.Parameters() {
				arg := "undefined as never"
				if effectArgument(c.GetTypeOfSymbol(param), make(map[*checker.Type]bool)) {
					arg = "e"
					hasEffect = true
				}
				args = append(args, arg)
			}
			if hasEffect {
				calls = append(calls, fmt.Sprintf("const result%d = Effect[%q](%s)", len(calls), export.Name(), strings.Join(args, ", ")))
				found = true
			}
		}
		if found {
			names++
		}
	}
	if names < 100 {
		t.Fatalf("only %d Effect exports with Effect parameters", names)
	}
	t.Logf("pinned Effect inventory: %d exports, %d signatures", names, len(calls))
	return calls
}

const declaredRootPromiseQuote = "`Promise.reject(e)`, like every Promise-producing call, must be inside a wrapper thunk in effect code."

func TestDeclaredRootPromiseRulesQuoted(t *testing.T) {
	if !strings.Contains(SpecText("003-failures.md"), declaredRootPromiseQuote) {
		t.Fatalf("Chapter 3 no longer says %q", declaredRootPromiseQuote)
	}
	const root = "a root runner is called inside code already running on a fiber"
	if !strings.Contains(SpecText("900-appendices.md"), root) {
		t.Fatalf("Appendix B no longer says %q", root)
	}
}

func isDeclaredRootPromise(d *ast.Diagnostic) bool {
	if !IsEK(d) || d.Code() != 1005 || d.Category() != diagnostics.CategoryError || d.File() == nil {
		return false
	}
	text := d.File().Text()
	if d.Pos() < 0 || d.End() > len(text) {
		return false
	}
	callee := text[d.Pos():d.End()]
	return callee == `Effect["runPromise"]` || callee == `Effect["runPromiseExit"]`
}

func isDeclaredRootPromiseCompanion(d *ast.Diagnostic, ds []*ast.Diagnostic) bool {
	if !IsEK(d) || d.Code() != 404 || d.Category() != diagnostics.CategoryError {
		return false
	}
	for _, root := range ds {
		if isDeclaredRootPromise(root) && root.File() == d.File() && root.Pos() == d.Pos() && root.End() <= d.End() {
			return true
		}
	}
	return false
}

func TestDeclaredRootPromiseCompanionScope(t *testing.T) {
	TestDeclaredRootPromiseRulesQuoted(t)
	for _, name := range []string{"runPromise", "runPromiseExit", "runCallback"} {
		source := `Effect["` + name + `"](e); Promise.resolve(e)`
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "fixture/main.vibe", PathKey: "fixture/main.vibe"}, source, core.ScriptKindTS)
		end := strings.Index(source, "(")
		root := ast.NewExternalDiagnostic(file, core.NewTextRange(0, end), "EK", diagnostics.CategoryError, 1005, "nested root")
		diag := ast.NewExternalDiagnostic(file, core.NewTextRange(0, end+3), "EK", diagnostics.CategoryError, 404, "Promise-producing call")
		want := name != "runCallback"
		if got := isDeclaredRootPromiseCompanion(diag, []*ast.Diagnostic{root}); got != want {
			t.Fatalf("%s: got %t want %t", name, got, want)
		}
		unrelated := ast.NewExternalDiagnostic(file, core.NewTextRange(end+5, len(source)), "EK", diagnostics.CategoryError, 404, "another Promise")
		if isDeclaredRootPromiseCompanion(unrelated, []*ast.Diagnostic{root}) {
			t.Fatal("accepted unrelated Promise diagnostic")
		}
		if isDeclaredRootPromiseCompanion(diag, nil) {
			t.Fatal("accepted Promise diagnostic without a nested-root diagnostic")
		}
		native := ast.NewExternalDiagnostic(file, core.NewTextRange(0, end), "TS", diagnostics.CategoryError, 1005, "native parse error")
		if isDeclaredRootPromiseCompanion(diag, []*ast.Diagnostic{native}) {
			t.Fatal("native TS1005 acted as an EK1005 companion")
		}
	}
}

// The API inventory includes root runners and provider overloads. Native TS
// acceptance proves the synthesized arguments fit each API. EK1005 and EK3207
// are independent of Effect-as-data admission. Promise root calls additionally
// require a correlated EK0404; unrelated Promise errors remain unexpected.
func checkDeclaredParameterOracle(t *testing.T, w *Workspace, source string, want int) {
	t.Helper()
	TestDeclaredRootPromiseRulesQuoted(t)
	native := "import { Effect, Stream, Option } from \"effect\"\n" + strings.Replace(source, "export effect function", "export function", 1)
	control, err := w.Compile(t.Context(), Project{Files: map[string]string{"control.ts": native}})
	if err != nil {
		t.Fatal(err)
	}
	defer control.Remove()
	if HasError(control.Diagnostics) {
		t.Fatalf("generated API calls must typecheck in TypeScript: %v\n%s", SortedKeys(Keys(control.Dir, control.Diagnostics)), native)
	}
	result, err := w.Compile(t.Context(), Single(source))
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	// These calls are root runners and Promise producers simultaneously.
	// Require both independent rules, with the same call position.
	for _, root := range result.Diagnostics {
		if !isDeclaredRootPromise(root) {
			continue
		}
		paired := false
		for _, d := range result.Diagnostics {
			if d.Pos() == root.Pos() && isDeclaredRootPromiseCompanion(d, []*ast.Diagnostic{root}) {
				paired = true
			}
		}
		if !paired {
			t.Fatalf("root Promise runner lost EK0404: %v", SortedKeys(Keys(result.Dir, result.Diagnostics)))
		}
	}
	count := 0
	for _, d := range result.Diagnostics {
		if d.Code() == 4802 {
			count++
		}
		if d.Category() == diagnostics.CategoryError && d.Code() != 1005 && d.Code() != 3207 && !isDeclaredRootPromiseCompanion(d, result.Diagnostics) {
			t.Fatalf("unexpected error: %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
		}
	}
	if count != want {
		t.Fatalf("want %d EK4802 diagnostics (plain generic control only), got %d: %v\n%s", want, count, SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
	}
}

func TestEffectExportedParameters(t *testing.T) {
	w := NewWorkspace(t)
	calls := effectParameterCalls(t, w)
	for start := 0; start < len(calls); start += 30 {
		end := min(start+30, len(calls))
		source := "export effect function probe(e: Effect.Effect<never>) {\n" + strings.Join(calls[start:end], "\n") + "\nreturn 0\n}"
		checkDeclaredParameterOracle(t, w, source, 0)
	}
}

func FuzzDeclaredEffectParameter(f *testing.F) {
	startShortBudget(f)
	w := NewWorkspace(f)
	calls := effectParameterCalls(f, w)
	for i := range calls {
		f.Add(uint16(i), uint8(i%3), uint8(i%4))
	}
	f.Fuzz(func(t *testing.T, index uint16, value, shape uint8) {
		if !strings.Contains(SpecText("002-running.md"), effectDeclaredParameterQuote) {
			t.Fatal("declared parameter oracle changed")
		}
		types := []string{"never", "number", "Effect.Effect<number>"}
		controls := []string{"T", "T | number", "T & object", "{ value: T }"}
		declared := []string{"T | Effect.Effect<T>", "T & Effect.Effect<never>", "Stream.Stream<T>", "Option.Option<T>"}
		declaredArg := []string{"p", "e", "s", "o"}
		argument := "p"
		if shape%4 == 3 {
			argument = "{ value: p }"
		}
		source := fmt.Sprintf("function identity<T>(x: %s): number { return 0 }\nfunction declared<T>(x: %s): number { return 0 }\nexport effect function probe(e: Effect.Effect<never>, p: Effect.Effect<%s>, s: Stream.Stream<Effect.Effect<%s>>, o: Option.Option<Effect.Effect<%s>>) {\n%s\nconst boundary = declared(%s)\nconst control = identity(%s)\nreturn 0\n}", controls[shape%4], declared[shape%4], types[value%3], types[value%3], types[value%3], calls[int(index)%len(calls)], declaredArg[shape%4], argument)
		checkDeclaredParameterOracle(t, w, source, 1)
	})
}

const effectDeclaredParameterQuote = "A parameter whose declared type is or contains an Effect, Stream or another Effect data type never reports this warning, including through an alias, union, intersection or generic constraint."
