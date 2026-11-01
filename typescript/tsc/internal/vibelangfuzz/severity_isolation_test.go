package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"
)

const severityIsolationTarget = "FuzzMigrationSeverityIsolation"
const severityIsolationQuote = "They are warnings by default and use `vibe.severities`, independently of the imported Effect lint table."

// foldkit-14: changing a VibeLang warning must leave imported Effect lint
// eligibility unchanged. The corpus retains the repository's minimized source
// and configuration; mutations vary source text, advisory, category and extends.
func TestMigrationSeverityIsolationQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), severityIsolationQuote) {
		t.Fatalf("Chapter 7 no longer says %q", severityIsolationQuote)
	}
}

func migrationSeverityWitness() string {
	return Archive(map[string]string{
		"main.ts":       "import { Effect } from \"effect\"\nEffect.succeed(1)\n",
		"tsconfig.json": `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true},"vibe":{"severities":{"EK4842":"off"}},"files":["main.ts"]}`,
	})
}

func checkMigrationSeverityIsolation(t *testing.T, w *Workspace, archive string, key string) {
	t.Helper()
	TestMigrationSeverityIsolationQuoted(t)
	toolsGuard(t, severityIsolationTarget, func() {
		files := toolsUnarchive(archive)
		if toolsTooLarge(files) {
			t.Skip("project too large")
		}
		var config struct {
			CompilerOptions map[string]any `json:"compilerOptions"`
			Vibe            struct {
				Severities map[string]string `json:"severities"`
			} `json:"vibe"`
		}
		if json.Unmarshal([]byte(files["tsconfig.json"]), &config) != nil || len(config.Vibe.Severities) != 1 {
			t.Skip("not an isolated severity configuration")
		}
		codes := []string{"EK4842", "EK0801", "EK4833", "EK3009"}
		categories := []string{"off", "warning", "suggestion", "error"}
		code, severity := "", ""
		for c, s := range config.Vibe.Severities {
			code, severity = c, s
		}
		if !slices.Contains(codes, code) || !slices.Contains(categories, severity) {
			t.Skip("not a VibeLang advisory")
		}
		// Other options could enable the plugin deliberately. This oracle
		// concerns a severity-only change to a plugin-free TypeScript project.
		if config.CompilerOptions == nil || config.CompilerOptions["plugins"] != nil {
			t.Skip("configuration has an explicit plugin")
		}
		keys := migrationSeverityKeys()
		if !slices.Contains(keys, key) {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		parts := strings.Split(key, ":")
		extends := parts[len(parts)-1] == "extends"
		if parts[0] != "original" {
			code, severity = parts[0], parts[1]
		}

		delete(files, "tsconfig.json")
		base := map[string]any{"compilerOptions": config.CompilerOptions}
		original, err := json.Marshal(base)
		if err != nil {
			t.Fatal(err)
		}
		before, err := w.Compile(t.Context(), Project{Files: files, Config: string(original)})
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		if HasError(before.Diagnostics) {
			t.Skipf("not a valid baseline: %v", SortedKeys(Keys(before.Dir, before.Diagnostics)))
		}
		for _, d := range before.Diagnostics {
			if importedEffectLint(d) {
				t.Fatal("plugin-free positive control unexpectedly ran imported lint")
			}
		}
		base["vibe"] = map[string]any{"severities": map[string]string{code: severity}}
		changed, err := json.Marshal(base)
		if err != nil {
			t.Fatal(err)
		}
		if extends {
			files["base.json"] = string(changed)
			changed = []byte(`{"extends":"./base.json"}`)
		}
		after, err := w.Compile(t.Context(), Project{Files: files, Config: string(changed)})
		if err != nil {
			t.Fatal(err)
		}
		defer after.Remove()
		var imported []string
		for _, d := range after.Diagnostics {
			if importedEffectLint(d) {
				imported = append(imported, fmt.Sprintf("EK%d", d.Code()))
			}
		}
		if len(imported) > 0 {
			Gap(t, severityIsolationTarget, "severity:"+key,
				"Chapter 7: %q; %s=%s (extends=%t) introduced unrelated %v\n%s\nconfig:\n%s",
				severityIsolationQuote, code, severity, extends, imported, archive, changed)
		}
		if HasError(after.Diagnostics) {
			t.Fatalf("unrelated configuration errors: %v", SortedKeys(Keys(after.Dir, after.Diagnostics)))
		}
		ExpectPending(t, severityIsolationTarget, "severity:"+key)
		ExpectPending(t, severityIsolationTarget, specCorpusKey(t))
	})
}

func migrationSeverityKeys() []string {
	keys := []string{}
	for _, context := range []string{"direct", "extends"} {
		keys = append(keys, "original:"+context)
		for _, code := range []string{"EK4842", "EK0801", "EK4833", "EK3009"} {
			for _, category := range []string{"off", "warning", "suggestion", "error"} {
				keys = append(keys, code+":"+category+":"+context)
			}
		}
	}
	return keys
}
func FuzzMigrationSeverityIsolation(f *testing.F) {
	startShortBudget(f)
	for _, key := range migrationSeverityKeys() {
		f.Add(migrationSeverityWitness(), key)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, archive, key string) { checkMigrationSeverityIsolation(t, w, archive, key) })
}
