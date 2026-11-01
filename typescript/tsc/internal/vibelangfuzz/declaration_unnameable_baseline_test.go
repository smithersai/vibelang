package vibelangfuzz

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// TestDeclarationUnnameableBaseline covers t3code's CodexThreadRevert.ts
// (inbox/migrate-t3code.md, declaration:baseline-ts4023-codex-thread-revert).
// The original Effect.fn value takes Pick<Client["Service"], "request">, whose
// service shape holds a module-private interface, so stock tsc stops with
// TS4023 and writes no declaration. Its VibeLang conversion is an Effect
// function, which Chapter 1 declares as its Effect TypeScript twin, a function
// returning Effect.gen: "Declarations are exactly what idiomatic Effect
// TypeScript would declare." and "a function declaration is a `declare
// function`, and a `const` holding an arrow is a `declare const`".
//
// Oracles, for each parameter spelling × declaration form:
//   - the .vibe module compiles and its declaration equals, byte for byte,
//     stock tsc's declaration of the twin;
//   - when stock tsc rejects the original Effect.fn module, the migration's
//     declaration gate reports the new declaration as added, so the flow keeps
//     the TypeScript file instead of claiming an identity it cannot prove.
func TestDeclarationUnnameableBaseline(t *testing.T) {
	requireDeclarationPreludeModesQuote(t)
	requireUnnameableFormQuote(t)
	tsc := StockTypeScript(t)
	api := declarationIdentityAPI(t)
	w := NewWorkspace(t)
	const client = `import { Context, Effect } from "effect"
interface Raw {
  readonly id: string
}
export class Client extends Context.Service<
  Client,
  {
    readonly raw: Raw
    readonly request: <M extends string>(method: M) => Effect.Effect<M>
  }
>()("Client") {}
`
	const config = `{"compilerOptions":{"target":"ES2022","singleThreaded":true,"module":"NodeNext","moduleResolution":"NodeNext","strict":true,"types":[],"skipLibCheck":true,"declaration":true,"rewriteRelativeImportExtensions":true,"outDir":"out"},"files":["client.ts",%q]}`
	params := []struct{ key, text string }{
		{"pick", `Pick<C.Client["Service"], "request">`},
		{"pick-union", `Pick<C.Client["Service"], "request" | "raw">`},
		{"omit", `Omit<C.Client["Service"], "raw">`},
	}
	forms := []struct{ key, original, vibe, twin string }{
		{
			"declaration",
			"export const revert = Effect.fn(\"revert\")(function* (client: %P) {\n  return yield* client.request(\"a\")\n})\n",
			"export effect function revert(client: %P) {\n  return try client.request(\"a\")\n}\n",
			"export function revert(client: %P) {\n  return Effect.gen(function* () {\n    return yield* client.request(\"a\")\n  })\n}\n",
		},
		{
			"const-expression",
			"export const revert = Effect.fn(function* (client: %P) {\n  return yield* client.request(\"a\")\n})\n",
			"export const revert = effect function (client: %P) {\n  return try client.request(\"a\")\n}\n",
			"export const revert = function (client: %P) {\n  return Effect.gen(function* () {\n    return yield* client.request(\"a\")\n  })\n}\n",
		},
	}
	const header = "import type * as C from \"./client.ts\"\n"
	const effectImport = "import { Effect } from \"effect\"\n"
	for _, p := range params {
		for _, f := range forms {
			key := "t3code-codex-thread-revert/" + p.key + "/" + f.key
			t.Run(p.key+"/"+f.key, func(t *testing.T) {
				fill := func(s string) string { return strings.ReplaceAll(s, "%P", p.text) }
				original := Project{Files: map[string]string{"client.ts": client, "revert.ts": effectImport + header + fill(f.original), "package.json": `{"type":"module"}`}, Config: fmt.Sprintf(config, "revert.ts")}
				twin := Project{Files: map[string]string{"client.ts": client, "revert.ts": effectImport + header + fill(f.twin), "package.json": `{"type":"module"}`}, Config: fmt.Sprintf(config, "revert.ts")}
				// The twin writes the Effect import first, where the declaration adds it.
				// Compile first: it prepares the workspace's shared node_modules,
				// which stock tsc resolves effect from.
				vibe, err := w.Compile(t.Context(), Project{Files: map[string]string{"client.ts": client, "revert.vibe": header + fill(f.vibe), "package.json": `{"type":"module"}`}, Config: fmt.Sprintf(config, "revert.vibe")})
				if err != nil {
					t.Fatal(err)
				}
				defer vibe.Remove()
				stockOriginal, originalErr := stockEmitWithErrors(t, w, tsc, original)
				defer os.RemoveAll(stockOriginal)
				stockTwin, twinErr := stockEmitWithErrors(t, w, tsc, twin)
				defer os.RemoveAll(stockTwin)
				if twinErr != "" {
					t.Fatalf("the Effect TypeScript twin must be a valid stock program:\n%s", twinErr)
				}
				if p.key == "pick" && f.key == "declaration" && !strings.Contains(originalErr, "TS4023") {
					t.Fatalf("the t3code witness must reproduce stock TS4023, got %q", originalErr)
				}
				if HasError(vibe.Diagnostics) {
					Gap(t, "TestDeclarationUnnameableBaseline", key, "the Effect function conversion reports %v", SortedKeys(Keys(vibe.Dir, vibe.Diagnostics)))
					return
				}
				got := ""
				current := filepath.Join(vibe.Dir, "__unnameable_current")
				for name, text := range vibe.Outputs {
					if !isDeclaration(name) {
						continue
					}
					slash := filepath.ToSlash(name)
					i := strings.LastIndex(slash, "out/")
					rel, ok := slash[i+len("out/"):], i >= 0
					if !ok {
						t.Fatalf("declaration outside outDir: %s", name)
					}
					if err := writeInside(current, rel, text); err != nil {
						t.Fatal(err)
					}
					if rel == "revert.d.ts" {
						got = text
					}
				}
				want, err := os.ReadFile(filepath.Join(stockTwin, "out", "revert.d.ts"))
				if err != nil {
					t.Fatal(err)
				}
				if got != string(want) {
					Gap(t, "TestDeclarationUnnameableBaseline", key, "Chapter 1: \"Declarations are exactly what idiomatic Effect TypeScript would declare.\"\nVibeLang:\n%s\nTypeScript twin:\n%s", got, want)
					return
				}
				if originalErr == "" {
					return
				}
				ctx, cancel := context.WithTimeout(t.Context(), 2*HangLimit)
				defer cancel()
				diff, err := compareIdentityDeclarations(ctx, api, filepath.Join(stockOriginal, "out"), current)
				if err != nil {
					t.Fatal(err)
				}
				if !strings.Contains(diff, "revert.d.ts (added)") {
					t.Fatalf("stock tsc wrote no revert.d.ts (%s), so the migration gate must report the native declaration as added; it reported:\n%s", originalErr, diff)
				}
			})
		}
	}
}

const unnameableFormQuote = "a function declaration is a `declare function`, and a `const` holding an arrow is a `declare const`"

func requireUnnameableFormQuote(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), unnameableFormQuote) {
		t.Fatal("chapter 1 declaration form quote changed")
	}
}

func TestDeclarationUnnameableFormQuoted(t *testing.T) { requireUnnameableFormQuote(t) }

// stockEmitWithErrors runs stock tsc on project and returns its directory and,
// when tsc reports errors, its output. Declarations land in <dir>/out.
func stockEmitWithErrors(t *testing.T, w *Workspace, tsc string, project Project) (string, string) {
	t.Helper()
	dir, err := w.writeProject(project)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 2*HangLimit)
	defer cancel()
	cmd := exec.CommandContext(ctx, tsc, "-p", ".", "--pretty", "false")
	cmd.Dir = dir
	out, runErr := cmd.CombinedOutput()
	if ctx.Err() != nil {
		t.Fatalf("stock tsc did not finish: %v", ctx.Err())
	}
	var exit *exec.ExitError
	if runErr != nil && (!errors.As(runErr, &exit) || exit.ExitCode() != 1 && exit.ExitCode() != 2) {
		t.Fatalf("stock tsc failed to run: %v\n%s", runErr, out)
	}
	if runErr != nil {
		return dir, string(out)
	}
	return dir, ""
}
