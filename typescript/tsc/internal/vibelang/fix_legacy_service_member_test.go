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

// Before VIP-1, S() gave a service's value and a method call on it whose
// result is an Effect ran where it stood: const digest = (Hasher()).digest(input)
// held the bytes (Smithers flows/crypto Uuid.vibe, ui/views render-a-view).
// Post-flip S() is TS2349, so the checker gives the method no signature, and
// --fix-vip-only wrote (try Hasher) but no try for the method's Effect: the
// file's tries added TS2339 on digest.slice and were all refused. The
// migration reads the method on the service's value, as the old compiler did.
func TestFixVIPServiceMemberCallResult(t *testing.T) {
	source := `import { Context, Effect } from "effect"

export class Hasher extends Context.Service<Hasher, {
  readonly digest: (input: Uint8Array) => Effect.Effect<Uint8Array>
}>()("Hasher") {}

export class Users extends Context.Service<Users, {
  find(id: string): Effect.Effect<{ readonly name: string }>
  readonly size: number
}>()("Users") {}

export const head = (input: Uint8Array): number!!Hasher => {
  const digest = (Hasher()).digest(input)
  return digest.slice(0, 1)[0]!
}

export const name = (id: string): string!!Users => {
  const user = Users().find(id)
  const size = (Users()).size
  return user.name + String(size)
}
`
	want := `import { Context, Effect } from "effect"

export class Hasher extends Context.Service<Hasher, {
  readonly digest: (input: Uint8Array) => Effect.Effect<Uint8Array>
}>()("Hasher") {}

export class Users extends Context.Service<Users, {
  find(id: string): Effect.Effect<{ readonly name: string }>
  readonly size: number
}>()("Users") {}

export const head = effect (input: Uint8Array): number!!Hasher => {
  const digest = try (try Hasher).digest(input)
  return digest.slice(0, 1)[0]!
}

export const name = effect (id: string): string!!Users => {
  const user = try (try Users).find(id)
  const size = (try Users).size
  return user.name + String(size)
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
	if fixed == nil || fixed.Text != want || len(result.Refused) != 0 {
		got := ""
		if fixed != nil {
			got = fixed.Text
		}
		t.Fatalf("--fix-vip-only wrote\n%s\nwant\n%s\nrefused %+v", got, want, result.Refused)
	}
}

// The neighbourhood: a legacy service call, parenthesized or not, whose
// method's Effect ran in each position the old compiler ran a call in, is
// written try (try S).m(…), and the migrated program compiles.
func TestFixVIPServiceMemberCallPositions(t *testing.T) {
	prelude := `import { Context, Effect } from "effect"

export class Hasher extends Context.Service<Hasher, {
  readonly digest: (input: Uint8Array, salt?: number) => Effect.Effect<Uint8Array>
}>()("Hasher") {}

function keep(bytes: Uint8Array): Uint8Array {
  return bytes
}

`
	positions := []struct{ key, legacy, want string }{
		{"initializer", "export const f = (input: Uint8Array): number!!Hasher => {\n  const bytes = %s\n  return bytes.length\n}\n", "export const f = effect (input: Uint8Array): number!!Hasher => {\n  const bytes = %s\n  return bytes.length\n}\n"},
		{"return", "export const f = (input: Uint8Array): Uint8Array!!Hasher => {\n  return %s\n}\n", "export const f = effect (input: Uint8Array): Uint8Array!!Hasher => {\n  return %s\n}\n"},
		{"argument", "export const f = (input: Uint8Array): number!!Hasher => {\n  return keep(%s).length\n}\n", "export const f = effect (input: Uint8Array): number!!Hasher => {\n  return keep(%s).length\n}\n"},
		{"statement", "export const f = (input: Uint8Array): number!!Hasher => {\n  %s\n  return 0\n}\n", "export const f = effect (input: Uint8Array): number!!Hasher => {\n  %s\n  return 0\n}\n"},
	}
	calls := []struct{ key, legacy, want string }{
		{"parenthesized", "(Hasher()).digest(input)", "try (try Hasher).digest(input)"},
		{"bare", "Hasher().digest(input, 2)", "try (try Hasher).digest(input, 2)"},
	}
	for _, p := range positions {
		for _, c := range calls {
			t.Run(p.key+"/"+c.key, func(t *testing.T) {
				source := prelude + strings.Replace(p.legacy, "%s", c.legacy, 1)
				want := prelude + strings.Replace(p.want, "%s", c.want, 1)
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
				result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{VIPOnly: true})
				fixed := result.Files[file.FileName()]
				if fixed == nil || fixed.Text != want || len(result.Refused) != 0 {
					got := ""
					if fixed != nil {
						got = fixed.Text
					}
					t.Fatalf("--fix-vip-only wrote\n%s\nwant\n%s\nrefused %+v", got, want, result.Refused)
				}
			})
		}
	}
}
