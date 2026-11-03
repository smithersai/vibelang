package vibelang

import (
	"strings"
	"testing"
)

func TestFixRelicForkBlock(t *testing.T) {
	for _, body := range []string{
		"return 7",
		"/* keep */ return try Effect.succeed(7)",
		"const child = fork { return 7 }; return join child",
		"try Effect.yieldNow(); return 7",
	} {
		t.Run(body, func(t *testing.T) {
			source := "export effect function main() { const child = fork /* capture */ { " + body + " }; return join child }"
			result, name, _ := fixOnce(t, source)
			fixed := result.Files[name]
			if result.Err != nil || len(result.Refused) != 0 || fixed == nil {
				t.Fatalf("missing safe fork-block migration: err=%v refused=%+v fixed=%+v", result.Err, result.Refused, fixed)
			}
			if !strings.Contains(fixed.Text, "fork /* capture */ effect {") || strings.Contains(fixed.Text, "fork {") {
				t.Fatalf("bare fork block remains: %s", fixed.Text)
			}
		})
	}
}

func TestFixRelicForkBlockControls(t *testing.T) {
	for _, source := range []string{
		"export effect function main() { const child = fork effect { return 7 }; return join child }",
		"export effect function main() { const child = fork Effect.succeed(7); return join child }",
		"export function main() { const fork = (x: number) => x; return fork(7) }",
		"export const text = 'fork { return 7 }'",
	} {
		_, file, _, _ := editorProgram(t, source)
		proposed := relicForkBlockFixes(file, map[string]bool{})
		if len(proposed.fixes) != 0 {
			t.Fatalf("bare-block migration claimed non-relic source %s: %+v", source, proposed)
		}
		// Other project fixes are independent of this migration's scope.
		result, name, _ := fixOnce(t, source)
		if result.Err != nil {
			t.Fatal(result.Err)
		}
		if fixed := result.Files[name]; fixed != nil {
			t.Logf("other --fix rewrites for control %q: %s", source, fixed.Text)
		}
	}
}

func TestFixRelicForkBlockSpacing(t *testing.T) {
	for _, gap := range []string{"", " ", "\n", "/* KEEP */"} {
		source := "export effect function main(){const child=fork" + gap + "{return 7};return join child}"
		result, name, _ := fixOnce(t, source)
		fixed := result.Files[name]
		if result.Err != nil || len(result.Refused) > 0 || fixed == nil || !strings.Contains(fixed.Text, "effect {") {
			t.Fatalf("word boundary lost for %q: %+v fixed %+v", gap, result, fixed)
		}
	}
}
