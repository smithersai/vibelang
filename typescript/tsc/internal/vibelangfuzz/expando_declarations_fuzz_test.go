package vibelangfuzz

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// FuzzExpandoDeclarations enforces Chapter 1, Declaration output, API
// identity: "Declaration output is API-identical to what `tsc` writes for the
// Effect TypeScript twin: the same exported names, each export's type
// identical to `tsc`'s in both directions (a type-level check)". The input
// picks a function host and up to four property assignments on it
// (`f.x = …` or `f["x"] = …`), so a property may be assigned once or several
// times, with an alias of a local function, a literal or an arrow. The twin is
// the same text as a .ts module; expando assignments are plain TypeScript.
// Stock tsc checks one consumer that reads every assigned property from the
// .vibe module's emitted declarations and from the twin source, and requires
// the two types to be assignable both ways. Library checking stays on, so a
// namespace that declares one property twice (`TS2300`, `TS2484`) fails. The
// acceptance case legacy-constructor-writes declared `export { g as
// constructor }` twice for `f.constructor = g` and `f["constructor"] = g`.
func FuzzExpandoDeclarations(f *testing.F) {
	startShortBudget(f)
	expandoDeclarationChapters(f)
	tsc := StockTypeScript(f)
	w := NewWorkspace(f)
	for _, seed := range expandoDeclarationSeeds {
		f.Add([]byte("expando:" + seed))
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		CheckExpandoDeclarations(t, w, tsc, parseExpandoDeclarations(data))
	})
}

// TestExpandoDeclarationsQuoted fails when a chapter rewords a sentence the
// oracle quotes (RULES.md 9).
func TestExpandoDeclarationsQuoted(t *testing.T) { expandoDeclarationChapters(t) }

var expandoDeclarationQuotes = map[string][]string{
	"001-functions.md": {
		"Declaration output is API-identical to what `tsc` writes for the Effect TypeScript twin: the same exported names, each export's type identical to `tsc`'s in both directions (a type-level check)",
	},
}

func expandoDeclarationChapters(tb testing.TB) {
	tb.Helper()
	for chapter, quotes := range expandoDeclarationQuotes {
		text := SpecText(chapter)
		for _, quote := range quotes {
			if !strings.Contains(text, quote) {
				tb.Fatalf("%s no longer says %q", chapter, quote)
			}
		}
	}
}

// The seeds hold every value once and every repeated shape the emitter
// distinguishes: one alias twice, two aliases, an alias and a value in both
// orders, a value twice, an arrow twice (a generated local name) and both
// access forms.
var expandoDeclarationSeeds = []string{
	"function:x.dot.g",
	"function:x.dot.one",
	"function:x.dot.arrow",
	"function:constructor.dot.g,constructor.element.g",
	"function:x.dot.g,x.dot.h",
	"function:x.dot.g,x.element.one",
	"function:x.dot.text,x.dot.g",
	"function:y.dot.one,y.element.one",
	"function:toString.dot.arrow,toString.element.arrow",
	"arrow:x.dot.g,y.dot.g,x.element.g,y.dot.text",
	"expression:constructor.element.h,x.dot.one,constructor.dot.g",
}

// An expandoHost is the exported function the properties are assigned to.
type expandoHost struct{ name, source string }

var expandoHosts = []expandoHost{
	{"function", "export function f(): number { return 1 }\n"},
	{"arrow", "export const f = (): number => 1\n"},
	{"expression", "export const f = function (): number { return 1 }\n"},
}

// Property names include `constructor` and `toString`, which every function
// already has. `toString` also resolves as a global name, so its declaration
// takes a generated local name.
var expandoProperties = []string{"x", "y", "constructor", "toString"}

var expandoForms = []string{"dot", "element"}

// An expandoValue is what one assignment assigns.
type expandoValue struct{ name, source string }

var expandoValues = []expandoValue{
	{"g", "g"},
	{"h", "h"},
	{"one", "1"},
	{"text", "\"text\""},
	{"arrow", "() => true"},
}

type expandoAssignment struct {
	property string
	form     string
	value    expandoValue
}

type expandoDeclarations struct {
	host        expandoHost
	assignments []expandoAssignment
}

func (e expandoDeclarations) key() string {
	parts := make([]string, len(e.assignments))
	for i, a := range e.assignments {
		parts[i] = a.property + "." + a.form + "." + a.value.name
	}
	return "expando:" + e.host.name + ":" + strings.Join(parts, ",")
}

// parseExpandoDeclarations reads the keyed form,
// `expando:<host>:<property>.<form>.<value>,…`, so a saved corpus file keeps
// what it tests (RULES.md 11), and otherwise reads the choices from the bytes.
func parseExpandoDeclarations(data []byte) expandoDeclarations {
	e := expandoDeclarations{host: expandoHosts[0]}
	if rest, ok := strings.CutPrefix(string(data), "expando:"); ok {
		host, list, _ := strings.Cut(rest, ":")
		for _, h := range expandoHosts {
			if h.name == host {
				e.host = h
			}
		}
		for _, item := range strings.Split(list, ",") {
			fields := strings.Split(item, ".")
			if len(fields) != 3 || len(e.assignments) == 4 {
				continue
			}
			a := expandoAssignment{property: expandoProperties[0], form: expandoForms[0], value: expandoValues[0]}
			if slices.Contains(expandoProperties, fields[0]) {
				a.property = fields[0]
			}
			if slices.Contains(expandoForms, fields[1]) {
				a.form = fields[1]
			}
			for _, v := range expandoValues {
				if v.name == fields[2] {
					a.value = v
				}
			}
			e.assignments = append(e.assignments, a)
		}
		if len(e.assignments) == 0 {
			e.assignments = []expandoAssignment{{expandoProperties[0], expandoForms[0], expandoValues[0]}}
		}
		return e
	}
	at := func(i int) int {
		if i < len(data) {
			return int(data[i])
		}
		return 0
	}
	e.host = expandoHosts[at(0)%len(expandoHosts)]
	for i := range 1 + at(1)%4 {
		e.assignments = append(e.assignments, expandoAssignment{
			property: expandoProperties[at(2+3*i)%len(expandoProperties)],
			form:     expandoForms[at(3+3*i)%len(expandoForms)],
			value:    expandoValues[at(4+3*i)%len(expandoValues)],
		})
	}
	return e
}

// module prints the module; the .vibe source and its twin share this text.
func (e expandoDeclarations) module() string {
	var b strings.Builder
	b.WriteString(e.host.source)
	b.WriteString("function g(): number { return 2 }\n")
	b.WriteString("function h(): string { return \"h\" }\n")
	for _, a := range e.assignments {
		if a.form == "dot" {
			fmt.Fprintf(&b, "f.%s = %s;\n", a.property, a.value.source)
		} else {
			fmt.Fprintf(&b, "f[%q] = %s;\n", a.property, a.value.source)
		}
	}
	b.WriteString("export const result = f()\n")
	return b.String()
}

// properties lists each assigned property once, in first-assignment order.
func (e expandoDeclarations) properties() []string {
	var names []string
	for _, a := range e.assignments {
		if !slices.Contains(names, a.property) {
			names = append(names, a.property)
		}
	}
	return names
}

// consumer reads every property through the twin source and through the
// emitted declarations.
func (e expandoDeclarations) consumer() string {
	var b strings.Builder
	b.WriteString("import * as Source from \"./source.js\"\n")
	b.WriteString("import * as Vibe from \"./vibe/main.js\"\n")
	b.WriteString("type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false\n")
	for i, property := range e.properties() {
		fmt.Fprintf(&b, "export const p%d: Same<typeof Source.f.%s, typeof Vibe.f.%s> = true\n", i, property, property)
	}
	b.WriteString("export const called: number = Vibe.f()\n")
	return b.String()
}

const expandoDeclarationsConfig = `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"declaration":true,"emitDeclarationOnly":true,"outDir":"__expando_out","rootDir":"."},"files":["main.vibe"]}`

const expandoConsumerConfig = `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":false,"noEmit":true,"types":[]},"files":["consumer.ts"]}`

// CheckExpandoDeclarations compiles one module and checks its declarations
// against its twin under stock tsc.
func CheckExpandoDeclarations(t *testing.T, w *Workspace, tsc string, e expandoDeclarations) {
	const target = "FuzzExpandoDeclarations"
	defer recoverCompilerPanic(t, target)
	vibe := Project{Files: map[string]string{"main.vibe": e.module(), "package.json": `{"type":"module"}`}, Config: expandoDeclarationsConfig}
	g := &Gaps{Target: target, Input: e.module()}
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
		g.Add("feature:"+e.key()+":compiles", "Chapter 1: the module is plain TypeScript, which a .vibe file accepts; the compiler reports %v for:\n%s", SortedKeys(Keys(c.Dir, c.Diagnostics)), e.module())
		g.FinishInput(t, key)
		return
	}
	declaration, ok := c.Outputs["__expando_out/main.d.ts"]
	if !ok {
		names := make([]string, 0, len(c.Outputs))
		for name := range c.Outputs {
			names = append(names, name)
		}
		slices.Sort(names)
		t.Fatalf("no declaration output among %v", names)
	}
	consumer := Project{
		Files: map[string]string{
			"package.json":   `{"type":"module"}`,
			"source.ts":      e.module(),
			"vibe/main.d.ts": declaration,
			"consumer.ts":    e.consumer(),
		},
		Config: expandoConsumerConfig,
	}
	dir, err := w.writeProject(consumer)
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	ctx, cancel := context.WithTimeout(t.Context(), 2*HangLimit)
	defer cancel()
	cmd := stockCompile(ctx, tsc, "-p", filepath.Join(dir, "tsconfig.json"), "--pretty", "false")
	cmd.Dir = dir
	out, runErr := cmd.CombinedOutput()
	if ctx.Err() != nil {
		t.Fatalf("stock consumer did not finish: %v", ctx.Err())
	}
	if runErr != nil {
		codes := []string{}
		for _, line := range strings.Split(string(out), "\n") {
			match := stockCode.FindStringSubmatch(line)
			if match == nil {
				continue
			}
			if strings.HasPrefix(line, "source.ts(") {
				// The twin is not valid TypeScript, so it states no API.
				t.Skipf("not a valid stock TypeScript module: %s", line)
			}
			if !slices.Contains(codes, "TS"+match[1]) {
				codes = append(codes, "TS"+match[1])
			}
		}
		if len(codes) == 0 {
			t.Fatalf("stock consumer failed without a TypeScript diagnostic: %v\n%s", runErr, out)
		}
		g.Add("feature:"+e.key()+":"+strings.Join(codes, "+"), "Chapter 1, API identity: \"Declaration output is API-identical to what `tsc` writes for the Effect TypeScript twin: … each export's type identical to `tsc`'s in both directions (a type-level check)\". Stock tsc rejects the emitted declarations or finds a property type that differs from the twin's:\n%s\nmodule:\n%s\ndeclarations:\n%s", out, e.module(), declaration)
	}
	g.FinishInput(t, key)
}
