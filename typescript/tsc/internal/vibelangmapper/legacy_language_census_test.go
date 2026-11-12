package vibelangmapper

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// The legacy-language census.
//
// The language is explicit: "A function with no modifier is plain", "Calling
// an Effect function returns its Effect unrun", and `try` runs it
// (packages/compiler/skills/vibelang/SKILL.md, "The model"; VIP-1, VIP-5).
// The mapper's checking and executable renderings still apply the earlier
// inferred model, and the golden tables record what they produce. A row that
// records the inferred model is not evidence that the projection is right:
// it is a row to rewrite when the form resolver is retired.
//
// testdata/legacy-language.txt lists every such row with the retired rules
// it records. TestLegacyLanguageCensus derives the rows from the tables and
// fails when one is not listed, so the list cannot grow unnoticed: a new row
// is written in the current language (`effect`, `try`, a function-literal
// `catch` handler), and a retired form gets a rejection test, not a lowering
// expectation. A listed row stays listed whichever retired rules it records,
// and a line whose row was rewritten or removed is only logged, so a change
// that rewrites rows passes with or without its lines deleted.

// legacyCensusFile is the pinned worklist, relative to the package.
const legacyCensusFile = "testdata/legacy-language.txt"

// frozenLegacyDirs hold copies of compiler cases taken before the cases
// moved to the current language. Each file is a census line.
var frozenLegacyDirs = []string{"testdata/pre-vip1", "testdata/purity"}

// The rules a census line can name.
const (
	// A source that writes no `effect` projects as an Effect generator.
	legacyImplicitEffect = "implicit-effect"
	// An Effect function runs a call that no `try` or other running form marks.
	legacyImplicitRun = "implicit-run"
	// `layer Name: Service { … }` is retired (EK2121).
	legacyLayer = "layer-declaration"
	// A value, a name or a block after `catch`; the handler is a function literal.
	legacyCatchValue = "catch-value"
	// Effect code has no `try` statements.
	legacyTryStatement = "try-statement"
	// `fork(() => …)` as a call; `fork` takes an operand.
	legacyForkCall = "fork-call"
	// `fiber.join()`; `join` takes an operand.
	legacyJoinMethod = "join-method"
	// The `mutable` member marker.
	legacyMutableMember = "mutable-member"
	// `sync(value)` with a value in place of a function.
	legacySyncValue = "sync-value"
)

var (
	legacyLayerPattern        = regexp.MustCompile(`(^|[;{}\s])layer\s+[A-Za-z_$][\w$]*\s*:`)
	legacyTryStatementPattern = regexp.MustCompile(`\btry\s*\{`)
	legacyForkCallPattern     = regexp.MustCompile(`(^|[^.\w$])fork\s*\(`)
	legacyJoinMethodPattern   = regexp.MustCompile(`\.join\(\s*\)`)
	legacyMutablePattern      = regexp.MustCompile(`(^|[;{,\s])mutable\s+[A-Za-z_$#\[]`)
	legacySyncCallPattern     = regexp.MustCompile(`(^|[^.\w$])sync\s*\(\s*`)
	legacyCatchPattern        = regexp.MustCompile(`\bcatch\b\s*`)
	legacyFunctionPattern     = regexp.MustCompile(`^((effect|async)\s+)?(\(|function\b|[A-Za-z_$][\w$]*\s*=>)`)
	legacyRunningFormPattern  = regexp.MustCompile(`\b(try|catch|fork|join|for|using|yield|provide|match|race|defer|sync|promise)\b|\|>`)
	legacyEffectOutputPattern = regexp.MustCompile(`\$gen\(|\$plainSync\(|\$entry\(`)
	legacyRunOutputPattern    = regexp.MustCompile(`\$run(At)?\(`)
)

// writesEffect reports whether source writes `effect` on a function, a
// lambda or a block, as the parser reads it (a string or a property named
// effect is not the keyword).
func writesEffect(source string) bool {
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: projectedFileName, VibeLangDoAsFunction: true}, source, core.ScriptKindTS)
	return len(writtenEffectDeclarationMarks(file))+len(writtenEffectLambdaMarks(file))+len(writtenEffectBlockMarks(file)) > 0
}

// valueAfter reports whether some match of pattern in source is followed by
// something other than a function literal. A `{` after `catch` is a `try`
// statement's clause, which has its own rule.
func valueAfter(pattern *regexp.Regexp, source string) bool {
	for _, at := range pattern.FindAllStringIndex(source, -1) {
		rest := source[at[1]:]
		if !legacyFunctionPattern.MatchString(rest) && !strings.HasPrefix(rest, "{") {
			return true
		}
	}
	return false
}

// legacyRules returns the retired rules a golden row records: source is the
// row's VibeLang, output what the mapper renders for it, and accepted
// whether the row expects no diagnostic. Retired syntax counts only in an
// accepted row; a row that expects its diagnostic is a rejection test.
func legacyRules(source, output string, accepted bool) []string {
	var rules []string
	add := func(rule string, found bool) {
		if found {
			rules = append(rules, rule)
		}
	}
	effect := writesEffect(source)
	effectOutput := legacyEffectOutputPattern.MatchString(output)
	add(legacyImplicitEffect, !effect && effectOutput)
	add(legacyImplicitRun, effect && !legacyRunningFormPattern.MatchString(source) && legacyRunOutputPattern.MatchString(output))
	if accepted {
		add(legacyLayer, legacyLayerPattern.MatchString(source))
		add(legacyCatchValue, valueAfter(legacyCatchPattern, source))
		// A `try` statement in a plain function that stays plain is JavaScript's.
		add(legacyTryStatement, (effect || effectOutput) && legacyTryStatementPattern.MatchString(source))
		add(legacyForkCall, legacyForkCallPattern.MatchString(source))
		add(legacyJoinMethod, legacyJoinMethodPattern.MatchString(source))
		add(legacyMutableMember, legacyMutablePattern.MatchString(source))
		add(legacySyncValue, valueAfter(legacySyncCallPattern, source))
	}
	return rules
}

// legacyCensus derives the census lines from the golden tables and the
// frozen directories, sorted.
func legacyCensus(t *testing.T) []string {
	var lines []string
	row := func(table, name string, rules []string) {
		if len(rules) > 0 {
			lines = append(lines, table+"\t"+strings.Join(rules, ",")+"\t"+name)
		}
	}
	for _, c := range projectionCases {
		row("projection", c.name, legacyRules(c.source, c.virtual, len(c.diagnostics) == 0))
	}
	for _, c := range emitCases {
		js, _, diagnostics := Emit(c.source, testContext)
		row("emit", c.name, legacyRules(c.source, js, len(diagnostics) == 0))
	}
	for _, dir := range frozenLegacyDirs {
		err := filepath.WalkDir(dir, func(path string, entry fs.DirEntry, err error) error {
			if err == nil && !entry.IsDir() {
				lines = append(lines, "frozen\tpre-migration-copy\t"+filepath.ToSlash(path))
			}
			return err
		})
		if err != nil && !os.IsNotExist(err) {
			t.Fatal(err)
		}
	}
	slices.Sort(lines)
	return lines
}

// censusKey is the part of a census line that names its row: the table and
// the row name, without the rules.
func censusKey(line string) string {
	fields := strings.SplitN(line, "\t", 3)
	if len(fields) != 3 {
		return line
	}
	return fields[0] + "\t" + fields[2]
}

// staleCensusLines returns the pinned lines that the derived census does not
// hold: the row was rewritten, removed, or records other rules now.
func staleCensusLines(pinned, derived []string) []string {
	var stale []string
	for _, line := range pinned {
		if !slices.Contains(derived, line) {
			stale = append(stale, line)
		}
	}
	return stale
}

// unlistedCensusLines returns the derived lines whose row no pinned line
// names. A row is named by its table and name, so a listed row may change
// the rules it records.
func unlistedCensusLines(pinned, derived []string) []string {
	listed := map[string]bool{}
	for _, line := range pinned {
		listed[censusKey(line)] = true
	}
	var unlisted []string
	for _, line := range derived {
		if !listed[censusKey(line)] {
			unlisted = append(unlisted, line)
		}
	}
	return unlisted
}

// TestLegacyLanguageCensus holds the golden tables to the pinned worklist: a
// row that records retired language must be listed. UPDATE_LEGACY_CENSUS=1
// rewrites the list; a rewrite that adds a row needs the reason the row
// cannot be written in the current language.
func TestLegacyLanguageCensus(t *testing.T) {
	got := legacyCensus(t)
	data, err := os.ReadFile(legacyCensusFile)
	if err != nil {
		t.Fatal(err)
	}
	var header, want []string
	for _, line := range strings.Split(strings.TrimRight(string(data), "\n"), "\n") {
		if strings.HasPrefix(line, "#") || line == "" {
			header = append(header, line)
		} else {
			want = append(want, line)
		}
	}
	if os.Getenv("UPDATE_LEGACY_CENSUS") == "1" {
		text := strings.Join(append(header, got...), "\n") + "\n"
		if err := os.WriteFile(legacyCensusFile, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	if !slices.IsSorted(want) {
		t.Errorf("%s is not sorted", legacyCensusFile)
	}
	for _, line := range unlistedCensusLines(want, got) {
		t.Errorf("a golden row records retired language and is not in %s:\n  %s\nWrite the row in the current language: `effect` on the function, `try` on a call that runs, a function literal after `catch`. A retired form belongs in a test of its diagnostic.", legacyCensusFile, line)
	}
	for _, line := range staleCensusLines(want, got) {
		t.Logf("%s holds a line its row no longer matches; UPDATE_LEGACY_CENSUS=1 rewrites the list:\n  %s", legacyCensusFile, line)
	}
}

// TestLegacyCensusComparison checks the comparison the census makes: a row
// that is not listed is reported, a listed row may change its rules, and a
// line with no row left is stale, not a failure.
func TestLegacyCensusComparison(t *testing.T) {
	pinned := []string{"emit\timplicit-effect\ta", "projection\timplicit-effect,try-statement\tb", "projection\tcatch-value\tgone"}
	derived := []string{"emit\timplicit-run\ta", "projection\timplicit-effect,try-statement\tb", "projection\timplicit-effect\ta", "emit\tlayer-declaration\tnew"}
	if got, want := unlistedCensusLines(pinned, derived), []string{"projection\timplicit-effect\ta", "emit\tlayer-declaration\tnew"}; !slices.Equal(got, want) {
		t.Errorf("unlisted %q, want %q", got, want)
	}
	if got, want := staleCensusLines(pinned, derived), []string{"emit\timplicit-effect\ta", "projection\tcatch-value\tgone"}; !slices.Equal(got, want) {
		t.Errorf("stale %q, want %q", got, want)
	}
	if got := unlistedCensusLines(pinned, pinned); len(got) != 0 {
		t.Errorf("a list reports its own lines: %q", got)
	}
}

// TestLegacyRules checks the census's reading of one row per rule of the
// model: the current-language spelling of a row is never a census line, and
// each retired spelling is.
func TestLegacyRules(t *testing.T) {
	for _, c := range []struct {
		name, source, output string
		rejected             bool
		want                 string
	}{
		{name: "a function with no modifier is plain", source: `function f() { return g(1) }`, output: `function f() { return g(1) }`},
		{name: "a plain function projected as an Effect generator", source: `function f() { return g(1) }`, output: `function f() { return $gen(function* () { return (yield* $run(g(1))) })}`, want: legacyImplicitEffect},
		{name: "a plain function emitted with an Effect wrapper", source: `export function double(n: number) { return n * 2 }`, output: `return $plainSync(double$direct, this, $args)`, want: legacyImplicitEffect},
		{name: "a plain function emitted with entry dispatch", source: `export function main() { return 1 }`, output: `$entry(import.meta.main, () => $runMain(main()))`, want: legacyImplicitEffect},
		{name: "the word effect in a module name is not the keyword", source: `import { Match } from "effect"; const o = { effect: 1 }; function f() { return o.effect }`, output: `function f() { return $gen(function* () { return o.effect })}`, want: legacyImplicitEffect},
		{name: "an effect function runs a tried call", source: `effect function f() { return try g(1) }`, output: `function f() { return $gen(function* () { return (yield* $run($try(g(1)))) })}`},
		{name: "an effect function holds an untried call", source: `effect function f() { return g(1) }`, output: `function f() { return $gen(function* () { return g(1) })}`},
		{name: "an effect function projected as running an untried call", source: `effect function f() { return g(1) }`, output: `function f() { return $gen(function* () { return (yield* $run(g(1))) })}`, want: legacyImplicitRun},
		{name: "an effect lambda", source: `const f = effect (id: string) => try find(id)`, output: `const f = (id: string) => $gen(function* () { return (yield* $run($try(find(id)))) })`},
		{name: "an effect method", source: `class C { effect find(id: string) { return try load(id) } }`, output: `class C { find(id: string) { return $gen({ self: this }, function* () { return (yield* $run($try(load(id)))) })} }`},
		{name: "an effect block", source: `const p = effect { return try load(1) }`, output: `const p = $gen(function* () { return (yield* $run($try(load(1)))) })`},
		{name: "catch with a plain handler", source: `effect function f() { return a() catch () => 2 }`, output: `$run($catch(`},
		{name: "catch with a named-parameter handler", source: `effect function f() { return a() catch e => e._tag }`, output: `$run($catch(`},
		{name: "catch with an effect handler", source: `effect function f() { return a() catch effect (e) => try b(e) }`, output: `$run($catch(`},
		{name: "catch with a value", source: `effect function f() { return a() catch 2 }`, output: `$run($catch(`, want: legacyCatchValue},
		{name: "catch with a name", source: `effect function f() { return a() catch fallback }`, output: `$run($catch(`, want: legacyCatchValue},
		{name: "catch with an effect block", source: `effect function f() { return a() catch effect { return 2 } }`, output: `$run($catch(`, want: legacyCatchValue},
		{name: "a rejected retired form is a rejection test", source: `effect function f() { return a() catch 2 }`, output: `$run($catch(`, rejected: true},
		{name: "a try statement in effect code", source: `effect function f() { try { a() } catch (e) { b(e) } }`, output: `$gen(`, want: legacyTryStatement},
		{name: "a try statement in a plain function is JavaScript's", source: `function f() { try { a() } catch (e) { b(e) } }`, output: `function f() { try { a() } catch (e) { b(e) } }`},
		{name: "a try statement in a plain function projected as Effect code", source: `function f() { try { a() } catch (e) { b(e) } }`, output: `function f() { return $gen(function* () {`, want: legacyImplicitEffect + "," + legacyTryStatement},
		{name: "a layer declaration", source: `layer Live: Users { find(id: string) { return id } }`, output: `const Live = Layer.succeed(`, want: legacyLayer},
		{name: "a member named layer", source: `const o = { layer: 1 }; const p = Layer.effect(a, b)`, output: `const o = { layer: 1 }`},
		{name: "fork as a call", source: `effect function f() { const fiber = fork(() => 1); return fiber }`, output: `$run($scoped(fork)(`, want: legacyForkCall},
		{name: "fork with an operand", source: `effect function f() { const fiber = fork work(); return join fiber }`, output: `$run($fork(`},
		{name: "join as a method", source: `effect function f(fiber: Fiber.Fiber<number>) { const n = try g(); return fiber.join() }`, output: `$run(Fiber.join(fiber))`, want: legacyJoinMethod},
		{name: "an array join takes its separator", source: `function f(xs: string[]) { return xs.join(",") }`, output: `function f(xs: string[]) { return xs.join(",") }`},
		{name: "the mutable member marker", source: `schema User { mutable name: string }`, output: `Schema.mutableKey(`, want: legacyMutableMember},
		{name: "a member named mutable", source: `const o = { mutable: true }; const m = o.mutable`, output: `const o = { mutable: true }`},
		{name: "sync with a value", source: `effect function f() { return try sync(count * 2) }`, output: `$run($try(`, want: legacySyncValue},
		{name: "sync with a function", source: `effect function f() { return try sync(() => count * 2) }`, output: `$run($try(`},
	} {
		got := strings.Join(legacyRules(c.source, c.output, !c.rejected), ",")
		if got != c.want {
			t.Errorf("%s: %s\n  rules %q, want %q", c.name, c.source, got, c.want)
		}
	}
}

// FuzzLegacyRules checks the census's reading on arbitrary sources: it is
// deterministic, it names retired syntax only in an accepted row, and a
// source with no `catch` word, `try {`, `layer`, `fork(`, `.join(`,
// `mutable` or `sync(` names no retired syntax at all.
func FuzzLegacyRules(f *testing.F) {
	for _, c := range projectionCases {
		f.Add(c.source, c.virtual)
	}
	for _, c := range emitCases {
		f.Add(c.source, strings.Join(c.contains, "\n"))
	}
	f.Add("effect function f() { return a() catch effect (e) => try b(e) }", "$run($catch(")
	f.Add("catch", "")
	f.Add("effect", "$gen(")
	syntax := []string{legacyLayer, legacyCatchValue, legacyTryStatement, legacyForkCall, legacyJoinMethod, legacyMutableMember, legacySyncValue}
	f.Fuzz(func(t *testing.T, source, output string) {
		if len(source) > 4*1024 {
			t.Skip()
		}
		accepted := legacyRules(source, output, true)
		if again := legacyRules(source, output, true); !slices.Equal(accepted, again) {
			t.Fatalf("not deterministic for %q: %v, %v", source, accepted, again)
		}
		rejected := legacyRules(source, output, false)
		for _, rule := range rejected {
			if slices.Contains(syntax, rule) {
				t.Fatalf("a rejected row names retired syntax %s: %q", rule, source)
			}
		}
		if slices.Contains(accepted, legacyImplicitEffect) && slices.Contains(accepted, legacyImplicitRun) {
			t.Fatalf("a source both writes and omits effect: %q", source)
		}
		if slices.Contains(accepted, legacyTryStatement) && !writesEffect(source) && !legacyEffectOutputPattern.MatchString(output) {
			t.Fatalf("a try statement in plain code that stays plain is named retired: %q", source)
		}
		spelled := false
		for _, word := range []string{"catch", "try", "layer", "fork", ".join(", "mutable", "sync"} {
			spelled = spelled || strings.Contains(source, word)
		}
		if !spelled {
			for _, rule := range accepted {
				if slices.Contains(syntax, rule) {
					t.Fatalf("%s named with none of its words: %q", rule, source)
				}
			}
		}
	})
}
