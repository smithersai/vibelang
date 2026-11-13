package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

const platformContextualRow = "interim warning inside formerly accepted boundary callbacks; error otherwise:"
const platformContextualQuote = "The restriction and preserving repair still apply; unwrapped host access and Node value imports remain errors."

func TestPlatformContextualSeverityQuoted(t *testing.T) {
	appendix := SpecText(grammarAppendix)
	if !strings.Contains(appendix, "a forbidden punctuator follows a throw expression") {
		t.Fatal("missing VIP-41 punctuation rule")
	}
	if !strings.Contains(appendix, defaultCategoryQuote) {
		t.Fatalf("Appendix B no longer says %q", defaultCategoryQuote)
	}
	// This followup also runs on the published predecessor. The registry row
	// selects the policy; no compiler helper or diagnostic selects its oracle.
	if strings.HasPrefix(Facts().Rows[4402].Reports, platformContextualRow) &&
		!strings.Contains(SpecText("005-services.md"), platformContextualQuote) {
		t.Fatalf("Services no longer says %q", platformContextualQuote)
	}
}

func TestPlatformContextualRegistryCategories(t *testing.T) {
	TestPlatformContextualSeverityQuoted(t)
	contextual := strings.HasPrefix(Facts().Rows[4402].Reports, platformContextualRow)
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/project/main.vibe", PathKey: "/project/main.vibe"}, "x", core.ScriptKindTS)
	for _, category := range []diagnostics.Category{diagnostics.CategoryError, diagnostics.CategoryWarning, diagnostics.CategorySuggestion, diagnostics.CategoryMessage} {
		d := ast.NewExternalDiagnostic(file, core.NewTextRange(0, 1), "EK", category, 4402, "platform category witness")
		gaps := &Gaps{}
		CheckDiagnostics(gaps, "/project", []*ast.Diagnostic{d}, true)
		valid := category == diagnostics.CategoryError || contextual && category == diagnostics.CategoryWarning
		if gaps.Any() == valid {
			t.Errorf("category %s: valid=%t gaps=%v", category.Name(), valid, gaps.found)
		}
	}
	if Facts().IsAdjustable(4402) {
		t.Error("contextual compatibility warning must not make host errors configurable")
	}
	for _, severity := range Facts().Severities {
		if len(settingProblems(map[string]any{"severities": map[string]any{"EK4402": severity}})) != 1 {
			t.Errorf("EK4402=%s must remain invalid configuration", severity)
		}
	}
}

var platformSeverityCases = []struct {
	key, source      string
	boundary, absent bool
}{
	{"unwrapped", "export const value = process.env.NAME", false, false},
	{"sync", "export const value = sync(() => process.env.NAME)", true, false},
	{"callback", "export const value = callback(() => { const name = process.env.NAME })", true, false},
	{"try", "export const value = Effect.try(() => process.env.NAME)", true, false},
	{"try-options", "export const value = Effect.try({try: () => process.env.NAME, catch: () => 0})", true, false},
	{"try-promise", "export const value = Effect.tryPromise(() => Promise.resolve(process.env.NAME))", true, false},
	{"input", "export const value = sync((name: string | undefined) => name, process.env.NAME)", false, false},
	{"shadow-host", "const process = {env: {NAME: 7}}; export const value = sync(() => process.env.NAME)", false, true},
	{"node-import", "import * as fs from 'node:fs'; export const value = fs", false, false},
}

func FuzzPlatformContextualSeverity(f *testing.F) {
	startShortBudget(f)
	for _, tc := range platformSeverityCases {
		f.Add(tc.key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestPlatformContextualSeverityQuoted(t)
		choice := int(variant) % len(platformSeverityCases)
		for i, tc := range platformSeverityCases {
			if key == tc.key {
				choice = i
				break
			}
		}
		tc := platformSeverityCases[choice]
		source := tc.source
		if variant&1 != 0 {
			source = "// retained offset\n" + source
		}
		if variant&2 != 0 {
			source = strings.ReplaceAll(source, "process.env.NAME", "process.env['NAME']")
		}
		files := map[string]string{
			"main.vibe":               "/// <reference path=\"./types-node/index.d.ts\" />\n" + source,
			"package.json":            "{\"name\":\"platform-severity\",\"type\":\"module\"}",
			"types-node/package.json": "{\"name\":\"@types/node\",\"types\":\"index.d.ts\"}",
			"types-node/index.d.ts":   "export {}; declare global { var process: {env: {[key:string]: string | undefined}} }",
		}
		result := toolsCompile(t, w, "FuzzPlatformContextualSeverity", files)
		defer result.Remove()
		want := diagnostics.CategoryError
		if tc.boundary && strings.HasPrefix(Facts().Rows[4402].Reports, platformContextualRow) {
			want = diagnostics.CategoryWarning
		}
		found := 0
		for _, d := range result.Diagnostics {
			if !IsEK(d) || d.Code() != 4402 {
				continue
			}
			found++
			if d.Category() != want {
				Gap(t, "FuzzPlatformContextualSeverity", "category:"+tc.key, "Appendix B and Services require %s, got %s", want.Name(), d.Category().Name())
			}
			gaps := &Gaps{}
			CheckDiagnostics(gaps, result.Dir, []*ast.Diagnostic{d}, true)
			if gaps.Any() {
				Gap(t, "FuzzPlatformContextualSeverity", "registry:"+tc.key, "registry rejected contextual category: %v", gaps.found)
			}
		}
		count := 1
		if tc.absent {
			count = 0
		}
		if found != count {
			Gap(t, "FuzzPlatformContextualSeverity", "presence:"+tc.key, "expected %d EK4402 diagnostics, got %d (%s)", count, found, fmt.Sprint(result.Diagnostics))
		}
	})
}

// Keep both reported FuzzCompile witnesses even when the short sampler moves.
func TestCompilePlatformContextualCases(t *testing.T) {
	w := NewWorkspace(t)
	found := 0
	for _, seed := range CaseSeeds() {
		if seed.Name != "platform-stdlib-wrapper-arrows.fail" && seed.Name != "vip4-coverage-platform-warning" {
			continue
		}
		found++
		t.Run(seed.Name, func(t *testing.T) { CheckCompile(t, w, "FuzzCompile", Archive(seed.Files)) })
	}
	if found != 2 {
		t.Fatalf("expected both reported platform cases, found %d", found)
	}
}

func FuzzExplicitDiagnosticCategoryVariants(f *testing.F) {
	startShortBudget(f)
	for _, code := range []int32{1010, 4402} {
		for variant := uint8(0); variant < 4; variant++ {
			f.Add(code, variant)
		}
	}
	f.Fuzz(func(t *testing.T, raw int32, variant uint8) {
		code := int32(1010)
		if raw == 4402 {
			code = 4402
		}
		row := Facts().Rows[code].Reports
		variants := strings.Contains(row, "Category variants: `error`, `warning`.")
		if code == 4402 && !variants {
			t.Fatal("Appendix B no longer lists both host context categories")
		}
		if code == 1010 && (variants || !strings.Contains(row, "a forbidden punctuator follows a throw expression")) {
			t.Fatal("VIP-41 throw punctuation must retain its fixed error category")
		}
		categories := []diagnostics.Category{diagnostics.CategoryError, diagnostics.CategoryWarning, diagnostics.CategorySuggestion, diagnostics.CategoryMessage}
		category := categories[variant%uint8(len(categories))]
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/project/main.vibe", PathKey: "/project/main.vibe"}, "x", core.ScriptKindTS)
		d := ast.NewExternalDiagnostic(file, core.NewTextRange(0, 1), "EK", category, code, "explicit category-variant witness")
		gaps := &Gaps{}
		CheckDiagnostics(gaps, "/project", []*ast.Diagnostic{d}, true)
		valid := category == diagnostics.CategoryError || variants && category == diagnostics.CategoryWarning
		if gaps.Any() == valid {
			t.Fatalf("EK%d category %s: valid=%t gaps=%v", code, category.Name(), valid, gaps.found)
		}
		if Facts().IsAdjustable(code) {
			t.Fatalf("EK%d contextual category became configurable", code)
		}
		for _, severity := range Facts().Severities {
			if len(settingProblems(map[string]any{"severities": map[string]any{fmt.Sprintf("EK%04d", code): severity}})) != 1 {
				t.Fatalf("EK%d=%s must remain an invalid override", code, severity)
			}
		}
	})
}
