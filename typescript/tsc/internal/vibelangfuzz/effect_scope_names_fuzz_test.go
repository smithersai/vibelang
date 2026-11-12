package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-14 and VIP-33, as chapter 5 states them: the names a .vibe file has in
// scope with no import. Two of its rules have no other target: a qualified
// Effect.M that names no module, and a bare subpath namespace.
// FuzzEffectCollisionTypeof covers the ten collision qualifiers, and
// FuzzEffectGlobals the functions of effect/Effect.
const effectScopeTarget = "FuzzEffectScopeNames"

const (
	effectScopeRowsQuote    = "`Effect.M`, where `M` is a module in the table's first two rows, is that module"
	effectScopeOtherQuote   = "Every other `Effect.x` is the export `x` of `effect/Effect`."
	effectScopeSubpathQuote = "**Subpath namespaces are in scope:** the namespaces exported by the 23 lowercase subpaths in effect 4.1.1's package `exports`"
	effectScopeClashQuote   = "A name that two subpaths export, or a subpath and the root, is not in scope bare: using it is a compile error (`EK1401`)"
)

func TestEffectScopeNamesQuoted(t *testing.T) { effectScopeQuoted(t) }

// effectScopeQuoted checks every quote and returns chapter 5.
func effectScopeQuoted(t testing.TB) string {
	t.Helper()
	text, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{effectScopeRowsQuote, effectScopeOtherQuote, effectScopeSubpathQuote, effectScopeClashQuote} {
		if !strings.Contains(string(text), quote) {
			t.Fatalf("chapter 5 no longer says %q", quote)
		}
	}
	return string(text)
}

// effectScopeCollisionRows reads the module names of the precedence table's
// first two rows, the modules a qualified Effect.M names, from chapter 5.
func effectScopeCollisionRows(t testing.TB, chapter string) []string {
	t.Helper()
	_, section, ok := strings.Cut(chapter, "## Effect's modules are in scope")
	if !ok {
		t.Fatal("chapter 5 has no section named Effect's modules are in scope")
	}
	_, table, ok := strings.Cut(section, "| Name | Bare name means | Effect's module |")
	if !ok {
		t.Fatal("chapter 5 has no precedence table")
	}
	rows := strings.Split(strings.TrimSpace(table), "\n")
	if len(rows) < 3 {
		t.Fatal("the precedence table has fewer than two rows")
	}
	var names []string
	code := regexp.MustCompile("`(\\w+)`")
	for _, row := range rows[1:3] { // rows[0] is the separator
		cell := strings.Split(strings.Trim(row, "| "), "|")[0]
		for _, m := range code.FindAllStringSubmatch(cell, -1) {
			names = append(names, m[1])
		}
	}
	if len(names) == 0 {
		t.Fatal("the precedence table's first two rows name no module")
	}
	return names
}

// effectScopeNames is read from the installed effect package, never from the
// compiler: its root namespaces, the lowercase subpaths that export each
// namespace, and every name effect/Effect declares.
type effectScopeNames struct {
	root     []string
	subpaths map[string][]string
	effect   map[string]bool
}

var (
	effectScopeStarAs   = regexp.MustCompile(`(?m)^export \* as (\w+) from`)
	effectScopeDeclared = regexp.MustCompile(`(?m)^export (?:declare )?(?:abstract )?(?:const|function|class|interface|type|namespace|enum) (\w+)`)
	effectScopeLower    = regexp.MustCompile(`^\./[a-z][a-z-]*$`)
)

func readEffectScopeNames(t testing.TB, w *Workspace) effectScopeNames {
	t.Helper()
	dir := filepath.Join(w.Dir, "node_modules", "effect")
	read := func(rel string) string {
		text, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(rel)))
		if err != nil {
			t.Fatal(err)
		}
		return string(text)
	}
	names := effectScopeNames{subpaths: map[string][]string{}, effect: map[string]bool{}}
	for _, m := range effectScopeStarAs.FindAllStringSubmatch(read("dist/index.d.ts"), -1) {
		names.root = append(names.root, m[1])
	}
	var manifest struct {
		Exports map[string]json.RawMessage `json:"exports"`
	}
	if err := json.Unmarshal([]byte(read("package.json")), &manifest); err != nil {
		t.Fatal(err)
	}
	var subpaths []string
	for key := range manifest.Exports {
		// "./index" repeats the root; it is not a subpath namespace.
		if effectScopeLower.MatchString(key) && key != "./index" {
			subpaths = append(subpaths, key)
		}
	}
	slices.Sort(subpaths)
	if len(subpaths) != 23 {
		t.Fatalf("effect exports %d lowercase subpaths, and chapter 5 says 23: %v", len(subpaths), subpaths)
	}
	for _, key := range subpaths {
		var target string
		if err := json.Unmarshal(manifest.Exports[key], &target); err != nil || !strings.HasSuffix(target, ".js") {
			t.Fatalf("effect's export %s is not a JavaScript path: %s", key, manifest.Exports[key])
		}
		for _, m := range effectScopeStarAs.FindAllStringSubmatch(read(strings.TrimSuffix(target, ".js")+".d.ts"), -1) {
			names.subpaths[m[1]] = append(names.subpaths[m[1]], key[2:])
		}
	}
	for _, m := range effectScopeDeclared.FindAllStringSubmatch(read("dist/Effect.d.ts"), -1) {
		names.effect[m[1]] = true
	}
	return names
}

// effectScopeKeys are the inputs' keys: "qualified:M" for each root namespace
// that effect/Effect does not also declare, and "bare:N" for each subpath
// namespace, sorted.
func effectScopeKeys(names effectScopeNames) []string {
	var keys []string
	for _, name := range names.root {
		if !names.effect[name] {
			keys = append(keys, "qualified:"+name)
		}
	}
	for name := range names.subpaths {
		keys = append(keys, "bare:"+name)
	}
	slices.Sort(keys)
	return keys
}

// effectScopeExpr writes one name in one form; the variant changes only
// spelling the chapter does not distinguish.
func effectScopeStatement(form, name string, variant byte) string {
	if form == "qualified" {
		switch variant % 3 {
		case 1:
			return "const probe = Effect /* spaced */ . " + name + "\n"
		case 2:
			return "const probe = (Effect)." + name + "\n"
		}
		return "const probe = Effect." + name + "\n"
	}
	if variant%3 == 1 {
		return "const probe = (" + name + ")\n"
	}
	return "const probe = " + name + "\n"
}

// effectScopeWant is the oracle: the error codes the statement must report,
// none for a name in scope. A qualified collision module is that module; any
// other qualified root namespace is a missing export of effect/Effect, which
// TypeScript reports as TS2339 or, with a suggestion, TS2551. A bare subpath
// namespace is in scope unless another subpath or the root also exports it.
func effectScopeWant(names effectScopeNames, collisions []string, form, name string) (codes []string) {
	if form == "qualified" {
		if slices.Contains(collisions, name) {
			return nil
		}
		return []string{"TS2339", "TS2551"}
	}
	if len(names.subpaths[name]) > 1 || slices.Contains(names.root, name) {
		return []string{"EK1401"}
	}
	return nil
}

func effectScopeCode(d *ast.Diagnostic) string {
	return cmp(d.Source(), "TS") + fmt.Sprintf("%04d", d.Code())
}

// effectScopeCheck reports a gap when a statement's errors break the oracle:
// an error where the name is in scope, no error where it is not, or an error
// of another code.
func effectScopeCheck(t testing.TB, key string, want []string, errors []*ast.Diagnostic, source string) {
	t.Helper()
	var got []string
	for _, d := range errors {
		got = append(got, effectScopeCode(d))
	}
	switch {
	case len(want) == 0 && len(got) > 0:
		Gap(t, effectScopeTarget, key, "chapter 5 puts the name in scope, but it reports %v\n%s", got, source)
	case len(want) > 0 && len(got) == 0:
		Gap(t, effectScopeTarget, key, "chapter 5 makes this an error (%v), but it compiles\n%s", want, source)
	case slices.ContainsFunc(got, func(code string) bool { return !slices.Contains(want, code) }):
		Gap(t, effectScopeTarget, key, "want only %v, got %v\n%s", want, got, source)
	}
}

func effectScopeErrors(t testing.TB, result *Result) []*ast.Diagnostic {
	t.Helper()
	var errors []*ast.Diagnostic
	for _, d := range result.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		if d.File() == nil || path.Base(string(d.File().FileName())) != "main.vibe" {
			t.Fatalf("unexpected error outside main.vibe: %s", keyOf(result.Dir, d))
		}
		errors = append(errors, d)
	}
	return errors
}

// TestEffectScopeEveryName compiles every qualified root namespace and every
// bare subpath namespace of the pinned effect, one name a line, in one
// compilation per form.
func TestEffectScopeEveryName(t *testing.T) {
	chapter := effectScopeQuoted(t)
	w := NewWorkspace(t)
	names := readEffectScopeNames(t, w)
	collisions := effectScopeCollisionRows(t, chapter)
	for _, form := range []string{"qualified", "bare"} {
		var list []string
		for _, key := range effectScopeKeys(names) {
			if f, name, _ := strings.Cut(key, ":"); f == form {
				list = append(list, name)
			}
		}
		var b strings.Builder
		for i, name := range list {
			b.WriteString(strings.Replace(effectScopeStatement(form, name, 0), "probe", fmt.Sprintf("probe%d", i), 1))
		}
		source := b.String()
		result, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		byLine := map[int][]*ast.Diagnostic{}
		for _, d := range effectScopeErrors(t, result) {
			line := strings.Count(source[:d.Pos()], "\n")
			byLine[line] = append(byLine[line], d)
		}
		result.Remove()
		for i, name := range list {
			key := form + ":" + name
			t.Run(key, func(t *testing.T) {
				effectScopeCheck(t, key, effectScopeWant(names, collisions, form, name), byLine[i], strings.Split(source, "\n")[i])
				ExpectPending(t, effectScopeTarget, key)
			})
		}
	}
}

// FuzzEffectScopeNames compiles one name in one form, picked by its key, such
// as "qualified:Option" or "bare:LanguageModel", and a spelling variant in the
// byte after a NUL. An input without a known key picks a key by its first byte.
func FuzzEffectScopeNames(f *testing.F) {
	startShortBudget(f)
	chapter := effectScopeQuoted(f)
	w := NewWorkspace(f)
	names := readEffectScopeNames(f, w)
	collisions := effectScopeCollisionRows(f, chapter)
	keys := effectScopeKeys(names)
	for _, seed := range []string{
		"qualified:Option", "qualified:Schema", "qualified:Stream", "qualified:Layer", "qualified:Array", "qualified:Record",
		"bare:LanguageModel", "bare:TestClock", "bare:HttpClient", "bare:ChildProcess", "bare:Headers", "bare:Model", "bare:Prompt", "bare:Utils",
	} {
		for variant := range byte(3) {
			f.Add([]byte(seed + "\x00" + string(rune('0'+variant))))
		}
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		head, tail, _ := strings.Cut(string(data), "\x00")
		key := head
		if !slices.Contains(keys, key) {
			if len(data) == 0 {
				return
			}
			key = keys[int(data[0])%len(keys)]
		}
		variant := byte(0)
		if len(tail) > 0 {
			variant = tail[0]
		}
		form, name, _ := strings.Cut(key, ":")
		source := effectScopeStatement(form, name, variant)
		var result *Result
		var err error
		within(t, "check scope name", func() { result, err = w.Compile(t.Context(), Single(source)) })
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		effectScopeCheck(t, key, effectScopeWant(names, collisions, form, name), effectScopeErrors(t, result), source)
		ExpectPending(t, effectScopeTarget, key)
		ExpectPending(t, effectScopeTarget, specCorpusKey(t))
	})
}
