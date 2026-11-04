package vibelangfuzz

import (
	"maps"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const typedYieldTarget = "FuzzFixTypedYield"
const typedYieldQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"
const typedYieldFixedPointQuote = "One " + "\x60vibelang --fix\x60" + " run applies fixes until none applies; running it again changes nothing."

func TestFixTypedYieldQuoted(t *testing.T) { typedYieldQuoted(t) }
func typedYieldQuoted(t testing.TB) {
	t.Helper()
	chapter := SpecText("007-tooling.md")
	for _, quote := range []string{typedYieldQuote, typedYieldFixedPointQuote} {
		if !strings.Contains(chapter, quote) {
			t.Fatalf("Chapter 7 no longer says %q", quote)
		}
	}
}

type typedYieldShape struct{ header, result, failure, body string }

var typedYieldShapes = map[string]typedYieldShape{
	"fail-return":      {"interface Unjudged { readonly reason: \"invalid_question\" | \"unconfigured\"; readonly detail: string }\n", "number", "Unjudged", "return yield* PREFIXfail<Unjudged>({ reason: \"invalid_question\", detail: \"test\" })"},
	"fail-statement":   {"interface Unjudged { readonly reason: \"invalid_question\" | \"unconfigured\"; readonly detail: string }\n", "number", "Unjudged", "yield* PREFIXfail<Unjudged>({ reason: \"invalid_question\", detail: \"test\" }); return 1"},
	"succeed-object":   {"interface Payload { readonly kind: \"ok\" | \"other\" }\n", "Payload", "never", "const value = yield* PREFIXsucceed<Payload>({ kind: \"ok\" }); const exact: Payload = value; return exact"},
	"succeed-tuple":    {"", "number", "never", "const pair = yield* PREFIXsucceed<readonly [number, string]>([1, \"x\"]); return pair[0] + pair[1].length"},
	"succeed-callback": {"", "number", "never", "const fn = yield* PREFIXsucceed<(n: number) => number>((n) => n + 1); return fn(1)"},
	"inferred-fail":    {"", "number", "string", "return yield* PREFIXfail(\"bad\")"},
	"inferred-succeed": {"", "number", "never", "return yield* PREFIXsucceed(1)"},
}

// Contextual typing is a static property: the TypeScript twin and the fixed
// program must both satisfy the written success/error contract. This target
// does not add a runtime oracle; runtime equivalence belongs to VIPDifferential.
func FuzzFixTypedYield(f *testing.F) {
	startShortBudget(f)
	typedYieldQuoted(f)
	var keys []string
	for _, spelling := range []string{"qualified", "bare"} {
		for _, shape := range slices.Sorted(maps.Keys(typedYieldShapes)) {
			key := spelling + "/" + shape
			keys = append(keys, key)
			f.Add([]byte(key))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		fields := strings.SplitN(strings.TrimPrefix(string(data), "key:"), "\x00", 2)
		key := fields[0]
		if !slices.Contains(keys, key) {
			index := 0
			if len(data) > 0 {
				index = int(data[0]) % len(keys)
			}
			key = keys[index]
		}
		parts := strings.Split(key, "/")
		shape := typedYieldShapes[parts[1]]
		prefix := "Effect."
		imports := "import { Effect } from \"effect\"\n"
		if parts[0] == "bare" {
			prefix = ""
			imports += "import { fail, succeed } from \"effect/Effect\"\n"
		}
		body := strings.ReplaceAll(shape.body, "PREFIX", prefix)
		common := imports + shape.header
		ts := common + "export const test = (): Effect.Effect<" + shape.result + ", " + shape.failure + "> => Effect.gen(function*() {\n" + body + "\n})\n"
		contract := shape.result + "!" + shape.failure
		if shape.failure == "never" {
			contract = shape.result + "!!"
		}
		source := common + "export const test = (): " + contract + " => Effect.gen(function*() {\n" + body + "\n})\n"
		if len(fields) > 1 && len(fields[1]) > 0 {
			if fields[1][0]&1 != 0 {
				source = "// Smithers Judgement contextual yield\n" + source
				ts = "// Smithers Judgement contextual yield\n" + ts
			}
			if fields[1][0]&2 != 0 {
				source = strings.ReplaceAll(source, "\"", "'")
				ts = strings.ReplaceAll(ts, "\"", "'")
			}
		}
		twin := toolsCompile(t, w, typedYieldTarget, map[string]string{"main.ts": ts})
		defer twin.Remove()
		if !toolsErrorFree(twin) {
			t.Fatalf("invalid TypeScript twin %s: %v\n%s", key, twin.Diagnostics, ts)
		}
		before := toolsCompile(t, w, typedYieldTarget, map[string]string{"main.vibe": source})
		defer before.Remove()
		fixed := vibelang.FixProject(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir))
		if fixed.Err != nil {
			t.Fatal(fixed.Err)
		}
		text := source
		for name, file := range fixed.Files {
			if filepath.Base(name.AsString()) == "main.vibe" {
				text = file.Text
			}
		}
		g := &Gaps{Target: typedYieldTarget, Input: source}
		if strings.Contains(text, "Effect.gen") || len(fixed.Refused) > 0 {
			g.Add(key+"/conversion", "VIP-34: %s; valid contextual yield remains refused: %+v\n%s", typedYieldQuote, fixed.Refused, text)
		} else {
			after := toolsCompile(t, w, typedYieldTarget, map[string]string{"main.vibe": text})
			defer after.Remove()
			if !toolsErrorFree(after) {
				g.Add(key+"/contract", "VIP-34: %s; fixed program violates its TypeScript contract: %v\n%s", typedYieldQuote, after.Diagnostics, text)
			} else {
				again := vibelang.FixProject(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir))
				if again.Err != nil {
					t.Fatal(again.Err)
				}
				if len(again.Files) != 0 || len(again.Refused) != 0 {
					g.Add(key+"/fixed-point", "VIP-34: %s; second fix: %+v", typedYieldFixedPointQuote, again)
				}
			}
		}
		g.FinishInput(t, specCorpusKey(t))
	})
}
