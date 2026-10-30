package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangestree"
)

// FuzzParse parses any text as a .vibe, .ts, .tsx and .d.ts file and holds
// the tree to what the checker, the emitter and the editor read from it
// (Chapter 27's pipeline starts at the parser): no panic; every node inside
// the text and its parent, after its previous sibling; the same tree and
// syntax errors on every parse; and an ESTree conversion that is valid JSON
// whose ranges are UTF-16 offsets into the text (Chapter 28, Linting, D277).
func FuzzParse(f *testing.F) {
	startShortBudget(f)
	for _, seed := range ParseSeeds() {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, source string) {
		if len(source) > 64<<10 {
			t.Skip("too large")
		}
		CheckParse(t, "FuzzParse", source)
	})
}

// ParseSeeds are the text of every source file of the acceptance cases and
// every documentation snippet.
var ParseSeeds = sync.OnceValue(func() []string {
	var seeds []string
	seen := map[string]bool{}
	for _, seed := range append(slices.Clone(CaseSeeds()), SnippetSeeds()...) {
		for _, name := range mapKeys(seed.Files) {
			if text := seed.Files[name]; isSource(name) && !seen[text] {
				seen[text] = true
				seeds = append(seeds, text)
				seedNames.LoadOrStore(text, seed.Name+": "+name)
			}
		}
	}
	return seeds
})

// A parseKind is a file name whose extension selects the language.
type parseKind struct {
	name string
	kind core.ScriptKind
}

var parseKinds = []parseKind{
	{"/fuzz/main.vibe", core.ScriptKindTS},
	{"/fuzz/main.ts", core.ScriptKindTS},
	{"/fuzz/main.tsx", core.ScriptKindTSX},
	{"/fuzz/main.d.ts", core.ScriptKindTS},
}

func parseAs(k parseKind, source string) *ast.SourceFile {
	return parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(k.name), PathKey: tspath.PathKey(k.name)}, source, k.kind)
}

// CheckParse runs FuzzParse's oracles on one text.
func CheckParse(t *testing.T, target, source string) {
	g := &Gaps{Target: target, Input: SeedName(source)}
	key := ""
	if name := corpusFile(t, target); name != "" {
		key = "corpus:" + name
		g.Input = "testdata/fuzz/" + target + "/" + name
	}
	defer recoverCompilerPanic(t, target)
	parseGaps(g, source)
	g.FinishInput(t, key)
}

// parseGaps records FuzzParse's disagreements in the input's shared Gaps.
// The caller recovers compiler panics and finishes the input after every
// oracle has run, including any compilation oracles.
func parseGaps(g *Gaps, source string) {
	dumps := map[string]string{}
	for _, k := range parseKinds {
		var file *ast.SourceFile
		Within("parse "+k.name, func() { file = parseAs(k, source) })
		where := strings.TrimPrefix(k.name, "/fuzz/main")
		// The tree is what every later stage reads positions from:
		// diagnostics print at its spans (D61), source maps carry them (D34),
		// and the editor finds the node at a position by descending through
		// children in order (Chapter 28, The editor).
		if where == ".vibe" {
			// The VibeLang parser writes each abbreviation as the TypeScript
			// it stands for, placing the long form's nodes at the source
			// spans they come from, which may overlap; Chapter 27 and 28 hold
			// only the spans themselves to the text.
			if kind, problem := spanProblem(file, source); problem != "" {
				g.Add("feature:parse-span-"+kind, "parsed as .vibe: %s", problem)
			}
		} else if problem := treeProblem(file, source); problem != "" {
			// The key names the node at fault, so one known gap does not
			// switch the tree oracle off for every TypeScript input.
			kind := strings.TrimPrefix(strings.Fields(problem)[0], "Kind")
			g.Add("feature:parse-tree-ts:"+kind, "parsed as %s: %s", where, problem)
		}
		dumps[k.name] = dumpTree(file)
	}
	// Parsing is a function of the text: parsing again, after the other
	// languages, gives the same tree and the same syntax errors.
	for i := len(parseKinds) - 1; i >= 0; i-- {
		k := parseKinds[i]
		if again := dumpTree(parseAs(k, source)); again != dumps[k.name] {
			g.Add("feature:parse-determinism", "parsing as %s again gives another tree:\n%s", strings.TrimPrefix(k.name, "/fuzz/main"), firstDifference(dumps[k.name], again))
		}
	}
	for _, name := range []string{"main.vibe", "main.ts"} {
		checkESTree(g, name, source)
	}
}

// treeProblem returns the first violation of the tree's shape, or "": each
// node lies inside the text and inside its parent, after its previous
// sibling. A node with no position (-1), which a parser makes for an
// abbreviation, is skipped; its children are held to its nearest positioned
// ancestor.
func treeProblem(file *ast.SourceFile, text string) string {
	size := len(text)
	if file.Pos() != 0 || file.End() != size {
		return fmt.Sprintf("the source file spans [%d, %d) of %d bytes", file.Pos(), file.End(), size)
	}
	var problem string
	var walk func(parent *ast.Node, lo, hi int)
	walk = func(parent *ast.Node, lo, hi int) {
		previous := lo
		parent.ForEachChild(func(n *ast.Node) bool {
			if problem != "" {
				return true
			}
			if n.Pos() < 0 && n.End() < 0 {
				walk(n, lo, hi)
				return false
			}
			switch {
			case n.Pos() < 0 || n.End() < n.Pos() || n.End() > size:
				problem = fmt.Sprintf("%s spans [%d, %d) of %d bytes", n.Kind, n.Pos(), n.End(), size)
			case n.Pos() < lo || n.End() > hi:
				problem = fmt.Sprintf("%s [%d, %d) leaves its parent %s [%d, %d): %q", n.Kind, n.Pos(), n.End(), parent.Kind, lo, hi, excerpt(text, n.Pos()))
			case n.Pos() < previous:
				problem = fmt.Sprintf("%s [%d, %d) starts before its previous sibling ends at %d, in %s: %q", n.Kind, n.Pos(), n.End(), previous, parent.Kind, excerpt(text, n.Pos()))
			}
			if problem != "" {
				return true
			}
			previous = n.End()
			walk(n, n.Pos(), n.End())
			return false
		})
	}
	walk(file.AsNode(), 0, size)
	return problem
}

// spanProblem returns the first node whose span is not a range of the
// text, or "": diagnostics print at these spans (D61) and source maps carry
// them (D34).
func spanProblem(file *ast.SourceFile, text string) (kind string, problem string) {
	var walk ast.Visitor
	walk = func(n *ast.Node) bool {
		if n.Pos() < 0 && n.End() < 0 {
			n.ForEachChild(walk)
			return problem != ""
		}
		if n.Pos() < 0 || n.End() < n.Pos() || n.End() > len(text) {
			kind = strings.TrimPrefix(n.Kind.String(), "Kind")
			problem = fmt.Sprintf("%s spans [%d, %d) of %d bytes: %q", n.Kind, n.Pos(), n.End(), len(text), excerpt(text, max(0, min(n.Pos(), n.End()))))
			return true
		}
		n.ForEachChild(walk)
		return problem != ""
	}
	file.AsNode().ForEachChild(walk)
	return kind, problem
}

// dumpTree writes a tree's kinds, spans and flags, and its syntax errors.
func dumpTree(file *ast.SourceFile) string {
	var b strings.Builder
	var walk func(n *ast.Node, depth int)
	walk = func(n *ast.Node, depth int) {
		fmt.Fprintf(&b, "%d %s %d %d %d\n", depth, n.Kind, n.Pos(), n.End(), n.Flags)
		n.ForEachChild(func(c *ast.Node) bool {
			walk(c, depth+1)
			return false
		})
	}
	walk(file.AsNode(), 0)
	for _, d := range slices.Concat(file.Diagnostics(), file.JSDiagnostics()) {
		fmt.Fprintf(&b, "error %d %d %d %s\n", d.Code(), d.Pos(), d.Len(), d.String())
	}
	return b.String()
}

// checkESTree converts the text with VibeLang's ESLint parser twice, and
// holds the result to Chapter 28's Linting section: valid JSON, ranges that
// are UTF-16 offsets into the text, the same conversion every time, and, for
// a file the parser accepts, a form for every node (D277).
func checkESTree(g *Gaps, name, source string) {
	var out string
	var failure *vibelangestree.Error
	Within("estree "+name, func() { out, failure = vibelangestree.Parse(name, source) })
	again, failureAgain := vibelangestree.Parse(name, source)
	if out != again || (failure == nil) != (failureAgain == nil) || failure != nil && *failure != *failureAgain {
		g.Add("feature:estree-determinism", "converting %s twice gives two results", name)
	}
	size := UTF16Len(source)
	if failure != nil {
		if failure.Index < 0 || failure.Index > size || failure.Line < 1 {
			g.Add("feature:estree-range", "%s's parsing error is at index %d, line %d, outside its %d UTF-16 units", name, failure.Index, failure.Line, size)
		}
		// typescript-estree rejects JSDoc types outside comments, so only a
		// VibeLang file's other forms are held to having one.
		if strings.HasSuffix(name, ".vibe") && strings.HasPrefix(failure.Message, "VibeLang's ESLint parser has no ESTree form") && !strings.Contains(failure.Message, "JSDoc") {
			file := parseAs(parseKind{"/fuzz/" + name, core.ScriptKindTS}, source)
			if len(file.Diagnostics()) == 0 && len(file.JSDiagnostics()) == 0 {
				g.Add("feature:estree-form", "%s parses without a syntax error, but %s", name, failure.Message)
			}
		}
		return
	}
	var tree any
	if err := json.Unmarshal([]byte(out), &tree); err != nil {
		g.Add("feature:estree-json", "%s's ESTree is not JSON: %v", name, err)
		return
	}
	if kind, problem := rangeProblem(tree, size); problem != "" {
		g.Add("feature:estree-range-"+kind, "%s: %s", name, problem)
	}
}

// rangeProblem returns the type of the first ESTree node whose range is not
// a range of [0, size], and the problem, or "".
func rangeProblem(value any, size int) (kind string, problem string) {
	switch v := value.(type) {
	case map[string]any:
		if r, ok := v["range"].([]any); ok {
			kind = fmt.Sprint(v["type"])
			if len(r) != 2 {
				return kind, fmt.Sprintf("%v has range %v", v["type"], r)
			}
			start, ok1 := r[0].(float64)
			end, ok2 := r[1].(float64)
			if !ok1 || !ok2 || start < 0 || end < start || int(end) > size {
				return kind, fmt.Sprintf("%v has range %v outside its %d UTF-16 units", v["type"], r, size)
			}
		}
		for _, key := range mapKeys(v) {
			if kind, problem := rangeProblem(v[key], size); problem != "" {
				return kind, problem
			}
		}
	case []any:
		for _, child := range v {
			if kind, problem := rangeProblem(child, size); problem != "" {
				return kind, problem
			}
		}
	}
	return "", ""
}
