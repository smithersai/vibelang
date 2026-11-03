package vibelangfuzz

import (
	"slices"
	"strconv"
	"strings"
	"testing"
)

// FuzzPreludeModuleClash holds Chapter 5, "Effect's modules are in scope":
// "Precedence applies per meaning, as in TypeScript. In a type position, a
// bare name declared as a type by an ambient global declaration (a TypeScript
// `lib` file or `@types`) keeps that meaning (including the DOM's `Console`,
// `FileSystem`, `Headers`, `Response` and `Event`). In a value or namespace
// position the table below decides." and "Bare `Worker` is Effect's
// `effect/workers` namespace, by the precedence above, as `Headers`,
// `Response` and `Event` are." The input picks one of the
// four names and a position: a value read of the module (compiles), `new
// Name()` on the namespace (TypeScript's own "not constructable" error, the
// same codes the imported namespace gets), a type position (the DOM type
// compiles) and a local class that shadows the module. Each .vibe program's
// counterpart is the same TypeScript with the module imported from its
// subpath, or, for a type position, with no import at all. foldkit-84
// (inbox migrate-foldkit, 2026-11-01) returned a module to TypeScript over a
// public signature naming `Response`.
func FuzzPreludeModuleClash(f *testing.F) {
	startShortBudget(f)
	preludeClashChapters(f)
	w := NewWorkspace(f)
	for _, name := range preludeClashNames {
		for _, position := range preludeClashPositions {
			f.Add([]byte("clash:" + name.name + ":" + position))
		}
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		CheckPreludeModuleClash(t, w, parsePreludeClash(data))
	})
}

// TestPreludeModuleClashQuoted fails when Chapter 5 rewords a sentence the
// oracle quotes (RULES.md 9).
func TestPreludeModuleClashQuoted(t *testing.T) { preludeClashChapters(t) }

var preludeClashQuotes = []string{
	"**Precedence applies per meaning, as in TypeScript.** In a type position, a bare name declared as a type by an ambient global declaration (a TypeScript `lib` file or `@types`) keeps that meaning (including the DOM's `Console`, `FileSystem`, `Headers`, `Response` and `Event`). In a value or namespace position the table below decides.",
	"Bare `Worker` is Effect's `effect/workers` namespace, by the precedence above, as `Headers`, `Response` and `Event` are.",
	"A local or imported `Worker` shadows as usual, and `new Worker(url)` on the namespace gets TypeScript's own \"not constructable\" error.",
}

func preludeClashChapters(tb testing.TB) {
	tb.Helper()
	text := SpecText("005-services.md")
	for _, quote := range preludeClashQuotes {
		if !strings.Contains(text, quote) {
			tb.Fatalf("005-services.md no longer says %q", quote)
		}
	}
}

// A preludeClashName is a Web global whose bare name is an Effect module in a
// value position: the subpath that exports it and one member the module has
// in the pinned Effect, which the counterpart proves.
type preludeClashName struct {
	name, subpath, member string
}

var preludeClashNames = []preludeClashName{
	{"Headers", "effect/http", "empty"},
	{"Response", "effect/ai", "isPart"},
	{"Event", "effect/eventlog", "isEvent"},
	{"Worker", "effect/workers", "Spawner"},
}

// preludeClashPositions are where the bare name stands.
var preludeClashPositions = []string{"value", "construct", "type", "signature", "shadow"}

type preludeClashInput struct {
	name     preludeClashName
	position string
}

func (in preludeClashInput) key() string { return "clash:" + in.name.name + ":" + in.position }

// parsePreludeClash reads the keyed form, `clash:<name>:<position>`, so a
// saved corpus file keeps what it tests (RULES.md 11), and otherwise reads
// the choice from the bytes.
func parsePreludeClash(data []byte) preludeClashInput {
	in := preludeClashInput{name: preludeClashNames[0], position: preludeClashPositions[0]}
	if rest, ok := strings.CutPrefix(string(data), "clash:"); ok {
		parts := strings.Split(rest, ":")
		for _, name := range preludeClashNames {
			if parts[0] == name.name {
				in.name = name
			}
		}
		if len(parts) > 1 && slices.Contains(preludeClashPositions, parts[1]) {
			in.position = parts[1]
		}
		return in
	}
	at := func(i int) byte {
		if i < len(data) {
			return data[i]
		}
		return 0
	}
	in.name = preludeClashNames[int(at(0))%len(preludeClashNames)]
	in.position = preludeClashPositions[int(at(1))%len(preludeClashPositions)]
	return in
}

// preludeClashProgram prints the .vibe program, or with native its
// counterpart: the module imported from its subpath where the bare name means
// the module, and nothing imported where it means the DOM type.
func preludeClashProgram(in preludeClashInput, native bool) string {
	n := in.name.name
	moduleImport := ""
	if native {
		moduleImport = "import { " + n + " } from \"" + in.name.subpath + "\"\n\n"
	}
	switch in.position {
	case "construct":
		return moduleImport + "export const probe = new " + n + "();\n"
	case "type":
		return "export declare const value: " + n + ";\nexport const same = (x: " + n + "): " + n + " => x;\n"
	case "signature":
		return "export declare function make(input: string): " + n + ";\nexport declare const latest: ReadonlyArray<" + n + ">;\n"
	case "shadow":
		return "class " + n + " {\n  readonly size = 0\n}\nexport const probe = new " + n + "().size;\n"
	default:
		return moduleImport + "export const probe = " + n + "." + in.name.member + ";\n"
	}
}

// errorCodes lists the error diagnostics' sources and codes, sorted.
func errorCodes(dir string, c *Compilation) []string {
	var codes []string
	for _, k := range Keys(dir, c.Diagnostics) {
		if k.Category.Name() == "error" {
			codes = append(codes, cmp(k.Source, "TS")+strconv.Itoa(int(k.Code)))
		}
	}
	slices.Sort(codes)
	return slices.Compact(codes)
}

// CheckPreludeModuleClash runs the oracle on one input.
func CheckPreludeModuleClash(t *testing.T, w *Workspace, in preludeClashInput) {
	const target = "FuzzPreludeModuleClash"
	defer recoverCompilerPanic(t, target)
	key := ""
	if name := corpusFile(t, target); name != "" {
		key = "corpus:" + name
	}
	compile := func(file, source string) *Compilation {
		var c *Compilation
		var err error
		within(t, file, func() {
			c, err = w.CompileOrdered(t.Context(), Project{Files: map[string]string{file: source, "package.json": `{"type":"module"}`}}, OrderTsc, true)
		})
		if err != nil {
			t.Fatal(err)
		}
		return c
	}
	native := preludeClashProgram(in, true)
	control := compile("main.ts", native)
	defer control.Remove()
	if control.Program == nil {
		t.Fatalf("invalid TypeScript counterpart for %s: no program\n%s", in.key(), native)
	}
	want := errorCodes(control.Dir, control)
	if in.position != "construct" && len(want) != 0 {
		t.Fatalf("invalid TypeScript counterpart for %s: %v\n%s", in.key(), SortedKeys(Keys(control.Dir, control.Diagnostics)), native)
	}
	vibe := preludeClashProgram(in, false)
	g := &Gaps{Target: target, Input: vibe}
	c := compile("main.vibe", vibe)
	defer c.Remove()
	if c.Program == nil {
		t.Fatalf("no program for %s", in.key())
	}
	got := errorCodes(c.Dir, c)
	if !slices.Equal(got, want) {
		g.Add("feature:"+in.key(), "Chapter 5: precedence applies per meaning (%s in a %s position); the counterpart reports %v, the compiler %v for:\n%s", in.name.name, in.position, want, SortedKeys(Keys(c.Dir, c.Diagnostics)), vibe)
	}
	g.FinishInput(t, key)
}
