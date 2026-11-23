package core

import "testing"

func TestCompilerOptionsCloneAndEqualsVibeLang(t *testing.T) {
	orig := &CompilerOptions{
		VibeLang: &VibeLangOptions{
			VibeOnly:      true,
			EffectGlobals: TSFalse,
			Severities:    map[string]string{"EK4609": "off"},
		},
	}
	cloned := orig.Clone()
	if cloned.VibeLang == nil || !cloned.VibeLang.Equals(orig.VibeLang) {
		t.Fatalf("Clone dropped or changed VibeLang: got %+v, want %+v", cloned.VibeLang, orig.VibeLang)
	}
	if !orig.Equals(cloned) {
		t.Fatalf("Equals returned false for cloned options")
	}

	different := orig.Clone()
	different.VibeLang = &VibeLangOptions{
		VibeOnly:      true,
		EffectGlobals: TSFalse,
		Severities:    map[string]string{"EK4609": "error"},
	}
	if orig.Equals(different) {
		t.Fatalf("Equals ignored Severities difference")
	}
}
