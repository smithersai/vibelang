package vibelangfuzz

import (
	"fmt"
	"maps"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const (
	fixStyleRepairsTarget  = "FuzzFixStyleRepairs"
	fixStyleRepairsOnQuote = "wherever the program reports them, so only where the project or a diagnostics comment turns the rule on, at any severity"
	fixStyleRepairsOff     = "Where the rule is off, these repairs do not run."
	fixStyleRepairsKeep    = "They change only how the code is written, never what it does or its declaration, and a repair that would drop a comment is not offered."
)

func TestFixStyleRepairsQuoted(t *testing.T) {
	text := SpecText("007-tooling.md")
	for _, quote := range []string{fixStyleRepairsOnQuote, fixStyleRepairsOff, fixStyleRepairsKeep} {
		if !strings.Contains(text, quote) {
			t.Fatalf("chapter 7 no longer says %q", quote)
		}
	}
}

// A style construct: its declaration line, the rule that reports it, the
// port and lint codes that name the rule, and the comment-free text the
// repair writes, or "" when a comment makes the repair decline.
type fixStyleConstruct struct {
	source, port, lint, fixed string
}

// fixStyleConstructs are keyed (RULES.md 11). alchemy-effect-arrow-object is
// the conversion alchemy's lint rejected.
var fixStyleConstructs = map[string]fixStyleConstruct{
	"alchemy-effect-arrow-object": {"export const make = effect (value: number) => { return { value }; }", "EK4823", "EK38123", "export const make = effect (value: number) => ({ value })"},
	"plain-arrow":                 {"export const inc = (n: number) => { return n + 1 }", "EK4823", "EK38123", "export const inc = (n: number) => n + 1"},
	"callback-comma":              {"export const pairs = [1, 2].map((n) => { return n, 3 })", "EK4823", "EK38123", "export const pairs = [1, 2].map((n) => (n, 3))"},
	"empty-method-pipe":           {"export const empty = Effect.succeed(1).pipe()", "EK4824", "EK38126", "export const empty = Effect.succeed(1)"},
	"empty-function-pipe":         {"export const bare = pipe(Effect.succeed(1))", "EK4824", "EK38126", "export const bare = Effect.succeed(1)"},
	"function-chain": {"export const chain = pipe(pipe(Effect.succeed(1), Effect.map((n: number) => n + 1)), Effect.map((n: number) => n * 2))", "EK4825", "EK38127",
		"export const chain = pipe(Effect.succeed(1), Effect.map((n: number) => n + 1), Effect.map((n: number) => n * 2))"},
	"commented-empty-pipe": {"export const kept = Effect.succeed(1).pipe(/* why */)", "EK4824", "EK38126", ""},
	"commented-chain":      {"export const noted = pipe(pipe(Effect.succeed(1), /* first */ Effect.map((n: number) => n + 1)), Effect.map((n: number) => n * 2))", "EK4825", "EK38127", ""},
}

var fixStyleSeverities = []string{"off", "suggestion", "warning", "error"}

// FuzzFixStyleRepairs runs ordinary --fix on one style construct, with its
// rule at a fuzzed severity, turned on by the project's vibe.severities or by
// a diagnostics comment, between fuzzed neighbours that no style rule
// reports. The oracle compares the compiler with itself: before and after.
func FuzzFixStyleRepairs(f *testing.F) {
	startShortBudget(f)
	for _, key := range slices.Sorted(maps.Keys(fixStyleConstructs)) {
		for _, mutation := range []uint8{0, 3, 6, 9, 14} {
			f.Add(key, mutation)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mutation uint8) {
		TestFixStyleRepairsQuoted(t)
		construct, ok := fixStyleConstructs[key]
		if !ok {
			keys := slices.Sorted(maps.Keys(fixStyleConstructs))
			key = keys[int(mutation)%len(keys)]
			construct = fixStyleConstructs[key]
		}
		severity := fixStyleSeverities[mutation%4]
		// A diagnostics comment sets EK48xx to error, warning or off only.
		byComment := mutation&4 != 0 && severity != "suggestion"
		neighbours := []string{
			"export const before = 1",
			"export const piped = Effect.succeed(2) |> Effect.map(%, (n: number) => n + 1)",
			"export const block = (n: number) => {\n  const m = n + 1\n  return m\n}",
		}[mutation>>3%3]
		source := neighbours + "\n" + construct.source + "\n"
		config := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,` +
			`"declaration":true,"outDir":"out","rootDir":".","plugins":[{"name":"@effect/language-service"}]}`
		if byComment {
			source = "// @vibelang-diagnostics " + construct.port + ":" + severity + "\n" + source
		} else {
			config += `,"vibe":{"severities":{"` + construct.lint + `":"` + severity + `"}}`
		}
		config += `,"files":["main.vibe"]}`
		project := Project{Files: map[string]string{"main.vibe": source}, Config: config}
		before, err := w.Compile(t.Context(), project)
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		reported := styleReports(before, construct)
		if (severity == "off") != (reported == 0) {
			t.Fatalf("invalid witness: severity %s reports %d\n%s", severity, reported, source)
		}
		fixed := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
		if fixed.Err != nil {
			t.Fatal(fixed.Err)
		}
		text := source
		for _, file := range fixed.Files {
			text = file.Text
		}
		label := fmt.Sprintf("%s:%s:%t", key, severity, byComment)
		switch {
		case severity == "off" && text != source:
			Gap(t, fixStyleRepairsTarget, "off:"+key, "%s\nbefore:\n%s\nafter:\n%s", fixStyleRepairsOff, source, text)
		case severity != "off" && construct.fixed == "" && text != source:
			Gap(t, fixStyleRepairsTarget, "comment:"+key, "%s\nbefore:\n%s\nafter:\n%s", fixStyleRepairsKeep, source, text)
		case severity != "off" && construct.fixed != "" && text != strings.Replace(source, construct.source, construct.fixed, 1):
			Gap(t, fixStyleRepairsTarget, "on:"+key, "%s (%s)\nbefore:\n%s\nafter:\n%s", fixStyleRepairsOnQuote, label, source, text)
		}
		after, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": text}, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer after.Remove()
		if !toolsErrorFree(after) && toolsErrorFree(before) {
			Gap(t, fixStyleRepairsTarget, "errors:"+key, "%s (%s): %v\n%s", fixStyleRepairsKeep, label, after.Diagnostics, text)
		}
		if construct.fixed != "" && severity != "off" && styleReports(after, construct) != 0 {
			Gap(t, fixStyleRepairsTarget, "left:"+key, "%s (%s)\n%s", fixStyleRepairsOnQuote, label, text)
		}
		if !maps.Equal(declarationsOf(before), declarationsOf(after)) {
			Gap(t, fixStyleRepairsTarget, "declaration:"+key, "%s (%s)\nbefore: %v\nafter: %v", fixStyleRepairsKeep, label, declarationsOf(before), declarationsOf(after))
		}
		ExpectPending(t, fixStyleRepairsTarget, "on:"+key)
	})
}

// styleReports counts the reports of construct's rule, under either code.
func styleReports(r *Result, construct fixStyleConstruct) int {
	n := 0
	for _, d := range r.Diagnostics {
		code := fmt.Sprintf("EK%d", d.Code())
		if IsEK(d) && (code == construct.port || code == construct.lint) && d.Category() != diagnostics.CategoryMessage {
			n++
		}
	}
	return n
}

// declarationsOf returns r's declaration outputs by name.
func declarationsOf(r *Result) map[string]string {
	out := map[string]string{}
	for name, text := range r.Outputs {
		if strings.HasSuffix(name, ".d.ts") || strings.HasSuffix(name, ".d.vibe.ts") {
			out[name] = text
		}
	}
	return out
}
