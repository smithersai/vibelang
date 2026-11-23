// VIP-30 nearest directory and first existing config.
// VIP-30 nearest directory and first existing config: docs/design/vips/0030-config-files.md#bb51c0a91e194b78
package tsoptions_test

import (
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
	"testing"
)

// Chapter 007 / nearest-directory config precedence: docs/design/src/007-tooling.md#08f671ebc135a31b
// Chapter 007 / nearest-directory config precedence: docs/design/src/007-tooling.md#e9ea081f2137ad5a
// Chapter 007 / nearest-directory config precedence: docs/design/src/007-tooling.md#c6d2a2b2adc66f19
// Chapter 007 / nearest-directory config precedence: docs/design/src/007-tooling.md#da8a3469f87d8049
func TestVibeConfigDiscovery(t *testing.T) {
	for _, test := range []struct {
		name  string
		files map[string]string
		want  string
	}{
		{"vibe first", map[string]string{"/app/vibe.config.json": "{}", "/app/tsconfig.json": "{}", "/app/jsconfig.json": "{}"}, "/app/vibe.config.json"},
		{"typescript second", map[string]string{"/app/tsconfig.json": "{}", "/app/jsconfig.json": "{}"}, "/app/tsconfig.json"},
		{"javascript fallback", map[string]string{"/app/jsconfig.json": "{}"}, "/app/jsconfig.json"},
		{"nearest directory first", map[string]string{"/vibe.config.json": "{}", "/app/jsconfig.json": "{}"}, "/app/jsconfig.json"},
		{"none", map[string]string{}, ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			fs := vfstest.FromMap(test.files, tspath.CaseSensitive)
			got := tsoptions.FindConfigFile("/app/src", fs.FileExists)
			if got.AsString() != test.want {
				t.Fatalf("got %q; want %q", got, test.want)
			}
		})
	}
}

// Chapter 007, "Config files": a directory in `references` names its project
// as -p <dir> does, so a program that follows the reference finds vibe.config.json.
func TestProjectReferenceDirectoryFollowsConfigPrecedence(t *testing.T) {
	for _, test := range []struct {
		name  string
		files map[string]string
		ref   string
		want  string
	}{
		{"vibe first", map[string]string{"/lib/vibe.config.json": "{}", "/lib/tsconfig.json": "{}", "/lib/jsconfig.json": "{}"}, "../lib", "/lib/vibe.config.json"},
		{"typescript second", map[string]string{"/lib/tsconfig.json": "{}", "/lib/jsconfig.json": "{}"}, "../lib", "/lib/tsconfig.json"},
		{"javascript fallback", map[string]string{"/lib/jsconfig.json": "{}"}, "../lib", "/lib/jsconfig.json"},
		{"none", map[string]string{}, "../lib", "/lib/tsconfig.json"},
		{"named file", map[string]string{"/lib/vibe.config.json": "{}", "/lib/tsconfig.json": "{}"}, "../lib/tsconfig.json", "/lib/tsconfig.json"},
	} {
		t.Run(test.name, func(t *testing.T) {
			test.files["/app/vibe.config.json"] = `{ "files": [], "references": [{ "path": "` + test.ref + `" }] }`
			fs := vfstest.FromMap(test.files, tspath.CaseSensitive)
			parsed, _ := tsoptions.GetParsedCommandLineOfConfigFile("/app/vibe.config.json", nil, nil, fs, nil)
			got := parsed.ResolvedProjectReferencePaths()
			if len(got) != 1 || got[0].AsString() != test.want {
				t.Fatalf("got %q; want %q", got, test.want)
			}
			if original := parsed.ProjectReferences()[0].OriginalPath; original != test.ref {
				t.Fatalf("original path %q; want %q", original, test.ref)
			}
		})
	}
}
