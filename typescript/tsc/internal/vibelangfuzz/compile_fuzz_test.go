package vibelangfuzz

import (
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

// FuzzCompile compiles any project, a txtar archive of its files, and holds
// every compilation to the invariants of Chapters 27 and 28: no panic or
// hang; every EK code in Chapter 28's registry, in its default category when
// nothing adjusts it, and only in .vibe files (D266); every span inside its
// file; the same diagnostics and outputs from a fresh compilation and in
// every order the checker can be asked; and, when no error is reported,
// JavaScript that parses and imports only what Chapter 27 allows, runtime
// helpers the runtime exports, source maps into the .vibe text (D34), and
// declarations a TypeScript consumer type-checks against (D366).
func FuzzCompile(f *testing.F) {
	startShortBudget(f)
	w := NewWorkspace(f)
	for _, seed := range CompileSeeds() {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, archive string) {
		t.Parallel() // the seed corpus only; fuzzing ignores it
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
	// Every acceptance case but one is under 24 KB. The one above,
	// match-flow-limit.fail, takes the compiler most of a minute (see the
	// pending corpus:match-flow-limit-cubic); its mutations would end every
	// campaign as hangs of the same bug.
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
	compile := func(stage string, order Order, singleThreaded bool) *Compilation {
		var c *Compilation
		within(t, stage, func() { c = w.CompileIn(ctx, a.Dir, project, order, singleThreaded || pending) })
		return c
	}
	CheckDiagnostics(g, a.Dir, a.Diagnostics, DefaultsApply(project))

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
	for _, order := range []Order{OrderReverse, OrderEmitFirst} {
		c := compile(order.String(), order, true)
		if diff := DiffKeys(SortedKeys(Keys(a.Dir, a.Diagnostics)), SortedKeys(Keys(c.Dir, c.Diagnostics))); diff != "" {
			g.Add("feature:order", "asked in %s, the program reports other diagnostics:\n%s", order, diff)
		}
		if diff := DiffOutputs(a.Dir, a.Outputs, c.Dir, c.Outputs); diff != "" {
			g.Add("feature:order", "asked in %s, the program writes other outputs:\n%s", order, diff)
		}
	}
}

// within runs a stage under Within and logs one that takes longer than a
// second, so a slow input is named before it becomes a hang.
func within(t testing.TB, stage string, fn func()) {
	start := time.Now()
	Within(stage, fn)
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

// TestSpecFacts checks that the facts read from Chapter 28 are the ones its
// text states, so that a change in the chapter's wording cannot silently
// empty an oracle.
func TestSpecFacts(t *testing.T) {
	facts := Facts()
	if facts.Boundary != 4801 {
		t.Errorf("the lint range starts at EK%d; Chapter 28's Diagnostics section says EK4801", facts.Boundary)
	}
	var warnings, mixed []int32
	for code, category := range facts.Defaults {
		if code < facts.Boundary && category == DefaultWarning {
			warnings = append(warnings, code)
		}
		if category == DefaultErrorOrWarning {
			mixed = append(mixed, code)
		}
	}
	slices.Sort(warnings)
	if len(warnings) != facts.WarningCount || facts.WarningCount == 0 {
		t.Errorf("%d warnings before EK%d (%v); the chapter says %d", len(warnings), facts.Boundary, warnings, facts.WarningCount)
	}
	if len(mixed) != 1 {
		t.Errorf("codes with forms of both categories: %v; the chapter names EK4408's", mixed)
	}
	rows := registryRows(SpecText(chapter28))
	for _, code := range SpecCodes() {
		cells := rows[code]
		category, ok := facts.Defaults[code]
		if !ok {
			t.Errorf("EK%d has no default", code)
			continue
		}
		reports := strings.ToLower(cells[1])
		// A row that states its category agrees with the paragraph.
		switch {
		case strings.HasPrefix(reports, "warning") && category != DefaultWarning:
			t.Errorf("EK%d's row says a warning; derived %s", code, category)
		case strings.HasPrefix(reports, "error by default") && category != DefaultError:
			t.Errorf("EK%d's row says an error by default; derived %s", code, category)
		case strings.HasPrefix(reports, "off by default") && category != DefaultOff:
			t.Errorf("EK%d's row says off by default; derived %s", code, category)
		}
		// Every lint code but the reserved historical rules has a default.
		if category == DefaultUnknown && !strings.HasPrefix(reports, "reserved historical") {
			t.Errorf("EK%d: no default category derived from %q", code, cells[1])
		}
	}
	for _, code := range []int32{4801, 4802, 4813, 4838, 9100} {
		if facts.Defaults[code] != DefaultError {
			t.Errorf("EK%d derived %s; Chapter 28 says an error", code, facts.Defaults[code])
		}
	}
	if facts.Defaults[9101] != DefaultNever {
		t.Errorf("EK9101 derived %s; Chapter 28 says the CLI never emits it", facts.Defaults[9101])
	}
	for _, code := range []int32{1008, 1014, 2115, 2116} {
		if !slices.Contains(facts.Retired, code) {
			t.Errorf("EK%d is retired in Chapter 28; derived retired codes %v", code, facts.Retired)
		}
	}
	if len(facts.Rules) < 10 {
		t.Errorf("only %d rules read below the registry table: %v", len(facts.Rules), facts.Rules)
	}

	// The options table and the paragraphs around it agree on what a project
	// may adjust: the policy codes, the lint codes but EK4813, and none of
	// the codes no setting lowers.
	diagnostics := section(SpecText(chapter28), "#### Diagnostics")
	policy := diagnostics[strings.Index(diagnostics, "A project may set"):]
	policy = policy[:strings.Index(policy, " to ")]
	for _, code := range codesIn(policy) {
		if !facts.IsAdjustable(code) {
			t.Errorf("EK%d: \"A project may set\" it, but the options table does not list it", code)
		}
	}
	for _, code := range []int32{4813, 4838, 9100, 2001} {
		if facts.IsAdjustable(code) {
			t.Errorf("EK%d is adjustable by the derivation; Chapter 28 says no setting changes it", code)
		}
	}
	lint := 0
	for _, code := range facts.Adjustable {
		if code >= 4801 && code <= 4825 {
			lint++
		}
	}
	if want := 24; lint != want {
		t.Errorf("%d adjustable codes in EK4801-EK4825; Chapter 28 lists 25 codes there and excepts EK4813", lint)
	}
	for _, code := range []int32{4830, 4837, 3205, 4403, 4409} {
		if !facts.IsAdjustable(code) {
			t.Errorf("EK%d should be adjustable", code)
		}
	}
	if !slices.Equal(facts.Severities, []string{"error", "warning", "off"}) {
		t.Errorf("severities %v", facts.Severities)
	}
	if !slices.Equal(facts.Tracing, []string{"none", "exported", "all"}) {
		t.Errorf("tracing values %v", facts.Tracing)
	}
	// The defaults column of the diagnostics option agrees with the derived
	// defaults: `EK1012, EK2004, and EK4406 "warning"; EK3205, EK4403,
	// and EK4409 "error"`.
	row := diagnostics[strings.Index(diagnostics, "| `diagnostics` |"):]
	row = row[:strings.Index(row, "\n")]
	defaults := strings.Split(row, " | ")[2]
	for _, part := range strings.Split(defaults, ";") {
		for _, severity := range []string{"warning", "error"} {
			if strings.Contains(part, `"`+severity+`"`) {
				want := map[string]DefaultCategory{"warning": DefaultWarning, "error": DefaultError}[severity]
				for _, code := range codesIn(part) {
					if facts.Defaults[code] != want {
						t.Errorf("EK%d's default is %s in the options table; derived %s", code, severity, facts.Defaults[code])
					}
				}
			}
		}
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
