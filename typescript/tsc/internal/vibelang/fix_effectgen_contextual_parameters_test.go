package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Effect.fn infers its parameter tuple from the generator, a context-sensitive
// function, so TypeScript types each unannotated parameter from the tuple's
// constraint: any, a default included. An effect function has no such
// context, so --fix writes the checked any where the parameter had none.
// Each want is the declaration stock TypeScript 5.9.3 writes for the source
// before --fix.
func TestEffectFnFixKeepsContextualParameterTypes(t *testing.T) {
	for _, tc := range []struct{ name, source, want string }{
		{"defaulted parameter in a span", `export const start = Effect.fn("start")(function* (version = "unknown") { return version })
`, "export declare const start: (version?: any) => Effect.Effect<any, never, never>;"},
		{"defaulted parameter without a span", `export const start = Effect.fn(function* (v = 1) { return v })
`, "export declare const start: (v?: any) => Effect.Effect<any, never, never>;"},
		{"defaulted parameter after an annotated one", `export const start = Effect.fn("start")(function* (a: number, b = 2) { return a + b })
`, "export declare const start: (a: number, b?: any) => Effect.Effect<any, never, never>;"},
		{"defaulted object parameter", `export const start = Effect.fn("start")(function* (o = { k: 1 }) { return o.k })
`, "export declare const start: (o?: any) => Effect.Effect<any, never, never>;"},
		{"unannotated parameter", `export const start = Effect.fn("start")(function* (x) { return x })
`, "export declare const start: (x: any) => Effect.Effect<any, never, never>;"},
		{"unannotated optional parameter", `export const start = Effect.fn("start")(function* (x?) { return 1 })
`, "export declare const start: (x?: any) => Effect.Effect<number, never, never>;"},
		{"unannotated parameter with a stage", `export const start = Effect.fn("start")(function* (x) { return 1 }, Effect.orDie)
`, "export declare const start: (x: any) => Effect.Effect<number, never, never>;"},
		{"annotated holder keeps its context", `export const start: (v?: string) => Effect.Effect<string> = Effect.fn(function* (v = "a") { return v })
`, "export declare const start: (v?: string) => Effect.Effect<string>;"},
		{"generic generator is not contextual", `export const start = Effect.fn("start")(function* <T>(t: T, d = 0) { return t })
`, "export declare const start: <T>(t: T, d?: number"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fixed, result := fixedPipe(t, tc.source)
			if strings.Contains(fixed, "function*") {
				t.Fatalf("generator remains:\n%s\nrefusals: %+v", fixed, result.Refused)
			}
			exported := fixedDeclaration(t, fixed)
			if !strings.Contains(exported, tc.want) {
				t.Fatalf("declaration is not %q:\n%s\nfixed:\n%s", tc.want, exported, fixed)
			}
		})
	}
}

// When every parameter is defaulted and a stage follows, TypeScript infers an
// empty parameter tuple: Effect.fn("s")(function* (v = true) { return v },
// Effect.orDie) declares () => Effect.Effect<any, never, never>. An effect
// function cannot declare fewer parameters than it binds, so --fix leaves it.
func TestEffectFnFixRefusesAContextualTupleItCannotDeclare(t *testing.T) {
	source := `export const start = Effect.fn("start")(function* (v = true) { return v }, Effect.orDie)
`
	fixed, _ := fixedPipe(t, source)
	if !strings.Contains(fixed, "function*") {
		t.Fatalf("fixed, but the original declares () => ...:\n%s\n%s", fixed, fixedDeclaration(t, fixed))
	}
}

// fixedDeclaration emits the declarations of fixed, the text --fix wrote for
// the editor program's main.vibe.
func fixedDeclaration(t *testing.T, fixed string) string {
	t.Helper()
	_, file, _, _ := editorProgram(t, fixed)
	dir := filepath.Dir(file.FileName().AsString())
	config := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"declaration":true,"emitDeclarationOnly":true,"outDir":"out"},"files":["main.vibe"]}`
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(config), 0600); err != nil {
		t.Fatal(err)
	}
	var declarations strings.Builder
	for _, text := range migrationRuleDeclarations(t, dir, nil) {
		declarations.WriteString(text)
	}
	return declarations.String()
}
