package vibelangfuzz

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// FuzzEffectBlockWrapperThunks checks that an `effect { … }` block written in
// the arrow an Effect wrapper takes builds an Effect as it does anywhere else.
// Chapter 2 makes the block an expression that builds an Effect, inside which
// `try` runs Effects; VIP-6 says Effect's own wrappers take ordinary arrows,
// and Chapter 3 makes a function nested in a wrapper's thunk its own plain
// code. So each program below type-checks: the thunk returns an
// Effect<number>, the wrapper gives an Effect of that Effect, and the host
// runs both. The key names the wrapper, the thunk form and the host. Effect.sync,
// Effect.suspend and a direct call are controls the compiler never read as
// hatches.

const effectBlockWrapperTarget = "FuzzEffectBlockWrapperThunks"

var effectBlockWrapperQuotes = []struct{ chapter, text string }{
	{"002-running.md", "`effect { … }` is an expression. It builds an Effect from the block without running it."},
	{"002-running.md", "Inside it, `try` runs Effects."},
	{"../vips/0006-effect-globals.md", "No language feature wraps TypeScript into an Effect. You use Effect's own functions (`tryPromise`, `sync`, `callback`, `Effect.try`), and their arrows capture locals as in Effect TS."},
	{"003-failures.md", "A function nested in that literal is its own plain code."},
}

type effectBlockWrapper struct {
	name     string
	template string // the wrapper call, with %s for the thunk
	promise  bool   // the thunk returns a Promise of the Effect
	flat     bool   // the call gives the thunk's Effect itself
}

var effectBlockWrappers = []effectBlockWrapper{
	{name: "Effect.try", template: "Effect.try(%s)"},
	{name: "Effect.try-options", template: "Effect.try({ try: %s, catch: (e) => e })"},
	{name: "Effect.tryPromise", template: "Effect.tryPromise(%s)", promise: true},
	{name: "Effect.tryPromise-options", template: "Effect.tryPromise({ try: %s, catch: (e) => e })", promise: true},
	{name: "tryPromise", template: "tryPromise(%s)", promise: true},
	{name: "sync", template: "sync(%s)"},
	{name: "Effect.sync", template: "Effect.sync(%s)"},
	{name: "Effect.suspend", template: "Effect.suspend(%s)", flat: true},
	{name: "call", template: "(%s)()", flat: true},
}

var effectBlockWrapperForms = []string{"arrow", "helper", "pipe", "block", "function"}

var effectBlockWrapperHosts = []string{"effect", "plain", "top"}

const effectBlockValue = "effect { const n: number = try Effect.succeed(1); return n + 1 }"

type effectBlockWrapperCase struct {
	key     string
	wrapper effectBlockWrapper
	form    string
	host    string
}

func effectBlockWrapperCases() []effectBlockWrapperCase {
	var cases []effectBlockWrapperCase
	for _, w := range effectBlockWrappers {
		for _, form := range effectBlockWrapperForms {
			for _, host := range effectBlockWrapperHosts {
				cases = append(cases, effectBlockWrapperCase{key: w.name + "/" + form + "/" + host, wrapper: w, form: form, host: host})
			}
		}
	}
	return cases
}

func (c effectBlockWrapperCase) thunk() string {
	value := effectBlockValue
	switch c.form {
	case "helper":
		value = "keep(" + value + ")"
	case "pipe":
		value = "(" + value + ").pipe(Effect.map((n: number) => n + 1))"
	}
	wrap := func(v string) string {
		if c.wrapper.promise {
			return "Promise.resolve(" + v + ")"
		}
		return v
	}
	switch c.form {
	case "block":
		return "() => { const e = " + value + "; return " + wrap("e") + " }"
	case "function":
		return "function () { return " + wrap(value) + " }"
	default:
		return "() => " + wrap(value)
	}
}

func (c effectBlockWrapperCase) source() string {
	call := strings.Replace(c.wrapper.template, "%s", c.thunk(), 1)
	header := "import * as Effect from \"effect/Effect\"\nconst keep = <A>(a: A): A => a\n"
	switch c.host {
	case "effect":
		run := "  const inner = try Effect.orDie(outer)\n  const result: number = try inner\n"
		if c.wrapper.flat {
			run = "  const result: number = try outer\n"
		}
		return header + "export effect function probe() {\n  const outer = " + call + "\n" + run + "  return result\n}\n"
	default:
		value := "Effect.flatMap(Effect.orDie(" + call + "), (inner) => inner)"
		if c.wrapper.flat {
			value = call
		}
		if c.host == "plain" {
			return header + "export function probe(): Effect.Effect<number> {\n  return " + value + "\n}\n"
		}
		return header + "export const probe: Effect.Effect<number> = " + value + "\n"
	}
}

// effectBlockWrapperErrors compiles main.vibe and lists its error diagnostics;
// every program here is well typed, so any error is a gap.
func effectBlockWrapperErrors(t *testing.T, w *Workspace, files map[string]string) []string {
	t.Helper()
	r, err := w.Compile(t.Context(), Project{Files: files})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	var problems []string
	for _, d := range r.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			problems = append(problems, describe(d))
		}
	}
	return problems
}

func checkEffectBlockWrapper(t *testing.T, w *Workspace, c effectBlockWrapperCase) {
	t.Helper()
	files := map[string]string{"main.vibe": c.source()}
	if problems := effectBlockWrapperErrors(t, w, files); len(problems) > 0 {
		Gap(t, effectBlockWrapperTarget, c.key, "VIP-6: an effect block in the thunk %s takes builds an Effect, and its try runs Effects: %s\n%s", c.wrapper.name, strings.Join(problems, "; "), Archive(files))
	}
	ExpectPending(t, effectBlockWrapperTarget, c.key)
}

func TestEffectBlockWrapperThunksQuoted(t *testing.T) {
	for _, q := range effectBlockWrapperQuotes {
		r4Quoted(t, q.chapter, q.text)
	}
}

// TestEffectBlockWrapperThunksWitness compiles the alchemy minimum: an action
// helper given an effect block inside the try thunk Effect.try takes, as the
// drizzle examples write Alchemy.Action under the required wrapper.
func TestEffectBlockWrapperThunksWitness(t *testing.T) {
	TestEffectBlockWrapperThunksQuoted(t)
	raw, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", "alchemy-effect-block-action-try-thunk.json"))
	if err != nil {
		t.Fatal(err)
	}
	var witness struct{ Source, Main string }
	if err := json.Unmarshal(raw, &witness); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{"main.vibe": witness.Main}
	if problems := effectBlockWrapperErrors(t, NewWorkspace(t), files); len(problems) > 0 {
		Gap(t, effectBlockWrapperTarget, "witness:alchemy-effect-block-action-try-thunk", "VIP-6: %s: %s\n%s", witness.Source, strings.Join(problems, "; "), Archive(files))
	}
	ExpectPending(t, effectBlockWrapperTarget, "witness:alchemy-effect-block-action-try-thunk")
}

func FuzzEffectBlockWrapperThunks(f *testing.F) {
	startShortBudget(f)
	cases := effectBlockWrapperCases()
	f.Add("Effect.try-options/helper/effect")
	f.Add("Effect.tryPromise/arrow/plain")
	f.Add("Effect.suspend/arrow/top")
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestEffectBlockWrapperThunksQuoted(t)
		i := slices.IndexFunc(cases, func(c effectBlockWrapperCase) bool { return c.key == key })
		if i < 0 {
			i = len(key) % len(cases)
		}
		checkEffectBlockWrapper(t, w, cases[i])
		ExpectPending(t, effectBlockWrapperTarget, specCorpusKey(t))
	})
}

func TestEffectBlockWrapperThunksNeighborhood(t *testing.T) {
	if testing.Short() {
		t.Skip("the complete wrapper, form and host matrix runs separately")
	}
	TestEffectBlockWrapperThunksQuoted(t)
	w := NewWorkspace(t)
	for _, c := range effectBlockWrapperCases() {
		t.Run(c.key, func(t *testing.T) { checkEffectBlockWrapper(t, w, c) })
	}
}
