package vibelang

import (
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const smithersPlatformNodeTypes = `export {}
declare global {
 var process: {
  readonly stdout: { write(chunk: unknown): boolean };
  exit(code: number): never;
  env: { [key: string]: string | undefined };
 };
}
`

func smithersPlatformCase(t *testing.T, source string) string {
	t.Helper()
	dir := platformCallCase(t, source)
	if strings.Contains(source, "./spy.js") {
		if err := os.WriteFile(filepath.Join(dir, "spy.ts"), []byte("export declare const vi: { spyOn<T, K extends keyof T>(value: T, key: K): void };"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "types-node/index.d.ts"), []byte(smithersPlatformNodeTypes), 0600); err != nil {
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
			dir := smithersPlatformCase(t, test.source)
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

const smithersRestoreWrapper = "export effect function restore(previous: string | undefined) { try sync((previous) => { if (previous === undefined) delete process.env.COMPLETE; else process.env.COMPLETE = previous }, previous) }"

func TestFixPlatformWrapperInputsAndOneCompanion(t *testing.T) {
	for _, options := range []FixOptions{{}, {MigrationOnly: true}} {
		for name, source := range map[string]string{
			"restore":     smithersRestoreWrapper,
			"two-inputs":  "export effect function restore(previous: string, other: string) { try sync((previous, other) => { process.env.COMPLETE = previous; process.env.SECOND = other }, previous, other) }",
			"spy-restore": "import { vi } from \"./spy.js\"; export effect function spy() { try sync(() => vi.spyOn(process.stdout, \"write\")) }; " + smithersRestoreWrapper,
			"mixed":       smithersRestoreWrapper + "; export const read = sync(() => process.env.COMPLETE); export const clear = sync(() => { delete process.env.COMPLETE });",
		} {
			t.Run(name+fmtOptions(options), func(t *testing.T) {
				var first map[string]string
				for attempt := 0; attempt < 2; attempt++ {
					dir := smithersPlatformCase(t, source)
					fs := bundled.WrapFS(osvfs.FS())
					beforeProgram := platformCallProgram(t, dir)
					for _, diagnostic := range beforeProgram.GetSemanticDiagnostics(t.Context(), nil) {
						if diagnostic.Category() == errorCategory && diagnostic.Code() != EK4402.Code {
							t.Fatalf("invalid pre-repair fixture: %s", diagnostic.String())
						}
					}
					sourceName := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "main.vibe")))
					beforeDeclaration := declarationsOf(t.Context(), beforeProgram, []tspath.RootedFilePath{sourceName})[sourceName]
					config := beforeProgram.CommandLine()
					result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, options)
					if result.Err != nil || len(result.Refused) != 0 || len(result.Files) != 2 {
						t.Fatalf("need one verified source+companion repair: %+v", result)
					}
					texts := map[string]string{}
					for path, fixed := range result.Files {
						base := filepath.Base(path.AsString())
						if base != "main.vibe" && base != "main.platform.ts" {
							t.Fatalf("unstable or extra output %s", base)
						}
						texts[base] = fixed.Text
						if err := os.WriteFile(path.AsString(), []byte(fixed.Text), 0600); err != nil {
							t.Fatal(err)
						}
					}
					if strings.Contains(texts["main.vibe"], "process.") {
						t.Fatalf("host access remains in source: %s", texts["main.vibe"])
					}
					if !strings.Contains(texts["main.platform.ts"], "previous") {
						t.Fatal("lost callback/input body")
					}
					if problems := platformCallProblems(t, dir); len(problems) != 0 {
						t.Fatalf("repaired code: %v", problems)
					}
					afterDeclaration := declarationsOf(t.Context(), platformCallProgram(t, dir), []tspath.RootedFilePath{sourceName})[sourceName]
					if beforeDeclaration == "" || beforeDeclaration != afterDeclaration {
						t.Fatalf("declarations changed: before=%s after=%s", beforeDeclaration, afterDeclaration)
					}
					again := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), platformCallProgram(t, dir).CommandLine(), options)
					if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
						t.Fatalf("not fixed point: %+v", again)
					}
					if attempt == 0 {
						first = texts
					} else if !reflect.DeepEqual(first, texts) {
						t.Fatalf("repeated fresh runs differ: first=%v second=%v", first, texts)
					}
				}
			})
		}
	}
}

func fmtOptions(options FixOptions) string {
	if options.MigrationOnly {
		return "/migration"
	}
	return "/ordinary"
}

func TestFixPlatformWrapperInputRuntime(t *testing.T) {
	source := strings.ReplaceAll(smithersRestoreWrapper, "COMPLETE", "VIBELANG_PLATFORM_RESTORE")
	dir := smithersPlatformCase(t, source)
	result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), platformCallProgram(t, dir).CommandLine(), FixOptions{MigrationOnly: true})
	if result.Err != nil || len(result.Refused) != 0 || len(result.Files) != 2 {
		t.Fatalf("repair: %+v", result)
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
import { Effect, Exit } from "effect";
const { restore } = await import("./main.js");
const key = "VIBELANG_PLATFORM_RESTORE";
let evaluated = 0;
function input() { evaluated++; return "captured"; }
process.env[key] = "before";
const program = restore(input());
if (evaluated !== 1 || process.env[key] !== "before") throw Error("wrong construction phase");
const first = await Effect.runPromiseExit(program);
if (!Exit.isSuccess(first) || process.env[key] !== "captured") throw Error("write lost value or Exit");
process.env[key] = "changed";
await Effect.runPromise(program);
if (evaluated !== 1 || process.env[key] !== "captured") throw Error("input reevaluated or write not repeatable");
const remove = restore(undefined);
if (process.env[key] !== "captured") throw Error("delete ran before Effect");
await Effect.runPromise(remove);
if (key in process.env) throw Error("delete became assignment");
console.log("phase inputs write delete Exit preserved");
`
	if err := os.WriteFile(filepath.Join(dir, "run.mjs"), []byte(script), 0600); err != nil {
		t.Fatal(err)
	}
	command := exec.CommandContext(t.Context(), "node", "run.mjs")
	command.Dir = dir
	out, err := command.CombinedOutput()
	if err != nil || !strings.Contains(string(out), "phase inputs write delete Exit preserved") {
		t.Fatalf("runtime: %v\n%s", err, out)
	}
}

func TestFixPlatformWrapperInputRefusals(t *testing.T) {
	for name, source := range map[string]string{
		"lexical-capture": "export effect function restore(previous: string) { try sync(() => { process.env.COMPLETE = previous }) }",
		"receiver":        "export class Restore { previous = 'old'; effect restore() { try sync(() => { process.env.COMPLETE = this.previous }) } }",
	} {
		t.Run(name, func(t *testing.T) {
			dir := smithersPlatformCase(t, source)
			result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), platformCallProgram(t, dir).CommandLine(), FixOptions{MigrationOnly: true})
			if result.Err != nil || len(result.Refused) == 0 {
				t.Fatalf("unsafe mutation must refuse: %+v", result)
			}
			for name := range result.Files {
				if strings.HasSuffix(name.AsString(), ".platform.ts") {
					t.Fatalf("unsafe repair created %s", name)
				}
			}
		})
	}
}

func TestFixPlatformOneCompanionVerified(t *testing.T) {
	dir := smithersPlatformCase(t, smithersRestoreWrapper+"; export const read = sync(() => process.env.COMPLETE); export const clear = sync(() => { delete process.env.COMPLETE });")
	result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), platformCallProgram(t, dir).CommandLine(), FixOptions{MigrationOnly: true, Verified: func(texts map[tspath.RootedFilePath]string) {
		for name, text := range texts {
			if err := os.WriteFile(name.AsString(), []byte(text), 0600); err != nil {
				t.Fatal(err)
			}
		}
	}})
	if result.Err != nil || len(result.Refused) != 0 || len(result.Files) != 2 {
		t.Fatalf("verified writes must share one owned new companion: %+v", result)
	}
	if problems := platformCallProblems(t, dir); len(problems) != 0 {
		t.Fatalf("verified result: %v", problems)
	}
}

// A marker on disk is not ownership: only this invocation's new overlay may append.
func TestFixPlatformExistingGeneratedCompanion(t *testing.T) {
	dir := smithersPlatformCase(t, smithersRestoreWrapper)
	foreign := filepath.Join(dir, "main.platform.ts")
	original := "// Generated platform helpers for this VibeLang module.\nexport const sentinel = 17;\n"
	if err := os.WriteFile(foreign, []byte(original), 0600); err != nil {
		t.Fatal(err)
	}
	result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), platformCallProgram(t, dir).CommandLine(), FixOptions{MigrationOnly: true})
	if result.Err != nil || len(result.Refused) == 0 || len(result.Files) != 0 {
		t.Fatalf("preexisting generated companion must refuse: %+v", result)
	}
	got, err := os.ReadFile(foreign)
	if err != nil || string(got) != original {
		t.Fatalf("existing file changed: %v %s", err, got)
	}
}
