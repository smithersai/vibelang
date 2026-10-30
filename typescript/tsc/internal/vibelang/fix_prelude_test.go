package vibelang

import (
	"fmt"
	"os"
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
import { Option } from "effect"

export const Value: Schema.Codec<unknown> = Schema.Unknown
export const update = (): void!never!never => Effect.void
const quiet = (): void!! => Console.log("x")
export const first = (value: Option.Option<number>): number => Option.getOrElse(value, () => 0)
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

// EK4837's fix writes schema error, keeping the Schema, the tag and the
// accessors (D279), and names a codec with no type form by a constant. What a
// declaration cannot write keeps the class.
func TestFixSchemaErrorClasses(t *testing.T) {
	source := `import * as Schema from "effect/Schema"

export class Plain extends Schema.TaggedError<Plain>()("Plain", {
  message: Schema.String,
}) {}

export class Failed extends Schema.TaggedError<Failed>()("Failed", {
  reason: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.reason
  }
}

export class Keyed extends Schema.TaggedError<Keyed>()("Keyed", {
  note: Schema.optionalKey(Schema.String),
}) {}

export class Annotated extends Schema.TaggedError<Annotated>()("Annotated", {}, { httpApiStatus: 400 }) {}

export class Renamed extends Schema.TaggedError<Renamed>()("Other", {}) {}
`
	want := `import * as Schema from "effect/Schema"

export schema error Plain {
  readonly message: string
}

const FailedCauseField = Schema.Defect()
export schema error Failed {
  readonly reason: string
  cause?: FailedCauseField
  override get message(): string {
    return this.reason
  }
}

export class Keyed extends Schema.TaggedError<Keyed>()("Keyed", {
  note: Schema.optionalKey(Schema.String),
}) {}

export class Annotated extends Schema.TaggedError<Annotated>()("Annotated", {}, { httpApiStatus: 400 }) {}

export class Renamed extends Schema.TaggedError<Renamed>()("Other", {}) {}
`
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
	if fixed == nil || fixed.Text != want {
		got := ""
		if fixed != nil {
			got = fixed.Text
		}
		t.Fatalf("--fix wrote\n%s\nwant\n%s\nrefused %+v", got, want, result.Refused)
	}
}

// The declaration file prints a type as the source writes it, so
// vibelang --fix keeps an import that the emitted declaration file keeps,
// wherever the declaration prints the module: in a local type an export
// names, in a conditional type, or in a written type the checker resolves to
// one that no longer names the module, and an import whose type modifier is
// all that differs from the prelude's. An import only code uses still goes,
// unless comments before it would lead the declaration without it (s-53).
func TestFixKeepsImportsTheDeclarationPrints(t *testing.T) {
	cases := []struct{ name, source, want string }{
		{"local conditional alias", `import * as DateTime from "effect/DateTime"

type NonNull<V> = V extends DateTime.Utc ? string : V
export type FieldFilter<V> = { eq: NonNull<V> }
`, ""},
		{"exported conditional alias", `import * as DateTime from "effect/DateTime"

export type IsUtc<V> = V extends DateTime.Utc ? true : false
`, ""},
		{"resolved keyof", `import * as DateTime from "effect/DateTime"

export type Keys = keyof DateTime.Utc
`, ""},
		{"module export under a kept import", `import * as Metric from "effect/Metric"

export interface Tracked<M extends Metric.Metric<number, any>> {
  readonly metric: M
}
`, ""},
		{"a statement's type modifier", `import type { HttpClientResponse } from "effect/http"

export interface Handled {
  readonly response: HttpClientResponse.HttpClientResponse
}
`, ""},
		{"a specifier's type modifier", `import { type Duration, type Scope } from "effect"

export interface Timed {
  readonly delay: Duration.Input
  readonly scope: Scope.Scope
}
`, ""},
		{"a type import the declaration drops", `import type { Duration } from "effect"

const delay: Duration.Input = 10
export const value: number = 1
`, `
const delay: Duration.Input = 10
export const value: number = 1
`},
		{"a header comment the declaration drops with the import", `/**
 * What this module is for.
 */
import { Effect } from "effect"

const run = Effect.runSync(Effect.succeed(1))
export const answer: number = run
`, `/**
 * What this module is for.
 */
import { Effect } from "effect"

const run = runSync(Effect.succeed(1))
export const answer: number = run
`},
		{"a header comment the declaration keeps", `/**
 * What this module is for.
 */
import { Effect } from "effect"

export const answer = (n: number) => Effect.succeed(n + 1)
`, `/**
 * What this module is for.
 */

export const answer = (n: number) => Effect.succeed(n + 1)
`},
		{"code only", `import * as DateTime from "effect/DateTime"

export const isUtc = (value: unknown): boolean => DateTime.isDateTime(value)
`, `
export const isUtc = (value: unknown): boolean => DateTime.isDateTime(value)
`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			want := tc.want
			if want == "" {
				want = tc.source
			}
			_, file, _, _ := editorProgram(t, tc.source)
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
			got := tc.source
			if fixed := result.Files[file.FileName()]; fixed != nil {
				got = fixed.Text
			}
			if got != want || len(result.Refused) != 0 {
				t.Fatalf("--fix wrote\n%s\nwant\n%s\nrefused %+v", got, want, result.Refused)
			}
		})
	}
}

// Decided detail 277 around s-53: whatever comments come before a prelude
// import, wherever the import sits and whether the declaration writes it,
// vibelang --fix leaves the declaration's bytes as they were. Where no comment
// stands before the imports they still go.
func TestFixLeavesDeclarationBytesAroundImportComments(t *testing.T) {
	comments := []string{"", "// a\n", "/* a */\n", "/**\n * a\n */\n", "// a\n// b\n", "// a\n\n"}
	befores := []string{"", "import * as Option from \"effect/Option\"\n"}
	uses := []string{
		"const run = Effect.runSync(Effect.succeed(1))\nexport const answer: number = run\n",
		"export const answer = (n: number) => Effect.succeed(n + 1)\n",
	}
	declaration := func(t *testing.T, dir string) string {
		fs := bundled.WrapFS(osvfs.FS())
		config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
		if len(errors) != 0 {
			t.Fatalf("config: %v", errors)
		}
		program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
		name := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "main.vibe")))
		return declarationsOf(t.Context(), program, []tspath.RootedFilePath{name})[name]
	}
	for i, comment := range comments {
		for j, before := range befores {
			for k, use := range uses {
				source := comment + before + "import { Effect } from \"effect\"\n\n" + use
				if before != "" {
					source += "export const none: number = Option.getOrElse(Option.none(), () => 0)\n"
				}
				t.Run(fmt.Sprintf("comment%d-before%d-use%d", i, j, k), func(t *testing.T) {
					_, file, _, _ := editorProgram(t, source)
					dir := filepath.Dir(file.FileName().AsString())
					if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"declaration":true,"emitDeclarationOnly":true,"outDir":"out"},"files":["main.vibe"]}`), 0o600); err != nil {
						t.Fatal(err)
					}
					want := declaration(t, dir)
					fs := bundled.WrapFS(osvfs.FS())
					config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
					if len(errors) != 0 {
						t.Fatalf("config: %v", errors)
					}
					result := FixProject(t.Context(), fs, bundled.LibPath(), config)
					got := source
					if fixed := result.Files[file.FileName()]; fixed != nil {
						got = fixed.Text
					}
					if comment == "" && strings.Contains(got, `from "effect"`) {
						t.Fatalf("--fix kept the import with no comment before it:\n%s", got)
					}
					if err := os.WriteFile(file.FileName().AsString(), []byte(got), 0o600); err != nil {
						t.Fatal(err)
					}
					if after := declaration(t, dir); after != want {
						t.Fatalf("--fix turned\n%s\ninto\n%s\nand the declaration\n%s\ninto\n%s", source, got, want, after)
					}
				})
			}
		}
	}
}

// In a project that emits declarations, EK4837's fix keeps the import the
// declaration file prints, even where the class was its only use, and leaves
// a class whose Schema has another name (D501). Without declarations nothing
// reads the import, so it goes.
func TestFixSchemaErrorImports(t *testing.T) {
	plain := "import * as Schema from \"effect/Schema\"\n\nexport class Plain extends Schema.TaggedError<Plain>()(\"Plain\", {\n  message: Schema.String,\n}) {}\n"
	alias := "import { Schema as EffectSchema } from \"effect\"\n\nexport class Plain extends EffectSchema.TaggedError<Plain>()(\"Plain\", {\n  message: EffectSchema.String,\n}) {}\n"
	declared := "export schema error Plain {\n  readonly message: string\n}\n"
	for _, tc := range []struct {
		name, source, options, want string
	}{
		{"kept", plain, `"declaration":true,"noEmit":true`, "import * as Schema from \"effect/Schema\"\n\n" + declared},
		{"alias keeps the class", alias, `"declaration":true,"noEmit":true`, ""},
		{"removed without declarations", plain, `"noEmit":true`, "\n" + declared},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, tc.source)
			dir := filepath.Dir(file.FileName().AsString())
			if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[],`+tc.options+`}}`), 0o644); err != nil {
				t.Fatal(err)
			}
			fs := bundled.WrapFS(osvfs.FS())
			config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 {
				t.Fatalf("config: %v", errors)
			}
			fixed := FixProject(t.Context(), fs, bundled.LibPath(), config).Files[file.FileName()]
			got := ""
			if fixed != nil {
				got = fixed.Text
			}
			if got != tc.want {
				t.Fatalf("--fix wrote\n%s\nwant\n%s", got, tc.want)
			}
		})
	}
}

func TestFixPreludeRewrites(t *testing.T) {
	source := `import { FileSystem } from "effect/FileSystem"
import * as Path from "effect/Path"
import { HttpClient } from "effect/http"
import * as ChildProcess from "effect/process/ChildProcess"
import { Array as Arr, Option } from "effect"

const read = (path: string) => FileSystem.readFileString(Path.Path.join(path, "a"))
const key = FileSystem
const first = (value: Option.Option<number>): number => Option.getOrElse(value, () => 0)
const get = (url: string) => HttpClient.get(url)
const command = ChildProcess.make("ls")
const two = Arr.take([1, 2, 3], 2)
effect function implementation() {
  return [try FileSystem, try Path.Path]
}
const host = () => Experimental.Process.Process.hostname()
const running = (process: Experimental.Process.Process, pid: number) => process.isRunning(pid)
`
	want := `import { Array as Arr } from "effect"

const read = (path: string) => FileSystem.readFileString(Path.join(path, "a"))
const key = FileSystem.FileSystem
const first = (value: Option<number>): number => Option.getOrElse(value, () => 0)
const get = (url: string) => HttpClient.get(url)
const command = ChildProcess.make("ls")
const two = Arr.take([1, 2, 3], 2)
effect function implementation() {
  return [try FileSystem.FileSystem, try Path.Path]
}
const host = () => Experimental.Process.hostname()
const running = (process: Experimental.Process, pid: number) => process.isRunning(pid)
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
	if fixed.Rewrites[preludeImportLabel] != 5 || fixed.Rewrites[preludeKeyLabel] != 4 {
		t.Errorf("rewrites %v; want 5 imports and 4 module exports", fixed.Rewrites)
	}
	var report strings.Builder
	result.Report(&report, func(name tspath.RootedFilePath) string { return filepath.Base(name.AsString()) })
	if !strings.Contains(report.String(), "main.vibe: 9 fixes (prelude import ×5, module export ×4)") {
		t.Errorf("report:\n%s", report.String())
	}
	if err := os.WriteFile(file.FileName().AsString(), []byte(want), 0o600); err != nil {
		t.Fatal(err)
	}
	if again := FixProject(t.Context(), fs, bundled.LibPath(), config); len(again.Order) != 0 {
		t.Errorf("a second --fix changed %v", again.Order)
	}
}
