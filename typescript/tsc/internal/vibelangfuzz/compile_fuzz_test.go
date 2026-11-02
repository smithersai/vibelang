package vibelangfuzz

import (
	"fmt"
	"hash/fnv"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"runtime/debug"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// FuzzCompile compiles arbitrary projects and checks current Appendix B
// identity/defaults, valid diagnostic spans, fresh/order consistency and
// the emitter, source-map and declaration invariants described below.
func FuzzCompile(f *testing.F) {
	startShortBudget(f)
	w := NewWorkspace(f)
	lint := newEffectLint(f, 8)
	for _, seed := range CompileSeeds() {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, archive string) {
		t.Parallel() // the seed corpus only; fuzzing ignores it
		project := ProjectFromArchive(archive)
		if Admissible(project) == "" {
			lint.check(t, w, project, archive, strings.HasPrefix(corpusFile(t, "FuzzCompile"), "effect-lint-"))
		}
		CheckCompile(t, w, "FuzzCompile", archive)
	})
}

// CompileSeeds are the acceptance cases, with declarations and source maps
// turned on so that every emitter runs, and the documentation's snippets.
var CompileSeeds = sync.OnceValue(func() []string {
	var seeds []string
	seen := map[string]bool{}
	// An input that testdata/fuzz holds runs from there, under its pending
	// line if it has one.
	for _, input := range CorpusInputs("FuzzCompile") {
		seen[input[0]] = true
	}
	add := func(archive, name string) {
		if !seen[archive] {
			seen[archive] = true
			seeds = append(seeds, archive)
			seedNames.Store(archive, name)
		}
	}
	for i, seed := range literalMatchSeeds() {
		add(seed, fmt.Sprintf("literal match neighbourhood %d", i))
	}
	for _, seed := range shortWitnessSeeds(CaseSeeds(), 32) {
		files := map[string]string{}
		for name, text := range seed.Files {
			files[name] = text
		}
		if config, ok := files["tsconfig.json"]; ok {
			files["tsconfig.json"] = withEmitters(config)
		}
		add(Archive(files), "case "+seed.Name)
	}
	for _, seed := range shortWitnessSeeds(SnippetSeeds(), 16) {
		add(Archive(seed.Files), "snippet "+seed.Name)
	}
	return seeds
})

// shortWitnessSeeds keeps every pending witness; disk corpus is loaded independently.
// Campaigns and all-seed runs retain the complete generated lists.
func shortWitnessSeeds(seeds []Seed, n int) []Seed {
	if !testing.Short() || toolsFuzzing() {
		return seeds
	}
	for _, seed := range seeds {
		if seed.Pending != "" {
			n++
		}
	}
	return toolsSample(seeds, n, 0, func(seed Seed) bool { return seed.Pending != "" })
}

var compilerOptionsOpen = regexp.MustCompile(`"compilerOptions"\s*:\s*\{`)

// withEmitters turns on declarations and source maps in a tsconfig.json.
// An option the config sets itself comes later and wins.
func withEmitters(config string) string {
	loc := compilerOptionsOpen.FindStringIndex(config)
	if loc == nil {
		return config
	}
	return config[:loc[1]] + `"declaration": true, "sourceMap": true, ` + config[loc[1]:]
}

// CorpusInputs returns the inputs of a target's files in testdata/fuzz, the
// arguments of each file in Go's corpus format, unquoted.
func CorpusInputs(target string) [][]string {
	names, _ := filepath.Glob(filepath.Join(repoTestdata(), "fuzz", target, "*"))
	var inputs [][]string
	for _, name := range names {
		data, err := os.ReadFile(name)
		if err != nil {
			continue
		}
		var args []string
		for _, line := range strings.Split(string(data), "\n")[1:] {
			if quoted, ok := strings.CutPrefix(line, "string("); ok {
				if s, err := strconv.Unquote(strings.TrimSuffix(quoted, ")")); err == nil {
					args = append(args, s)
				}
			}
		}
		inputs = append(inputs, args)
	}
	return inputs
}

// corpusFile returns the name of the testdata/fuzz file a test runs, or "".
func corpusFile(t *testing.T, target string) string {
	name := path.Base(t.Name())
	if strings.HasPrefix(name, "seed#") || name == target {
		return ""
	}
	if _, err := os.Stat(filepath.Join(repoTestdata(), "fuzz", target, name)); err != nil {
		return ""
	}
	return name
}

// Admissible returns why a fuzz input is out of scope, or "".
func Admissible(project Project) string {
	if len(project.Files) == 0 || len(project.Files) > 24 {
		return "no files, or too many"
	}
	size, sources := len(project.Config), 0
	for name, text := range project.Files {
		size += len(text)
		if isSource(name) {
			sources++
		}
	}
	// Bound mutations to small projects. Wide literal matches also run as
	// ordinary regression seeds below this cap; TestCompileLargeLiteralMatch
	// retains the original 3,000-arm stress reproduction separately.
	if size > 32<<10 && os.Getenv("VIBELANG_FUZZ_HANG_PROBE") != "1" {
		return "too large"
	}
	if sources == 0 {
		return "no sources"
	}
	return ConfinedProject(project)
}

// CheckCompile runs FuzzCompile's oracles on one input.
func CheckCompile(t *testing.T, w *Workspace, target, archive string) {
	project := ProjectFromArchive(archive)
	if reason := Admissible(project); reason != "" {
		t.Skip(reason)
	}
	g := &Gaps{Target: target, Input: SeedName(archive)}
	key := ""
	if name := corpusFile(t, target); name != "" {
		key = "corpus:" + name
		g.Input = "testdata/fuzz/" + target + "/" + name
	}
	entry, pending := Pending(target, key)
	if pending && strings.HasPrefix(entry.Reason, "hang") && os.Getenv("VIBELANG_FUZZ_HANG_PROBE") != "1" {
		t.Skipf("pending (%s): %s", entry.Owner, entry.Reason)
	}
	defer recoverCompilerPanic(t, target)
	compileGaps(t, w, g, project, archive)
	g.FinishInput(t, key)
}

// compileGaps records FuzzCompile's disagreements in the input's shared
// Gaps. The key is the original fuzz input, so determinism sampling stays
// the same for both archives and splice choices. The caller recovers
// compiler panics and finishes the input after every oracle has run.
func compileGaps(t *testing.T, w *Workspace, g *Gaps, project Project, key string) {
	name := corpusFile(t, g.Target)
	_, pending := Pending(g.Target, "corpus:"+name)
	ctx := t.Context()
	var a *Compilation
	var err error
	within(t, "compile", func() { a, err = w.CompileOrdered(ctx, project, OrderTsc, true) })
	if err != nil {
		t.Fatal(err)
	}
	defer a.Remove()
	a.Diagnostics = withoutEffectLint(a.Diagnostics)
	compile := func(stage string, order Order, singleThreaded bool) *Compilation {
		var c *Compilation
		within(t, stage, func() { c = w.CompileIn(ctx, a.Dir, project, order, singleThreaded || pending) })
		c.Diagnostics = withoutEffectLint(c.Diagnostics)
		return c
	}
	var severities map[string]string
	if a.Program != nil {
		severities = EffectiveSeverities(a.Program.Options().VibeLang)
	}
	CheckDiagnostics(g, a.Dir, a.Diagnostics, DefaultsApply(project), severities)

	// The determinism checks compile the input three more times, so they run
	// on a third of the inputs, chosen by the input so that a failure
	// reproduces, and on every corpus file; VIBELANG_FUZZ_FULL=1 runs them on
	// every input. A seed run stays within a minute, and a campaign spends
	// its time on new inputs.
	full := name != "" || os.Getenv("VIBELANG_FUZZ_FULL") == "1" || seedHash(key)%3 == 0

	// Chapter 28: tsc, the language server and the bundlers see the same
	// diagnostics, so a compilation is a function of its input: a fresh one
	// reports the same diagnostics in the same order and writes the same
	// outputs (Chapter 27, one checker pass). The fresh one checks the files
	// with tsc's pool of checkers, the first with one checker, as the
	// language server does; the number of checkers decides nothing either.
	if full {
		checkDeterminism(t, g, a, compile)
	}

	if a.Program != nil && !HasError(a.Diagnostics) {
		within(t, "outputs", func() {
			(&OutputChecker{W: w, G: g, Ctx: ctx, Logf: t.Logf}).Check(a)
		})
	}
}

// checkDeterminism compiles the project again, in tsc's order and in the
// others, and compares each result with the first. This is a metamorphic
// oracle, not a compiler-produced baseline: Chapter 27 specifies one checker
// pass and Chapter 28 requires the CLI, editor and bundlers to agree. Neither
// result supplies the expected semantics; changing only query order and worker
// count must preserve the diagnostics and outputs.
func checkDeterminism(t *testing.T, g *Gaps, a *Compilation, compile func(string, Order, bool) *Compilation) {
	// The specification promises the same diagnostics, not the same order
	// across worker counts, so the comparison is of the sorted sets.
	b := compile("recompile", OrderTsc, false)
	if diff := DiffKeys(SortedKeys(Keys(a.Dir, a.Diagnostics)), SortedKeys(Keys(b.Dir, b.Diagnostics))); diff != "" {
		g.Add("feature:determinism", "a fresh compilation reports other diagnostics:\n%s", diff)
	}
	if diff := DiffOutputs(a.Dir, a.Outputs, b.Dir, b.Outputs); diff != "" {
		g.Add("feature:determinism", "a fresh compilation writes other outputs:\n%s", diff)
	}
	// The checker is lazy, so the order in which a program is asked must not
	// decide what it reports or writes: an editor asks for one file's
	// diagnostics, and a bundler emits before it asks for any.
	// The key names the codes that only one order reports, so a known
	// difference can be pending without hiding the others.
	want := SortedKeys(Keys(a.Dir, a.Diagnostics))
	for _, order := range []Order{OrderReverse, OrderEmitFirst} {
		c := compile(order.String(), order, true)
		got := SortedKeys(Keys(c.Dir, c.Diagnostics))
		if diff := DiffKeys(want, got); diff != "" {
			g.Add("feature:order:"+orderKey(order, want, got), "asked in %s, the program reports other diagnostics:\n%s", order, diff)
		}
		if diff := DiffOutputs(a.Dir, a.Outputs, c.Dir, c.Outputs); diff != "" {
			g.Add("feature:order:"+orderSlug(order)+":outputs", "asked in %s, the program writes other outputs:\n%s", order, diff)
		}
	}
}

// orderKey names how the diagnostics of a program asked in order differ
// from tsc's order's: the codes of the diagnostics only tsc's order reports,
// then those only order reports, as emit-first:+TS2552 or
// reverse-file-order:-EK0102+TS2304.
func orderKey(order Order, want, got []DiagnosticKey) string {
	codes := func(from, without []DiagnosticKey) []string {
		var out []string
		for _, k := range from {
			if !slices.Contains(without, k) {
				out = append(out, diagnosticCodeName(cmp(k.Source, "TS"), k.Code))
			}
		}
		slices.Sort(out)
		return slices.Compact(out)
	}
	key := orderSlug(order) + ":"
	for _, code := range codes(want, got) {
		key += "-" + code
	}
	for _, code := range codes(got, want) {
		key += "+" + code
	}
	return key
}

func orderSlug(order Order) string { return strings.ReplaceAll(order.String(), " ", "-") }

// within runs a stage under Within and logs one that takes longer than a
// second, so a slow input is named before it becomes a hang.
func within(t testing.TB, stage string, fn func()) {
	probe := os.Getenv("VIBELANG_FUZZ_HANG_PROBE") == "1"
	if probe {
		t.Logf("probe-stage start: %s", stage)
	}
	start := time.Now()
	Within(stage, fn)
	if probe {
		t.Logf("probe-stage done: %s", stage)
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Logf("slow: %s took %v", stage, elapsed.Round(time.Millisecond))
	}
}

// seedHash picks among variants of a check by the input, so that a
// crasher reproduces with the variant that found it.
func seedHash(parts ...string) uint32 {
	h := fnv.New32a()
	for _, p := range parts {
		h.Write([]byte(p))
		h.Write([]byte{0})
	}
	return h.Sum32()
}

// TestSpecFacts checks current-spec facts and the quoted source sentences.
func TestSpecFacts(t *testing.T) {
	TestRegistryUsesCurrentAppendix(t)
	facts := Facts()
	if !slices.Equal(facts.Severities, []string{"error", "warning", "suggestion", "off"}) {
		t.Errorf("severities: %v", facts.Severities)
	}
	for _, code := range SpecCodes() {
		if _, ok := facts.Rows[code]; !ok {
			t.Errorf("%s has no current row", specCodeName(code))
		}
	}
	if facts.Default(3801) != DefaultError {
		t.Error("Appendix B's imported table gives EK3801 the default error")
	}
}

// recoverCompilerPanic reports a panic of the compiler as a Gap keyed by the
// function that panicked, as the tools area keys it (toolsPanicFrame): a
// panic is always a bug, a known one can be pending under its own key, and a
// pending reproduction never excuses a new one. Defer it.
func recoverCompilerPanic(t testing.TB, target string) {
	t.Helper()
	if r := recover(); r != nil {
		stack := debug.Stack()
		Gap(t, target, "crash:"+toolsPanicFrame(stack), "compiler panic: %v\n%s", r, stack)
	}
}

// TestOrderKey checks that an order difference is keyed by the codes only
// one order reports, so one pending code does not hide another.
func TestOrderKey(t *testing.T) {
	name := DiagnosticKey{Code: 2304, File: "main.vibe", Pos: 10, Text: "Cannot find name 'C'."}
	other := DiagnosticKey{Code: 2304, File: "main.vibe", Pos: 20, Text: "Cannot find name 'C'."}
	effect := DiagnosticKey{Source: "EK", Code: 102, File: "main.vibe", Pos: 5}
	for _, c := range []struct {
		order     Order
		want, got []DiagnosticKey
		key       string
	}{
		{OrderEmitFirst, []DiagnosticKey{name}, []DiagnosticKey{name, other}, "emit-first:+TS2304"},
		{OrderReverse, []DiagnosticKey{effect, name}, []DiagnosticKey{name}, "reverse-file-order:-EK0102"},
		{OrderEmitFirst, []DiagnosticKey{effect}, []DiagnosticKey{name}, "emit-first:-EK0102+TS2304"},
	} {
		if key := orderKey(c.order, c.want, c.got); key != c.key {
			t.Errorf("orderKey(%s) = %q, want %q", c.order, key, c.key)
		}
	}
}
