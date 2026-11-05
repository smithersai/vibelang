package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const importedLintTarget = "FuzzImportedLintEligibility"

var importedLintForms = []string{"module", "plain", "effect", "block", "parenthesized-block", "assigned", "void", "arrow", "subtype", "declaration", "directive", "do"}
var importedLintModes = []string{"default", "plugin-warning", "file-off", "modern-error", "modern-warning", "modern-suggestion", "modern-off", "modern-only", "plugin-disabled", "plugin-null"}

func TestImportedLintEligibilityQuoted(t *testing.T) {
	for _, quote := range []string{
		"A `vibe.severities` entry never re-enables disabled diagnostics.",
		"They run on selected `.ts` and `.vibe` inputs, keeping the pinned upstream rule/file eligibility and declaration/library exclusions.",
		"Once enabled, severity resolves from `vibe.severities`, then the repository's Effect language-service configuration, then the rule's default",
		"An `effect { … }` expression statement builds and discards an unrun Effect; imported `floatingEffect` reports it as `EK3801`, as in TypeScript.",
	} {
		if !strings.Contains(SpecText("007-tooling.md"), quote) {
			t.Fatalf("chapter 7 no longer says %q", quote)
		}
	}
}

// Mutate the source context, root/subpath import, parentheses, and severity
// precedence. Count exact imported identities/categories on mixed inputs; the
// .ts file is a positive control, never the source of the oracle.
func FuzzImportedLintEligibility(f *testing.F) {
	startShortBudget(f)
	for _, form := range importedLintForms {
		f.Add(form, "default", byte(0))
	}
	for _, mode := range importedLintModes[1:] {
		f.Add("block", mode, byte(1))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, form, mode string, variant byte) {
		TestImportedLintEligibilityQuoted(t)
		selectKey := func(value string, choices []string) string {
			if slices.Contains(choices, value) {
				return value
			}
			if value == "" {
				return choices[0]
			}
			return choices[int(value[0])%len(choices)]
		}
		form, mode = selectKey(form, importedLintForms), selectKey(mode, importedLintModes)
		prelude := "import { Effect as E } from \"effect\";\n"
		if variant&1 != 0 {
			prelude = "import * as E from \"effect/Effect\";\n"
		}
		expr := "E.succeed(1)"
		if variant&2 != 0 {
			expr = "(" + expr + ")"
		}
		source, count := expr+";", 1
		switch form {
		case "plain":
			source = "export function example() { " + source + " }"
		case "effect":
			source = "export effect function example(_input: number) { " + source + " }"
		case "block":
			source = "export effect function example(_input: number) { " + source + " effect { return 99 }; }"
			count = 2
		case "parenthesized-block":
			source = "(effect { return 99 });"
		case "assigned":
			source = "export const task = " + expr + ";"
			count = 0
		case "void":
			source = "void (" + expr + ");"
			count = 0
		case "arrow":
			source = "const task = effect () => 1; task;"
			count = 0
		case "subtype":
			source = "import { Option } from \"effect\"; Option.some(1);"
			count = 0
		case "do":
			source = "export const task = do { " + expr + " };"
			count = 0
		case "directive":
			source = "// @effect-diagnostics-next-line floatingEffect:off\n" + source
			count = 0
		case "declaration":
			source = "export declare const task: E.Effect<number>;"
			count = 0
		}
		plugin := map[string]any{"name": "@effect/language-service", "diagnosticSeverity": map[string]string{"floatingEffect": "error"}}
		modern := map[string]string{}
		category := "error"
		switch mode {
		case "plugin-warning":
			plugin["diagnosticSeverity"] = map[string]string{"floatingEffect": "warning"}
			category = "warning"
		case "file-off":
			plugin["overrides"] = []any{map[string]any{"include": []string{"**/*.vibe"}, "options": map[string]any{"diagnosticSeverity": map[string]string{"floatingEffect": "off"}}}}
		case "plugin-disabled":
			plugin["diagnostics"] = false
			modern["EK3801"] = "error"
		case "plugin-null":
			plugin["diagnosticSeverity"] = nil
			modern["EK3801"] = "error"
		case "modern-only":
			category = "warning"
			modern["EK3801"] = category
		case "modern-error", "modern-warning", "modern-suggestion", "modern-off":
			category = strings.TrimPrefix(mode, "modern-")
			modern["EK3801"] = category
			plugin["diagnosticSeverity"] = map[string]string{"floatingEffect": "off"}
			plugin["overrides"] = []any{map[string]any{"include": []string{"**/*.vibe"}, "options": map[string]any{"diagnosticSeverity": map[string]string{"floatingEffect": "off"}}}}
		}
		// A rule already disabled by configuration needs no inline suppression.
		// Keep this witness about floatingEffect rather than the independent
		// upstream unused-directive diagnostic.
		if form == "directive" && (mode == "file-off" || category == "off") {
			source = expr + ";"
		}
		plugins := []any{plugin}
		if mode == "modern-only" {
			plugins = []any{}
		}
		config, _ := json.Marshal(map[string]any{
			"compilerOptions": map[string]any{"target": "ES2022", "module": "NodeNext", "strict": true, "skipLibCheck": true, "types": []string{}, "noEmit": true, "plugins": plugins},
			"vibe":            map[string]any{"effectGlobals": false, "effectModules": false, "severities": modern},
		})
		name := "main.vibe"
		if form == "declaration" {
			name = "main.d.vibe.ts"
		}
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{name: prelude + source, "native.ts": prelude + expr + ";"}, Config: string(config)})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		wantVibe, wantTS := count, 1
		if category == "off" || mode == "plugin-disabled" || mode == "plugin-null" {
			wantVibe, wantTS = 0, 0
		}
		if mode == "file-off" {
			wantVibe = 0
		}
		// Suggestions have their own compiler API; semantic diagnostics omit
		// them. Read the imported category from that API, as the LSP does.
		if category == "suggestion" && r.Program != nil {
			for _, file := range r.Program.GetSourceFiles() {
				base := filepath.Base(file.FileName().AsString())
				if base != name && base != "native.ts" {
					continue
				}
				for _, d := range r.Program.GetSuggestionDiagnostics(t.Context(), file) {
					if IsEK(d) && d.Code() == 3801 {
						r.Diagnostics = append(r.Diagnostics, d)
					}
				}
			}
		}
		got := map[string]int{}
		migrationWarnings := 0
		for _, d := range r.Diagnostics {
			if mode == "modern-only" && IsEK(d) && d.Code() == 3012 && d.Category().Name() == "warning" {
				migrationWarnings++
				continue
			}
			if !IsEK(d) || d.Code() != 3801 || d.Category().Name() != category || !strings.HasPrefix(d.MessageText(), "floatingEffect:") {
				Gap(t, importedLintTarget, fmt.Sprintf("%s/%s:diagnostic:%s%d", form, mode, d.Source(), d.Code()), "VIP-38 selected inputs: unexpected diagnostic: %s", d.String())
			}
			got[filepath.Base(d.File().FileName().AsString())]++
		}
		if mode == "modern-only" && migrationWarnings != 1 {
			t.Fatalf("severity-key activation must report one EK3012 warning, got %d", migrationWarnings)
		}
		key := fmt.Sprintf("%s/%s", form, mode)
		if got[name] != wantVibe || got["native.ts"] != wantTS {
			Gap(t, importedLintTarget, key, "VIP-38 selected inputs: want Vibe=%d TS=%d at %s; got %v\n%s", wantVibe, wantTS, category, got, source)
		}
		ExpectPending(t, importedLintTarget, key)
		ExpectPending(t, importedLintTarget, specCorpusKey(t))
	})
}
