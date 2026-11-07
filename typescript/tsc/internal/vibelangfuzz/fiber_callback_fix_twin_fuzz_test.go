package vibelangfuzz

import (
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const fiberCallbackFixQuote = "A call known to throw in a plain callback that Effect runs inside the fiber, such as an \x60Effect.catchTag\x60 handler, an \x60Effect.matchEffect\x60 member or an \x60Effect.suspend\x60 thunk, keeps its moment and its defect: the fix wraps the callback's body as \x60try { … } catch (thrown) { return die(thrown) }\x60, and the program exits with the same \x60Cause\x60."
const fiberCallbackEagerQuote = "An \x60Eager\x60 combinator such as \x60Effect.flatMapEager\x60 may call its callback while the program is built, so a call there keeps \x60EK0401\x60."

// A fiberCallbackProgram puts CB, a plain callback returning an Effect that
// holds value, where Effect runs it inside the fiber.
type fiberCallbackProgram struct{ name, program, value string }

var fiberCallbackPrograms = []fiberCallbackProgram{
	{"acquireRelease", "Effect.scoped(Effect.acquireRelease(Effect.succeed(1), CB))", "1"},
	{"acquireUseRelease-use", "Effect.acquireUseRelease(Effect.succeed(1), CB, () => Effect.void)", "1"},
	{"acquireUseRelease-release", "Effect.acquireUseRelease(Effect.succeed(1), () => Effect.succeed(1), CB)", "1"},
	{"andThen", "Effect.andThen(Effect.succeed(1), CB)", "1"},
	{"catch", "Effect.catch(Effect.fail(1), CB)", "1"},
	{"catchCause", "Effect.catchCause(Effect.fail(1), CB)", "1"},
	{"catchCauseFilter", "Effect.catchCauseFilter(Effect.fail(1), (cause) => Result.succeed(cause), CB)", "1"},
	{"catchCauseIf", "Effect.catchCauseIf(Effect.fail(1), () => true, CB)", "1"},
	{"catchDefect", "Effect.catchDefect(Effect.die(1), CB)", "1"},
	{"catchFilter", "Effect.catchFilter(Effect.fail(1), (error) => Result.succeed(error), CB)", "1"},
	{"catchIf", "Effect.catchIf(Effect.fail(1), () => true, CB)", "1"},
	{"catchTag", "Effect.catchTag(Effect.fail({ _tag: \"Denied\" } as const), \"Denied\", CB)", "1"},
	{"catchTag-list", "Effect.catchTag(Effect.fail({ _tag: \"Denied\" } as const), [\"Denied\"], CB)", "1"},
	{"catchTags", "Effect.catchTags(Effect.fail({ _tag: \"Denied\" } as const), { Denied: CB })", "1"},
	{"filterOrElse", "Effect.filterOrElse(Effect.succeed(1), () => false, CB)", "1"},
	{"flatMap", "Effect.flatMap(Effect.succeed(1), CB)", "1"},
	{"forEach", "Effect.forEach([1], CB)", "1"},
	{"matchCauseEffect-failure", "Effect.matchCauseEffect(Effect.fail(1), { onFailure: CB, onSuccess: () => Effect.succeed(0) })", "1"},
	{"matchCauseEffect-success", "Effect.matchCauseEffect(Effect.succeed(1), { onFailure: () => Effect.succeed(0), onSuccess: CB })", "1"},
	{"matchEffect-failure", "Effect.matchEffect(Effect.fail(1), { onFailure: CB, onSuccess: () => Effect.succeed(0) })", "1"},
	{"matchEffect-success", "Effect.matchEffect(Effect.succeed(1), { onFailure: () => Effect.succeed(0), onSuccess: CB })", "1"},
	{"onError", "Effect.onError(Effect.fail(1), CB)", "1"},
	{"onErrorFilter", "Effect.onErrorFilter(Effect.fail(1), (cause) => Result.succeed(cause), CB)", "1"},
	{"onErrorIf", "Effect.onErrorIf(Effect.fail(1), () => true, CB)", "1"},
	{"onExit", "Effect.onExit(Effect.succeed(1), CB)", "1"},
	{"onExitFilter", "Effect.onExitFilter(Effect.succeed(1), (exit) => Result.succeed(exit), CB)", "1"},
	{"onExitIf", "Effect.onExitIf(Effect.succeed(1), () => true, CB)", "1"},
	{"onInterrupt", "Effect.onInterrupt(Effect.interrupt, CB)", "1"},
	{"repeat-until", "Effect.repeat(Effect.succeed(1), { until: CB })", "true"},
	{"repeat-while", "Effect.repeat(Effect.succeed(1), { while: CB })", "false"},
	{"repeatOrElse", "Effect.repeatOrElse(Effect.fail(1), Schedule.recurs(1), CB)", "1"},
	{"retry-until", "Effect.retry(Effect.fail(1), { until: CB })", "true"},
	{"retry-while", "Effect.retry(Effect.fail(1), { while: CB })", "false"},
	{"retryOrElse", "Effect.retryOrElse(Effect.fail(1), Schedule.recurs(1), CB)", "1"},
	{"scopedWith", "Effect.scopedWith(CB)", "1"},
	{"suspend", "Effect.suspend(CB)", "1"},
	{"tap", "Effect.tap(Effect.succeed(1), CB)", "1"},
	{"tapCause", "Effect.tapCause(Effect.fail(1), CB)", "1"},
	{"tapCauseFilter", "Effect.tapCauseFilter(Effect.fail(1), (cause) => Result.succeed(cause), CB)", "1"},
	{"tapCauseIf", "Effect.tapCauseIf(Effect.fail(1), () => true, CB)", "1"},
	{"tapDefect", "Effect.tapDefect(Effect.die(1), CB)", "1"},
	{"tapError", "Effect.tapError(Effect.fail(1), CB)", "1"},
	{"tapErrorTag", "Effect.tapErrorTag(Effect.fail({ _tag: \"Denied\" } as const), \"Denied\", CB)", "1"},
}

// Alchemy's git service answers a denied push and a failed store or wire
// read with handlers that call a TypeScript response helper.
var fiberCallbackAlchemyPrograms = []fiberCallbackProgram{
	{"push-denied", "Effect.fail({ _tag: \"PushDenied\", reason: \"denied\" } as const).pipe(Effect.catchTag(\"PushDenied\", CB))", "1"},
	{"wire-error", "Effect.fail<{ readonly _tag: \"WireProtocolError\" | \"PackIngestError\"; readonly reason: string }>({ _tag: \"WireProtocolError\", reason: \"bad\" }).pipe(Effect.catchTag([\"WireProtocolError\", \"PackIngestError\"], CB))", "1"},
	{"store-error", "Effect.catchTags(Effect.fail({ _tag: \"StoreError\", reason: \"gone\" } as const), { StoreError: CB })", "1"},
}

// The Eager variants may call their callback while the program is built.
var fiberCallbackEagerPrograms = []fiberCallbackProgram{
	{"flatMapEager", "Effect.flatMapEager(Effect.succeed(1), CB)", "1"},
	{"catchEager", "Effect.catchEager(Effect.fail(1), CB)", "1"},
	{"matchCauseEffectEager", "Effect.matchCauseEffectEager(Effect.fail(1), { onFailure: CB, onSuccess: () => Effect.succeed(0) })", "1"},
}

var fiberCallbackForms = []string{"concise", "block"}
var fiberCallbackThrows = []string{"none", "object", "primitive", "error"}

func fiberCallbackNames() []string {
	var names []string
	for _, form := range fiberCallbackForms {
		for _, thrown := range fiberCallbackThrows {
			names = append(names, form+"/"+thrown)
		}
	}
	return append(names, "alchemy-git-protocol")
}

// fiberCallbackModule exports the programs, each with its callback in form.
func fiberCallbackModule(programs []fiberCallbackProgram, form string) string {
	var b strings.Builder
	b.WriteString("import * as Effect from \"effect/Effect\"\nimport * as Result from \"effect/Result\"\nimport * as Schedule from \"effect/Schedule\"\nimport { touch } from \"./foreign.js\"\nvoid Result, Schedule\nexport const programs = [\n")
	for _, p := range programs {
		callback := fmt.Sprintf("() => Effect.succeed(touch(%s))", p.value)
		if form == "block" {
			callback = fmt.Sprintf("() => { const value = touch(%s); return Effect.succeed(value) }", p.value)
		}
		b.WriteString("  " + strings.ReplaceAll(p.program, "CB", callback) + ",\n")
	}
	b.WriteString("]\n")
	return b.String()
}

// fiberCallbackForeign is a TypeScript helper that throws thrown, or returns
// its argument for "none".
func fiberCallbackForeign(thrown string) string {
	body := map[string]string{"none": "void marker", "object": "throw marker", "primitive": "throw 7", "error": "throw new Error(\"boom\")"}[thrown]
	return "export const marker = { defect: true }\nexport const touch = <T>(value: T): T => {\n  " + body + "\n  return value\n}\n"
}

// The runner describes every program's Exit and compares a defect with the
// very object the helper threw.
const fiberCallbackRunner = "import * as Cause from \"effect/Cause\"\nimport * as Effect from \"effect/Effect\"\nimport * as Exit from \"effect/Exit\"\nimport { marker } from \"./foreign.js\"\nimport { programs } from \"./main.js\"\n" +
	"export const main = () => Effect.forEach(programs as ReadonlyArray<Effect.Effect<unknown, unknown, never>>, (program) => Effect.map(Effect.exit(program), (exit) => Exit.isSuccess(exit) ? { exit: \"success\", value: exit.value } : { exit: \"failure\", reasons: exit.cause.reasons.map((r) => r._tag), same: Cause.squash(exit.cause) === marker, value: String(Cause.squash(exit.cause)) }))\n"

// fiberCallbackFix runs --fix on files and returns them with its writes.
func fiberCallbackFix(t *testing.T, w *Workspace, target string, files map[string]string) (map[string]string, *vibelang.FixResult) {
	t.Helper()
	before := toolsCompile(t, w, target, files)
	defer before.Remove()
	config := toolsConfig(w, before.Dir)
	if config == nil || len(config.Errors) != 0 {
		t.Fatal("invalid fix configuration")
	}
	result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
	if result.Err != nil || len(result.Refused) != 0 {
		t.Fatalf("fix: %v; refused: %v", result.Err, result.Refused)
	}
	fixed := maps.Clone(files)
	for name, file := range result.Files {
		fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
	}
	return fixed, result
}

// fiberCallbackRefusals counts the distinct EK0401 sites a fix declined.
func fiberCallbackRefusals(result *vibelang.FixResult) int {
	starts := map[int]bool{}
	for _, site := range result.Sites {
		if site.Code == "EK0401" {
			starts[site.Start] = true
		}
	}
	return len(starts)
}

func TestFiberCallbackFixQuoted(t *testing.T) {
	r4Quoted(t, "007-tooling.md", fiberCallbackFixQuote, fiberCallbackEagerQuote)
}

func TestFiberCallbackFixKeys(t *testing.T) {
	names := fiberCallbackNames()
	if len(names) != 9 {
		t.Fatalf("got %d keys, want 9", len(names))
	}
	for _, name := range names {
		p := filepath.Join("testdata/fuzz/FuzzFiberCallbackFixTwin", strings.ReplaceAll(name, "/", "-"))
		data, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(data), fmt.Sprintf("[]byte(%q)", "key:"+name)) {
			t.Fatalf("wrong key in %s", p)
		}
	}
}

// FuzzFiberCallbackFixTwin converts a module whose plain callbacks, each at a
// position Effect runs inside the fiber, call a TypeScript helper that may
// throw. Every callback is wrapped, the fixed module compiles with no
// diagnostic, and each program exits as its TypeScript twin does, holding the
// same thrown object. The Eager variants keep their EK0401 sites unwrapped.
func FuzzFiberCallbackFixTwin(f *testing.F) {
	startShortBudget(f)
	r4Quoted(f, "007-tooling.md", fiberCallbackFixQuote, fiberCallbackEagerQuote)
	names := fiberCallbackNames()
	r4Seeds(f, names)
	w := NewWorkspace(f)
	node, err := NewNode(w.Dir)
	if err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		const target = "FuzzFiberCallbackFixTwin"
		key := names[r4Pick(data, names)]
		programs, form, thrown := fiberCallbackPrograms, "concise", "object"
		if key == "alchemy-git-protocol" {
			programs = fiberCallbackAlchemyPrograms
		} else {
			form, thrown, _ = strings.Cut(key, "/")
		}
		main, foreign := fiberCallbackModule(programs, form), fiberCallbackForeign(thrown)
		toolsGuard(t, target, func() {
			stock := toolsCompile(t, w, target, map[string]string{"main.ts": main, "foreign.ts": foreign, "runner.ts": fiberCallbackRunner})
			defer stock.Remove()
			if len(stock.Diagnostics) != 0 {
				t.Fatalf("stock diagnostics: %v\n%s", SortedKeys(Keys(stock.Dir, stock.Diagnostics)), main)
			}
			fixed, result := fiberCallbackFix(t, w, target, map[string]string{"main.vibe": main, "foreign.ts": foreign, "runner.ts": fiberCallbackRunner})
			text := fixed["main.vibe"]
			if n, wraps := fiberCallbackRefusals(result), strings.Count(text, " catch (thrown) { return die(thrown) }"); n != 0 || wraps != len(programs) {
				Gap(t, target, "fiber-callback:"+key, "007-tooling: %s; %s: %d EK0401 sites refused, %d of %d callbacks wrapped\n%s", fiberCallbackFixQuote, key, n, wraps, len(programs), text)
				return
			}
			after := toolsCompile(t, w, target, fixed)
			defer after.Remove()
			if len(after.Diagnostics) != 0 {
				Gap(t, target, "fiber-callback:"+key, "007-tooling: %s; %s: the fixed module reports %v\n%s", fiberCallbackFixQuote, key, SortedKeys(Keys(after.Dir, after.Diagnostics)), text)
				return
			}
			was, is := node.Run(stock, "out/runner.js", "main"), node.Run(after, "out/runner.js", "main")
			if toolsInvalidOutcome(was) || toolsInvalidOutcome(is) || was.Kind != is.Kind || string(was.Value) != string(is.Value) {
				Gap(t, target, "fiber-callback:"+key, "007-tooling: %s; %s: Exit changed: stock=%+v fixed=%+v\n%s", fiberCallbackFixQuote, key, was, is, text)
				return
			}
			eager, eagerResult := fiberCallbackFix(t, w, target, map[string]string{"main.vibe": fiberCallbackModule(fiberCallbackEagerPrograms, form), "foreign.ts": foreign})
			if n := fiberCallbackRefusals(eagerResult); n != len(fiberCallbackEagerPrograms) || strings.Contains(eager["main.vibe"], "catch (thrown)") {
				Gap(t, target, "fiber-callback-eager:"+key, "007-tooling: %s; %s: %d of %d Eager EK0401 sites refused\n%s", fiberCallbackEagerQuote, key, n, len(fiberCallbackEagerPrograms), eager["main.vibe"])
			}
		})
	})
}
