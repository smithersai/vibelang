package vibelang

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// An Effect is not a function (VIP-5: only try runs it), so
// --fix-vip-only rewrites old VibeLang's p(), which ran the Effect value p
// where it stood (D501, D24), as try p in effect code: try p() loses its
// argument list, p() gains try, a chain continues (try p), a parenthesized
// callee loses its parentheses, and a service member that is an Effect is
// read from the service (VIP-10). A plain function's p() stays TypeScript's
// TS2349. A second run finds nothing to write.
func TestFixVIPRunsEffectValuesWithTry(t *testing.T) {
	source := `service Journal {
  read: Effect.Effect<number>
}

const ready = Effect.succeed(1)

function pick(flag: boolean) {
  return flag ? ready : Effect.succeed(2)
}

function plain() {
  return ready()
}

export effect function main() {
  const journal = try Journal()
  const a = try ready()
  const b = ready()
  const c = Journal().read
  const d = try Journal.read()
  const e = try (pick(true))()
  return [a, b, try c, d, e, journal, plain]
}
`
	want := `service Journal {
  read: Effect.Effect<number>
}

const ready = Effect.succeed(1)

function pick(flag: boolean) {
  return flag ? ready : Effect.succeed(2)
}

function plain() {
  return ready()
}

export effect function main() {
  const journal = try Journal
  const a = try ready
  const b = try ready
  const c = (try Journal).read
  const d = try (try Journal).read
  const e = try pick(true)
  return [a, b, try c, d, e, journal, plain]
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
	if err := os.WriteFile(file.FileName().AsString(), []byte(want), 0o600); err != nil {
		t.Fatal(err)
	}
	again := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{VIPOnly: true})
	if len(again.Files) != 0 {
		t.Errorf("a second run wrote %+v", again.Files[file.FileName()])
	}
}
