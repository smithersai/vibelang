package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The wrapper that keeps a generator's call exception a defect loses what
// control flow proved about a property the call reads, so EK1002's fix keeps
// the proof as EK0403's does: the guard joins the call in the function, or the
// read moves to a const under the guard. opencode's ai protocols kept their
// generators over this (cohere-chat: content.thinking !== undefined ?
// Lifecycle.reasoningDelta(…, content.thinking) : …, TS2345).
func TestEffectGenDefectBridgeKeepsNarrowing(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	const open, close = "try Effect.orDie(Effect.try({ try: () => ", ", catch: (e) => e }))"
	for name, tc := range map[string]struct{ body, want string }{
		"ternary":         {"return o.p ? double(o.p) : 0", "return " + open + "o.p ? double(o.p) : 0" + close},
		"ternary inside":  {"const r = o.p !== undefined ? double(o.p) : 0\n  return r", "const r = " + open + "o.p !== undefined ? double(o.p) : 0" + close},
		"both branches":   {"const r = o.p !== undefined ? double(o.p) : label(\"n\", n).length\n  return r", "const r = " + open + "o.p !== undefined ? double(o.p) : label(\"n\", n).length" + close},
		"and":             {"return o.p !== undefined && double(o.p) > 0", open + "o.p !== undefined && double(o.p) > 0" + close},
		"if block":        {"if (o.p) {\n    const r = double(o.p)\n    return r\n  }\n  return 0", "if (o.p) {\n    const n2 = o.p\n    const r = " + open + "double(n2)" + close},
		"early return":    {"if (!o.p) return 0\n  return double(o.p)", "if (!o.p) return 0\n  const n2 = o.p\n  return " + open + "double(n2)" + close},
		"unbraced branch": {"let r = 0\n  if (o.p) r = double(o.p)\n  return r", "if (o.p) {\n    const n2 = o.p\n    r = (" + open + "double(n2)" + close + ")\n  }"},
		"else branch":     {"let r = 0\n  if (!o.p) r = 1\n  else r = double(o.p)\n  return r", "else {\n    const n2 = o.p\n    r = (" + open + "double(n2)" + close + ")\n  }"},
		"two statements":  {"if (!o.p || !o.q) return 0\n  const a = double(o.p)\n  return a + double(o.q)", "const n2 = o.p\n  const a = " + open + "double(n2)" + close + "\n  const n3 = o.q\n  return a + (" + open + "double(n3)" + close + ")"},
	} {
		t.Run(name, func(t *testing.T) {
			dir := copyCompilerFixture(t, filepath.Join(root, "typescript/vibelang/cases/ek4401-fix.fail"), root)
			source := "import { double, label } from \"./plain.ts\"\nexport const value = Effect.fnUntraced(function* (n: number, o: { readonly p?: number; readonly q?: number }) {\n  " + tc.body + "\n})\n"
			if err := os.WriteFile(filepath.Join(dir, "lib.vibe"), []byte(source), 0o644); err != nil {
				t.Fatal(err)
			}
			result := fixCase(t, dir)
			if len(result.Refused) != 0 {
				t.Errorf("refused: %v", result.Refused)
			}
			got := ""
			for file, fixed := range result.Files {
				if filepath.Base(file.AsString()) == "lib.vibe" {
					got = fixed.Text
				}
			}
			if !strings.Contains(got, "effect (n: number") || !strings.Contains(got, tc.want) {
				t.Errorf("--fix writes\n%s\nwant it to hold\n%s", got, tc.want)
			}
		})
	}
}

// Where no form keeps the proof, the call alone goes through the wrapper, as
// before, and the fix gate decides: String(o.p) accepts what the guard ruled
// out. Of two calls in one statement, the first still keeps its proof.
func TestEffectGenDefectBridgeNarrowingFallsBack(t *testing.T) {
	for _, test := range []struct{ name, source, want, not string }{
		{"a yield in the guard", "export const g = (o: { readonly p?: number }, e: Effect.Effect<boolean>) => Effect.gen(function* () {\n  return (yield* e) && o.p !== undefined ? JSON.parse(String(o.p)) : 0\n})\n", "try: () => JSON.parse(String(o.p)), catch", "= o.p\n"},
		{"a call before the read", "const touch = (): number => 1\nexport const g = (o: { readonly p?: string }) => Effect.gen(function* () {\n  if (!o.p) return 0\n  return touch() + JSON.parse(o.p)\n})\n", "try: () => JSON.parse(o.p), catch", "= o.p\n"},
		{"two calls in one statement", "export const g = (o: { readonly p?: string; readonly q?: string }) => Effect.gen(function* () {\n  if (!o.p || !o.q) return 0\n  return JSON.parse(o.p) + JSON.parse(o.q)\n})\n", "try: () => JSON.parse(o.q), catch", "= o.q\n"},
		{"a loop head", "export const g = (o: { readonly p?: string }) => Effect.gen(function* () {\n  if (!o.p) return 0\n  for (let i = JSON.parse(o.p); i > 0; i--) yield* Effect.void\n  return 1\n})\n", "let i = try Effect.orDie(Effect.try({ try: () => JSON.parse(o.p), catch", "= o.p\n"},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, ok := effectGenQuickFix(t, test.source)
			if !ok {
				t.Fatalf("no quick fix; notes: %s", effectGenNotes(t, test.source))
			}
			if !strings.Contains(got, test.want) || strings.Contains(got, test.not) {
				t.Fatalf("got:\n%s\nwant the call alone in the wrapper, %q", got, test.want)
			}
		})
	}
}
