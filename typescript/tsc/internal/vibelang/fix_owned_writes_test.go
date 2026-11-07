package vibelang

import (
	"strings"
	"testing"
)

// One plain --fix run writes the owned sources, an imported one that
// exclude leaves out of root discovery among them, and the owned configs the
// named codemods migrate: the legacy severity map in an owned base, the
// retired declarationSidecars and the explicit Effect language-service plugin
// entry a severity key alone activated (EK3012). Nothing else changes, and a
// second run changes nothing.
func TestFixWritesOwnedSourcesAndConfigs(t *testing.T) {
	dir := onlyProject(t, nil)
	writeProjectFiles(t, dir, map[string]string{
		"tsconfig.json":    `{"extends":"./config/base.json","compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"allowImportingTsExtensions":true},"vibe":{"declarationSidecars":true,"severities":{"EK3801":"warning"}},"include":["*.vibe"],"exclude":["helper.vibe"]}`,
		"config/base.json": "{\n  // the shared base\n  \"vibelang\": {\"diagnostics\": {\"EK4609\": \"off\"}}\n}\n",
		"main.vibe":        "import type { H } from \"./helper.vibe\"\nexport type A = Effect.Effect<H>\n",
		"helper.vibe":      "export type H = number\nexport type B = Effect.Effect<string>\n",
	})
	before := projectBytes(t, dir)
	status, sys := runFix(t, dir)
	if status != 0 {
		t.Fatalf("status %d\nstdout %s\nstderr %s", status, sys.stdout.String(), sys.stderr.String())
	}
	after := projectBytes(t, dir)
	// rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#10b8a597b9ef26f4 | **Amended 2026-11-01, extended 2026-11-03 for VIP-38’s config migration: which files `--fix` writes.** A run writes only its selected project's owned `.vibe`/`.vibex` program sources, including imported owned sources excluded from root discovery, and owned configs for the named legacy-severity, retired-`declarationSidecars` and VIP-38 `EK3012` plugin-entry codemods and VIP-1's `--fix-vip-only` `EK4802` severity override.
	expectChanged(t, before, after, "main.vibe", "helper.vibe", "tsconfig.json", "config/base.json")
	if strings.Contains(after["helper.vibe"], "Effect.Effect") || strings.Contains(after["main.vibe"], "Effect.Effect") {
		t.Errorf("a source was not repaired:\n%s\n%s", after["main.vibe"], after["helper.vibe"])
	}
	if base := after["config/base.json"]; strings.Contains(base, `"vibelang"`) || !strings.Contains(base, `"severities"`) || !strings.Contains(base, "// the shared base") {
		t.Errorf("the owned base was not migrated preserving its comment:\n%s", base)
	}
	if config := after["tsconfig.json"]; strings.Contains(config, "declarationSidecars") || !strings.Contains(config, `"@effect/language-service"`) || !strings.Contains(config, `"EK3801"`) {
		t.Errorf("the selected config was not migrated:\n%s\n%s", config, sys.stdout.String())
	}
	again, second := runFix(t, dir)
	if again != 0 {
		t.Fatalf("second run: status %d, %s", again, second.stderr.String())
	}
	if done := projectBytes(t, dir); done["tsconfig.json"] != after["tsconfig.json"] {
		t.Errorf("a second run changed the config:\n%s\nfirst run:\n%s\nsecond run:\n%s", done["tsconfig.json"], sys.stdout.String(), second.stdout.String())
	}
	expectChanged(t, after, projectBytes(t, dir))
}
