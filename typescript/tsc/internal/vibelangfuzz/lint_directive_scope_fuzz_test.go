package vibelangfuzz

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

const lintDirectiveTarget = "FuzzLintDirectiveScope"
const lintDirectiveRule = "effecttsgo/effect-sleep-zero-to-yield-now"

var lintDirectiveKeys = []string{
	"next-line", "same-line", "block", "block-enable", "other-rule", "next-line-gap",
	"literal-double", "literal-single", "literal-template", "same-effective-config",
}

func TestLintDirectiveScopeQuoted(t *testing.T) {
	// VIP-38 inherits the configured lint and TypeScript's lexical distinction:
	// directive comments select rules; string/template contents are ordinary data.
	// The retained Oxlint adapter is selected explicitly by its .oxlintrc.json.
	for _, rule := range []struct{ chapter, quote string }{
		{"007-tooling.md", "A repository's existing Effect language-service configuration selects and configures them"},
		{"000-intro.md", "Where a VIP is silent, its TypeScript or pinned TC39 counterpart applies."},
		{"007-tooling.md", "A rule's severity resolves in this order, the more specific winning"},
	} {
		if !strings.Contains(SpecText(rule.chapter), rule.quote) {
			t.Fatalf("%s no longer says %q", rule.chapter, rule.quote)
		}
	}
}

type lintDirectiveFixture struct {
	Key          string `json:"key"`
	Source       string `json:"source"`
	Expected     int    `json:"expected"`
	RootSeverity bool   `json:"rootSeverity"`
}

func lintDirectiveFixtures(t testing.TB) map[string]lintDirectiveFixture {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/corpus/alchemy-12-lint-directive-scope.json"))
	if err != nil {
		t.Fatal(err)
	}
	var rows []lintDirectiveFixture
	if err := json.Unmarshal(data, &rows); err != nil {
		t.Fatal(err)
	}
	out := map[string]lintDirectiveFixture{}
	for _, row := range rows {
		if _, exists := out[row.Key]; exists {
			t.Fatalf("duplicate retained key %q", row.Key)
		}
		out[row.Key] = row
	}
	return out
}

func TestLintDirectiveCorpusModels(t *testing.T) {
	rows := lintDirectiveFixtures(t)
	retained := map[string]bool{}
	for _, args := range CorpusInputs(lintDirectiveTarget) {
		if len(args) > 0 {
			retained[args[0]] = true
		}
	}
	for _, key := range lintDirectiveKeys {
		source, expected := lintDirectiveSource(key, 0)
		row, ok := rows[key]
		if !ok || !retained[key] || row.Source != source || row.Expected != expected || row.RootSeverity != (key == "same-effective-config") {
			t.Fatalf("retained Alchemy12 %s witness differs from its mutation model", key)
		}
	}
	if len(rows) != len(lintDirectiveKeys) {
		t.Fatal("unexpected retained directive witness")
	}
}

// One configured diagnostic is established on an unsuppressed positive control
// before checking any scope for that variant. Verified controls are cached
// per the sixteen finite source-position variants; every candidate still runs. Other rules and process failures cannot make a
// missing lint pass. Saved fixtures are executed as written; variant bytes widen
// spelling, physical line endings, nesting and UTF-16 source positions.
func FuzzLintDirectiveScope(f *testing.F) {
	startShortBudget(f)
	fixtures := lintDirectiveFixtures(f)
	for _, key := range []string{"next-line", "same-line", "literal-template", "same-effective-config"} {
		f.Add(key, byte(15))
	}
	binary := cliBuild(f, f.TempDir())
	w := NewWorkspace(f)
	var verifiedControls sync.Map
	f.Fuzz(func(t *testing.T, key string, variant byte) {
		TestLintDirectiveScopeQuoted(t)
		known := false
		for _, candidate := range lintDirectiveKeys {
			known = known || key == candidate
		}
		if !known {
			index := byte(0)
			if key != "" {
				index = key[0]
			}
			key = lintDirectiveKeys[int(index)%len(lintDirectiveKeys)]
		}
		run := func(source string, modern bool) (int, string) {
			config := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"noEmit":true},"files":["main.vibe"]}`
			if modern {
				config = strings.TrimSuffix(config, "}") + `,"vibe":{"severities":{"EK3833":"error"}}}`
			}
			dir, err := w.writeProject(Project{
				Files: map[string]string{
					"main.vibe":      source,
					"package.json":   servicesPackage,
					".oxlintrc.json": `{"rules":{"effecttsgo/effect-sleep-zero-to-yield-now":"error"}}`,
				},
				Config: config,
			})
			if err != nil {
				t.Fatal(err)
			}
			defer os.RemoveAll(dir)
			ctx, cancel := context.WithTimeout(t.Context(), cliDeadline)
			defer cancel()
			cmd := exec.CommandContext(ctx, binary, "lint", "-p", dir)
			cmd.Dir = dir
			cliIsolate(cmd)
			output, err := cmd.CombinedOutput()
			if ctx.Err() != nil {
				t.Fatalf("lint directive probe timed out: %v", ctx.Err())
			}
			if err != nil {
				exit, ok := err.(*exec.ExitError)
				if !ok || exit.ExitCode() != 1 {
					t.Fatalf("lint driver failed: %v\n%s", err, output)
				}
			}
			if strings.Contains(string(output), "error TS") || strings.Contains(string(output), "panic:") {
				t.Fatalf("directive control must remain valid source:\n%s\n%s", source, output)
			}
			count := 0
			for _, line := range strings.Split(string(output), "\n") {
				if strings.Contains(line, "EK3833") && strings.Contains(line, "effectSleepZeroToYieldNow") {
					count++
				}
			}
			return count, string(output)
		}
		if _, verified := verifiedControls.Load(variant & 15); !verified {
			baseline, _ := lintDirectiveSource("other-rule", variant)
			if count, output := run(baseline, false); count != 1 {
				t.Fatalf("configured unsuppressed rule must report exactly once, got %d:\n%s\nCLI:\n%s", count, baseline, output)
			}
			verifiedControls.Store(variant&15, true)
		}
		source, want := lintDirectiveSource(key, variant)
		modern := key == "same-effective-config"
		if variant == 0 {
			modern = fixtures[key].RootSeverity
			source = fixtures[key].Source
			want = fixtures[key].Expected
		}
		got, output := run(source, modern)
		prefix := "oxlint"
		if variant&1 != 0 {
			prefix = "eslint"
		}
		newline := "lf"
		if variant&2 != 0 {
			newline = "crlf"
		}
		gap := fmt.Sprintf("scope:%s:%s:%s", key, prefix, newline)
		if key == "same-effective-config" {
			gap = "config:same-effective-error-severity:" + newline
		}
		if got != want {
			Gap(t, lintDirectiveTarget, gap, "VIP38 configured lint and TypeScript lexical scope: got %d diagnostics, want %d; effective severity and actual comment scope must preserve the selected diagnostics:\n%s\nCLI:\n%s", got, want, source, output)
		}
		ExpectPending(t, lintDirectiveTarget, gap)
		ExpectPending(t, lintDirectiveTarget, specCorpusKey(t))
	})
}

func lintDirectiveSource(key string, variant byte) (string, int) {
	prefix := "oxlint"
	if variant&1 != 0 {
		prefix = "eslint"
	}
	rule := lintDirectiveRule
	statement := "Effect.sleep(0);"
	text, expected := "", 1
	switch key {
	case "same-effective-config":
		text = statement
	case "next-line":
		text = "// " + prefix + "-disable-next-line " + rule + " -- Alchemy12 retained directive\n" + statement
		expected = 0
	case "same-line":
		text = statement + " // " + prefix + "-disable-line " + rule
		expected = 0
	case "block":
		text = "/* " + prefix + "-disable " + rule + " */\n" + statement
		expected = 0
	case "block-enable":
		text = "/* " + prefix + "-disable " + rule + " */\n/* " + prefix + "-enable " + rule + " */\n" + statement
	case "other-rule":
		text = "// " + prefix + "-disable-next-line no-console\n" + statement
	case "next-line-gap":
		text = "// " + prefix + "-disable-next-line " + rule + "\nvoid 0;\n" + statement
	case "literal-double":
		text = "const marker = \"// " + prefix + "-disable-next-line " + rule + " -- ordinary data\";\n" + statement
	case "literal-single":
		text = "const marker = '// " + prefix + "-disable-next-line " + rule + " -- ordinary data';\n" + statement
	case "literal-template":
		text = "const marker = `/* " + prefix + "-disable " + rule + " */`;\n" + statement
	}
	if variant&4 != 0 {
		text = "{\n" + text + "\n}"
	}
	if variant&8 != 0 {
		text = "const label = \"café🙂\";\n" + text
	}
	source := "import { Effect } from \"effect\";\nexport function pause() {\n" + text + "\nreturn 1;\n}\n"
	if variant&2 != 0 {
		source = strings.ReplaceAll(source, "\n", "\r\n")
	}
	return source, expected
}
