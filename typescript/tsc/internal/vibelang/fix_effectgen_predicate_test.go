package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A foreign type predicate an if tests keeps its proof through EK1002's
// rewrite, as EK0403's fix keeps it: a const holds the tested value or
// undefined, and the narrowed scope reads the const. The boolean bridge the
// rewrite used to write proved nothing, so the destructuring after
// if (!isRecord(body)) return … read unknown (opencode's ai protocols:
// TS2339 and TS2700 in the rewrite).
func TestEffectGenDefectBridgeKeepsPredicates(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	const bridge = "const record = try Effect.orDie(Effect.try({ try: () => isRecord(body) ? body : undefined, catch: (e) => e }))"
	for name, tc := range map[string]struct {
		body string
		want []string
	}{
		"early return": {"if (!isRecord(body)) return 0\n  const { a, ...rest } = body\n  return Object.keys(rest).length + (a === undefined ? 0 : 1)", []string{bridge, "if (record === undefined) return 0", "= record"}},
		"positive":     {"if (isRecord(body)) {\n    return Object.keys(body).length\n  }\n  return 0", []string{bridge, "if (record !== undefined) {", "Object.keys(record)"}},
		"else":         {"if (!isRecord(body)) {\n    return 0\n  } else {\n    return Object.keys(body).length\n  }", []string{bridge, "Object.keys(record)"}},
	} {
		t.Run(name, func(t *testing.T) {
			dir := copyCompilerFixture(t, filepath.Join(root, "typescript/vibelang/cases/ek4401-fix.fail"), root)
			predicate := "export function isRecord(x: unknown): x is Record<string, unknown> { return typeof x === \"object\" && x !== null }\n"
			if err := os.WriteFile(filepath.Join(dir, "predicate.ts"), []byte(predicate), 0o644); err != nil {
				t.Fatal(err)
			}
			source := "import { isRecord } from \"./predicate.ts\"\nexport const value = (body: unknown) => Effect.gen(function* () {\n  yield* Effect.void\n  " + tc.body + "\n})\n"
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
			for _, want := range tc.want {
				if strings.Contains(got, "function*") || !strings.Contains(got, want) {
					t.Errorf("--fix writes\n%s\nwant it to hold\n%s", got, want)
				}
			}
		})
	}
}
