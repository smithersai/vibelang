package vibelang

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
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

func platformCallErrors(t *testing.T, dir string) []string {
	t.Helper()
	var errs []string
	for _, d := range platformCallProgram(t, dir).GetSemanticDiagnostics(t.Context(), nil) {
		if d.Category() == errorCategory {
			errs = append(errs, fmt.Sprintf("TS%d %s", d.Code(), d.String()))
		}
	}
	return errs
}

func TestFixPlatformCallInCapturingWrapper(t *testing.T) {
	for site, body := range platformCallSites {
		for _, vipOnly := range []bool{false, true} {
			mode := "--fix"
			if vipOnly {
				mode = "--fix-vip-only"
			}
			t.Run(site+" "+mode, func(t *testing.T) {
				dir := platformCallCase(t, body)
				if errs := platformCallErrors(t, dir); len(errs) != 1 || !strings.HasPrefix(errs[0], "TS4402 Buffer.from") {
					t.Fatalf("fixture should draw exactly the EK4402 on Buffer.from: %v", errs)
				}
				fs := bundled.WrapFS(osvfs.FS())
				config, _ := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
				result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{VIPOnly: vipOnly})
				if result.Err != nil || len(result.Refused) != 0 || len(result.Files) != 2 {
					t.Fatalf("expected a verified two-file split: %+v", result)
				}
				var helper string
				for name, fixed := range result.Files {
					if strings.HasSuffix(name.AsString(), "main.vibe") {
						if strings.Contains(fixed.Text, "Buffer.from") || !strings.Contains(fixed.Text, "Effect.try({") || !strings.Contains(fixed.Text, "catch: (cause) =>") {
							t.Fatalf("the wrapper should stay and only Buffer.from move:\n%s", fixed.Text)
						}
					} else {
						helper = fixed.Text
					}
					if err := os.WriteFile(name.AsString(), []byte(fixed.Text), 0600); err != nil {
						t.Fatal(err)
					}
				}
				if !strings.Contains(helper, "return Buffer.from(arg0);") {
					t.Fatalf("helper:\n%s", helper)
				}
				if errs := platformCallErrors(t, dir); len(errs) != 0 {
					t.Fatalf("fixed program: %v", errs)
				}
				if again := fixCase(t, dir); again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
					t.Fatalf("not a fixed point: %+v", again)
				}
			})
		}
	}
}

// t3code Desktop is a composite project with include ["src"]: a composite
// project must list every file, so the gate's program reported TS6307 for the
// new sibling and the split was refused, though tsc lists it once written.
func TestFixPlatformCallInCompositeProject(t *testing.T) {
	dir := platformCallCase(t, platformCallSites["SafariCookies"])
	// A second module splits after the first: its trial's overlay holds the
	// first new file, which the keeper has already written (FixOptions.Verified).
	second := "/// <reference path=\"./types-node/index.d.ts\" />\n" + platformCallSites["ElectronSafeStorage"]
	if err := os.WriteFile(filepath.Join(dir, "second.vibe"), []byte(second), 0600); err != nil {
		t.Fatal(err)
	}
	config := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"composite":true,"emitDeclarationOnly":true,"outDir":"out"},"include":["*.vibe","*.ts","types-node"]}`
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(config), 0600); err != nil {
		t.Fatal(err)
	}
	if errs := platformCallErrors(t, dir); len(errs) != 2 || !strings.HasPrefix(errs[0], "TS4402 Buffer.from") || !strings.HasPrefix(errs[1], "TS4402 Buffer.from") {
		t.Fatalf("fixture should draw exactly two EK4402 on Buffer.from: %v", errs)
	}
	fs := bundled.WrapFS(osvfs.FS())
	parsed, _ := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), parsed, FixOptions{Verified: func(texts map[tspath.RootedFilePath]string) {
		for name, text := range texts {
			if err := os.WriteFile(name.AsString(), []byte(text), 0600); err != nil {
				t.Fatal(err)
			}
		}
	}})
	if result.Err != nil || len(result.Refused) != 0 || len(result.Files) != 4 {
		t.Fatalf("expected two verified two-file splits: %+v", result)
	}
	for name, fixed := range result.Files {
		if err := os.WriteFile(name.AsString(), []byte(fixed.Text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if errs := platformCallErrors(t, dir); len(errs) != 0 {
		t.Fatalf("fixed program: %v", errs)
	}
}

// --only writes no file it does not list, so the split, which creates one, is
// refused for that site with the reason, and the run goes on (t3code Desktop
// proof: `--fix --only` stopped the whole run with "wrote nothing").
func TestFixPlatformCallUnderOnly(t *testing.T) {
	dir := platformCallCase(t, platformCallSites["ElectronSafeStorage"])
	fs := bundled.WrapFS(osvfs.FS())
	config, _ := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	main := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "main.vibe")))
	result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{Only: []tspath.RootedFilePath{main}})
	if result.Err != nil || len(result.Files) != 0 {
		t.Fatalf("expected no file and no error: %+v", result)
	}
	refused := false
	for _, r := range result.Refused {
		refused = refused || strings.Contains(r.Error, "--only does not list")
	}
	if !refused {
		t.Fatalf("expected the --only refusal: %+v", result.Refused)
	}
}

// The split keeps what the program does: Buffer.from runs only when the
// Effect runs, on the same bytes, and a throw from it is still the catch's.
func TestFixPlatformCallKeepsBehaviour(t *testing.T) {
	dir := platformCallCase(t, platformCallSites["ElectronSafeStorage"])
	result := fixCase(t, dir)
	if result.Err != nil || len(result.Files) != 2 {
		t.Fatalf("fix: %+v", result)
	}
	for name, fixed := range result.Files {
		if err := os.WriteFile(name.AsString(), []byte(fixed.Text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	p := platformCallProgram(t, dir)
	p.Emit(t.Context(), compiler.EmitOptions{ForceEmit: true, EmitOnly: compiler.EmitOnlyJs, WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
		return os.WriteFile(name.AsString(), []byte(text), 0600)
	}})
	script := `
import { Effect } from "effect";
const real = Buffer.from;
let calls = 0;
Buffer.from = function (...args) { calls++; return real.apply(this, args); };
const { decryptString } = await import("./main.js");
const program = decryptString(new Uint8Array([104, 105]));
if (calls !== 0) throw Error("Buffer.from ran while building the Effect");
const value = await Effect.runPromise(program);
if (value !== "hi" || calls !== 1) throw Error("wrong value " + value + " after " + calls + " calls");
Buffer.from = () => { throw new Error("boom"); };
const { DecryptError } = await import("./main.js");
const failure = await Effect.runPromise(Effect.flip(decryptString(new Uint8Array([1]))));
if (!(failure instanceof DecryptError) || failure.cause?.message !== "boom") throw Error("throw did not reach catch: " + String(failure));
console.log("same behaviour");
`
	if err := os.WriteFile(filepath.Join(dir, "run.mjs"), []byte(script), 0600); err != nil {
		t.Fatal(err)
	}
	command := exec.CommandContext(t.Context(), "node", "run.mjs")
	command.Dir = dir
	output, err := command.CombinedOutput()
	if err != nil || !strings.Contains(string(output), "same behaviour") {
		t.Fatalf("runtime: %v\n%s", err, output)
	}
}
