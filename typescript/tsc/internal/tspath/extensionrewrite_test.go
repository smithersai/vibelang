package tspath_test

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"gotest.tools/v3/assert"
)

func TestRewriteExtension(t *testing.T) {
	t.Parallel()
	rewrites := []tspath.ExtensionRewrite{
		{Source: ".z", Target: ".js"},
		{Source: ".y.z", Target: ".mjs"},
	}

	rewritten, ok := tspath.ToModuleSpecifier("./Widget.y.z").RewriteExtension(rewrites, tspath.CaseSensitive)
	assert.Assert(t, ok)
	assert.Equal(t, rewritten, tspath.ToModuleSpecifier("./Widget.mjs"))

	rewritten, ok = tspath.ToModuleSpecifier("./Widget.Y.Z").RewriteExtension(rewrites, tspath.CaseInsensitive)
	assert.Assert(t, ok)
	assert.Equal(t, rewritten, tspath.ToModuleSpecifier("./Widget.mjs"))

	rewritten, ok = tspath.ToModuleSpecifier(".y").RewriteExtension(rewrites, tspath.CaseSensitive)
	assert.Assert(t, !ok)
	assert.Equal(t, rewritten, tspath.ToModuleSpecifier(".y"))

	rewrites = append(rewrites, tspath.ExtensionRewrite{Source: ".identity.y.z", Target: ".identity.y.z"})
	rewritten, ok = tspath.ToModuleSpecifier("./Widget.IDENTITY.Y.Z").RewriteExtension(rewrites, tspath.CaseInsensitive)
	assert.Assert(t, !ok)
	assert.Equal(t, rewritten, tspath.ToModuleSpecifier("./Widget.IDENTITY.Y.Z"))
	assert.Assert(t, !tspath.ToModuleSpecifier("./Widget.identity.y.z").ShouldRewriteExtension(rewrites, tspath.CaseSensitive))
}

func TestRootedFilePathRewriteExtension(t *testing.T) {
	t.Parallel()
	rewrites := []tspath.ExtensionRewrite{
		{Source: ".z", Target: ".js"},
		{Source: ".y.z", Target: ".mjs"},
		{Source: ".identity.y.z", Target: ".identity.y.z"},
	}
	for _, test := range []struct {
		path, expected  string
		caseSensitivity tspath.CaseSensitivity
		changed         bool
	}{
		{"/src/Widget.y.z", "/src/Widget.mjs", tspath.CaseSensitive, true},
		{"/src/Widget.Y.Z", "/src/Widget.mjs", tspath.CaseInsensitive, true},
		{"/src/Widget.Y.Z", "/src/Widget.Y.Z", tspath.CaseSensitive, false},
		{"/src/Widget.IDENTITY.Y.Z", "/src/Widget.IDENTITY.Y.Z", tspath.CaseInsensitive, false},
		{"/src/Widget.txt", "/src/Widget.txt", tspath.CaseSensitive, false},
	} {
		file := tspath.RootedFilePathFromNormalized(test.path)
		rewritten, changed := file.RewriteExtension(rewrites, test.caseSensitivity)
		assert.Equal(t, rewritten, tspath.RootedFilePathFromNormalized(test.expected))
		assert.Equal(t, changed, test.changed)
	}
}

func TestModuleSpecifierShouldRewriteExtension(t *testing.T) {
	t.Parallel()
	rewrites := []tspath.ExtensionRewrite{{Source: ".astro", Target: ".js"}}
	for _, test := range []struct {
		specifier string
		expected  bool
	}{
		{"./Card.astro", true},
		{"../Card.astro", true},
		{"./file.ts", true},
		{"./file.d.ts", false},
		{"./file.d.astro.ts", false},
		{"./file.js", false},
		{"package.astro", false},
		{"/Card.astro", false},
	} {
		assert.Equal(t, tspath.ToModuleSpecifier(test.specifier).ShouldRewriteExtension(rewrites, tspath.CaseSensitive), test.expected)
	}
}

// VIP-30: declarations preserve written TypeScript spelling in every config.
func TestModuleSpecifierRewriteVibeExtension(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		specifier, expected string
		changed             bool
	}{
		{"./lookup.vibe", "./lookup.ts", true},
		{"../errors/SmithersError.vibe", "../errors/SmithersError.ts", true},
		{"./a.b.vibe", "./a.b.ts", true},
		{"./dir/index.vibe", "./dir/index.ts", true},
		{"./view.vibex", "./view.tsx", true},
		{"../dir/view.vibex", "../dir/view.tsx", true},
		{"./file.ts", "./file.ts", false},
		{"./file.tsx", "./file.tsx", false},
		{"./file.mts", "./file.mts", false},
		{"./file.js", "./file.js", false},
		{"./file", "./file", false},
		{"package.vibe", "package.vibe", false},
		{"/root/file.vibe", "/root/file.vibe", false},
	} {
		rewritten, changed := tspath.ToModuleSpecifier(test.specifier).RewriteVibeExtension()
		assert.Equal(t, rewritten.AsString(), test.expected, test.specifier)
		assert.Equal(t, changed, test.changed, test.specifier)
	}
}

// 001-functions.md, Declaration output, Specifiers: "`./App.vibex` as
// `./App.tsx`; written `./user.js`, `./App.jsx`, `./user` and native
// `./plain.ts` keep their spelling."
func TestRewriteVibexExtension(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		in, want string
		changed  bool
	}{
		{"./App.vibex", "./App.tsx", true},
		{"../ui/App.vibex", "../ui/App.tsx", true},
		{"./nested/a.b.vibex", "./nested/a.b.tsx", true},
		{"./App.jsx", "./App.jsx", false},
		{"./App.js", "./App.js", false},
		{"./App", "./App", false},
		{"./plain.ts", "./plain.ts", false},
		{"./user.vibe", "./user.vibe", false},
		{"./App.d.vibex.ts", "./App.d.vibex.ts", false},
		{"pkg/App.vibex", "pkg/App.vibex", false},
		{"App.vibex", "App.vibex", false},
	} {
		got, changed := tspath.ToModuleSpecifier(tc.in).RewriteVibexExtension()
		assert.Equal(t, got.AsString(), tc.want, tc.in)
		assert.Equal(t, changed, tc.changed, tc.in)
	}
}
