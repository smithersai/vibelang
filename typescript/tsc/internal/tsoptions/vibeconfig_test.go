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
