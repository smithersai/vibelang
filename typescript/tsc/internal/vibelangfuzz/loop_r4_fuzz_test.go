package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Fuzz coverage for spec loop round 4 (lane sl4-apply). Each target reads its
// rule from the chapter or VIP at test time (RULES.md 1, 4, 9 and 10), picks a
// shape from a keyed input (RULES.md 11), and reports a disagreement through
// Gap under a precise key. Fuzz coverage for OPUS-3, OPUS-4/ASTRA-1, OPUS-6,
// OPUS-7 and ASTRA-2 is fuzz-findings' claim.

func r4Errors(diags []*ast.Diagnostic) []string {
	var out []string
	for _, d := range diags {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		source := d.Source()
		if source == "" {
			source = "TS"
		}
		out = append(out, fmt.Sprintf("%s%04d", source, d.Code()))
	}
	return out
}

func r4Pick(data []byte, names []string) int {
	if key, ok := strings.CutPrefix(string(data), "key:"); ok {
		if i := slices.Index(names, key); i >= 0 {
			return i
		}
	}
	if len(data) == 0 {
		return 0
	}
	return int(data[0]) % len(names)
}

func r4Quoted(tb testing.TB, chapter string, quotes ...string) {
	tb.Helper()
	text := SpecText(chapter)
	for _, q := range quotes {
		if !strings.Contains(text, q) {
			tb.Fatalf("%s no longer says %q", chapter, q)
		}
	}
}

func r4Seeds(f *testing.F, names []string) {
	for _, name := range names {
		f.Add([]byte("key:" + name))
	}
}

// ---------------------------------------------------------------------------
// OPUS-1 (decided detail 250): a JSX attribute is an object member under
// VIP-4's assignability rule, so its verdict is the one every other
// call-signature comparison site gives. The .vibe neighbourhood: a foreign
// function value with a written @throws, checked against a function type at
// an argument, an object member, a spread member, an initializer, a return
// against a written type and an array element.

const (
	attributeQuote     = "a function value in an attribute must fit the prop's call signature, as in `f({ onClick: … })`"
	assignabilityQuote = "The rule applies wherever TypeScript checks one call signature against another: assignments, arguments, returns against a written return type, object members"
	untaggedQuote      = "without `@throws`, they admit only `never`"
)

type callbackSource struct {
	name, tag string
	thrown    int // index into callbackBounds
}

// callbackBounds orders thrown types by subtyping for the oracle:
// never < TypeError < Error < unknown.
var callbackBounds = []string{"never", "TypeError", "Error", "unknown"}

var callbackSources = []callbackSource{
	{"never", "/** @throws {never} */", 0},
	{"type-error", "/** @throws {TypeError} */", 1},
	{"error", "/** @throws {Error} */", 2},
	{"unknown", "/** @throws {unknown} */", 3},
}

var callbackDestinations = []struct {
	name, decl string
	admits     int
}{
	{"untagged", "export type Handler = () => void", 0},
	{"error", "export interface Handler {\n  /** @throws {Error} */\n  (): void\n}", 2},
	{"unknown", "export interface Handler {\n  /** @throws {unknown} */\n  (): void\n}", 3},
}

// callbackSites are the places a value meets a function type. A site that
// admits unknown whatever Handler says is one of Appendix E's: a parameter
// named by @rethrows, or the thunk of Effect.try.
var callbackSites = []struct {
	name, code string
	admitsAll  bool
}{
	{"argument", "call(source)", false},
	{"member", "take({ onClick: source })", false},
	{"spread", "take({ ...{ onClick: source } })", false},
	{"initializer", "const h: Handler = source\n  void h", false},
	{"array", "const hs: Handler[] = [source]\n  void hs", false},
	{"arrow-return", "const back = (): Handler => source\n  void back", false},
	{"rethrows", "each(source)", true},
	{"effect-try", "void Effect.try(source)", true},
}

func callbackNames() []string {
	var names []string
	for _, src := range callbackSources {
		for _, dst := range callbackDestinations {
			for _, site := range callbackSites {
				names = append(names, src.name+"/"+dst.name+"/"+site.name)
			}
		}
	}
	return names
}

func TestForeignCallbackSitesQuoted(t *testing.T) {
	r4Quoted(t, "../vips/0039-vibex.md", attributeQuote)
	r4Quoted(t, "003-failures.md", assignabilityQuote, untaggedQuote)
}

func FuzzForeignCallbackSites(f *testing.F) {
	startShortBudget(f)
	r4Quoted(f, "../vips/0039-vibex.md", attributeQuote)
	r4Quoted(f, "003-failures.md", assignabilityQuote, untaggedQuote)
	names := callbackNames()
	r4Seeds(f, names)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		i := r4Pick(data, names)
		site := callbackSites[i%len(callbackSites)]
		dst := callbackDestinations[(i/len(callbackSites))%len(callbackDestinations)]
		src := callbackSources[i/(len(callbackSites)*len(callbackDestinations))]
		handlers := src.tag + "\nexport function source(): void {}\n" + dst.decl + "\n" +
			"/** @throws {never} */\nexport declare function take(props: { onClick: Handler }): void\n" +
			"/** @throws {never} */\nexport declare function call(f: Handler): void\n" +
			"/** @throws {never} @rethrows f */\nexport declare function each(f: Handler): void\n"
		main := "import { source, take, call, each, type Handler } from \"./handlers.ts\"\nexport function sites() {\n  " + site.code + "\n}\n"
		files := map[string]string{"handlers.ts": handlers, "main.vibe": main}
		config := strings.TrimSuffix(DefaultConfig, "\n  }\n}") + ",\n    \"allowImportingTsExtensions\": true,\n    \"noEmit\": true\n  },\n  \"files\": [\"main.vibe\", \"handlers.ts\"]\n}"
		r, err := w.Compile(t.Context(), Project{Files: files, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		errs := r4Errors(r.Diagnostics)
		want := src.thrown > dst.admits && !site.admitsAll
		got := slices.Contains(errs, "EK0402")
		others := slices.DeleteFunc(slices.Clone(errs), func(e string) bool { return e == "EK0402" })
		if len(others) > 0 {
			t.Fatalf("%s: unexpected errors %v\n%s", names[i], others, Archive(files))
		}
		if want && !got {
			Gap(t, "FuzzForeignCallbackSites", "missing:EK0402/"+site.name, "003-failures: %s; %s: a @throws {%s} value against a function type admitting %s gives %v:\n%s", assignabilityQuote, names[i], callbackBounds[src.thrown], callbackBounds[dst.admits], errs, Archive(files))
		}
		if got && !want {
			Gap(t, "FuzzForeignCallbackSites", "extra:EK0402/"+site.name, "003-failures: %s; %s: a @throws {%s} value fits a function type admitting %s, but gives %v:\n%s", assignabilityQuote, names[i], callbackBounds[src.thrown], callbackBounds[dst.admits], errs, Archive(files))
		}
	})
}

// ---------------------------------------------------------------------------
// OPUS-2: chapter 7 publishes the relative-specifier resolution table. The
// .vibe rows run today; the .vibex candidates wait for the file kind.

const resolutionHeading = "## JSX source files: `.vibex`"

type resolutionRow struct {
	specifier  string
	candidates []string
}

// resolutionTable reads chapter 7's table at test time.
func resolutionTable(tb testing.TB) []resolutionRow {
	tb.Helper()
	text := SpecText("007-tooling.md")
	at := strings.Index(text, resolutionHeading)
	if at < 0 {
		tb.Fatalf("007-tooling.md no longer has %q", resolutionHeading)
	}
	var rows []resolutionRow
	for line := range strings.SplitSeq(text[at:], "\n") {
		if !strings.HasPrefix(line, "| `./App") {
			if len(rows) > 0 && !strings.HasPrefix(line, "|") {
				break
			}
			continue
		}
		cells := strings.Split(line, "|")
		var row resolutionRow
		for spec := range strings.SplitSeq(cells[1], ",") {
			spec = strings.Trim(strings.TrimSpace(spec), "`")
			if row.specifier == "" || strings.HasSuffix(spec, ".js") {
				row.specifier = spec // the extensioned spelling when a row has two
			}
		}
		for c := range strings.SplitSeq(cells[2], ",") {
			c = strings.TrimSpace(c)
			if strings.HasPrefix(c, "`App.") {
				row.candidates = append(row.candidates, strings.Trim(c, "`"))
			}
		}
		rows = append(rows, row)
	}
	if len(rows) != 4 {
		tb.Fatalf("007-tooling.md: want 4 resolution rows, got %d", len(rows))
	}
	return rows
}

// resolutionKinds are the candidate files the generator can write; a file
// says which one it is through the literal type of its export.
var resolutionKinds = []string{"App.ts", "App.tsx", "App.vibe", "App.d.ts"}

func resolutionNames(rows []resolutionRow) []string {
	var names []string
	for _, row := range rows {
		if strings.HasSuffix(row.specifier, ".vibex") {
			continue // the .vibex file kind is not built yet (VIP-39 preconditions)
		}
		for mask := 1; mask < 1<<len(resolutionKinds); mask++ {
			names = append(names, fmt.Sprintf("%s/%04b", row.specifier, mask))
		}
	}
	return names
}

func TestVibeResolutionTableQuoted(t *testing.T) { resolutionTable(t) }

func FuzzVibeResolutionOrder(f *testing.F) {
	startShortBudget(f)
	rows := resolutionTable(f)
	names := resolutionNames(rows)
	r4Seeds(f, names)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		name := names[r4Pick(data, names)]
		specifier, bits, _ := strings.Cut(name, "/")
		var row resolutionRow
		for _, r := range rows {
			if r.specifier == specifier {
				row = r
			}
		}
		files := map[string]string{}
		var present []string
		for k, kind := range resolutionKinds {
			if bits[len(bits)-1-k] != '1' {
				continue
			}
			present = append(present, kind)
			if kind == "App.d.ts" {
				files[kind] = "export declare const which: \"" + kind + "\"\n"
			} else {
				files[kind] = "export const which = \"" + kind + "\" as const\n"
			}
		}
		want := ""
		for _, c := range row.candidates {
			if slices.Contains(present, c) {
				want = c
				break
			}
		}
		if want == "" {
			return // only JavaScript or .vibex candidates would apply
		}
		files["main.vibe"] = "import { which } from \"" + specifier + "\"\nexport const check: \"" + want + "\" = which\n"
		config := strings.TrimSuffix(DefaultConfig, "\n  }\n}") + ",\n    \"allowImportingTsExtensions\": true,\n    \"jsx\": \"preserve\",\n    \"noEmit\": true\n  },\n  \"files\": [\"main.vibe\"]\n}"
		r, err := w.Compile(t.Context(), Project{Files: files, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		if errs := r4Errors(r.Diagnostics); len(errs) > 0 {
			Gap(t, "FuzzVibeResolutionOrder", "order:"+specifier, "007-tooling: %s tries %v; with %v present it must pick %s, but reports %v:\n%s", specifier, row.candidates, present, want, errs, Archive(files))
		}
	})
}

// ---------------------------------------------------------------------------
// OPUS-5 (decided detail 198, VIP-2): a `do` that jumps out of a larger
// expression is an expression like any other operand: "Everything to its left
// runs first, in source order". VIP-39 row 33 applies this to a JSX element.
// Static half: every operand position admits a `do` whose return, break or
// continue leaves it. The run-time order is the case do-jump-operand-order.

const (
	doOrderQuote = "Everything to its left runs first, in source order, fully evaluated as ECMA-262 specifies"
	row33Quote   = "the `do` never moves alone"
)

var doPositions = []struct{ name, code string }{
	{"argument", "f(1, D, 2)"},
	{"new-argument", "new Array<number>(1, D)"},
	{"array", "[1, D, 2]"},
	{"object", "({ a: 1, v: D, z: 2 })"},
	{"spread", "[...[1], D]"},
	{"template", "`${1}${D}`"},
	{"binary-right", "1 + D"},
	{"conditional", "flag ? D : 2"},
	{"coalesce", "maybe ?? D"},
}

var doJumps = []struct{ name, body string }{
	{"return", "do { if (flag) return 7; 1 }"},
	{"break", "do { if (flag) break; 1 }"},
	{"continue", "do { if (flag) continue; 1 }"},
	{"labeled-break", "do { if (flag) break outer; 1 }"},
	{"none", "do { const n = 1; n }"},
}

var doBodies = []string{"effect", "async"}

func doNames() []string {
	var names []string
	for _, body := range doBodies {
		for _, jump := range doJumps {
			for _, pos := range doPositions {
				names = append(names, body+"/"+jump.name+"/"+pos.name)
			}
		}
	}
	return names
}

func TestDoJumpOperandQuoted(t *testing.T) {
	r4Quoted(t, "002-running.md", doOrderQuote)
	r4Quoted(t, "../vips/0039-vibex.md", row33Quote)
}

func FuzzDoJumpOperandPositions(f *testing.F) {
	startShortBudget(f)
	r4Quoted(f, "002-running.md", doOrderQuote)
	r4Quoted(f, "../vips/0039-vibex.md", row33Quote)
	names := doNames()
	r4Seeds(f, names)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		i := r4Pick(data, names)
		pos := doPositions[i%len(doPositions)]
		jump := doJumps[(i/len(doPositions))%len(doJumps)]
		body := doBodies[i/(len(doPositions)*len(doJumps))]
		expr := strings.Replace(pos.code, "D", jump.body, 1)
		head := "export effect function main(flag: boolean, maybe: number | undefined) {"
		if body == "async" {
			head = "export async function main(flag: boolean, maybe: number | undefined) {"
		}
		source := "declare function f(...xs: unknown[]): unknown\n" + head + "\n  outer: for (const _ of [0]) {\n    const v = " + expr + "\n    void v\n  }\n  return 0\n}\n"
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		if errs := r4Errors(r.Diagnostics); len(errs) > 0 {
			Gap(t, "FuzzDoJumpOperandPositions", "jump:"+jump.name, "002-running: %s; %s: a do whose %s leaves it is an ordinary operand, but reports %v:\n%s", doOrderQuote, names[i], jump.name, errs, source)
		}
	})
}
