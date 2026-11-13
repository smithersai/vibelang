package vibelangfuzz

import (
	"fmt"
	"maps"
	"slices"
	"strings"
	"testing"
)

const (
	portPluginSeverityTarget = "FuzzPortPluginSeverityTwins"
	portPluginSeverityQuote  = "Once enabled, severity resolves from `vibe.severities`, then the repository's Effect language-service configuration, then the rule's default"
)

func TestPortPluginSeverityQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), portPluginSeverityQuote) {
		t.Fatalf("chapter 7 no longer says %q", portPluginSeverityQuote)
	}
}

// A ported rule: its name, a declaration both a .ts and a .vibe module accept
// that the rule reports, the VibeLang port's code and the rule's code.
type portPluginRule struct {
	rule, source string
	port, lint   int32
}

// portPluginRules are keyed.
var portPluginRules = map[string]portPluginRule{
	"arrow-block":   {"unnecessaryArrowBlock", "export const inc = (n: number) => { return n + 1 }", 4823, 38123},
	"extends-error": {"extendsNativeError", "export class Legacy extends Error {}", 4805, 3837},
	"empty-pipe":    {"unnecessaryPipe", "export const empty = Effect.succeed(1).pipe()", 4824, 38126},
	"pipe-chain":    {"unnecessaryPipeChain", "export const chain = Effect.succeed(1).pipe(Effect.map((n: number) => n + 1)).pipe(Effect.map((n: number) => n * 2))", 4825, 38127},
}

var portPluginSeverities = []string{"off", "suggestion", "warning", "error"}

// FuzzPortPluginSeverityTwins compiles a .vibe module and its .ts twin in one
// program whose Effect plugin entry gives one ported rule a fuzzed severity,
// at the top level or through a file override, and requires the port in the
// .vibe module to report what the rule reports in the .ts twin: its lint code
// and category, or nothing. The oracle
// compares the compiler with itself on two inputs chapter 7 says must agree.
func FuzzPortPluginSeverityTwins(f *testing.F) {
	startShortBudget(f)
	for _, key := range slices.Sorted(maps.Keys(portPluginRules)) {
		for _, mutation := range []uint8{0, 1, 2, 3, 4, 7} {
			f.Add(key, mutation)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mutation uint8) {
		TestPortPluginSeverityQuoted(t)
		rule, ok := portPluginRules[key]
		if !ok {
			keys := slices.Sorted(maps.Keys(portPluginRules))
			key = keys[int(mutation)%len(keys)]
			rule = portPluginRules[key]
		}
		severity := portPluginSeverities[mutation%4]
		entry := fmt.Sprintf(`"diagnosticSeverity":{%q:%q}`, rule.rule, severity)
		if mutation&4 != 0 {
			entry = fmt.Sprintf(`"diagnosticSeverity":{},"overrides":[{"include":["src/**/*"],"options":{"diagnosticSeverity":{%q:%q}}}]`, rule.rule, severity)
		}
		source := "import { Effect } from \"effect\"\n" + rule.source + "\n"
		if mutation&8 != 0 {
			source = "// a module\n" + source + "export const after = 1\n"
		}
		config := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,` +
			`"plugins":[{"name":"@effect/language-service",` + entry + `}]},"files":["src/m.vibe","src/t.ts"]}`
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"src/m.vibe": source, "src/t.ts": source}, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		categories := map[string][]string{}
		for _, d := range r.Diagnostics {
			if d.File() == nil || !IsEK(d) {
				continue
			}
			name := d.File().FileName().AsString()
			name = name[strings.LastIndex(name, "/")+1:]
			if name == "m.vibe" && (d.Code() == rule.port || d.Code() == rule.lint) || name == "t.ts" && d.Code() == rule.lint {
				categories[name] = append(categories[name], fmt.Sprintf("EK%d %s", d.Code(), d.Category().Name()))
			}
		}
		if len(categories["t.ts"]) == 0 && severity != "off" {
			t.Fatalf("invalid twin: the rule does not report the .ts module at %s\n%s", severity, source)
		}
		if !slices.Equal(categories["m.vibe"], categories["t.ts"]) {
			Gap(t, portPluginSeverityTarget, key, "%s: %s at %s (override %t): .vibe %v, .ts %v\n%s", portPluginSeverityQuote, rule.rule, severity, mutation&4 != 0, categories["m.vibe"], categories["t.ts"], source)
		}
		ExpectPending(t, portPluginSeverityTarget, key)
	})
}
