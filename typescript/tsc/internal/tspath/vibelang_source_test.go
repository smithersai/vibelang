package tspath

import "testing"

// IsVibeLangSource is the one "is this VibeLang?" test (VIP-39): a .vibe or a
// .vibex source, never a declaration sidecar such as x.d.vibe.ts.
func TestIsVibeLangSource(t *testing.T) {
	t.Parallel()
	for _, row := range []struct {
		name      string
		extension string
	}{
		{"/a.vibe", ExtensionVibe},
		{"/a.vibex", ExtensionVibex},
		{"/src/App.vibex", ExtensionVibex},
		{"a.vibe", ExtensionVibe},
		{"/a.ts", ""},
		{"/a.tsx", ""},
		{"/a.d.ts", ""},
		{"/a.d.vibe.ts", ""},
		{"/a.d.vibex.ts", ""},
		{"/a.vibe.ts", ""},
		{"/a.vibexx", ""},
		{"/a.xvibe", ""},
		{"/vibe", ""},
		{"/a.VIBE", ""},
		{"", ""},
	} {
		if got := VibeLangSourceExtension(row.name); got != row.extension {
			t.Errorf("VibeLangSourceExtension(%q) = %q, want %q", row.name, got, row.extension)
		}
		if got, want := IsVibeLangSource(row.name), row.extension != ""; got != want {
			t.Errorf("IsVibeLangSource(%q) = %v, want %v", row.name, got, want)
		}
	}
}

// .vibex is a TypeScript implementation extension wherever .vibe is, and its
// declaration emits to .d.ts.
func TestVibexExtensionLists(t *testing.T) {
	t.Parallel()
	if !ExtensionIsTs(ExtensionVibex) {
		t.Error("ExtensionIsTs(.vibex) = false")
	}
	for name, list := range map[string][]string{
		"SupportedTSImplementationExtensions": SupportedTSImplementationExtensions,
		"SupportedTSExtensionsFlat":           SupportedTSExtensionsFlat,
		"SupportedTSExtensions[0]":            SupportedTSExtensions[0],
		"AllSupportedExtensions[0]":           AllSupportedExtensions[0],
	} {
		found := false
		for _, extension := range list {
			found = found || extension == ExtensionVibex
		}
		if !found {
			t.Errorf("%s lacks .vibex", name)
		}
	}
	if got := RemoveFileExtension("/src/App.vibex"); got != "/src/App" {
		t.Errorf("RemoveFileExtension(App.vibex) = %q", got)
	}
	if got := GetDeclarationEmitExtensionForPath("/src/App.vibex"); got != ExtensionDts {
		t.Errorf("GetDeclarationEmitExtensionForPath(App.vibex) = %q, want .d.ts", got)
	}
	if got := TryGetExtensionFromPath("/src/App.vibex"); got != ExtensionVibex {
		t.Errorf("TryGetExtensionFromPath(App.vibex) = %q, want .vibex", got)
	}
}
