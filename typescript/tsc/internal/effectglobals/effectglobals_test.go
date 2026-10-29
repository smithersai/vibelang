package effectglobals

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

// TestExportsMatchEffect checks exports_generated.go against the installed
// effect package: run go run ./internal/effectglobals/gen in typescript/tsc
// after upgrading effect.
func TestExportsMatchEffect(t *testing.T) {
	modules := os.Getenv("EFFECT_NODE_MODULES")
	if modules == "" {
		modules = "../../../../experiments/node_modules"
	}
	declarations, err := os.ReadFile(filepath.Join(modules, "effect", "dist", "Effect.d.ts"))
	if err != nil {
		t.Skipf("effect is not installed: %v", err)
	}
	var manifest struct{ Version string }
	data, err := os.ReadFile(filepath.Join(modules, "effect", "package.json"))
	if err != nil || json.Unmarshal(data, &manifest) != nil {
		t.Fatalf("effect's package.json: %v", err)
	}
	generated, err := os.ReadFile("exports_generated.go")
	if err != nil {
		t.Fatal(err)
	}
	if want := Generated(manifest.Version, ParseExports(string(declarations))); string(generated) != want {
		t.Errorf("exports_generated.go is not effect@%s's Effect module; run go run ./internal/effectglobals/gen in typescript/tsc", manifest.Version)
	}
}

// TestParseExports reads each form of export that dist/Effect.d.ts uses, and
// skips types, comments, and declarations it does not export.
func TestParseExports(t *testing.T) {
	declarations := `
/** export declare const commented: number */
export declare const succeed: <A>(value: A) => Effect<A>;
export declare function gen<A>(f: () => A): Effect<A>;
export declare class Transaction extends Transaction_base {}
export type Success<T> = T;
export interface Effect<A> {}
declare const try_: <A>(f: () => A) => Effect<A>;
export {
/**
 * Effect.try
 */
try_ as try };
export { void_ as void };
declare const local: number;
`
	got := ParseExports(declarations)
	want := []string{"Transaction", "gen", "succeed", "try", "void"}
	if !slices.Equal(got, want) {
		t.Errorf("ParseExports = %v, want %v", got, want)
	}
}

// TestClashes pins which exports of effect@4.1.1's Effect module are not
// globals (VIP-6), and why.
func TestClashes(t *testing.T) {
	want := map[string]string{
		"catch": "a reserved word", "let": "a reserved word", "try": "a reserved word", "void": "a reserved word",
		"undefined":     "a JavaScript global",
		"interruptible": "a VibeLang keyword", "match": "a VibeLang keyword", "provide": "a VibeLang keyword",
		"service": "a VibeLang keyword", "uninterruptible": "a VibeLang keyword", "when": "a VibeLang keyword",
	}
	got := map[string]string{}
	for _, name := range Exports {
		if why := Clash(name); why != "" {
			got[name] = why
		} else if !Names[name] {
			t.Errorf("%s clashes with nothing but is not a global", name)
		}
	}
	for name, why := range want {
		if got[name] != why {
			t.Errorf("Clash(%q) = %q, want %q", name, got[name], why)
		}
	}
	for name, why := range got {
		if want[name] == "" {
			t.Errorf("Clash(%q) = %q, which this test does not expect", name, why)
		}
	}
	for _, name := range []string{"retry", "sleep", "tryPromise", "sync", "callback", "interrupt", "yieldNow", "as", "fn", "gen"} {
		if !Names[name] {
			t.Errorf("%s is not a global", name)
		}
	}
	if len(Names)+len(want) != len(Exports) {
		t.Errorf("%d globals and %d clashes, but %d exports", len(Names), len(want), len(Exports))
	}
}
