package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// Chapter 003: an unannotated foreign function may throw unknown, and a
// promise or sync thunk does not admit that throw, so Effect.promise(load) is
// EK0402. --fix writes the explicit defect bridge, which keeps a thrown or
// rejected value as the same defect. Minimized from opencode's stats sync,
// try Effect.promise(loadCatalogIdentity).
func TestForeignThunkBridgeFix(t *testing.T) {
	const foreign = `export async function load() { return 1 }
export function read(signal: AbortSignal): Promise<number> { return Promise.resolve(signal.aborted ? 0 : 1) }
export function count() { return 1 }
export const constant = () => 2
export const box = { read: (): Promise<number> => Promise.resolve(3) }
`
	for _, mode := range []string{"ordinary", "migration", "vip"} {
		for _, tc := range []struct{ name, body, want string }{
			{"promise of an async function", "Effect.promise(load)", "Effect.orDie(Effect.tryPromise({ try: () => load(), catch: (e) => e }))"},
			{"promise of a function taking the signal", "Effect.promise(read)", "Effect.orDie(Effect.tryPromise({ try: (signal) => read(signal), catch: (e) => e }))"},
			{"sync of a function", "Effect.sync(count)", "Effect.orDie(Effect.try({ try: () => count(), catch: (e) => e }))"},
			{"sync of a const arrow", "Effect.sync(constant)", "Effect.orDie(Effect.try({ try: () => constant(), catch: (e) => e }))"},
		} {
			t.Run(mode+"/"+tc.name, func(t *testing.T) {
				source := "import { load, read, count, constant } from \"./foreign.js\"\nexport const p = effect { return try " + tc.body + " }\n"
				fixed, result := foreignThunkFixed(t, mode, source, foreign)
				if !strings.Contains(fixed, tc.want) {
					t.Fatalf("no defect bridge %q:\n%s\nrefused: %+v\nsites: %+v", tc.want, fixed, result.Refused, result.Sites)
				}
			})
		}
	}
	// A method read off an object is evaluated at the call and runs without
	// its this, so the bridge would change it; the arrow forms draw no EK0402.
	for _, body := range []string{"Effect.promise(box.read)", "Effect.promise(() => load())", "Effect.sync(() => count())"} {
		t.Run("kept/"+body, func(t *testing.T) {
			source := "import { load, count, box } from \"./foreign.js\"\nexport const p = effect { return try " + body + " }\n"
			if fixed, _ := foreignThunkFixed(t, "ordinary", source, foreign); !strings.Contains(fixed, body) || strings.Contains(fixed, "orDie") {
				t.Fatalf("rewrote %s:\n%s", body, fixed)
			}
		})
	}
}

// foreignThunkFixed runs --fix in mode over source beside foreign.ts and
// returns the fixed main.vibe, which must then check without an error.
func foreignThunkFixed(t *testing.T, mode, source, foreign string) (string, *FixResult) {
	t.Helper()
	p, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	if err := os.WriteFile(filepath.Join(dir, "foreign.ts"), []byte(foreign), 0600); err != nil {
		t.Fatal(err)
	}
	fs := bundled.WrapFS(osvfs.FS())
	options := FixOptions{MigrationOnly: mode == "migration", VIPOnly: mode == "vip"}
	result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), p.CommandLine(), options)
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	fixed := source
	if f := result.Files[file.FileName()]; f != nil {
		fixed = f.Text
	}
	for name, f := range result.Files {
		if err := os.WriteFile(name.AsString(), []byte(f.Text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	after := compiler.NewProgram(compiler.ProgramOptions{Config: p.CommandLine(), Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	for _, d := range programErrors(t.Context(), after) {
		if d.Code() == EK0402.Code && !strings.Contains(fixed, "orDie") {
			continue // a kept form keeps its diagnostic
		}
		t.Errorf("diagnostic %d at %d:%d: %s\nfixed source:\n%s", d.Code(), d.Pos(), d.End(), d.String(), fixed)
	}
	return fixed, result
}
