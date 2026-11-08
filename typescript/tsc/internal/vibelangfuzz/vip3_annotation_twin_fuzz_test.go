package vibelangfuzz

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// FuzzVIP3AnnotationTwin enforces Chapter 1, Meaning: "An effect function's
// return annotation means exactly what the same annotation means on the
// equivalent `Effect.fn` or `Effect.gen` TypeScript (VIP-3, amended
// 2026-11-02)". The input picks an annotation shape (none, Effect.Effect<A>,
// Effect.Effect<A, E>, Effect.Effect<A, E, R>, A!E, A!E!R, A!E!, A!!R, A!!,
// unknown, which is not an Effect type, and unions of Effects), the type in
// each slot, and what the body returns, throws and needs. The oracle is tsc
// 5.9.3, the version the pinned Effect version's install pins, on the
// Effect.fn twin, written independently of the compiler: tsc accepts the twin
// exactly when the compiler accepts the effect function, and then
// ReturnType of the twin is identical to the effect function's declared
// return type. A union of two different Effect types is not one Effect type,
// so Chapter 1's Static rules decide it instead of the twin: the compiler
// reports EK0106 (annotationUnionQuote), as tsc reports TS1064 for a union
// of Promises on an async function. A union whose members are the same
// Effect type is that one type and keeps the twin oracle.
func FuzzVIP3AnnotationTwin(f *testing.F) {
	startShortBudget(f)
	annotationTwinChapters(f)
	tsc := annotationTwinTypeScript(f)
	w := NewWorkspace(f)
	for _, seed := range []string{
		"annot:none:union:never:never:fails;needs",
		"annot:effect1:num:never:never:fails",
		"annot:effect2:num:type:never:fails;needs",
		"annot:effect3:union:both:scope:fails;needs",
		"annot:bang2:lit:type:never:fails",
		"annot:bang3:num:both:scope:fails;fails2;needs",
		"annot:bangEmpty:num:type:never:fails",
		"annot:bangR:num:never:scope:needs",
		"annot:bang0:lit:never:never:",
		"annot:unionOfEffects:num:type:never:fails",
		"annot:unionOfBangs:union:both:scope:fails;needs",
		"annot:unionSame:lit:type:never:fails",
	} {
		f.Add([]byte(seed))
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		CheckVIP3AnnotationTwin(t, w, tsc, parseAnnotationTwin(data))
	})
}

// TestVIP3AnnotationTwinQuoted fails when Chapter 1 rewords the sentence the
// oracle quotes (RULES.md 9).
func TestVIP3AnnotationTwinQuoted(t *testing.T) { annotationTwinChapters(t) }

const annotationTwinQuote = "An effect function's annotation means the same as the annotation on its Effect TypeScript twin."

// annotationUnionQuote is Chapter 1's EK0106 row, which decides a return
// annotation that is a union of different Effect types.
const annotationUnionQuote = "A written return type of an `effect` function that does not resolve to `Effect.Effect<A, E, R>`, an alias included, as TS1064 requires `Promise<T>` for `async`"

func annotationTwinChapters(tb testing.TB) {
	tb.Helper()
	text, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		tb.Fatal(err)
	}
	for _, quote := range []string{annotationTwinQuote, annotationUnionQuote} {
		if !strings.Contains(string(text), quote) {
			tb.Fatalf("001-functions.md no longer says %q", quote)
		}
	}
}

// annotationTwinTypeScript is tsc 5.9.3 from the Effect install the
// workspace uses, which the VIP-3 amendment names as the oracle.
func annotationTwinTypeScript(tb testing.TB) string {
	tb.Helper()
	modules := os.Getenv("EFFECT_NODE_MODULES")
	if modules == "" {
		modules = filepath.Join(Root(), "experiments/node_modules")
	}
	api := filepath.Join(modules, "typescript")
	if got := packageVersion(api); got != "5.9.3" {
		Missing(tb, "FuzzVIP3AnnotationTwin needs tsc 5.9.3 at %s (found %q): set EFFECT_NODE_MODULES to the pinned Effect version's install", api, got)
	}
	return filepath.Join(api, "bin/tsc")
}

var (
	annotationShapes = []string{"none", "effect1", "effect2", "effect3", "bang2", "bang3", "bangEmpty", "bangR", "bang0", "unknown", "unionOfEffects", "unionOfBangs", "unionSame"}
	annotationAs     = []string{"num", "lit", "union"}
	annotationEs     = []string{"never", "type", "both"}
	annotationRs     = []string{"never", "scope"}
	annotationBody   = []string{"fails", "fails2", "needs"}
)

// annotationTwin is one generated effect function.
type annotationTwin struct {
	shape, a, e, r string
	body           map[string]bool
}

// parseAnnotationTwin reads the keyed form `annot:shape:a:e:r:body;…`
// (RULES.md 11), and otherwise reads each choice from a byte.
func parseAnnotationTwin(data []byte) annotationTwin {
	x := annotationTwin{body: map[string]bool{}}
	pick := func(list []string, want string, b byte) string {
		for _, v := range list {
			if v == want {
				return v
			}
		}
		return list[int(b)%len(list)]
	}
	if rest, ok := strings.CutPrefix(string(data), "annot:"); ok {
		parts := strings.SplitN(rest, ":", 5)
		for len(parts) < 5 {
			parts = append(parts, "")
		}
		x.shape, x.a, x.e, x.r = pick(annotationShapes, parts[0], 0), pick(annotationAs, parts[1], 0), pick(annotationEs, parts[2], 0), pick(annotationRs, parts[3], 0)
		for _, part := range strings.Split(parts[4], ";") {
			for _, b := range annotationBody {
				if part == b {
					x.body[b] = true
				}
			}
		}
		return x
	}
	at := func(i int) byte {
		if i < len(data) {
			return data[i]
		}
		return 0
	}
	x.shape, x.a, x.e, x.r = pick(annotationShapes, "", at(0)), pick(annotationAs, "", at(1)), pick(annotationEs, "", at(2)), pick(annotationRs, "", at(3))
	for i, b := range annotationBody {
		if at(4)&(1<<i) != 0 {
			x.body[b] = true
		}
	}
	return x
}

func (x annotationTwin) key() string {
	var body []string
	for _, b := range annotationBody {
		if x.body[b] {
			body = append(body, b)
		}
	}
	return "annot:" + x.shape + ":" + x.a + ":" + x.e + ":" + x.r + ":" + strings.Join(body, ";")
}

// slots returns the A, E and R the shape writes, as each side spells them,
// with an omitted slot never, as Effect's defaults make it.
func (x annotationTwin) slots(ts bool) (a, e, r string) {
	a = map[string]string{"num": "number", "lit": `"a" | "b"`, "union": "number | string"}[x.a]
	e = map[string]string{"never": "never", "type": "TypeError", "both": "TypeError | RangeError"}[x.e]
	r = "never"
	if x.r == "scope" {
		r = "Scope"
		if ts {
			r = "Scope.Scope"
		}
	}
	switch x.shape {
	case "effect1", "bang0":
		e, r = "never", "never"
	case "effect2", "bang2", "bangEmpty":
		r = "never"
	case "bangR":
		e = "never"
	}
	return
}

func parenthesized(t string) string {
	if strings.Contains(t, "|") {
		return "(" + t + ")"
	}
	return t
}

// annotation prints the .vibe return annotation, with its leading colon.
func (x annotationTwin) annotation() string {
	a, e, r := x.slots(false)
	switch x.shape {
	case "none":
		return ""
	case "effect1":
		return ": Effect.Effect<" + a + ">"
	case "effect2":
		return ": Effect.Effect<" + a + ", " + e + ">"
	case "effect3":
		return ": Effect.Effect<" + a + ", " + e + ", " + r + ">"
	case "bang2":
		return ": " + parenthesized(a) + "!" + parenthesized(e)
	case "bang3":
		return ": " + parenthesized(a) + "!" + parenthesized(e) + "!" + r
	case "bangEmpty":
		return ": " + parenthesized(a) + "!" + parenthesized(e) + "!"
	case "bangR":
		return ": " + parenthesized(a) + "!!" + r
	case "unknown":
		return ": unknown"
	case "unionOfEffects":
		return ": Effect.Effect<" + a + ", " + e + ", " + r + "> | Effect.Effect<" + a + ">"
	case "unionOfBangs":
		return ": (" + parenthesized(a) + "!" + parenthesized(e) + "!" + r + ") | (" + parenthesized(a) + "!!)"
	case "unionSame":
		return ": Effect.Effect<" + a + ", " + e + ", " + r + "> | Effect.Effect<" + a + ", " + e + ", " + r + ">"
	default:
		return ": " + parenthesized(a) + "!!"
	}
}

func (x annotationTwin) returned() string {
	return map[string]string{"num": "1", "lit": `"a"`, "union": "text.length > 1 ? 1 : text"}[x.a]
}

func (x annotationTwin) vibe() string {
	var b strings.Builder
	b.WriteString("export effect function f(text: string)" + x.annotation() + " {\n")
	if x.body["fails"] {
		b.WriteString("  if (text === \"x\") throw new TypeError(text)\n")
	}
	if x.body["fails2"] {
		b.WriteString("  if (text === \"y\") throw new RangeError(text)\n")
	}
	if x.body["needs"] {
		b.WriteString("  try Effect.addFinalizer(() => Effect.void)\n")
	}
	b.WriteString("  return " + x.returned() + "\n}\n")
	return b.String()
}

// twin prints the Effect.fn function the sentence names: the annotation is
// Effect.fn.Return<A, E, R> on the generator.
func (x annotationTwin) twin() string {
	var b strings.Builder
	b.WriteString("import { Effect, Scope } from \"effect\"\n\nexport const f = Effect.fn(function* (text: string)")
	a, e, r := x.slots(true)
	switch x.shape {
	case "none":
	case "unknown":
		b.WriteString(": unknown")
	case "unionOfEffects", "unionOfBangs":
		b.WriteString(": Effect.fn.Return<" + a + ", " + e + ", " + r + "> | Effect.fn.Return<" + a + ">")
	case "unionSame":
		b.WriteString(": Effect.fn.Return<" + a + ", " + e + ", " + r + "> | Effect.fn.Return<" + a + ", " + e + ", " + r + ">")
	default:
		b.WriteString(": Effect.fn.Return<" + a + ", " + e + ", " + r + ">")
	}
	b.WriteString(" {\n")
	if x.body["fails"] {
		b.WriteString("  if (text === \"x\") return yield* Effect.fail(new TypeError(text))\n")
	}
	if x.body["fails2"] {
		b.WriteString("  if (text === \"y\") return yield* Effect.fail(new RangeError(text))\n")
	}
	if x.body["needs"] {
		b.WriteString("  yield* Effect.addFinalizer(() => Effect.void)\n")
	}
	b.WriteString("  return " + x.returned() + "\n})\n")
	return b.String()
}

const annotationTwinConfig = `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"declaration":true,"outDir":"out","rootDir":"."},"files":[%s]}`

var declaredReturn = regexp.MustCompile(`(?m)^export declare function f\(text: string\): (.*);$`)

// CheckVIP3AnnotationTwin compares one effect function with its Effect.fn
// twin under tsc 5.9.3.
func CheckVIP3AnnotationTwin(t *testing.T, w *Workspace, tsc string, x annotationTwin) {
	const target = "FuzzVIP3AnnotationTwin"
	defer recoverCompilerPanic(t, target)
	g := &Gaps{Target: target, Input: x.vibe()}
	key := ""
	if name := corpusFile(t, target); name != "" {
		key = "corpus:" + name
		g.Input = "testdata/fuzz/" + target + "/" + name
	}
	var c *Compilation
	var err error
	within(t, "compile", func() {
		c, err = w.CompileOrdered(t.Context(), Project{Files: map[string]string{"main.vibe": x.vibe()}, Config: fmt.Sprintf(annotationTwinConfig, `"main.vibe"`)}, OrderTsc, true)
	})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Remove()
	vibeAccepts := c.Program != nil && !HasError(c.Diagnostics)
	if x.shape == "unionOfEffects" || x.shape == "unionOfBangs" {
		// Its two members differ in E and R whenever either is not never; with
		// both never the members are one type, which Chapter 1 accepts.
		_, e, r := x.slots(true)
		distinct := e != "never" || r != "never"
		reported := slices.ContainsFunc(c.Diagnostics, func(d *ast.Diagnostic) bool { return d.Source() == "EK" && d.Code() == 106 })
		switch {
		case distinct && !reported:
			g.Add("feature:annotation-union-EK0106:"+x.shape, "Chapter 1, Static rules: %q is EK0106; a union of different Effect types is not one. The compiler reports %v for:\n%s", annotationUnionQuote, SortedKeys(Keys(c.Dir, c.Diagnostics)), x.vibe())
		case !distinct && reported:
			g.Add("feature:annotation-union-same-EK0106:"+x.shape, "Chapter 1, Static rules: %q; a union of one Effect type is that type, but the compiler reports EK0106 for:\n%s", annotationUnionQuote, x.vibe())
		}
		if distinct {
			g.FinishInput(t, key)
			return
		}
	}
	twinOut, twinAccepts := runAnnotationTwinTSC(t, w, tsc, map[string]string{"main.ts": x.twin()}, `"main.ts"`)
	switch {
	case twinAccepts && !vibeAccepts:
		g.Add("feature:annotation-twin-accepts:"+x.shape, "Chapter 1: %q tsc 5.9.3 accepts the Effect.fn twin; the compiler reports %v.\n%s\ntwin:\n%s", annotationTwinQuote, SortedKeys(Keys(c.Dir, c.Diagnostics)), x.vibe(), x.twin())
	case !twinAccepts && vibeAccepts:
		g.Add("feature:annotation-twin-rejects:"+x.shape, "Chapter 1: %q tsc 5.9.3 rejects the Effect.fn twin:\n%s\nthe compiler accepts:\n%s\ntwin:\n%s", annotationTwinQuote, twinOut, x.vibe(), x.twin())
	case twinAccepts && vibeAccepts:
		m := declaredReturn.FindStringSubmatch(c.Outputs["out/main.d.ts"])
		if m == nil {
			t.Fatalf("no declaration of f in:\n%s", c.Outputs["out/main.d.ts"])
		}
		check := "import { Effect, Scope } from \"effect\"\nimport { f } from \"./main.js\"\n\ntype Same<X, Y> = (<G>() => G extends X ? 1 : 2) extends (<G>() => G extends Y ? 1 : 2) ? true : false\nexport const same: Same<ReturnType<typeof f>, " + m[1] + "> = true\nexport type Unused = Effect.Effect<Scope.Scope>\n"
		out, ok := runAnnotationTwinTSC(t, w, tsc, map[string]string{"main.ts": x.twin(), "check.ts": check}, `"main.ts", "check.ts"`)
		if !ok {
			g.Add("feature:annotation-twin-type:"+x.shape, "Chapter 1: %q the effect function declares %s, which is not the Effect.fn twin's type:\n%s\n%s\ntwin:\n%s", annotationTwinQuote, m[1], out, x.vibe(), x.twin())
		}
	}
	g.FinishInput(t, key)
}

// runAnnotationTwinTSC compiles files with tsc in a project of the
// workspace, whose node_modules holds effect, and reports whether tsc
// accepted them, with its output.
func runAnnotationTwinTSC(t *testing.T, w *Workspace, tsc string, files map[string]string, listed string) (string, bool) {
	t.Helper()
	dir, err := w.writeProject(Project{Files: files, Config: fmt.Sprintf(annotationTwinConfig, listed)})
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	ctx, cancel := context.WithTimeout(t.Context(), 2*HangLimit)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", tsc, "-p", ".", "--pretty", "false", "--noEmit")
	cmd.Dir = dir
	out, runErr := cmd.CombinedOutput()
	if ctx.Err() != nil {
		t.Fatalf("tsc 5.9.3 did not finish: %v", ctx.Err())
	}
	if exit, ok := runErr.(*exec.ExitError); runErr != nil && (!ok || exit.ExitCode() != 1 && exit.ExitCode() != 2) {
		t.Fatalf("tsc 5.9.3 failed to run: %v\n%s", runErr, out)
	}
	return string(out), runErr == nil
}
