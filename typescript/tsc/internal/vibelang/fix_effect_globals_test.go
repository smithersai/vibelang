package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// VIP-6 puts Effect exports in scope; Chapter 7 allows preserving cosmetic
// rewrites only. Imported aliases count, while a shadowed value stays qualified.
func TestFixEffectGlobalCalls(t *testing.T) {
	for _, tc := range []struct{ name, source, want string }{
		{"retry", "export const f = effect () => try Effect.retry(Effect.void, { times: 1 })\n", "try retry("},
		{"namespace-alias", "import * as E from \"effect/Effect\"\nexport const f = effect () => try E.sleep(\"1 millis\")\n", "try sleep("},
		{"held-call", "export const f = () => Effect.sleep(\"1 millis\")\n", "() => sleep("},
		{"prefix-comment", "export const f = () => Effect /* retained */ .sleep(\"1 millis\")\n", "Effect /* retained */ .sleep("},
		{"parameter-shadow", "export const f = (sleep: number) => Effect.sleep(\"1 millis\")\n", "Effect.sleep("},
		{"block-shadow", "export const f = () => { const sleep = 1; return Effect.sleep(\"1 millis\") }\n", "Effect.sleep("},
		{"type-shadow", "type sleep = string\nexport const f = () => Effect.sleep(\"1 millis\")\n", "() => sleep("},
		{"namespace-parameter", "export const f = (E: typeof import(\"effect/Effect\")) => E.sleep(\"1 millis\")\n", "E.sleep("},
		{"object-property", "const E = { sleep: Effect.sleep }\nexport const f = () => E.sleep(\"1 millis\")\n", "E.sleep("},
		{"ambient-shadow", "declare const sleep: number\nexport const f = () => Effect.sleep(\"1 millis\")\n", "Effect.sleep("},

		{"native-module-body", "module native { import * as Effect from \"effect/Effect\"; import { sleep } from \"effect/Effect\"; export const value = () => Effect.sleep(\"1 millis\") }\nimport { value } from native\nexport { value }\n", "Effect.sleep("},
		{"value-reference", "export const f = Effect.sleep\n", "Effect.sleep"},
		{"reserved", "export const f = () => Effect.succeed(1)\n", "Effect.succeed("},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fixed, result := fixedPipe(t, tc.source)
			if result.Err != nil || len(result.Refused) != 0 || !strings.Contains(fixed, tc.want) {
				t.Fatalf("err=%v refused=%+v\n%s\nwant %q", result.Err, result.Refused, fixed, tc.want)
			}
			again, next := fixedPipe(t, fixed)
			if again != fixed || next.Err != nil || len(next.Refused) != 0 {
				t.Fatalf("not idempotent: %s\n%s", fixed, again)
			}
		})
	}
}

func TestFixEffectGlobalDisabled(t *testing.T) {
	for _, option := range []string{"effectGlobals", "effectModules"} {
		t.Run(option, func(t *testing.T) {
			source := "import * as E from \"effect/Effect\"\nexport const f = () => E.sleep(\"1 millis\")\n"
			_, file, _, _ := editorProgram(t, source)
			dir := filepath.Dir(file.FileName().AsString())
			config := "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true},\"vibe\":{\"" + option + "\":false},\"files\":[\"main.vibe\"]}"
			if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(config), 0600); err != nil {
				t.Fatal(err)
			}
			result := fixCase(t, dir)
			text := source
			if fixed := result.Files[file.FileName()]; fixed != nil {
				text = fixed.Text
			}
			want := "E.sleep("
			if option == "effectModules" {
				want = "=> sleep(" // VIP-14 keeps the function and namespace switches independent.
			}
			if result.Err != nil || len(result.Refused) != 0 || !strings.Contains(text, want) {
				t.Fatalf("disabled globals shortened: %v %+v\n%s", result.Err, result.Refused, text)
			}
		})
	}
}

func TestFixEffectGlobalKeepsSidecarImport(t *testing.T) {
	source := "import * as E from \"effect/Effect\"\nexport const f = () => E.sleep(\"1 millis\")\n"
	before, file, _, _ := editorProgram(t, source)
	original := declarationsOf(t.Context(), before, []tspath.RootedFilePath{file.FileName()})[file.FileName()]
	if original == "" {
		t.Fatal("control produced no forced declaration")
	}
	fixed, result := fixedPipe(t, source)
	if result.Err != nil || len(result.Refused) != 0 || !strings.Contains(fixed, "import * as E") || !strings.Contains(fixed, "=> sleep(") {
		t.Fatalf("lost a sidecar import: %v %+v\n%s", result.Err, result.Refused, fixed)
	}
	after, next, _, _ := editorProgram(t, fixed)
	declaration := declarationsOf(t.Context(), after, []tspath.RootedFilePath{next.FileName()})[next.FileName()]
	if original != declaration {
		t.Fatalf("sidecar changed despite declaration:false\nbefore:\n%s\nafter:\n%s", original, declaration)
	}
}
