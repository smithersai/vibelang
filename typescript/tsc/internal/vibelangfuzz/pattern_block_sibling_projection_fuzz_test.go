package vibelangfuzz

import (
	"os"
	"sort"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

// An is test's names belong to the enclosing block, so the checking view
// renders that block as one form. The statements beside the test keep their
// own meaning: chapter 002 gives each try operation its lowering wherever it
// stands, and chapter 004 gives the test only its names' home. The oracle
// reads both rules from their chapters and checks the rendered block against
// the shipped declaration surface with the compiler's TypeScript frontend.
var patternBlockSiblingQuotes = []struct{ chapter, quote string }{
	{"002-running.md", "| `try.all [a(), b()]` | `yield* Effect.all([a(), b()], { concurrency: \"unbounded\" })` |"},
	{"002-running.md", "| `try.race [a(), b()]` | `yield* Effect.raceAllFirst([a(), b()])` |"},
	{"002-running.md", "| `try.any [a(), b()]` | `yield* Effect.raceAll([a(), b()])` |"},
	{"002-running.md", "| `try.allSettled [a(), b()]` | `yield* Effect.all([Effect.exit(a()), Effect.exit(b())], { concurrency: \"unbounded\" })`"},
	{"004-match.md", "In an ordinary block expression or an `if` head, its `let` and `const` names belong to the nearest enclosing lexical home"},
}

func TestPatternBlockSiblingProjectionQuoted(t *testing.T) {
	for _, q := range patternBlockSiblingQuotes {
		if !strings.Contains(SpecText(q.chapter), q.quote) {
			t.Fatalf("chapter %s changed; update the pattern-block sibling oracle: %s", q.chapter, q.quote)
		}
	}
}

// Each sibling is a statement and the text chapter 002's table requires in
// its rendering, or "" when the TypeScript check alone is the oracle.
var patternBlockSiblings = map[string][2]string{
	"try-all":         {`const [a, b] = try.all [load(1), load(2)]`, `Effect.all([load(1), load(2)], { concurrency: "unbounded" })`},
	"try-race":        {`const first: number = try.race [load(3), load(4)]`, `Effect.raceAllFirst([load(3), load(4)])`},
	"try-any":         {`const any: number = try.any [load(3), load(4)]`, `Effect.raceAll([load(3), load(4)])`},
	"try-all-settled": {`const settled = try.allSettled [load(3), load(4)]`, `Effect.all([Effect.exit(load(3)), Effect.exit(load(4))], { concurrency: "unbounded" })`},
	"try-all-if":      {`if (flag) { const z: number[] = try.all [load(1)] }`, `Effect.all([load(1)], { concurrency: "unbounded" })`},
	"try-race-while":  {`while (flag) { try.race [load(1)]; break }`, `Effect.raceAllFirst([load(1)])`},
	"try-all-do":      {`const d = do { try.all [load(1)] }`, `Effect.all([load(1)], { concurrency: "unbounded" })`},
	"uninterruptible": {`uninterruptible { try load(5) }`, ""},
	"interruptible":   {`interruptible { try load(5) }`, ""},
	"restore":         {`uninterruptible { restore { try load(5) } }`, ""},
	"effect-lambda":   {`const h = (n: number): number!! => try.race [load(n)]`, `Effect.raceAllFirst([load(n)])`},
	"fork-loop":       {`for (let i = 0; i < 2; i++) { const f = fork load(i); try.all [load(1)] }`, `Effect.all([load(1)], { concurrency: "unbounded" })`},
}

var patternBlockTests = map[string]string{
	"if":        `if (u is { id: let who }) { try load(who.length) }`,
	"condition": `const ok = u is { id: let who } && who.length > 0`,
	"negated":   `if (!(u is { id: const who })) { return 0 }`,
}

func FuzzPatternBlockSiblingProjection(f *testing.F) {
	startShortBudget(f)
	siblings := make([]string, 0, len(patternBlockSiblings))
	for key := range patternBlockSiblings {
		siblings = append(siblings, key)
	}
	sort.Strings(siblings)
	tests := []string{"condition", "if", "negated"}
	for i, key := range siblings {
		f.Add(key + "+" + tests[i%len(tests)])
	}
	prelude, err := os.ReadFile("../../../../packages/ts-mapper/prelude.d.ts")
	if err != nil {
		f.Fatal(err)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		for _, q := range patternBlockSiblingQuotes {
			if !strings.Contains(SpecText(q.chapter), q.quote) {
				t.Fatal("pattern-block sibling authority changed")
			}
		}
		var mode uint64
		for i := 0; i < len(key) && i < 24; i++ {
			mode = mode*131 + uint64(key[i])
		}
		siblingKey, testKey, _ := strings.Cut(key, "+")
		sibling, ok := patternBlockSiblings[siblingKey]
		if !ok {
			siblingKey = siblings[mode%uint64(len(siblings))]
			sibling = patternBlockSiblings[siblingKey]
		}
		test, ok := patternBlockTests[testKey]
		if !ok {
			testKey = tests[(mode/16)%uint64(len(tests))]
			test = patternBlockTests[testKey]
		}
		first, second := sibling[0], test
		if (mode/64)&1 != 0 {
			first, second = second, first
		}
		// Generated nodes carry source positions, so offsets vary as well.
		indent := strings.Repeat(" ", int(mode%7))
		source := strings.Repeat("\n", int(mode%3)) +
			"effect function load(n: number) { return n }\n" +
			"export effect function main(flag: boolean) {\n" +
			indent + "const u: { id: string } | undefined = flag ? { id: \"a\" } : undefined\n" +
			indent + first + "\n" +
			indent + second + "\n" +
			indent + "return 1\n}\n"
		name := siblingKey + "+" + testKey
		context := vibelangmapper.FileContext{}
		projected := vibelangmapper.Project(source, context)
		for _, diagnostic := range projected.Diagnostics {
			t.Fatalf("%s checking projection: %v\n%s", name, diagnostic, projected.Text)
		}
		if want := sibling[1]; want != "" && !strings.Contains(projected.Text, want) {
			t.Fatalf("%s: chapter 002 lowers the sibling to %s:\n%s", name, want, projected.Text)
		}
		// Check the rendered TypeScript against the shipped declaration surface,
		// through the TypeScript frontend, independently of the projector: a parser helper
		// printed in place of a lowering is a name TypeScript cannot find.
		checked, err := w.CompileOrdered(t.Context(), Project{
			Files: map[string]string{
				"main.ts":      strings.ReplaceAll(projected.Text, "vibelang-ts-mapper/prelude", "./prelude.js"),
				"prelude.d.ts": string(prelude),
				"package.json": "{\"type\":\"module\"}",
			},
			Config: "{\"compilerOptions\":{\"strict\":true,\"skipLibCheck\":true,\"target\":\"esnext\",\"module\":\"nodenext\",\"moduleResolution\":\"nodenext\",\"noEmit\":true,\"types\":[]},\"files\":[\"main.ts\"]}",
		}, OrderTsc, true)
		if err != nil {
			t.Fatal(err)
		}
		defer checked.Remove()
		for _, diagnostic := range checked.Diagnostics {
			if diagnostic.Category() == diagnostics.CategoryError {
				t.Fatalf("%s checked projection: %s\n%s", name, diagnostic, projected.Text)
			}
		}
	})
}
