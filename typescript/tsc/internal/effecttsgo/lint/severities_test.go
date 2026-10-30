package lint

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/etscore"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/internal/rules"
)

func TestReleaseSeverityConfigPrecedence(t *testing.T) {
	base := &etscore.EffectPluginOptions{DiagnosticSeverity: map[string]etscore.Severity{"floatingEffect": etscore.SeverityError}, Overrides: []etscore.Override{{Include: []string{"**/*.vibe"}, Options: etscore.OverrideOptions{DiagnosticSeverity: map[string]etscore.Severity{"floatingEffect": etscore.SeverityOff}}}}}
	for _, severity := range []string{"error", "warning", "suggestion", "off"} {
		got := releaseSeverities(base, &core.VibeLangOptions{Severities: map[string]string{"EK3801": severity}})
		want := etscore.ParseSeverity(severity)
		if got.DiagnosticSeverity["floatingEffect"] != want || got.Overrides[0].Options.DiagnosticSeverity["floatingEffect"] != want {
			t.Fatalf("code severity lost to plugin override: %+v", got)
		}
	}
	if base.DiagnosticSeverity["floatingEffect"] != etscore.SeverityError || base.Overrides[0].Options.DiagnosticSeverity["floatingEffect"] != etscore.SeverityOff {
		t.Fatal("mutated shared config")
	}
}

func TestImportedLintCodeRegistryMatchesPin(t *testing.T) {
	if len(core.VibeImportedLintCodes) != len(rules.All) {
		t.Fatal("update the stable code table for the new pin")
	}
	for _, r := range rules.All {
		code, ok := importedRuleCodes[r.Name]
		if !ok || !core.VibeSeverityCode(fmt.Sprintf("EK%d", code)) {
			t.Fatalf("unregistered rule %s", r.Name)
		}
	}
	if importedRuleCodes["floatingEffect"] != 3801 || importedRuleCodes["abortControllerInEffect"] != 3802 {
		t.Fatal("stable assigned codes changed")
	}
}
