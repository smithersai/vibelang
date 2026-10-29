package core

import (
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/etscore"
	"testing"
)

func TestEffectCompilerOptionCloningAndEquality(t *testing.T) {
	options := &CompilerOptions{Effect: &etscore.EffectPluginOptions{Diagnostics: true}}
	cloned := options.Clone()
	if cloned == options || cloned.Effect != options.Effect {
		t.Fatal("shallow clone must retain Effect options")
	}
	if !options.Equals(cloned) {
		t.Fatal("cloned options must be equal")
	}
	equivalent := &CompilerOptions{Effect: &etscore.EffectPluginOptions{Diagnostics: true}}
	if !options.Equals(equivalent) {
		t.Fatal("Effect options must compare by value")
	}
	equivalent.Effect.Diagnostics = false
	if options.Equals(equivalent) {
		t.Fatal("changed Effect options must invalidate equality")
	}
}
