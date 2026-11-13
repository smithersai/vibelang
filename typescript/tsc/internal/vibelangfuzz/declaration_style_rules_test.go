package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const declarationStyleQuote = "root `vibelang.declarationImportStyle` and `compilerOptions.vibelang.declarationImportStyle` are ignored with nonfatal deprecation warning `EK3011` for every value, including invalid values"
const declarationWrittenSpecifierQuote = "written `./user.js`, `./App.jsx`, `./user` and native `./plain.ts` keep their spelling."

func TestDeclarationStyleRulesQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), declarationStyleQuote) {
		t.Fatal(declarationStyleQuote)
	}
	if !strings.Contains(SpecText("001-functions.md"), declarationWrittenSpecifierQuote) {
		t.Fatal(declarationWrittenSpecifierQuote)
	}
}

func FuzzDeclarationStyleRules(f *testing.F) {
	startShortBudget(f)
	rules := []struct {
		key   string
		style any
	}{
		{"default-sibling", nil}, {"style-js", ".js"},
		{"style-extensionless", "extensionless"}, {"style-ts", ".ts"},
		{"invalid-string", "bogus"}, {"invalid-number", 42},
		{"invalid-null", nil}, {"invalid-boolean", false},
		{"invalid-array", []any{}}, {"invalid-object", map[string]any{}},
	}
	for _, rule := range rules {
		f.Add(rule.key, uint8(0))
		f.Add(rule.key, uint8(128))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestDeclarationStyleRulesQuoted(t)
		i := slices.IndexFunc(rules, func(rule struct {
			key   string
			style any
		}) bool {
			return rule.key == key
		})
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(rules)
		}
		rule := rules[i]
		q := "\""
		if variant&1 != 0 {
			q = "'"
		}
		helper := []string{"helper", "file space", "sub/helper"}[int(variant>>1)%3]
		payload := []string{"number", "string", "number | string"}[int(variant>>3)%3]
		files := map[string]string{
			"main.vibe":    fmt.Sprintf("export type { Value } from %s./%s.ts%s;\nexport type { Payload } from %s./data.vibe%s;\n", q, helper, q, q, q),
			helper + ".ts": "export interface Value { n:" + payload + " }\n",
			"data.vibe":    "export interface Payload { n:number }\n",
		}
		var config map[string]any
		if err := json.Unmarshal([]byte(DefaultConfig), &config); err != nil {
			t.Fatal(err)
		}
		config["compilerOptions"].(map[string]any)["rewriteRelativeImportExtensions"] = true
		// VIP-30 says the key is ignored. Compare otherwise identical projects;
		// this oracle does not choose the compiler's default declaration ending.
		baselineConfig, err := json.Marshal(config)
		if err != nil {
			t.Fatal(err)
		}
		baseline, err := w.Compile(t.Context(), Project{Files: files, Config: string(baselineConfig)})
		if err != nil {
			t.Fatal(err)
		}
		defer baseline.Remove()
		if HasError(baseline.Diagnostics) {
			t.Fatalf("unconfigured control has errors: %v", baseline.Diagnostics)
		}
		if rule.key != "default-sibling" {
			if variant&128 != 0 {
				config["compilerOptions"].(map[string]any)["vibelang"] = map[string]any{"declarationImportStyle": rule.style}
			} else {
				config["vibelang"] = map[string]any{"declarationImportStyle": rule.style}
			}
		}
		text, err := json.Marshal(config)
		if err != nil {
			t.Fatal(err)
		}
		r, err := w.Compile(t.Context(), Project{Files: files, Config: string(text)})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var errors []string
		warnings := 0
		for _, d := range r.Diagnostics {
			if IsEK(d) && d.Code() == 3011 {
				if d.Category() != diagnostics.CategoryWarning {
					t.Fatalf("EK3011 must be a warning: %s", d.String())
				}
				warnings++
			}
			if d.Category() == diagnostics.CategoryError {
				errors = append(errors, d.String())
			}
		}
		wantWarnings := 1
		if rule.key == "default-sibling" {
			wantWarnings = 0
		}
		if warnings != wantWarnings {
			Gap(t, "FuzzDeclarationStyleRules", "warning:"+rule.key, "VIP-30: want %d EK3011 warnings, got %d", wantWarnings, warnings)
		}
		if len(errors) != 0 {
			Gap(t, "FuzzDeclarationStyleRules", "control:"+rule.key, "chapter 007 declaration style must be admitted: %v", errors)
			return
		}
		declaration, ok := r.Outputs["out/main.d.ts"]
		if !ok {
			t.Fatalf("no public declaration: %v", r.Outputs)
		}
		has := func(value string) bool {
			return strings.Contains(declaration, strconv.Quote(value)) || strings.Contains(declaration, "'"+value+"'")
		}
		if !has("./" + helper + ".ts") {
			Gap(t, "FuzzDeclarationStyleRules", "sibling:"+rule.key, "chapter 001 %q: %s", declarationWrittenSpecifierQuote, declaration)
		}
		if want, ok := baseline.Outputs["out/main.d.ts"]; !ok || declaration != want {
			Gap(t, "FuzzDeclarationStyleRules", "ignored:"+rule.key, "VIP-30 %q: configured declaration %q differs from unconfigured %q", declarationStyleQuote, declaration, want)
		}
		for _, kind := range []string{"control:", "sibling:", "ignored:", "warning:"} {
			ExpectPending(t, "FuzzDeclarationStyleRules", kind+rule.key)
		}
		ExpectPending(t, "FuzzDeclarationStyleRules", specCorpusKey(t))
	})
}
