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

// vibelang --fix-vip-only marks effect each function the analyzer compiles
// to an Effect (VIP-1): a declaration, a method, and a literal in the Effect
// form, with try before an arrow's body that the function runs. A literal in
// the program form becomes an effect block (VIP-2). A function that compiles
// to plain JavaScript stays unmarked and loses the try its calls had, and a
// catch handler that runs nothing stays plain. A second run writes nothing.
func TestFixVIPWritesEffect(t *testing.T) {
	source := `function load(n: number) {
  try yieldNow()
  return { n }
}

function double(n: number) {
  return n * 2
}

class Box {
  get(n: number) {
    return n
  }
}

export function main() {
  const box = new Box()
  const a = try load(1)
  const twice = try forEach([1, 2], (n) => load(n))
  const again = try Effect.retry(() => load(3), { times: 1 })
  const block = try Effect.retry(() => { try yieldNow(); return 4 }, { times: 1 })
  const d = double(2)
  const g = try box.get(5)
  const h = load(6) catch (e) => ({ n: 0 })
  return a.n + twice.length + again.n + block + d + g + h.n
}
`
	want := `effect function load(n: number) {
  try yieldNow()
  return { n }
}

function double(n: number) {
  return n * 2
}

class Box {
  effect get(n: number) {
    return n
  }
}

export effect function main() {
  const box = new Box()
  const a = try load(1)
  const twice = try forEach([1, 2], effect (n) => try load(n))
  const again = try Effect.retry(effect { return try load(3) }, { times: 1 })
  const block = try Effect.retry(effect { try yieldNow(); return 4 }, { times: 1 })
  const d = double(2)
  const g = try box.get(5)
  const h = load(6) catch (e) => ({ n: 0 })
  return a.n + twice.length + again.n + block + d + g + h.n
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
	if fixed.Rewrites[effectLabel] != 6 {
		t.Errorf("rewrites %v; want 6 effect rewrites: load, get, main, the literal, and the two blocks", fixed.Rewrites)
	}
	if err := os.WriteFile(file.FileName().AsString(), []byte(want), 0o600); err != nil {
		t.Fatal(err)
	}
	again := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{VIPOnly: true})
	if len(again.Files) != 0 {
		t.Errorf("a second run wrote %+v", again.Files[file.FileName()])
	}
}

// A plain function's call loses its try under --fix-vip-only, unless the
// call gives an error or a Yieldable: try of a yieldable error fails the
// Effect, as yield* did, so it becomes throw, or keeps its try where no
// statement can throw; a Yieldable runs as try x.asEffect(). Dropping the try
// would make the error or the Yieldable the program's value.
func TestFixVIPKeepsAnErrorsFailure(t *testing.T) {
	source := `error NotFound { id: string }
interface Output { readonly name: string; asEffect(): string!! }
const toError = (id: string): NotFound => new NotFound({ id })
const output = (name: string): Output => ({ name, asEffect: effect () => name })
export const f = effect (id: string) => {
  if (id === "") { return try toError(id) }
  if (id === "?") { try toError(id) }
  const held = [try toError(id)]
  const name = try output(id)
  return held.length > 1 ? "" : name
}
`
	want := `error NotFound { id: string }
interface Output { readonly name: string; asEffect(): string!! }
const toError = (id: string): NotFound => new NotFound({ id })
const output = (name: string): Output => ({ name, asEffect: effect () => name })
export const f = effect (id: string) => {
  if (id === "") { throw toError(id) }
  if (id === "?") { throw toError(id) }
  const held = [try toError(id)]
  const name = try output(id).asEffect()
  return held.length > 1 ? "" : name
}
`
	program, file, _, _ := editorProgram(t, source)
	note := ""
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == EK0502.Code {
			for _, chained := range d.MessageChain() {
				note += chained.String()
			}
		}
	}
	if !strings.Contains(note, "write throw toError(id)") || !strings.Contains(note, "write try output(id).asEffect()") {
		t.Errorf("EK0502 does not say throw or asEffect: %q", note)
	}
	dir := filepath.Dir(file.FileName().AsString())
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true},"files":["main.vibe"]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{VIPOnly: true})
	got := source
	if fixed := result.Files[file.FileName()]; fixed != nil {
		got = fixed.Text
	}
	if got != want {
		t.Fatalf("--fix-vip-only wrote\n%s\nwant\n%s", got, want)
	}
}

func TestFixEffectAnnotatedArrows(t *testing.T) {
	source := `import * as Effect from "effect/Effect"
export const value = (): Effect.Effect<number> => 1
export const block = (): Effect.Effect<number> => { return 2 }
export const literal = function (): Effect.Effect<number> { return 3 }
export const shorthand = (): number!! => 4
type Result = Effect.Effect<number>
export const alias = (): Result => 5
export const plain = (): number => 6
const held: Effect.Effect<number> = Effect.succeed(7)
export const factory = (): Effect.Effect<number> => held
`
	want := `import * as Effect from "effect/Effect"
export const value = effect (): Effect.Effect<number> => 1
export const block = effect (): Effect.Effect<number> => { return 2 }
export const literal = effect function (): Effect.Effect<number> { return 3 }
export const shorthand = effect (): number!! => 4
type Result = Effect.Effect<number>
export const alias = effect (): Result => 5
export const plain = (): number => 6
const held: Effect.Effect<number> = Effect.succeed(7)
export const factory = (): Effect.Effect<number> => held
`
	program, file, _, _ := editorProgram(t, source)
	program.GetSemanticDiagnostics(t.Context(), file)
	c, done := program.GetTypeCheckerForFile(t.Context(), file)
	defer done()
	edits, count := effectEdits(c, file)
	got := applyEdits(source, mergeInsertions(edits))
	if got != want || count != 5 {
		t.Fatalf("effect rewrite (%d):\n%s\nwant:\n%s", count, got, want)
	}
}
