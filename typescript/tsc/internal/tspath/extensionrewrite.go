package tspath

import "strings"

type ExtensionRewrite struct {
	Source string
	Target string
}

func getExtensionRewrite(path string, rewrites []ExtensionRewrite, caseSensitivity CaseSensitivity) (ExtensionRewrite, bool) {
	var best ExtensionRewrite
	equal := caseSensitivity.getEqualityComparer()
	for _, rewrite := range rewrites {
		if len(rewrite.Source) <= len(best.Source) || len(path) <= len(rewrite.Source) {
			continue
		}
		if equal(path[len(path)-len(rewrite.Source):], rewrite.Source) {
			best = rewrite
		}
	}
	return best, best.Source != ""
}

func (r ExtensionRewrite) isIdentity(caseSensitivity CaseSensitivity) bool {
	return caseSensitivity.getEqualityComparer()(r.Source, r.Target)
}

func (f RootedFilePath) GetExtensionRewrite(rewrites []ExtensionRewrite, caseSensitivity CaseSensitivity) (ExtensionRewrite, bool) {
	return getExtensionRewrite(f.AsString(), rewrites, caseSensitivity)
}

func (f RootedFilePath) RewriteExtension(rewrites []ExtensionRewrite, caseSensitivity CaseSensitivity) (RootedFilePath, bool) {
	rewrite, ok := f.GetExtensionRewrite(rewrites, caseSensitivity)
	if !ok || rewrite.isIdentity(caseSensitivity) {
		return f, false
	}
	suffix := f.AsString()[len(f.AsString())-len(rewrite.Source):]
	return f.RemoveExtension(suffix).AppendSuffix(rewrite.Target), true
}

func (s ModuleSpecifier) RewriteExtension(rewrites []ExtensionRewrite, caseSensitivity CaseSensitivity) (ModuleSpecifier, bool) {
	rewrite, ok := getExtensionRewrite(s.AsString(), rewrites, caseSensitivity)
	if !ok || rewrite.isIdentity(caseSensitivity) {
		return s, false
	}
	return ToModuleSpecifier(s.AsString()[:len(s.AsString())-len(rewrite.Source)] + rewrite.Target), true
}

func (s ModuleSpecifier) ShouldRewriteExtension(rewrites []ExtensionRewrite, caseSensitivity CaseSensitivity) bool {
	if !s.IsRelative() || IsDeclarationFileName(s.AsString()) {
		return false
	}
	if rewrite, ok := getExtensionRewrite(s.AsString(), rewrites, caseSensitivity); ok {
		return !rewrite.isIdentity(caseSensitivity)
	}
	return HasTSFileExtension(s.AsString())
}

// RewriteVibeExtension spells a relative source reference as its TypeScript
// twin does in a declaration. TypeScript preserves written source extensions;
// rewriteRelativeImportExtensions controls JavaScript, not declaration imports.
func (s ModuleSpecifier) RewriteVibeExtension() (ModuleSpecifier, bool) {
	if !s.IsRelative() {
		return s, false
	}
	for _, pair := range [][2]string{{ExtensionVibe, ExtensionTs}, {".vibex", ExtensionTsx}} {
		if FileExtensionIs(s.AsString(), pair[0]) {
			return ToModuleSpecifier(strings.TrimSuffix(s.AsString(), pair[0]) + pair[1]), true
		}
	}
	return s, false
}

// RewriteVibexExtension returns the specifier an ordinary declaration file
// uses for a relative import of a .vibex module, and whether it differs: its
// TypeScript twin's ./App.tsx, which stock tsc keeps in the twin's
// declarations (001-functions.md, Declaration output, Specifiers). TypeScript
// resolves ./App.tsx to the module's declaration, App.d.ts; a declaration has
// no .vibex sibling to resolve ./App.vibex to.
func (s ModuleSpecifier) RewriteVibexExtension() (ModuleSpecifier, bool) {
	if !s.IsRelative() || !FileExtensionIs(s.AsString(), ExtensionVibex) {
		return s, false
	}
	return ToModuleSpecifier(strings.TrimSuffix(s.AsString(), ExtensionVibex) + ExtensionTsx), true
}
