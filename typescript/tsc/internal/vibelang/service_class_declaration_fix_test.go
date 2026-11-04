package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// EK4831's fix keeps an exported service class's declaration. Chapter 7: "A
// quick fix is offered only when it preserves evaluation order, coldness,
// types, comments, and declaration output". The body form declares a public
// Name.Shape namespace that the class never had (005-services, two types),
// so an exported class with a written member object becomes the written
// whole-shape service, which passes that object to Context.Service unchanged
// and adds no helper or namespace (005-services, "A written whole shape").
// alchemy's Domain Correlation and Platform are the witnesses. A class
// exported only by an export list counts, and so does a project that emits
// no declarations: the fix's tsconfig is often not the one that builds the
// package's declarations.
func TestServiceClassFixKeepsDeclarations(t *testing.T) {
	// rule-evidence: docs/design/src/007-tooling.md#4b00a9276c4ace5d — Chapter 007: exported service class shape
	source := `import { Context } from "effect"

/** The flow work belongs to. */
export class Correlation extends Context.Service<Correlation, { readonly id: string }>()(
  "alchemy/Domain/Correlation",
) {}

/** Swap the platform. */
class Platform extends Context.Service<
  Platform,
  {
    readonly view: (name: string) => Effect.Effect<number>
    readonly label: string
    count: number
    find(id: string): Effect.Effect<string>
  }
>()("alchemy/Domain/Platform") {}
export { Platform }
`
	want := `
/** The flow work belongs to. */
export service Correlation: { readonly id: string } { static readonly key = "alchemy/Domain/Correlation" }

/** Swap the platform. */
service Platform: {
  readonly view: (name: string) => number!!
  readonly label: string
  count: number
  find(id: string): string!!
} { static readonly key = "alchemy/Domain/Platform" }
export { Platform }
`
	for _, options := range []string{`"declaration":true,"emitDeclarationOnly":true,"outDir":"out"`, `"noEmit":true`} {
		if got, refused := fixOne(t, source, options); got != want || refused != "" {
			t.Errorf("%s: --fix wrote\n%s\nwant\n%s\nrefused %s", options, got, want, refused)
		}
	}
	// The oracle: the fixed source declares exactly what the class did.
	before, after := wholeDeclaration(t, source), wholeDeclaration(t, want)
	if before != after {
		t.Errorf("declarations differ\nclass:\n%s\nfixed:\n%s", before, after)
	}
	if strings.Contains(after, "namespace") || strings.Contains(after, "_shape") {
		t.Errorf("an exported fixed service declares a Shape helper or namespace:\n%s", after)
	}
}

// A class its module does not export keeps the body form, the idiomatic
// declaration: its Shape namespace is not part of the module's API.
func TestServiceClassFixLocalKeepsBodyForm(t *testing.T) {
	source := `import { Context } from "effect"

class Local extends Context.Service<Local, { readonly n: number; find(id: string): Effect.Effect<string> }>()("app/Local") {}
export const local = Local
`
	want := `
service Local { static readonly key = "app/Local"; readonly n: number; find(id: string): string!! }
export const local = Local
`
	if got, refused := fixOne(t, source, `"declaration":true,"emitDeclarationOnly":true,"outDir":"out"`); got != want || refused != "" {
		t.Errorf("--fix wrote\n%s\nwant\n%s\nrefused %s", got, want, refused)
	}
}

// fixOne runs --fix on source as main.vibe under compiler options and
// returns the fixed text and any refusals.
func fixOne(t *testing.T, source, options string) (string, string) {
	t.Helper()
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,`+options+`},"files":["main.vibe"]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	result := fixCase(t, dir)
	got := source
	if fixed := result.Files[file.FileName()]; fixed != nil {
		got = fixed.Text
	}
	var refused []string
	for _, r := range result.Refused {
		refused = append(refused, r.Error)
	}
	return got, strings.Join(refused, "; ")
}
