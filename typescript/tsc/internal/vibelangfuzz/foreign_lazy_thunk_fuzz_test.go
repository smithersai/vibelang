package vibelangfuzz

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// FuzzForeignLazyThunks checks which wrappers admit a thunk that calls a
// foreign function. A foreign function without a tag may throw unknown
// (003-failures.md, Thrown types). Only Effect.try and Effect.tryPromise
// take a throwing thunk; sync, promise and suspend take LazyArg, which admits
// only never (VIP-4). The rule is about the thunk, not its spelling: passing
// the foreign function (promise(load)) and an arrow, block or function that
// calls it (promise(() => load())) get the same verdict. So do the global
// and the qualified spelling of one wrapper: the globals are the exports of
// Effect's Effect module (VIP-6). The key names the wrapper, the thunk form
// and the foreign contract; the choice byte varies the layout
// failuresProject varies (lib.ts or lib.d.ts, a nested block).

const foreignLazyTarget = "FuzzForeignLazyThunks"

var foreignLazyQuotes = []struct{ chapter, text string }{
	{"003-failures.md", "| no tag | `unknown` |"},
	{"003-failures.md", "| `/** @throws {T} */` on it or its call signature | `T`, trusted, not checked |"},
	{"003-failures.md", "An unannotated foreign `queryDb` may throw `unknown`, so use `tryPromise(() => queryDb(q))`; `promise` does not admit that throwing thunk."},
	{"003-failures.md", "Effect's `LazyArg` and other callback parameter types, those in `.d.ts` files included, describe what an argument callback may throw: without `@throws`, they admit only `never`. So `sync(() => parse(s))` is an error."},
	{"003-failures.md", "`Effect.try` and `Effect.tryPromise` declare their thunk `@throws {unknown}` in both overloads, so `Effect.try(() => parse(s))` is allowed and the wrapper turns a throw into a failure."},
	{"../vips/0006-effect-globals.md", "Every export of Effect's `Effect` module is a global variable in a `.vibe` file: `retry`, `sleep`, `log`, `all`, `race`, `tryPromise`, `sync`, `callback`, `map`, and so on."},
	{"../vips/0004-throw.md", "Only `Effect.try` and `Effect.tryPromise` admit a throwing thunk. `sync`, `promise`, `callback` and `suspend` take `LazyArg`, which has no `@throws`, so a throwing thunk there is a compile error; use the matching wrapper."},
}

type foreignLazyWrapper struct {
	name   string
	async  bool // the thunk returns the foreign Promise
	bridge bool // admits a throwing thunk
	effect bool // the thunk returns an Effect (suspend)
}

var foreignLazyWrappers = []foreignLazyWrapper{
	{name: "promise", async: true},
	{name: "Effect.promise", async: true},
	{name: "sync"},
	{name: "Effect.sync"},
	{name: "Effect.suspend", effect: true},
	{name: "tryPromise", async: true, bridge: true},
	{name: "Effect.tryPromise", async: true, bridge: true},
	{name: "Effect.try", bridge: true},
}

var foreignLazyForms = []string{"reference", "arrow", "block", "function", "local"}

// A contract is the tag on the foreign declaration; throws says whether its
// thrown type is other than never.
var foreignLazyContracts = []struct {
	name, tag string
	throws    bool
}{
	{"untagged", "", true},
	{"never", "/** @throws {never} */\n", false},
	{"error", "/** @throws {Error} */\n", true},
	{"unknown", "/** @throws {unknown} */\n", true},
}

type foreignLazyCase struct {
	key     string
	wrapper foreignLazyWrapper
	form    string
	tag     string
	throws  bool
}

func (c foreignLazyCase) rejects() bool { return c.throws && !c.wrapper.bridge }

func foreignLazyCases() []foreignLazyCase {
	var cases []foreignLazyCase
	for _, w := range foreignLazyWrappers {
		for _, form := range foreignLazyForms {
			if form == "reference" && w.effect {
				continue // a number-returning foreign function is no suspend thunk
			}
			for _, c := range foreignLazyContracts {
				cases = append(cases, foreignLazyCase{key: w.name + "/" + form + "/" + c.name, wrapper: w, form: form, tag: c.tag, throws: c.throws})
			}
		}
	}
	return cases
}

func (c foreignLazyCase) project() *failCase {
	callee, result := "read", "number"
	if c.wrapper.async {
		callee, result = "load", "Promise<number>"
	}
	call := callee + "()"
	value, local := call, "v"
	if c.wrapper.effect {
		value, local = "Effect.succeed("+call+")", "Effect.succeed(v)"
	}
	var thunk string
	switch c.form {
	case "reference":
		thunk = callee
	case "arrow":
		thunk = "() => " + value
	case "block":
		thunk = "() => { return " + value + " }"
	case "function":
		thunk = "function () { return " + value + " }"
	default:
		thunk = "() => { const v = " + call + "; return " + local + " }"
	}
	if c.rejects() {
		thunk = "⟦" + thunk + "⟧"
	}
	return &failCase{Host: "effect", Lib: c.tag + "export declare function " + callee + "(): " + result + "\n", Body: "const n = try " + c.wrapper.name + "(" + thunk + ")"}
}

// foreignLazyVerdict compiles files and lists what the chapter forbids: a
// marked thunk without a throw-admission error (EK0401 or EK0402) inside it,
// and any error outside the marked thunks.
func foreignLazyVerdict(t *testing.T, w *Workspace, files map[string]string, spans [][2]int) (problems []string) {
	t.Helper()
	r, err := w.Compile(t.Context(), Project{Files: files})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	matched := make([]bool, len(spans))
	for _, d := range r.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		in := false
		for i, span := range spans {
			if d.File() != nil && strings.HasSuffix(string(d.File().FileName()), "/main.vibe") && d.Pos() <= span[1] && d.End() >= span[0] {
				in = true
				matched[i] = matched[i] || IsEK(d) && (d.Code() == 401 || d.Code() == 402)
			}
		}
		if !in {
			problems = append(problems, "unexpected error "+describe(d))
		}
	}
	for i, ok := range matched {
		if !ok {
			problems = append(problems, "no EK0401 or EK0402 on thunk "+strconv.Itoa(i+1))
		}
	}
	return problems
}

func checkForeignLazyThunk(t *testing.T, w *Workspace, c foreignLazyCase, choice byte) {
	t.Helper()
	files, span := failuresProject(c.project(), choice)
	var spans [][2]int
	if span[0] >= 0 {
		spans = append(spans, span)
	}
	if problems := foreignLazyVerdict(t, w, files, spans); len(problems) > 0 {
		Gap(t, foreignLazyTarget, c.key, "VIP-4: a %s thunk admits a foreign call only when its thrown type is never (rejects=%v): %s\n%s", c.wrapper.name, c.rejects(), strings.Join(problems, "; "), Archive(files))
	}
	ExpectPending(t, foreignLazyTarget, c.key)
}

func TestForeignLazyThunksQuoted(t *testing.T) {
	for _, q := range foreignLazyQuotes {
		r4Quoted(t, q.chapter, q.text)
	}
}

// TestForeignLazyThunksWitness compiles the opencode minimum unchanged: three
// foreign functions, each passed to promise or sync directly and through an
// arrow. Each of the six thunks is rejected, and nothing else is.
var _ = PendingCompanion(foreignLazyTarget, "TestForeignLazyThunksWitness")

func TestForeignLazyThunksWitness(t *testing.T) {
	TestForeignLazyThunksQuoted(t)
	raw, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", "opencode-foreign-lazy-thunks.json"))
	if err != nil {
		t.Fatal(err)
	}
	var witness struct{ Source, Foreign, Main string }
	if err := json.Unmarshal(raw, &witness); err != nil {
		t.Fatal(err)
	}
	text, spans := witness.Main, [][2]int(nil)
	for strings.Contains(text, "⟦") {
		i := strings.Index(text, "⟦")
		text = strings.Replace(text, "⟦", "", 1)
		j := strings.Index(text, "⟧")
		text = strings.Replace(text, "⟧", "", 1)
		spans = append(spans, [2]int{i, j})
	}
	if len(spans) != 6 {
		t.Fatalf("the witness marks %d thunks, want 6", len(spans))
	}
	files := map[string]string{"foreign.ts": witness.Foreign, "main.vibe": text}
	w := NewWorkspace(t)
	if problems := foreignLazyVerdict(t, w, files, spans); len(problems) > 0 {
		Gap(t, foreignLazyTarget, "witness:opencode-foreign-lazy-thunks", "VIP-4: %s: %s\n%s", witness.Source, strings.Join(problems, "; "), Archive(files))
	}
	ExpectPending(t, foreignLazyTarget, "witness:opencode-foreign-lazy-thunks")
}

func FuzzForeignLazyThunks(f *testing.F) {
	startShortBudget(f)
	cases := foreignLazyCases()
	// Every case is a seed: a pending line names one, and a line no seed
	// reaches is never judged.
	for _, c := range cases {
		f.Add(c.key, uint8(0))
	}
	f.Add("sync/reference/untagged", uint8(8))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice uint8) {
		TestForeignLazyThunksQuoted(t)
		i := slices.IndexFunc(cases, func(c foreignLazyCase) bool { return c.key == key })
		if i < 0 {
			i = len(key) % len(cases)
		}
		checkForeignLazyThunk(t, w, cases[i], choice)
		ExpectPending(t, foreignLazyTarget, specCorpusKey(t))
	})
}

func TestForeignLazyThunksNeighborhood(t *testing.T) {
	if testing.Short() {
		t.Skip("the complete wrapper, form and contract matrix runs separately")
	}
	TestForeignLazyThunksQuoted(t)
	w := NewWorkspace(t)
	for _, c := range foreignLazyCases() {
		for _, choice := range []byte{0, 8, 2} {
			t.Run(c.key+"/"+strconv.Itoa(int(choice)), func(t *testing.T) { checkForeignLazyThunk(t, w, c, choice) })
		}
	}
}
