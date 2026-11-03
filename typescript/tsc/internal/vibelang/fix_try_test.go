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

// vibelang --fix-vip-only migrates what a marked file still spells the old way
// and leaves the rest as written: a function is an Effect function exactly when
// marked effect (VIP-1), so the marker is an input now, and a call that no try
// runs gives its Effect unrun (VIP-5). A retired await operation (EK1802) and the
// retired try(…) hatch (EK4616) become try forms, in a function already marked.
// fork's operand, a held const, the left side of catch and a plain function's
// call stay as they are; the retired value fallback { n: 0 } becomes the
// function literal () => ({ n: 0 }) (EK0509, foldkit-17069). A second run
// finds nothing to write.
func TestFixVIPWritesTryWhereCallsRun(t *testing.T) {
	source := `error Bad { cause: unknown }

effect function load(n: number) {
  try yieldNow()
  return { n }
}

class Box {
  effect get(n: number) {
    try yieldNow()
    return n
  }
}

function plainDouble(n: number): number {
  return n * 2
}

export effect function main() {
  const box = new Box()
  const a = try load(1)
  try box.get(2)
  const b = (try load(3)).n
  const all = await.all [load(4), load(5)]
  const f = fork load(6)
  const p: { n: number }!! = load(7)
  const later = effect () => try load(8)
  const d = plainDouble(1)
  ;(try load(11)).n
  const c = try load(9)
  const e = load(12) catch { n: 0 }
  const parsed = try((text) => JSON.parse(text), (cause) => new Bad({ cause }), "1")
  join f
  return a.n + b + all[0].n + d + c.n + e.n + parsed + try box.get(10)
}
`
	want := `error Bad { cause: unknown }

effect function load(n: number) {
  try yieldNow()
  return { n }
}

class Box {
  effect get(n: number) {
    try yieldNow()
    return n
  }
}

function plainDouble(n: number): number {
  return n * 2
}

export effect function main() {
  const box = new Box()
  const a = try load(1)
  try box.get(2)
  const b = (try load(3)).n
  const all = (try.all [effect { return try load(4) }, effect { return try load(5) }])
  const f = fork load(6)
  const p: { n: number }!! = load(7)
  const later = effect () => try load(8)
  const d = plainDouble(1)
  ;(try load(11)).n
  const c = try load(9)
  const e = load(12) catch () => ({ n: 0 })
  const parsed = try Effect.try({ try: () => { let text = "1"; return JSON.parse(text) }, catch: (cause) => new Bad({ cause }) })
  join f
  return a.n + b + all[0].n + d + c.n + e.n + parsed + try box.get(10)
}
`
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true},"files":["main.vibe"]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	fs := bundled.WrapFS(osvfs.FS())
	configPath := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json")))
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(configPath, &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{VIPOnly: true})
	fixed := result.Files[file.FileName()]
	if fixed == nil || fixed.Text != want {
		got := ""
		if fixed != nil {
			got = fixed.Text
		}
		t.Fatalf("--fix-vip-only wrote\n%s\nwant\n%s\nrefused %+v", got, want, result.Refused)
	}
	if fixed.Counts[EK1802.Code] != 1 || fixed.Counts[EK4616.Code] != 1 {
		t.Errorf("fixes %v; want one EK1802 fix and one EK4616 fix", fixed.Counts)
	}
	var report strings.Builder
	result.Report(&report, func(name tspath.RootedFilePath) string { return filepath.Base(name.AsString()) })
	if !strings.Contains(report.String(), "main.vibe: 3 fixes (EK0509 ×1, EK1802 ×1, EK4616 ×1)") {
		t.Errorf("report:\n%s", report.String())
	}

	if err := os.WriteFile(file.FileName().AsString(), []byte(want), 0o600); err != nil {
		t.Fatal(err)
	}
	again := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{VIPOnly: true})
	if len(again.Files) != 0 {
		t.Errorf("a second run wrote %+v", again.Files[file.FileName()])
	}
}

// t3code's pullRequestStatsPersistence.vibe and alchemy's BucketBinding.vibe
// (VIP-1 flip acceptance cases 8 and 10): an effect arrow whose body is a
// call runs that call today, and VIP-5 returns it unrun once the mark alone
// decides (`effect () => e` keeps e), so --fix-vip-only writes try before
// it, as it does before a block body's return.
func TestFixVIPTriesAnEffectArrowsBodyCall(t *testing.T) {
	source := `const authorize = <A, E>(operation: A!E): A!E => effect { return try operation }

export const direct = effect () => authorize(Effect.succeed(5))
export const span = effect (k: string): number!! =>
  withSpan(effect { return k.length }, "name")
export const block = effect () => { return authorize(Effect.succeed(1)) }
`
	want := `const authorize = <A, E>(operation: A!E): A!E => effect { return try operation }

export const direct = effect () => try authorize(Effect.succeed(5))
export const span = effect (k: string): number!! =>
  try withSpan(effect { return k.length }, "name")
export const block = effect () => { return try authorize(Effect.succeed(1)) }
`
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true},"files":["main.vibe"]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	fs := bundled.WrapFS(osvfs.FS())
	configPath := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json")))
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(configPath, &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{VIPOnly: true})
	fixed := result.Files[file.FileName()]
	if fixed == nil || fixed.Text != want {
		got := ""
		if fixed != nil {
			got = fixed.Text
		}
		t.Fatalf("--fix-vip-only wrote\n%s\nwant\n%s\nrefused %+v", got, want, result.Refused)
	}
	if err := os.WriteFile(file.FileName().AsString(), []byte(want), 0o600); err != nil {
		t.Fatal(err)
	}
	again := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{VIPOnly: true})
	if len(again.Files) != 0 {
		t.Errorf("a second run wrote %+v", again.Files[file.FileName()])
	}
}

// smithers' agent/fs (SchemaBridge.vibe, Route.vibe), on VibeLang 0.0.8: a
// retired try hatch with a handler by name. The second argument is the
// mapper whatever its form (D330), so EK4616's fix makes it the catch, and
// undefined there leaves the catch out. The hatch's function is TypeScript
// that Effect.try wraps as it is: the hatch stands in a function marked effect
// (VIP-1), and the fix leaves the hatch's own function plain. An arrow whose
// parameters take inputs of their own names becomes the thunk's body: called
// in place inside the thunk, it would be plain code holding a call known to
// throw (JSON.parse, EK0401), and the fix would be refused.
func TestFixVIPRetiredHatchMapperByName(t *testing.T) {
	source := `const documentOf = (n: number): { readonly a: number } => {
  if (n < 0) throw new Error("negative")
  return { a: n }
}

const unsupported = (): Error => new Error("unsupported")

export const project = effect (n: number): Effect<number, Error> => {
  const { a } = try((documentOf, n) => documentOf(n), unsupported, documentOf, n)
  return a
}

export const projectBlock = effect (n: number): Effect<number, Error> => {
  const { a } = try((documentOf, n) => {
    return documentOf(n)
  }, unsupported, documentOf, n)
  return a
}

export const parse = effect (text: string): Effect<number, unknown> => {
  const n: number = try((text) => JSON.parse(text), undefined, text)
  return n
}

export const annotated = (text: string): Effect<number, unknown> => {
  return try((text): number => JSON.parse(text), undefined, text)
}

export const generic = (n: number): Effect<number, unknown> => {
  return try(<T>(value: T): T => value, undefined, n)
}
`
	want := `const documentOf = (n: number): { readonly a: number } => {
  if (n < 0) throw new Error("negative")
  return { a: n }
}

const unsupported = (): Error => new Error("unsupported")

export const project = effect (n: number): Effect<number, Error> => {
  const { a } = try Effect.try({ try: () => documentOf(n), catch: unsupported })
  return a
}

export const projectBlock = effect (n: number): Effect<number, Error> => {
  const { a } = try Effect.try({ try: () => {
    return documentOf(n)
  }, catch: unsupported })
  return a
}

export const parse = effect (text: string): Effect<number, unknown> => {
  const n: number = try Effect.try(() => JSON.parse(text))
  return n
}

export const annotated = effect (text: string): Effect<number, unknown> => {
  return try Effect.try((): number => JSON.parse(text))
}

export const generic = effect (n: number): Effect<number, unknown> => {
  return try Effect.try(() => (<T>(value: T): T => value)(n))
}
`
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true},"files":["main.vibe"]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	fs := bundled.WrapFS(osvfs.FS())
	configPath := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json")))
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(configPath, &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{VIPOnly: true})
	fixed := result.Files[file.FileName()]
	if fixed == nil || fixed.Text != want {
		got := ""
		if fixed != nil {
			got = fixed.Text
		}
		t.Fatalf("--fix-vip-only wrote\n%s\nwant\n%s\nrefused %+v", got, want, result.Refused)
	}
	if fixed.Counts[EK4616.Code] != 5 {
		t.Errorf("fixes %v; want five EK4616 fixes", fixed.Counts)
	}
}
