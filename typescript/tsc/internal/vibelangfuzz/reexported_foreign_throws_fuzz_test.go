package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Chapter 3, Thrown types: a callable's contract is its declaring signature's,
// whichever package re-exports it and however the program imports it. vitest's
// expect and assert, which @effect/vitest re-exports, are the motivating case
// (VIP-4, clarified 2026-11-10).
var reexportedThrowsQuotes = []string{
	"The declaring signature decides the contract, not the import path: a package's re-export of another package's callable, and a method of a value its call returned, keep the declaration's own tags.",
	"| no tag | `unknown` |",
	"In effect code, a call, `new` expression, tagged template or class evaluation whose thrown type is not `never`.",
}

func TestReexportedThrowsQuoted(t *testing.T) { requireReexportedThrowsQuotes(t) }

func requireReexportedThrowsQuotes(t testing.TB) {
	t.Helper()
	text := SpecText(failuresChapter)
	for _, quote := range reexportedThrowsQuotes {
		if !strings.Contains(text, quote) {
			t.Fatalf("chapter 3 rule changed: %q", quote)
		}
	}
}

// The dimensions of one program. Keys name each choice, so a corpus file keeps
// testing the same program when a list grows.
var (
	reexportedThrowsPackages = []string{"@effect/vitest", "@effect/relay", "relay"}
	reexportedThrowsForms    = []string{"star", "named", "renamed", "namespace"}
	reexportedThrowsTags     = []string{"none", "never", "error"}
	reexportedThrowsShapes   = []string{"direct", "member", "returned", "held"}
	reexportedThrowsHosts    = []string{"effect", "wrapped"}
	reexportedThrowsImports  = []string{"named", "star"}
)

type reexportedThrowsCase struct{ pkg, form, tag, shape, host, imports string }

func (c reexportedThrowsCase) key() string {
	return strings.Join([]string{c.pkg, c.form, c.tag, c.shape, c.host, c.imports}, ":")
}

func pickKeyed(list []string, field string, fallback byte) string {
	for _, item := range list {
		if item == field {
			return item
		}
	}
	return list[int(fallback)%len(list)]
}

// reexportedThrowsCaseOf reads a key such as "relay:named:none:direct:effect:named",
// falling back to bytes of the input for each field it does not name.
func reexportedThrowsCaseOf(input string) reexportedThrowsCase {
	fields := strings.Split(input, ":")
	field := func(i int) (string, byte) {
		var b byte
		if i < len(input) {
			b = input[i]
		}
		if i < len(fields) {
			return fields[i], b
		}
		return "", b
	}
	pick := func(i int, list []string) string { f, b := field(i); return pickKeyed(list, f, b) }
	return reexportedThrowsCase{
		pkg:     pick(0, reexportedThrowsPackages),
		form:    pick(1, reexportedThrowsForms),
		tag:     pick(2, reexportedThrowsTags),
		shape:   pick(3, reexportedThrowsShapes),
		host:    pick(4, reexportedThrowsHosts),
		imports: pick(5, reexportedThrowsImports),
	}
}

// project builds the vendor package, the re-exporting package and main.vibe,
// and returns the EK0403 count the quoted rules give: one per call whose
// declared contract is not never, in effect code outside Effect.try.
func (c reexportedThrowsCase) project() (map[string]string, int) {
	tag := map[string]string{"none": "", "never": "/** @throws {never} */\n", "error": "/** @throws {Error} */\n"}[c.tag]
	vendor := "export interface Assertion {\n" + tag + "toBe(expected: number): void\n}\n" +
		tag + "export declare function fn(x: number): number\n" +
		"export declare const obj: {\n" + tag + "check(x: number): void\n}\n" +
		tag + "export declare function make(x: number): Assertion\n"
	suffix := ""
	reexport := map[string]string{
		"star":      `export * from "vendor"`,
		"named":     `export { fn, obj, make } from "vendor"`,
		"renamed":   `export { fn as fn2, obj as obj2, make as make2 } from "vendor"`,
		"namespace": `export * as V from "vendor"`,
	}[c.form]
	if c.form == "renamed" {
		suffix = "2"
	}
	dir := "node_modules/" + c.pkg
	files := map[string]string{
		"package.json":                     `{"type":"module"}`,
		"node_modules/vendor/package.json": `{"name":"vendor","type":"module","types":"index.d.ts"}`,
		"node_modules/vendor/index.d.ts":   vendor,
		dir + "/package.json":              fmt.Sprintf(`{"name":%q,"type":"module","types":"index.d.ts"}`, c.pkg),
		dir + "/index.d.ts":                reexport + "\n",
	}
	names := []string{"fn" + suffix, "obj" + suffix, "make" + suffix}
	var imports, qualifier string
	switch {
	case c.imports == "star":
		imports = fmt.Sprintf("import * as R from %q", c.pkg)
		qualifier = "R."
		if c.form == "namespace" {
			qualifier = "R.V."
		}
	case c.form == "namespace":
		imports = fmt.Sprintf("import { V } from %q", c.pkg)
		qualifier = "V."
	default:
		imports = fmt.Sprintf("import { %s } from %q", strings.Join(names, ", "), c.pkg)
	}
	fn, obj, make := qualifier+names[0], qualifier+names[1], qualifier+names[2]
	statements, calls := map[string][]string{
		"direct":   {fn + "(1)"},
		"member":   {obj + ".check(1)"},
		"returned": {make + "(1).toBe(1)"},
		"held":     {"const held = " + make + "(1)", "held.toBe(1)"},
	}[c.shape], map[string]int{"direct": 1, "member": 1, "returned": 2, "held": 2}[c.shape]
	body := "  " + strings.Join(statements, "\n  ")
	want := 0
	if c.host == "wrapped" {
		body = "  try Effect.try(() => {\n    " + strings.Join(statements, "\n    ") + "\n  })"
	} else if c.tag != "never" {
		want = calls
	}
	files["main.vibe"] = imports + "\n\nexport effect function use() {\n" + body + "\n}\n"
	return files, want
}

func FuzzReexportedForeignThrows(f *testing.F) {
	startShortBudget(f)
	requireReexportedThrowsQuotes(f)
	// Every package, form, tag and shape once; hosts and import styles rotate.
	i := 0
	for _, pkg := range reexportedThrowsPackages {
		for _, form := range reexportedThrowsForms {
			for _, tag := range reexportedThrowsTags {
				shape := reexportedThrowsShapes[i%len(reexportedThrowsShapes)]
				host := reexportedThrowsHosts[(i/len(reexportedThrowsShapes))%len(reexportedThrowsHosts)]
				imports := reexportedThrowsImports[(i/2)%len(reexportedThrowsImports)]
				f.Add(reexportedThrowsCase{pkg, form, tag, shape, host, imports}.key())
				i++
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, input string) {
		c := reexportedThrowsCaseOf(input)
		files, want := c.project()
		result, err := w.Compile(t.Context(), Project{Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		got := 0
		var other []string
		for _, d := range result.Diagnostics {
			if d.Source() == "EK" && d.Code() == 403 {
				got++
			} else if d.Category() == diagnostics.CategoryError {
				other = append(other, fmt.Sprintf("%s%d %s", d.Source(), d.Code(), d.String()))
			}
		}
		if len(other) != 0 {
			t.Fatalf("%s: unexpected errors %v\n%s", c.key(), other, files["main.vibe"])
		}
		if got != want {
			Gap(t, "FuzzReexportedForeignThrows", "reexport-throws:"+c.key(), "%s; got %d EK0403, want %d\n%s\n%s", reexportedThrowsQuotes[0], got, want, files["node_modules/"+c.pkg+"/index.d.ts"], files["main.vibe"])
		}
	})
}
