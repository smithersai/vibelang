package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"
)

// FuzzRecursiveInferredDeclarations enforces Chapter 1, Declaration output:
// "Declarations are exactly what idiomatic Effect TypeScript would declare",
// for an inferred return type that meets its own anonymous type again.
// Decision 6 matches TypeScript 7.0.2 where 7.1 regressed: 5.9 and 7.0.2
// declare the type met again as /*elided*/ any, where 7.1 reports TS5088
// ("references a type with a cyclic structure") and declares nothing. The
// input picks the recursion (a property arrow, two functions that build each
// other, a method, a function declaration, an array element, a generic
// builder), how deep in the result the recursive site sits, and whether the
// recursive function is exported. Every generated shape compiles with
// TypeScript 7.0.2. The oracle: the program compiles with declarations and no
// error, the recursive site prints /*elided*/ any, and the declaration file
// typechecks as a consumer's input. alchemy's packages/aws builders recurse
// this way (corpus alchemy-recursive-builder).
func FuzzRecursiveInferredDeclarations(f *testing.F) {
	startShortBudget(f)
	recursiveDeclarationsChapter(f)
	for _, shape := range recursiveShapes {
		f.Add([]byte("recursive:" + shape.name + "/1/exported"))
	}
	f.Add([]byte("recursive:property/3/local"))
	f.Add([]byte("recursive:mutual/2/exported"))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		CheckRecursiveInferredDeclarations(t, w, parseRecursive(data))
	})
}

// TestRecursiveInferredDeclarationsQuoted fails when Chapter 1 rewords the
// sentence the oracle quotes (RULES.md 9).
func TestRecursiveInferredDeclarationsQuoted(t *testing.T) { recursiveDeclarationsChapter(t) }

const recursiveDeclarationsQuote = "Declarations are exactly what idiomatic Effect TypeScript would declare."

func recursiveDeclarationsChapter(tb testing.TB) {
	tb.Helper()
	text, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		tb.Fatal(err)
	}
	if !strings.Contains(string(text), recursiveDeclarationsQuote) {
		tb.Fatalf("Chapter 1 no longer says %q", recursiveDeclarationsQuote)
	}
}

// A recursiveShape writes the recursive functions; W(x) stands for x wrapped
// in the chosen number of objects, and E for the export keyword or nothing.
type recursiveShape struct{ name, text string }

var recursiveShapes = []recursiveShape{
	{"property", "E const make = (value: string) => ({ value, named: (next: string) => W(make(next)) })"},
	{"mutual", "E const ping = (n: number) => ({ n, next: () => W(pong(n + 1)) })\nconst pong = (n: number) => ({ n, back: () => ping(n - 1) })"},
	{"method", "E function make(count: number) {\n  return { count, more() { return W(make(count + 1)) } }\n}"},
	{"declaration", "E function make(count: number) {\n  return { count, more: () => W(make(count + 1)) }\n}"},
	{"array", "E const make = (value: string) => ({ value, children: [() => W(make(value))] })"},
	{"generic", "E const make = <T>(value: T) => ({ value, again: () => W(make(value)) })"},
}

type recursiveInput struct {
	shape    recursiveShape
	depth    int
	exported bool
}

// parseRecursive reads the keyed form, `recursive:<shape>/<depth>/<exported|local>`
// (RULES.md 11), and otherwise picks from the bytes.
func parseRecursive(data []byte) recursiveInput {
	if rest, ok := strings.CutPrefix(string(data), "recursive:"); ok {
		parts := append(strings.Split(rest, "/"), "", "", "")
		in := recursiveInput{shape: recursiveShapes[0], exported: parts[2] != "local"}
		for _, s := range recursiveShapes {
			if s.name == parts[0] {
				in.shape = s
			}
		}
		fmt.Sscan(parts[1], &in.depth)
		in.depth = min(max(in.depth, 0), 3)
		return in
	}
	at := func(i int) int {
		if i < len(data) {
			return int(data[i])
		}
		return 0
	}
	return recursiveInput{recursiveShapes[at(0)%len(recursiveShapes)], at(1) % 4, at(2)&1 == 0}
}

// source prints the program; a local recursive function is reached through
// an exported entry, so its type still reaches the declarations.
func (in recursiveInput) source() string {
	wrap := func(x string) string {
		for i := range in.depth {
			x = fmt.Sprintf("({ level%d: %s })", i, x)
		}
		return x
	}
	text := in.shape.text
	if open := strings.Index(text, "W("); open >= 0 {
		depth, end := 0, open+2
		for ; end < len(text); end++ {
			if text[end] == '(' {
				depth++
			} else if text[end] == ')' {
				if depth == 0 {
					break
				}
				depth--
			}
		}
		text = text[:open] + wrap(text[open+2:end]) + text[end+1:]
	}
	export := "export"
	if !in.exported {
		export = ""
	}
	text = strings.TrimSpace(strings.ReplaceAll(text, "E ", export+" "))
	entry := map[string]string{"property": "make(\"a\")", "mutual": "ping(1)", "method": "make(1)", "declaration": "make(1)", "array": "make(\"a\")", "generic": "make(1)"}[in.shape.name]
	return text + "\nexport const entry = () => " + entry + "\n"
}

const recursiveConfig = `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"declaration":true,"outDir":"out"}}`

// CheckRecursiveInferredDeclarations compiles one program, then its
// declaration file as a consumer's input.
func CheckRecursiveInferredDeclarations(t *testing.T, w *Workspace, in recursiveInput) {
	const target = "FuzzRecursiveInferredDeclarations"
	defer recoverCompilerPanic(t, target)
	source := in.source()
	g := &Gaps{Target: target, Input: source}
	key := ""
	if name := corpusFile(t, target); name != "" {
		key = "corpus:" + name
		g.Input = "testdata/fuzz/" + target + "/" + name
	}
	errorsOf := func(r *Result) []string {
		var out []string
		for _, d := range r.Diagnostics {
			if d.Category().Name() == "error" {
				out = append(out, fmt.Sprintf("%s%d: %s", d.Source(), d.Code(), d.String()))
			}
		}
		return out
	}
	r, err := w.Compile(t.Context(), Project{Files: map[string]string{"package.json": `{"type":"module"}`, "main.ts": source}, Config: recursiveConfig})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	declaration := r.Outputs["out/main.d.ts"]
	switch errs := errorsOf(r); {
	case len(errs) != 0:
		g.Add("feature:recursive-declaration", "Chapter 1: %q; decision 6: TypeScript 7.0.2 declares this program, the compiler reports:\n%s\n%s", recursiveDeclarationsQuote, strings.Join(errs, "\n"), source)
	case declaration == "":
		g.Add("feature:recursive-declaration", "Chapter 1: %q; no declaration file for:\n%s", recursiveDeclarationsQuote, source)
	case !strings.Contains(declaration, "/*elided*/ any"):
		g.Add("feature:recursive-elided", "decision 6: TypeScript 7.0.2 declares the type met again as /*elided*/ any; the declarations are:\n%s\nfor:\n%s", declaration, source)
	default:
		consumer, err := w.Compile(t.Context(), Project{Files: map[string]string{"package.json": `{"type":"module"}`, "main.d.ts": declaration, "use.ts": "import { entry } from \"./main.js\"\nexport const used = entry()\n"}, Config: recursiveConfig})
		if err != nil {
			t.Fatal(err)
		}
		defer consumer.Remove()
		if errs := errorsOf(consumer); len(errs) != 0 {
			g.Add("feature:recursive-declaration-checks", "Chapter 1: %q; the declarations do not check:\n%s\n%s", recursiveDeclarationsQuote, strings.Join(errs, "\n"), declaration)
		}
	}
	g.FinishInput(t, key)
}
