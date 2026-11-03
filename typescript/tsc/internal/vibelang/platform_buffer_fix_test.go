package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// vibelang --fix writes platform-buffer-bytelength-fixed for
// platform-buffer-bytelength.fail, apart from the expectation line, and fixing
// the twin changes nothing.
func TestPlatformBufferByteLengthCase(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	cases := filepath.Join(root, "typescript/vibelang/cases")
	result := fixCase(t, copyCompilerFixture(t, filepath.Join(cases, "platform-buffer-bytelength.fail"), root))
	if len(result.Refused) != 0 || len(result.Files) != 1 {
		t.Fatalf("fix: %+v", result)
	}
	var got string
	for _, fixed := range result.Files {
		got = fixed.Text
	}
	want, err := os.ReadFile(filepath.Join(cases, "platform-buffer-bytelength-fixed/main.vibe"))
	if err != nil {
		t.Fatal(err)
	}
	body := func(text string) string {
		_, rest, _ := strings.Cut(text, "\n")
		return rest
	}
	if body(got) != body(string(want)) {
		t.Fatalf("--fix writes\n%s\nwant\n%s", got, want)
	}
	if again := fixCase(t, copyCompilerFixture(t, filepath.Join(cases, "platform-buffer-bytelength-fixed"), root)); len(again.Files) != 0 {
		t.Fatalf("fixing the twin again changes %v", again.Order)
	}
}

// A call the rewrite would change keeps Buffer and EK4402, and says why.
func TestPlatformBufferByteLengthFixLeaves(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]string{
		"bytes":          `export const f = (v: Uint8Array): number => Buffer.byteLength(v)`,
		"union":          `export const f = (v: string | Uint8Array): number => Buffer.byteLength(v)`,
		"any":            `export const f = (v: any): number => Buffer.byteLength(v)`,
		"encoding":       `export const f = (v: string): number => Buffer.byteLength(v, "hex")`,
		"named encoding": `export const f = (v: string, e: string): number => Buffer.byteLength(v, e)`,
		"spread":         `export const f = (v: [string]): number => Buffer.byteLength(...v)`,
		"none":           `export const f = (): number => Buffer.byteLength()`,
		"shadow":         `export const f = (v: string): number => { const TextEncoder = 1; return Buffer.byteLength(v) + TextEncoder }`,
		"comment":        `export const f = (v: string): number => Buffer.byteLength(v /* text */, "utf8")`,
		"optional":       `export const f = (v: string): number => Buffer.byteLength?.(v)`,
	} {
		t.Run(name, func(t *testing.T) {
			dir := copyCompilerFixture(t, filepath.Join(root, "typescript/vibelang/cases/platform-buffer-bytelength.fail"), root)
			if err := os.WriteFile(filepath.Join(dir, "main.vibe"), []byte("/// <reference path=\"./types-node/index.d.ts\" />\n"+body+"\n"), 0600); err != nil {
				t.Fatal(err)
			}
			fs := bundled.WrapFS(osvfs.FS())
			config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 {
				t.Fatalf("config: %v", errors)
			}
			result := FixProject(t.Context(), fs, bundled.LibPath(), config)
			for _, fixed := range result.Files {
				if strings.Contains(fixed.Text, "encode(") {
					t.Fatalf("--fix wrote TextEncoder:\n%s", fixed.Text)
				}
			}
		})
	}
}
