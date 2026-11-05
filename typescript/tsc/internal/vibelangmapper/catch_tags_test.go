package vibelangmapper

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// D209/D218/D238: inferred catch failures follow the same exhaustive tag
// elimination as written contracts, including singleton Schema/Data errors.
func TestCatchTagExhaustiveStock(t *testing.T) {
	source, err := os.ReadFile("../../../vibelang/cases/catch-tag-exhaustive/main.vibe")
	if err != nil {
		t.Fatal(err)
	}
	declarations, output, err := catchTagStock(t, string(source))
	if err != nil {
		t.Fatalf("%v\n%s", err, output)
	}
	// Stock TypeScript renames the Effect namespace import when a local name
	// collides (Effect_1.Effect); parity normalizes that alias the same way.
	declarations = strings.ReplaceAll(declarations, "Effect_1.", "Effect.")
	for _, want := range []string{
		"export declare const inferredSchema: () => Effect.Effect<number, never, never>;",
		"export declare function inferredData(): Effect.Effect<number, never, never>;",
		"export declare function inferredDecl(): Effect.Effect<number, never, never>;",
		"export declare function partial(data: boolean): Effect.Effect<number, DataFailure, never>;",
	} {
		if !hasCatchEffectDeclaration(declarations, want) {
			t.Fatalf("missing %s\n%s", want, declarations)
		}
	}
}

func TestCatchTagPartialStock(t *testing.T) {
	source, err := os.ReadFile("../../../vibelang/cases/catch-tag-partial.fail/main.vibe")
	if err != nil {
		t.Fatal(err)
	}
	_, output, err := catchTagStock(t, string(source))
	if err == nil || !strings.Contains(output, "Second") {
		t.Fatalf("partial catch must retain Second: %v\n%s", err, output)
	}
}

// A literal arm cannot eliminate a failure whose own tag is a union/string;
// a value pattern cannot eliminate every failure sharing that value's type.
func TestCatchTagNonSingletonStock(t *testing.T) {
	source := `import { Effect } from "effect"
declare const tag: string
declare function wide(): Effect.Effect<never, { readonly _tag: string }, never>
declare function union(): Effect.Effect<never, { readonly _tag: "A" | "B" }, never>
export function broad() { try { return wide() } catch (e) { return match (e) { when { _tag: "A" }: 1; default: throw e; } } }
export function several() { try { return union() } catch (e) { return match (e) { when { _tag: "A" }: 1; default: throw e; } } }
export function value() { try { return wide() } catch (e) { return match (e) { when { _tag: tag }: 1; default: throw e; } } }
`
	declarations, output, err := catchTagStock(t, source)
	if err != nil {
		t.Fatalf("%v\n%s", err, output)
	}
	if strings.Count(declarations, "readonly _tag: string;") != 2 || !strings.Contains(declarations, `readonly _tag: "A" | "B";`) {
		t.Fatalf("non-singleton failures disappeared:\n%s", declarations)
	}
}

func catchTagStock(t *testing.T, source string) (string, string, error) {
	t.Helper()
	dir, stock := stockBuiltinProject(t)
	requireStockTypeScript(t, stock)
	projection := Project(source, testContext)
	if len(projection.Diagnostics) != 0 {
		t.Fatal(projection.Diagnostics)
	}
	if err := os.WriteFile(filepath.Join(dir, "main.ts"), []byte(projection.Text), 0600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(stock, "--ignoreConfig", "--declaration", "--emitDeclarationOnly", "--skipLibCheck", "--strict", "--target", "esnext", "--module", "nodenext", "main.ts")
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	declarations, readErr := os.ReadFile(filepath.Join(dir, "main.d.ts"))
	if err == nil && readErr != nil {
		t.Fatal(readErr)
	}
	return string(declarations), string(output), err
}

// The namespace used by a native try migration is an implementation detail.
// Compare the expected type through aliases imported from the actual module;
// a similarly named foreign namespace cannot satisfy the declaration check.
var catchEffectNamespaceImport = regexp.MustCompile(`(?m)^import \* as ([^ ]+) from "effect/Effect";?$`)

func hasCatchEffectDeclaration(declarations, want string) bool {
	if strings.Contains(declarations, want) {
		return true
	}
	for _, imported := range catchEffectNamespaceImport.FindAllStringSubmatch(strings.ReplaceAll(declarations, "\r\n", "\n"), -1) {
		candidate := strings.ReplaceAll(want, "Effect.Effect<", imported[1]+".Effect<")
		if strings.Contains(declarations, candidate) {
			return true
		}
	}
	return false
}

func FuzzCatchDeclarationNamespaceAliases(f *testing.F) {
	for alias := range uint8(4) {
		for mode := range uint8(8) {
			f.Add(alias, mode)
		}
	}
	f.Fuzz(func(t *testing.T, alias, mode uint8) {
		name := []string{"Effect_1", "$nativeTryEffect6", "NativeEffect", "Σ"}[alias%4]
		mode %= 8
		module := "effect/Effect"
		if mode&1 != 0 {
			module = "./foreign.js"
		}
		actual := "export declare function recovered(): " + name + ".Effect<number, never, never>;"
		want := "export declare function recovered(): Effect.Effect<number, never, never>;"
		if mode&2 != 0 {
			actual = strings.Replace(actual, "never, never", "Error, never", 1)
		}
		declarations := "import * as " + name + " from \"" + module + "\";\n" + actual
		if mode&4 != 0 {
			declarations = strings.ReplaceAll(declarations, "\n", "\r\n")
		}
		expected := mode&3 == 0
		if got := hasCatchEffectDeclaration(declarations, want); got != expected {
			t.Fatalf("namespace %s mode %d: got %t, want %t\n%s", name, mode, got, expected, declarations)
		}
	})
}
