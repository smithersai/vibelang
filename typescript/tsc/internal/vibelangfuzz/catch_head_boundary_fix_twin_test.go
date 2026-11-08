package vibelangfuzz

import (
	"fmt"
	"maps"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// Chapter 7: a catch head runs before its catch is installed, and --fix
// keeps the recovery a head written for the earlier boundary had, unless the
// head's value may be an Effect. The oracle is a TypeScript twin of each
// meaning: Effect.catch around the head's whole run for a repaired head, and
// Effect.catch around the Effect the head gives for one that keeps its try.
const catchHeadBoundaryQuote = "When such a head can fail and its value is not an Effect the catch runs, by the [result test](002-running.md#result-tests), `--fix` keeps the earlier recovery"
const catchHeadEffectQuote = "A head whose value may be an Effect keeps its `try`: the catch runs the Effect it gives, as written."

func TestCatchHeadBoundaryFixQuoted(t *testing.T) {
	for _, quote := range []string{catchHeadBoundaryQuote, catchHeadEffectQuote} {
		if !strings.Contains(SpecText("007-tooling.md"), quote) {
			t.Fatalf("Chapter 7 no longer says %q", quote)
		}
	}
}

// A shape is a catch head in a native effect function and the TypeScript
// Effect its run is: recovered whole when the fix keeps the earlier boundary
// (keepsTry false), or run first, with only the Effect it gives recovered.
type catchHeadShape struct {
	key, head, stock string
	keepsTry         bool
}

var catchHeadShapes = []catchHeadShape{
	{"try-call", "(try poll(k))", "poll(k)", false},
	{"try-identifier", "(try program)", "program", false},
	{"try-block", "(try effect { const n = try lookup(k); return throw new Pending({ n }) })",
		"Effect.gen(function* () { const n = yield* lookup(k); return yield* Effect.fail(new Pending({ n })) })", false},
	{"try-retry", "(try (effect { const n = try lookup(k); throw new Pending({ n }) } |> Effect.retry(%, { while: (e) => e._tag === \"Pending\", times: 1 })))",
		"Effect.gen(function* () { const n = yield* lookup(k); return yield* Effect.fail(new Pending({ n })) }).pipe(Effect.retry({ while: (e) => e._tag === \"Pending\", times: 1 }))", false},
	{"any-head", "(toAny(try lookup(k)))", "Effect.map(lookup(k), toAny)", false},
	{"effect-valued", "(try nestedOf(k))", "nestedOf(k)", true},
}

var catchHeadHandlers = [][2]string{
	{"() => -1", "() => Effect.succeed(-1)"},
	{"effect (e) => match (e) { when { _tag: \"NotFound\" }: -1; default: throw e; }", "(e) => e._tag === \"NotFound\" ? Effect.succeed(-1) : Effect.fail(e)"},
}

const catchHeadForeign = `import { Data, Effect } from "effect"
export class NotFound extends Data.TaggedError("NotFound") {}
export class Other extends Data.TaggedError("Other") {}
export class Pending extends Data.TaggedError("Pending")<{ readonly n: number }> {}
export const marker = { defect: true }
/** @throws {never} */
export const lookup = (k: number): Effect.Effect<number, NotFound | Other> =>
  k === 0 ? Effect.fail(new NotFound()) : k === 1 ? Effect.fail(new Other()) : k === 2 ? Effect.die(marker) : Effect.succeed(k)
/** @throws {never} */
export const poll = (k: number): Effect.Effect<never, NotFound | Other | Pending> => Effect.flatMap(lookup(k), (n) => Effect.fail(new Pending({ n })))
/** @throws {never} */
export const nestedOf = (k: number): Effect.Effect<Effect.Effect<number, NotFound | Other>, Pending> => k === 3 ? Effect.fail(new Pending({ n: k })) : Effect.succeed(lookup(k))
/** @throws {never} */
export const toAny = (n: number): any => ({ n })
`

func FuzzCatchHeadBoundaryFixTwin(f *testing.F) {
	startShortBudget(f)
	if !strings.Contains(SpecText("007-tooling.md"), catchHeadBoundaryQuote) || !strings.Contains(SpecText("007-tooling.md"), catchHeadEffectQuote) {
		f.Fatal("catch head boundary rule changed")
	}
	for _, shape := range catchHeadShapes {
		for handler := uint8(0); handler < 2; handler++ {
			for _, outcome := range []uint8{0, 1} {
				f.Add(shape.key, handler, outcome)
			}
		}
	}
	w := NewWorkspace(f)
	node, err := NewNode(w.Dir)
	if err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, key string, handler, outcome uint8) {
		const target = "FuzzCatchHeadBoundaryFixTwin"
		i := slices.IndexFunc(catchHeadShapes, func(s catchHeadShape) bool { return s.key == key })
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(catchHeadShapes)
		}
		shape, h := catchHeadShapes[i], catchHeadHandlers[handler%2]
		k := outcome % 4
		imports := "import { Effect } from \"effect\"\nimport { lookup, poll, nestedOf, toAny, Pending } from \"./foreign.js\"\n"
		native := imports + "export effect function work(k: number) {\n  const program = poll(k)\n  return " + shape.head + " catch " + h[0] + "\n}\n"
		caught := "Effect.catch(" + shape.stock + ", " + h[1] + ")"
		if shape.keepsTry {
			caught = "Effect.flatMap(" + shape.stock + ", (inner) => Effect.catch(inner, " + h[1] + "))"
		}
		stock := imports + "export const work = (k: number) => Effect.suspend(() => {\n  const program = poll(k)\n  void program\n  return " + caught + "\n})\n"
		runner := fmt.Sprintf("import { Cause, Effect, Exit } from \"effect\"\nimport { marker } from \"./foreign.js\"\nimport { work } from \"./main.js\"\nexport const main = () => Effect.map(Effect.exit(work(%d)), (ex) => Exit.isSuccess(ex) ? { exit: \"success\", value: JSON.stringify(ex.value) } : { exit: \"failure\", reasons: ex.cause.reasons.map((r) => r._tag), same: Cause.squash(ex.cause) === marker, value: String((Cause.squash(ex.cause) as { _tag?: string })?._tag ?? Cause.squash(ex.cause)) })\n", k)
		errorsOf := func(r *Result) []string {
			var errors []string
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					errors = append(errors, diagnosticCodeName(d.Source(), d.Code())+": "+d.String())
				}
			}
			return errors
		}
		toolsGuard(t, target, func() {
			twin := toolsCompile(t, w, target, map[string]string{"main.ts": stock, "foreign.ts": catchHeadForeign, "runner.ts": runner})
			defer twin.Remove()
			if errors := errorsOf(twin); len(errors) != 0 {
				t.Fatalf("stock twin errors: %v\n%s", errors, stock)
			}
			files := map[string]string{"main.vibe": native, "foreign.ts": catchHeadForeign, "runner.ts": runner}
			before := toolsCompile(t, w, target, files)
			defer before.Remove()
			config := toolsConfig(w, before.Dir)
			if config == nil || len(config.Errors) != 0 {
				t.Fatal("invalid fix configuration")
			}
			result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
			if result.Err != nil {
				t.Fatalf("fix: %v", result.Err)
			}
			fixed := maps.Clone(files)
			for name, file := range result.Files {
				fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
			}
			text := fixed["main.vibe"]
			if kept := strings.Contains(text, shape.head+" catch"); kept != shape.keepsTry {
				Gap(t, target, "head:"+shape.key, "Chapter 7: %q / %q; head kept=%v\n%s", catchHeadBoundaryQuote, catchHeadEffectQuote, kept, text)
				return
			}
			after := toolsCompile(t, w, target, fixed)
			defer after.Remove()
			if errors := errorsOf(after); len(errors) != 0 {
				t.Fatalf("fixed program errors: %v\n%s", errors, text)
			}
			was, is := node.Run(twin, "out/runner.js", "main"), node.Run(after, "out/runner.js", "main")
			if toolsInvalidOutcome(was) || toolsInvalidOutcome(is) || was.Kind != is.Kind || string(was.Value) != string(is.Value) {
				Gap(t, target, "exit:"+shape.key, "Chapter 7: %q; twin=%+v fixed=%+v\n%s", catchHeadBoundaryQuote, was, is, text)
			}
		})
	})
}
