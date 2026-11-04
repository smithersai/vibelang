package vibelangfuzz

import (
	"encoding/json"
	"os"
	"slices"
	"strings"
	"testing"
)

// VIP-38 / Chapter 007 selects rules through the existing resolved plugin,
// while the severity table configures selected rules. Its preserving migration
// retains legacy activation only when the resolved plugin is absent.
const lintMigrationQuote = "an assigned `EK38xx` key in a config without a resolved plugin entry still activates the whole default plugin"
const lintActivationQuote = "The existing Effect language-service configuration in `compilerOptions.plugins` selects the imported `effecttsgo/*` rules."

func TestLintActivationQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), lintActivationQuote) || !strings.Contains(SpecText("007-tooling.md"), lintMigrationQuote) {
		t.Fatalf("Chapter 007 no longer says %q", lintActivationQuote)
	}
}

func checkLintActivation(t *testing.T, w *Workspace, input string, inherited bool, namespace bool) {
	t.Helper()
	parts := strings.Split(input, ":")
	pick := func(i int, values []string) string {
		if i < len(parts) && slices.Contains(values, parts[i]) {
			return parts[i]
		}
		return values[0]
	}
	mode := pick(0, []string{"absent", "null", "disabled", "empty", "unrelated", "enabled"})
	severity := pick(1, []string{"error", "warning", "suggestion", "off"})
	key := mode + ":" + severity
	options := map[string]any{"strict": true, "types": []string{}, "skipLibCheck": true, "noEmit": true, "target": "ES2022", "module": "NodeNext"}
	plugin := map[string]any{"name": "@effect/language-service"}
	switch mode {
	case "null":
		plugin["diagnosticSeverity"] = nil
	case "disabled":
		plugin["diagnostics"] = false
	case "enabled":
		plugin["diagnosticSeverity"] = map[string]string{"floatingEffect": "off"}
	case "unrelated":
		plugin["name"] = "other"
	}
	if mode == "empty" {
		options["plugins"] = []any{}
	} else if mode != "absent" {
		options["plugins"] = []any{plugin}
	}
	config := map[string]any{"compilerOptions": options, "vibe": map[string]any{"severities": map[string]string{"EK3801": severity}}, "files": []string{"main.ts"}}
	source := "import { Effect } from \"effect\"; Effect.succeed(1); export {}"
	if namespace {
		source = "import * as Effect from \"effect/Effect\"; Effect.succeed(1); export {}"
	}
	files := map[string]string{"main.ts": source}
	if inherited {
		delete(config, "files")
		base, err := json.Marshal(config)
		if err != nil {
			t.Fatal(err)
		}
		files["base.json"] = string(base)
		config = map[string]any{"extends": "./base.json", "files": []string{"main.ts"}}
	}
	encoded, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	dir, err := w.writeProject(Project{Files: files, Config: string(encoded)})
	if err != nil {
		t.Fatal(err)
	}
	c := w.programIn(dir, true)
	defer os.RemoveAll(dir)
	if len(c.Diagnostics) != 0 {
		t.Fatalf("config diagnostics: %v", diagnosticTexts(c.Diagnostics))
	}
	if c.Program == nil {
		t.Fatal("no program")
	}
	ds := c.Program.GetSemanticDiagnostics(t.Context(), nil)
	count := 0
	for _, d := range ds {
		if d.Code() == 3801 {
			count++
			if d.Category().Name() != severity {
				Gap(t, "FuzzLintActivation", key, "VIP-38 severity %s became %s", severity, d.Category().Name())
			}
		} else if d.Category().Name() == "error" {
			t.Fatalf("unrelated error: %s", d.String())
		}
	}
	want := 0
	if (mode == "enabled" || mode == "absent" || mode == "empty" || mode == "unrelated") && severity != "off" {
		want = 1
	}
	if count != want {
		Gap(t, "FuzzLintActivation", key, "VIP-38 selected plugin %s: got %d lint reports, want %d (inherited=%v)", mode, count, want, inherited)
	}
}

func FuzzLintActivation(f *testing.F) {
	startShortBudget(f)
	for _, mode := range []string{"absent", "null", "disabled", "empty", "unrelated", "enabled"} {
		f.Add(mode+":error", false, false)
		f.Add(mode+":warning", true, true)
	}
	f.Add("enabled:suggestion", true, false)
	f.Add("enabled:off", false, true)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, inherited bool, namespace bool) {
		checkLintActivation(t, w, key, inherited, namespace)
	})
}
