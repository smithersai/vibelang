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

const declarationStyleQuote = "every other written specifier stays as written under every style"

func TestDeclarationStyleRulesQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), declarationStyleQuote) {
		t.Fatal(declarationStyleQuote)
	}
}

func FuzzDeclarationStyleRules(f *testing.F) {
	startShortBudget(f)
	rules := []struct{ key, style, suffix string }{
		{"default-sibling", "", ".js"},
		{"style-js", ".js", ".js"},
		{"style-extensionless", "extensionless", ""},
		{"style-ts", ".ts", ".ts"},
	}
	for _, rule := range rules {
		f.Add(rule.key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestDeclarationStyleRulesQuoted(t)
		i := slices.IndexFunc(rules, func(rule struct{ key, style, suffix string }) bool { return rule.key == key })
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
			"main.vibe":    fmt.Sprintf("export type { Value } from %s./%s.ts%s;\nexport type { Data } from %s./data.vibe%s;\n", q, helper, q, q, q),
			helper + ".ts": "export interface Value { n:" + payload + " }\n",
			"data.vibe":    "export interface Data { n:number }\n",
		}
		var config map[string]any
		if err := json.Unmarshal([]byte(DefaultConfig), &config); err != nil {
			t.Fatal(err)
		}
		config["compilerOptions"].(map[string]any)["rewriteRelativeImportExtensions"] = true
		if rule.style != "" {
			config["vibelang"] = map[string]any{"declarationImportStyle": rule.style}
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
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				errors = append(errors, d.String())
			}
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
			Gap(t, "FuzzDeclarationStyleRules", "sibling:"+rule.key, "chapter 007 %q: %s", declarationStyleQuote, declaration)
		}
		if !has("./data" + rule.suffix) {
			Gap(t, "FuzzDeclarationStyleRules", "vibe:"+rule.key, "approved .vibe spelling %s: %s", rule.suffix, declaration)
		}
		for _, kind := range []string{"control:", "sibling:", "vibe:"} {
			ExpectPending(t, "FuzzDeclarationStyleRules", kind+rule.key)
		}
		ExpectPending(t, "FuzzDeclarationStyleRules", specCorpusKey(t))
	})
}
