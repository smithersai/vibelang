package tsoptions

import (
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/etscore"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"testing"
)

func TestEffectOptionsInvalidateSemanticDiagnostics(t *testing.T) {
	oldOptions := &core.CompilerOptions{Effect: &etscore.EffectPluginOptions{Diagnostics: true}}
	newOptions := &core.CompilerOptions{Effect: &etscore.EffectPluginOptions{Diagnostics: true}}
	if CompilerOptionsAffectSemanticDiagnostics(oldOptions, newOptions) {
		t.Fatal("equal Effect options must retain semantic diagnostics")
	}
	newOptions.Effect.Diagnostics = false
	if !CompilerOptionsAffectSemanticDiagnostics(oldOptions, newOptions) {
		t.Fatal("changed Effect options must invalidate semantic diagnostics")
	}
	if CompilerOptionsAffectSemanticDiagnostics(nil, nil) {
		t.Fatal("nil options must compare safely")
	}
	if !CompilerOptionsAffectSemanticDiagnostics(oldOptions, nil) {
		t.Fatal("removing options must invalidate semantic diagnostics")
	}
}
