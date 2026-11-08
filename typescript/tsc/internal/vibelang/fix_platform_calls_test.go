package vibelang

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

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

// The two t3code Desktop sites that compiled before VIP-33 checked host access
// inside Effect.try (00814e7d89bc) and drew EK4402 after it, with no fix:
// apps/desktop/src/electron/ElectronSafeStorage.vibe:83 and
// apps/desktop/src/preview/BrowserImport/SafariCookies.vibe:64. Each calls
// Buffer.from on a local inside Effect.try({ try }), and each catch builds an
// error of the file, so the wrapper cannot move whole.
var platformCallSites = map[string]string{
	"ElectronSafeStorage": `
export class DecryptError extends Error {
  constructor(readonly cause: unknown) { super("decrypt") }
}
const decrypt = (bytes: Buffer): string => bytes.toString("utf8")
export const decryptString = (value: Uint8Array) => Effect.try({
  try: () => decrypt(Buffer.from(value)),
  catch: (cause) => new DecryptError(cause),
})
`,
	"SafariCookies": `
export class ReadError extends Error {
  constructor(readonly path: string, readonly cause: unknown) { super("read " + path) }
}
const parse = (bytes: Buffer): string => bytes.toString("utf8")
export effect function readCookies(cookiePath: string, contents: Uint8Array) {
  return try Effect.try({
    try: () => parse(Buffer.from(contents)),
    catch: (cause) => new ReadError(cookiePath, cause),
  })
}
`,
}

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

func platformCallProblems(t *testing.T, dir string) []string {
	t.Helper()
	var errs []string
	for _, d := range platformCallProgram(t, dir).GetSemanticDiagnostics(t.Context(), nil) {
		if d.Category() == errorCategory || d.Code() == EK4402.Code {
			errs = append(errs, fmt.Sprintf("TS%d %s", d.Code(), d.String()))
		}
	}
	return errs
}
