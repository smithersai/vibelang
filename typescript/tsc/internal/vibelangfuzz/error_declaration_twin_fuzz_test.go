package vibelangfuzz

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// FuzzErrorDeclarationTwin enforces Chapter 3, Meaning: "`error Name { fields
// }` declares exactly Effect's `Data.TaggedError` class. The tag is always the
// name, and every field is readonly. Optional `id?: T` maps to `readonly id?:
// T`, as in a TypeScript type literal. Fields, methods and getters may be
// interleaved, as in a TypeScript class." and Chapter 1, Declaration output:
// "Declarations are exactly what idiomatic Effect TypeScript would declare."
// The input picks an error declaration: its fields, a getter, a method, and
// whether a fieldless one writes braces. Its twin is the Data.TaggedError
// class that sentence names, written independently of the compiler, with no
// type argument when there are no fields, as Chapter 3 writes `error Timeout`'s
// counterpart, `class Timeout extends Data.TaggedError("Timeout")`. The
// declarations of the .vibe and of the twin under stock tsc must agree under
// the migration identity gate's canonicalization, as FuzzDeclarationIdentity
// compares them. alchemy declares 171 fieldless Data.TaggedError classes, so
// `--fix` writing them as `error X` must keep their declarations (corpus
// alchemy-fieldless-tagged-error).
func FuzzErrorDeclarationTwin(f *testing.F) {
	startShortBudget(f)
	errorTwinChapters(f)
	tsc := StockTypeScript(f)
	api := declarationIdentityAPI(f)
	w := NewWorkspace(f)
	for _, seed := range []string{
		"error-twin:",
		"error-twin:braces",
		"error-twin:getter",
		"error-twin:id;count?",
		"error-twin:id;count?;getter;method",
	} {
		f.Add([]byte(seed))
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		CheckErrorDeclarationTwin(t, w, tsc, api, parseErrorTwin(data))
	})
}

// TestErrorDeclarationTwinQuoted fails when a chapter rewords a sentence the
// oracle quotes (RULES.md 9).
func TestErrorDeclarationTwinQuoted(t *testing.T) { errorTwinChapters(t) }

var errorTwinQuotes = map[string][]string{
	"003-failures.md": {
		"`error Name { fields }` declares exactly Effect's `Data.TaggedError` class. The tag is always the name, and every field is readonly. Optional `id?: T` maps to `readonly id?: T`, as in a TypeScript type literal. Fields, methods and getters may be interleaved, as in a TypeScript class.",
		`class Timeout extends Data.TaggedError("Timeout")`,
	},
	"001-functions.md": {"Declarations are exactly what idiomatic Effect TypeScript would declare."},
}

func errorTwinChapters(tb testing.TB) {
	tb.Helper()
	for chapter, quotes := range errorTwinQuotes {
		text, err := os.ReadFile(SpecPath(chapter))
		if err != nil {
			tb.Fatal(err)
		}
		for _, quote := range quotes {
			if !strings.Contains(string(text), quote) {
				tb.Fatalf("%s no longer says %q", chapter, quote)
			}
		}
	}
}

// errorTwin is one generated error declaration.
type errorTwin struct {
	fields []errorTwinField
	braces bool // a fieldless, memberless declaration writes `{}`
	getter bool
	method bool
}

type errorTwinField struct {
	name     string
	optional bool
	typ      string
}

var errorTwinFieldNames = []string{"id", "count", "tags", "cause"}
var errorTwinTypes = []string{"string", "number", "boolean", "ReadonlyArray<string>"}

// parseErrorTwin reads the keyed form, `error-twin:` then `;`-separated
// parts (a field name, `?` for optional; `getter`; `method`; `braces`), so a
// saved corpus file keeps what it tests (RULES.md 11), and otherwise reads
// the shape from the bytes.
func parseErrorTwin(data []byte) errorTwin {
	var e errorTwin
	if rest, ok := strings.CutPrefix(string(data), "error-twin:"); ok {
		for _, part := range strings.Split(rest, ";") {
			switch part {
			case "":
			case "getter":
				e.getter = true
			case "method":
				e.method = true
			case "braces":
				e.braces = true
			default:
				name, optional := strings.CutSuffix(part, "?")
				for i, known := range errorTwinFieldNames {
					if name == known && len(e.fields) < len(errorTwinFieldNames) && !e.hasField(name) {
						e.fields = append(e.fields, errorTwinField{name, optional, errorTwinTypes[i]})
					}
				}
			}
		}
		return e
	}
	at := func(i int) byte {
		if i < len(data) {
			return data[i]
		}
		return 0
	}
	count := int(at(0)) % (len(errorTwinFieldNames) + 1)
	for i := range count {
		b := at(1 + i)
		e.fields = append(e.fields, errorTwinField{errorTwinFieldNames[i], b&1 != 0, errorTwinTypes[int(b>>1)%len(errorTwinTypes)]})
	}
	flags := at(1 + len(errorTwinFieldNames))
	e.getter, e.method, e.braces = flags&1 != 0, flags&2 != 0, flags&4 != 0
	return e
}

func (e errorTwin) hasField(name string) bool {
	for _, field := range e.fields {
		if field.name == name {
			return true
		}
	}
	return false
}

func (e errorTwin) members() []string {
	var out []string
	if e.getter {
		out = append(out, `get message(): string { return "failed" }`)
	}
	if e.method {
		out = append(out, `describe(): string { return "Failure" }`)
	}
	return out
}

// vibe prints the error declaration.
func (e errorTwin) vibe() string {
	var parts []string
	for _, field := range e.fields {
		parts = append(parts, field.name+optionalMark(field.optional)+": "+field.typ)
	}
	parts = append(parts, e.members()...)
	if len(parts) == 0 {
		if e.braces {
			return "export error Failure {}\n"
		}
		return "export error Failure\n"
	}
	return "export error Failure {\n  " + strings.Join(parts, "\n  ") + "\n}\n"
}

// twin prints the Data.TaggedError class Chapter 3 says the declaration is.
func (e errorTwin) twin() string {
	base := `Data.TaggedError("Failure")`
	if len(e.fields) != 0 {
		var fields []string
		for _, field := range e.fields {
			fields = append(fields, "readonly "+field.name+optionalMark(field.optional)+": "+field.typ)
		}
		base += "<{ " + strings.Join(fields, "; ") + " }>"
	}
	body := "{}"
	if members := e.members(); len(members) != 0 {
		body = "{\n  " + strings.Join(members, "\n  ") + "\n}"
	}
	return "import { Data } from \"effect\"\n\nexport class Failure extends " + base + " " + body + "\n"
}

func optionalMark(optional bool) string {
	if optional {
		return "?"
	}
	return ""
}

const errorTwinConfig = `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"declaration":true,"emitDeclarationOnly":true,"outDir":"__identity_out","rootDir":"."},"files":["%s"]}`

// CheckErrorDeclarationTwin compares one error declaration's declarations
// with its twin's under stock tsc.
func CheckErrorDeclarationTwin(t *testing.T, w *Workspace, tsc, api string, e errorTwin) {
	const target = "FuzzErrorDeclarationTwin"
	defer recoverCompilerPanic(t, target)
	vibe := Project{Files: map[string]string{"main.vibe": e.vibe()}, Config: fmt.Sprintf(errorTwinConfig, "main.vibe")}
	stock := Project{Files: map[string]string{"main.ts": e.twin()}, Config: fmt.Sprintf(errorTwinConfig, "main.ts")}
	g := &Gaps{Target: target, Input: e.vibe()}
	key := ""
	if name := corpusFile(t, target); name != "" {
		key = "corpus:" + name
		g.Input = "testdata/fuzz/" + target + "/" + name
	}
	var c *Compilation
	var err error
	within(t, "compile", func() { c, err = w.CompileOrdered(t.Context(), vibe, OrderTsc, true) })
	if err != nil {
		t.Fatal(err)
	}
	defer c.Remove()
	if c.Program == nil || HasError(c.Diagnostics) {
		g.Add("feature:error-declaration-compiles", "Chapter 3: an error declaration of fields, methods and getters is valid; the compiler reports %v for:\n%s", SortedKeys(Keys(c.Dir, c.Diagnostics)), e.vibe())
		g.FinishInput(t, key)
		return
	}
	dir := emitDeclarationIdentityStock(t, w, tsc, stock)
	defer os.RemoveAll(dir)
	current := filepath.Join(c.Dir, "__identity_current")
	if err := os.MkdirAll(current, 0o755); err != nil {
		t.Fatal(err)
	}
	for name, text := range c.Outputs {
		if rel, ok := strings.CutPrefix(name, "__identity_out/"); ok && isDeclaration(name) {
			if err := writeInside(current, rel, text); err != nil {
				t.Fatal(err)
			}
		}
	}
	ctx, cancel := context.WithTimeout(t.Context(), 2*HangLimit)
	defer cancel()
	diff, err := compareIdentityDeclarations(ctx, api, filepath.Join(dir, "__identity_out"), current)
	if err != nil {
		t.Fatal(err)
	}
	if diff != "" {
		g.Add("feature:error-declaration-twin", "Chapter 3: \"`error Name { fields }` declares exactly Effect's `Data.TaggedError` class.\" The twin's (-) and the error declaration's (+) canonical declarations differ:\n%s\nerror declaration:\n%s\ntwin:\n%s", diff, e.vibe(), e.twin())
	}
	g.FinishInput(t, key)
}
