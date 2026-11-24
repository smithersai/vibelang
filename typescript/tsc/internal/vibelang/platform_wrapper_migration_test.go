package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

const platformProcessTypes = `export {}
declare global {
 var process: {
  readonly stdout: { write(chunk: unknown): boolean };
  exit(code: number): never;
  env: { [key: string]: string | undefined };
 };
}
`

func platformProcessCase(t *testing.T, source string) string {
	t.Helper()
	dir := platformCallCase(t, source)
	if strings.Contains(source, "./spy.js") {
		if err := os.WriteFile(filepath.Join(dir, "spy.ts"), []byte("export declare const vi: { spyOn<T, K extends keyof T>(value: T, key: K): void };"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "types-node/index.d.ts"), []byte(platformProcessTypes), 0600); err != nil {
		t.Fatal(err)
	}
	return dir
}

// VIP-33 forbids the host access, but the retirement ruling keeps formerly
// accepted boundary callbacks as warnings until their preserving repair ships.
func TestLegacyWrappedPlatformMigrationWarning(t *testing.T) {
	cases := []struct {
		name, source string
		category     diagnostics.Category
	}{
		{"sync-read", "export effect function read() { return try sync(() => process.env.COMPLETE) }", warningCategory},
		{"sync-delete", "export effect function restore(previous: string | undefined) { try sync((previous) => { if (previous === undefined) delete process.env.COMPLETE; else process.env.COMPLETE = previous }, previous) }", warningCategory},
		{"try-read", "export const read = Effect.try(() => process.env.COMPLETE)", warningCategory},
		{"try-promise-read", "export const read = Effect.tryPromise(async () => process.env.COMPLETE)", warningCategory},
		{"outside", "export const read = process.env.COMPLETE", errorCategory},
		{"input-outside", "export effect function read() { return try sync((value) => value, process.env.COMPLETE) }", errorCategory},
		{"shadowed", "const sync = <A>(f: () => A): A => f(); export const read = sync(() => process.env.COMPLETE)", errorCategory},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			dir := platformProcessCase(t, test.source)
			seen := 0
			for _, d := range platformCallProgram(t, dir).GetSemanticDiagnostics(t.Context(), nil) {
				if d.Code() == EK4402.Code {
					seen++
					if d.Category() != test.category {
						t.Errorf("EK4402 category %v, want %v: %s", d.Category(), test.category, d.String())
					}
				}
			}
			if seen == 0 {
				t.Fatal("fixture must retain its platform diagnostic")
			}
		})
	}
}

// platformNodeTypes stands in for @types/node: Buffer.from's overloads and the
// Buffer type, which a .vibe file may name in a type.
const platformNodeTypes = `export {}
declare global {
  interface Buffer extends Uint8Array { toString(encoding?: string): string }
  var Buffer: {
    from(value: Uint8Array | ReadonlyArray<number>): Buffer
    from(value: string, encoding?: string): Buffer
  }
}
`

func platformCallCase(t *testing.T, body string) string {
	t.Helper()
	_, file, _, _ := editorProgram(t, "/// <reference path=\"./types-node/index.d.ts\" />\n"+body)
	dir := filepath.Dir(file.FileName().AsString())
	if err := os.MkdirAll(filepath.Join(dir, "types-node"), 0755); err != nil {
		t.Fatal(err)
	}
	for name, text := range map[string]string{"index.d.ts": platformNodeTypes, "package.json": `{"name":"@types/node","types":"index.d.ts"}`} {
		if err := os.WriteFile(filepath.Join(dir, "types-node", name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func platformCallProgram(t *testing.T, dir string) *compiler.Program {
	t.Helper()
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatal(errors)
	}
	return compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
}
