package vibelang

import (
	"strings"
	"testing"
)

// Exercise whole-binding planning without other style fixes interfering.
func TestTrustedEmptyMigrationPlans(t *testing.T) {
	for name, body := range map[string]string{
		"direct":     "return safe(1, 2)",
		"arithmetic": "return safe(1, 2) + 3",
		"branch":     "return n ? safe(1, 2) : safe(3, 4)",
		"loop":       "let x = 0; for (let i = 0; i < n; i++) x += safe(i, 2); return x",
		"shadow":     "function local(safe: number) { return safe }; return safe(1, 2)",
	} {
		t.Run(name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, "import { trusted } from \"vibelang-runtime\"\nconst safe = trusted(Math.max, [])\nexport effect function f(n: number) { "+body+" }")
			p := trustedEmptyMigrationFixes(t.Context(), program, file, map[string]bool{})
			if len(p.fixes) != 1 || strings.Contains(p.text(), "trusted(Math.max, [])") || !strings.Contains(p.text(), "Effect.orDie") {
				t.Fatalf("no complete migration: %s", p.text())
			}
		})
	}
	for name, source := range map[string]string{
		"eval-escape":      "const safe = trusted(Math.max, []); function leak() { return eval(\"safe\") }; export effect function f() { return safe(1, 2) }",
		"mutable":          "let safe = trusted(Math.max, []); export effect function f() { return safe(1, 2) }",
		"type":             "const safe: ReturnType<typeof trusted<typeof Math.max, []>> = trusted(Math.max, []); export effect function f() { return safe(1, 2) }",
		"export-alias":     "const safe = trusted(Math.max, []); export { safe }; export effect function f() { return safe(1, 2) }",
		"export-renamed":   "const safe = trusted(Math.max, []); export { safe as renamed }; export effect function f() { return safe(1, 2) }",
		"shorthand-escape": "const safe = trusted(Math.max, []); export const escaped = { safe }; export effect function f() { return safe(1, 2) }",
		"callback":         "const safe = trusted(Math.max, []); export const f = [1].map(x => safe(x, 2))",
		"nested-calls":     "const safe = trusted(Math.max, []); export effect function f() { return safe(safe(1, 2), 2) }",
		"throw-operand":    "const safe = trusted(Math.max, []); export effect function f(): number!Error! { return safe(throw new Error(\"bad\"), 2) }",
		"return-operand":   "const safe = trusted(Math.max, []); export effect function f(n: number): number!! { return safe(do { if (n) return 42; 1 }, 2) }",
		"effect-operand":   "const safe = trusted(Math.max, []); export effect function f() { return safe(try Effect.succeed(1), 2) }",
		"class-field":      "const safe = trusted(Math.max, []); export effect function f() { class C { field = safe(1, 2) }; return new C().field }",
		"effect-shadow":    "const safe = trusted(Math.max, []); export effect function f() { const Effect = { try: () => 0 }; return safe(1, 2) }",
		"native-namesake":  "function trusted<F>(f: F, errors: never[]): F { return f }; const safe = trusted(Math.max, []); export effect function f() { return safe(1, 2) }",
	} {
		t.Run(name, func(t *testing.T) {
			header := "import { trusted } from \"vibelang-runtime\"\n"
			if name == "native-namesake" {
				header = ""
			}
			program, file, _, _ := editorProgram(t, header+source)
			if p := trustedEmptyMigrationFixes(t.Context(), program, file, map[string]bool{}); len(p.fixes) != 0 {
				t.Fatalf("unsafe migration: %s", p.text())
			}
		})
	}
}

func TestTrustedEmptyConstructorBinding(t *testing.T) {
	for name, source := range map[string]string{
		"namespace": "import * as Runtime from \"vibelang-runtime\"; const safe = Runtime.trusted(Math.max, []); export effect function main() { return safe(1, 2) }",
		"proxy":     "import * as Runtime from \"vibelang-runtime\"; const ProxyRuntime = new Proxy(Runtime, {}); const safe = ProxyRuntime.trusted(Math.max, []); export effect function main() { return safe(1, 2) }",
	} {
		t.Run(name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			p := trustedEmptyMigrationFixes(t.Context(), program, file, map[string]bool{})
			want := 0
			if name == "namespace" {
				want = 1
			}
			if len(p.fixes) != want {
				t.Fatalf("constructor binding: want %d rewrites, got %d: %s", want, len(p.fixes), p.text())
			}
		})
	}
}
