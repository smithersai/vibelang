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

// vibelang --fix removes the imports that D310 and D311 make redundant and
// writes M.M as M where a module's name names its export, keeping what the
// program means: a use the module's name cannot stand for keeps the key,
// and an import a JavaScript global would take the place of stays. A second
// run finds nothing to fix. The experimental services (D313) shorten the
// same way: Experimental.Process.Process.hostname() becomes
// Experimental.Process.hostname().
// In a project that emits declarations, vibelang --fix keeps what the
// declaration file writes as the TypeScript did (D501): an import of a
// module that an export mentions, spelled otherwise than the prelude's
// import, and a never written in an exported Effect type. What no export
// mentions shortens as without declarations.
func TestFixKeepsDeclarations(t *testing.T) {
	source := `import * as Schema from "effect/Schema"
import * as Console from "effect/Console"
import { Option } from "effect"

export const Value: Schema.Codec<unknown> = Schema.Unknown
export const update = (): Effect.Effect<void, never, never> => Effect.void
const quiet = (): Effect.Effect<void, never, never> => Console.log("x")
export const first = (value: Option.Option<number>): number => Option.getOrElse(value, () => 0)
export const run = () => quiet()
`
	want := `import * as Schema from "effect/Schema"

export const Value: Schema.Codec<unknown> = Schema.Unknown
export const update = (): void!never!never => Effect.void
const quiet = (): void!! => Console.log("x")
export const first = (value: Option<number>): number => Option.getOrElse(value, () => 0)
export const run = () => quiet()
`
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"declaration":true,"emitDeclarationOnly":true,"outDir":"out"},"files":["main.vibe"]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	result := FixProject(t.Context(), fs, bundled.LibPath(), config)
	fixed := result.Files[file.FileName()]
	if fixed == nil || fixed.Text != want || len(result.Refused) != 0 {
		got := ""
		if fixed != nil {
			got = fixed.Text
		}
		t.Fatalf("--fix wrote\n%s\nwant\n%s\nrefused %+v", got, want, result.Refused)
	}
}

// A kept namespace import keeps what the declaration file prints through it
// (D501): M.M stays M.M, and a service keeps the Context its base names,
// though no export's type in the source mentions the module.
func TestFixKeepsNamespaceImportsOfDeclarations(t *testing.T) {
	for _, source := range []string{
		`import * as Duration from "effect/Duration"

export interface Every {
  readonly every: Duration.Duration
}
`,
		`import * as Context from "effect/Context"

export interface Shape {
  readonly id: string
}

export service Svc: Shape {
  static readonly key = "t3/Svc"
}
`,
		`import * as Context from "effect/Context"

export interface Shape {
  readonly id: string
}

export class Svc extends Context.Service<Svc, Shape>()("t3/Svc") {}
`,
	} {
		_, file, _, _ := editorProgram(t, source)
		dir := filepath.Dir(file.FileName().AsString())
		if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"declaration":true,"noEmit":true}}`), 0o644); err != nil {
			t.Fatal(err)
		}
		fs := bundled.WrapFS(osvfs.FS())
		config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
		if len(errors) != 0 {
			t.Fatalf("config: %v", errors)
		}
		result := FixProject(t.Context(), fs, bundled.LibPath(), config)
		fixed := result.Files[file.FileName()]
		if fixed != nil {
			t.Errorf("--fix rewrote\n%s\nto\n%s", source, fixed.Text)
		}
	}
}

func TestFixPreludeRewrites(t *testing.T) {
	source := `import { FileSystem } from "effect/FileSystem"
import * as Path from "effect/Path"
import { HttpClient } from "effect/http"
import * as ChildProcess from "effect/process/ChildProcess"
import { Array as Arr, Option } from "effect"

export const read = (path: string) => FileSystem.readFileString(Path.Path.join(path, "a"))
export const key = FileSystem
export const first = (value: Option.Option<number>): number => Option.getOrElse(value, () => 0)
export const get = (url: string) => HttpClient.get(url)
export const command = ChildProcess.make("ls")
export const two = Arr.take([1, 2, 3], 2)
export function implementation() {
  return [FileSystem(), Path.Path()]
}
export const host = () => Experimental.Process.Process.hostname()
export const running = (process: Experimental.Process.Process, pid: number) => process.isRunning(pid)
`
	want := `import { Array as Arr } from "effect"

export const read = (path: string) => FileSystem.readFileString(Path.join(path, "a"))
export const key = FileSystem.FileSystem
export const first = (value: Option<number>): number => Option.getOrElse(value, () => 0)
export const get = (url: string) => HttpClient.get(url)
export const command = ChildProcess.make("ls")
export const two = Arr.take([1, 2, 3], 2)
export function implementation() {
  return [FileSystem(), Path()]
}
export const host = () => Experimental.Process.hostname()
export const running = (process: Experimental.Process, pid: number) => process.isRunning(pid)
`
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true},"files":["main.vibe"]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	result := FixProject(t.Context(), fs, bundled.LibPath(), config)
	fixed := result.Files[file.FileName()]
	if fixed == nil || fixed.Text != want || len(result.Refused) != 0 {
		got := ""
		if fixed != nil {
			got = fixed.Text
		}
		t.Fatalf("--fix wrote\n%s\nwant\n%s\nrefused %+v", got, want, result.Refused)
	}
	if fixed.Rewrites[preludeImportLabel] != 5 || fixed.Rewrites[preludeKeyLabel] != 5 {
		t.Errorf("rewrites %v; want 5 imports and 5 module exports", fixed.Rewrites)
	}
	var report strings.Builder
	result.Report(&report, func(name tspath.RootedFilePath) string { return filepath.Base(name.AsString()) })
	if !strings.Contains(report.String(), "main.vibe: 10 fixes (prelude import ×5, module export ×5)") {
		t.Errorf("report:\n%s", report.String())
	}
	if err := os.WriteFile(file.FileName().AsString(), []byte(want), 0o600); err != nil {
		t.Fatal(err)
	}
	if again := FixProject(t.Context(), fs, bundled.LibPath(), config); len(again.Order) != 0 {
		t.Errorf("a second --fix changed %v", again.Order)
	}
}
