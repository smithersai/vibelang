package vibelangfuzz

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"
)

// FuzzUnionPipeRequirements enforces Chapter 1, Declaration output:
// "Declarations are exactly what idiomatic Effect TypeScript would declare",
// for a generic call that infers its requirements from an implementation
// built inside a callback. Binding a function to a local const and naming
// it in the returned object is the same value and the same type as writing
// the function in the object (a function expression's type does not widen),
// so when the inline program compiles, the local-const program compiles and
// declares the same provider; this compares the compiler with itself on two
// inputs that agree (RULES.md 1). Decision 6 matches TypeScript 7.0.2, which
// holds this on all 96 generated programs (it also rejects nine programs both
// ways, declaring them differently); 7.1's cached inference from type
// arguments inferred never for the local const. The input picks the callback (Effect.sync, Effect.gen, an
// immediately called function), the operand (a union of Effects with two
// requirement sets, or one), the combinator (a pipe of mapError or map,
// mapError called directly, none) and the requirements. alchemy's Railway,
// Cloudflare and PlanetScale AuthProvider register their providers this way
// (corpus alchemy-union-pipe-requirements).
func FuzzUnionPipeRequirements(f *testing.F) {
	startShortBudget(f)
	unionPipeChapter(f)
	for _, wrapper := range unionPipeWrappers {
		for _, combinator := range unionPipeCombinators {
			f.Add([]byte("union-pipe:" + wrapper.name + "/union/" + combinator.name + "/AB-A"))
		}
	}
	f.Add([]byte("union-pipe:sync/single/pipe-mapError/AB-A"))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		CheckUnionPipeRequirements(t, w, parseUnionPipe(data))
	})
}

// TestUnionPipeRequirementsQuoted fails when Chapter 1 rewords the sentence
// the oracle quotes (RULES.md 9).
func TestUnionPipeRequirementsQuoted(t *testing.T) { unionPipeChapter(t) }

const unionPipeQuote = "Declarations are exactly what idiomatic Effect TypeScript would declare."

func unionPipeChapter(tb testing.TB) {
	tb.Helper()
	text, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		tb.Fatal(err)
	}
	if !strings.Contains(string(text), unionPipeQuote) {
		tb.Fatalf("Chapter 1 no longer says %q", unionPipeQuote)
	}
}

type unionPipeChoice struct{ name, text string }

// BODY stands for the callback's statements, which return the implementation.
var unionPipeWrappers = []unionPipeChoice{
	{"sync", "Effect.sync(() => {\nBODY\n})"},
	{"gen", "Effect.gen(function* () {\nBODY\n})"},
	{"call", "Effect.succeed((() => {\nBODY\n})())"},
}

// X stands for the operand.
var unionPipeCombinators = []unionPipeChoice{
	{"pipe-mapError", "X.pipe(Effect.mapError((e) => e))"},
	{"pipe-map", "X.pipe(Effect.map((c) => c))"},
	{"mapError", "Effect.mapError(X, (e) => e)"},
	{"none", "X"},
}

var unionPipeOperands = []unionPipeChoice{
	{"union", "(name ? first : second)"},
	{"single", "first"},
}

// Each requirement set gives first's and second's requirements.
var unionPipeRequirements = []unionPipeChoice{
	{"AB-A", "A | B;A"},
	{"B-A", "B;A"},
	{"AB-AB", "A | B;A | B"},
	{"A-A", "A;A"},
}

type unionPipeInput struct{ wrapper, operand, combinator, requirements unionPipeChoice }

// parseUnionPipe reads `union-pipe:<wrapper>/<operand>/<combinator>/<requirements>`
// (RULES.md 11), and otherwise picks from the bytes.
func parseUnionPipe(data []byte) unionPipeInput {
	find := func(choices []unionPipeChoice, name string) unionPipeChoice {
		for _, c := range choices {
			if c.name == name {
				return c
			}
		}
		return choices[0]
	}
	if rest, ok := strings.CutPrefix(string(data), "union-pipe:"); ok {
		parts := append(strings.Split(rest, "/"), "", "", "", "")
		return unionPipeInput{find(unionPipeWrappers, parts[0]), find(unionPipeOperands, parts[1]), find(unionPipeCombinators, parts[2]), find(unionPipeRequirements, parts[3])}
	}
	at := func(i int) int {
		if i < len(data) {
			return int(data[i])
		}
		return 0
	}
	return unionPipeInput{unionPipeWrappers[at(0)%len(unionPipeWrappers)], unionPipeOperands[at(1)%len(unionPipeOperands)], unionPipeCombinators[at(2)%len(unionPipeCombinators)], unionPipeRequirements[at(3)%len(unionPipeRequirements)]}
}

// source prints lib.ts; local binds configure to a const first.
func (in unionPipeInput) source(local bool) string {
	firstR, secondR, _ := strings.Cut(in.requirements.text, ";")
	fn := "(name: string) => " + strings.ReplaceAll(in.combinator.text, "X", in.operand.text)
	body := "  return { configure: " + fn + " }"
	if local {
		body = "  const configure = " + fn + "\n  return { configure }"
	}
	return strings.Join([]string{
		`import * as Effect from "effect/Effect"`,
		`export interface A { readonly a: "A" }`,
		`export interface B { readonly b: "B" }`,
		`type E = { readonly message: string }`,
		`type Config = { method: "x" } | { method: "y" }`,
		`interface Impl<C, R> { configure(name: string): Effect.Effect<C, E, R | A> }`,
		`const register = <C>() => <R = never, InitR = never>(impl: Impl<C, R> | Effect.Effect<Impl<C, R>, never, InitR>): Effect.Effect<string, never, R | InitR> =>`,
		`  Effect.as(Effect.isEffect(impl) ? impl : Effect.succeed(impl), "registered")`,
		`const first = Effect.succeed({ method: "x" as const }) as Effect.Effect<{ method: "x" }, E, ` + firstR + `>`,
		`const second = Effect.succeed({ method: "y" as const }) as Effect.Effect<Config, E, ` + secondR + `>`,
		"export const provider = register<Config>()(" + strings.Replace(in.wrapper.text, "BODY", body, 1) + ")",
		"",
	}, "\n")
}

const unionPipeConfig = `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"declaration":true,"emitDeclarationOnly":true,"outDir":"out"},"files":["lib.ts"]}`

// CheckUnionPipeRequirements compiles the inline and the local-const program
// and, when the inline one compiles, compares their codes and provider
// declarations.
func CheckUnionPipeRequirements(t *testing.T, w *Workspace, in unionPipeInput) {
	const target = "FuzzUnionPipeRequirements"
	defer recoverCompilerPanic(t, target)
	local := in.source(true)
	g := &Gaps{Target: target, Input: local}
	key := ""
	if name := corpusFile(t, target); name != "" {
		key = "corpus:" + name
		g.Input = "testdata/fuzz/" + target + "/" + name
	}
	compile := func(source string) ([]string, string) {
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"package.json": `{"type":"module"}`, "lib.ts": source}, Config: unionPipeConfig})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var codes []string
		for _, d := range r.Diagnostics {
			if d.Category().Name() == "error" {
				codes = append(codes, fmt.Sprintf("%s%d", d.Source(), d.Code()))
			}
		}
		slices.Sort(codes)
		declaration := ""
		for _, line := range strings.Split(r.Outputs["out/lib.d.ts"], "\n") {
			if strings.Contains(line, "provider") {
				declaration = line
			}
		}
		return codes, declaration
	}
	inlineCodes, inlineDeclaration := compile(in.source(false))
	localCodes, localDeclaration := compile(local)
	if len(inlineCodes) == 0 && (len(localCodes) != 0 || inlineDeclaration != localDeclaration) {
		g.Add("feature:union-pipe-requirements", "Chapter 1: %q; configure bound to a local const declares and checks as configure written in the object (decision 6: as TypeScript 7.0.2 does).\ninline: %v %s\nlocal const: %v %s\n%s", unionPipeQuote, inlineCodes, inlineDeclaration, localCodes, localDeclaration, local)
	}
	g.FinishInput(t, key)
}
