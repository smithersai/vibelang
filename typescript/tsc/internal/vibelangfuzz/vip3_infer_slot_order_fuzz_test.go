package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const inferSlotCommentQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."

func TestVIP3InferSlotMigrationOrderQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", inferSlotCommentQuote)
	chapterSays(t, "007-tooling.md", legacyEffectAliasQuote)
	annotationTwinChapters(t)
}

// VIP-3's annotation twin and Chapter 7's preserving migration rule require
// writing an inferred channel only after VIP-1 has restored the old run sites.
// In particular, an unrun service call must not freeze E as never.
func FuzzVIP3InferSlotMigrationOrder(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "007-tooling.md", inferSlotCommentQuote)
	chapterSays(f, "007-tooling.md", legacyEffectAliasQuote)
	annotationTwinChapters(f)
	w := NewWorkspace(f)
	tsc := annotationTwinTypeScript(f)
	for shape := range uint8(4) {
		for op := range uint8(2) {
			f.Add(shape, op, false)
			f.Add(shape, op, true)
		}
	}
	f.Fuzz(func(t *testing.T, shape, op uint8, marked bool) {
		const target = "FuzzVIP3InferSlotMigrationOrder"
		defer recoverCompilerPanic(t, target)
		shape, op = shape%4, op%2
		key := fmt.Sprintf("shape:%d:operation:%d:marked:%t", shape, op, marked)
		a, oldBody, newBody := "number", "fs.remove(path); return 0", "yield* fs.remove(path); return 0"
		if op == 1 {
			a, oldBody, newBody = "string", "return fs.readFileString(path)", "return yield* fs.readFileString(path)"
		}
		annotations := []string{
			a + "!infer E!FileSystem.FileSystem",
			"Effect.Effect<" + a + ", infer E, FileSystem.FileSystem>",
			"Effect<" + a + ", infer E, FileSystem.FileSystem>",
			"Effect<infer A, infer E, infer R>",
		}
		mark := ""
		if marked {
			mark = "effect "
		}
		leading := []string{"// Leading migration comment.\n", "/* Leading migration comment. */\n"}[shape%2]
		trailing := []string{"// Trailing migration comment.\n", "/* Trailing migration comment. */\n"}[op]
		source := leading + "import { FileSystem } from \"effect\"\nexport const work = " + mark +
			"(path: string): " + annotations[shape] + " => { const fs = FileSystem.FileSystem(); " + oldBody + " }\n" + trailing
		before := toolsCompile(t, w, target, map[string]string{"main.vibe": source})
		defer before.Remove()
		options := vibelang.FixOptions{VIPOnly: true}
		fixed := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), options)
		if fixed.Err != nil || len(fixed.Refused) != 0 || len(fixed.Files) != 1 {
			Gap(t, target, "migration:"+key, "%s; error %v, refused %+v, files %d\n%s",
				legacyEffectAliasQuote, fixed.Err, fixed.Refused, len(fixed.Files), source)
			return
		}
		text := ""
		for _, file := range fixed.Files {
			text = file.Text
		}
		if !strings.HasPrefix(text, leading) || !strings.HasSuffix(text, trailing) {
			Gap(t, target, "comments:"+key, "%s\nfixed:\n%s", inferSlotCommentQuote, text)
			return
		}
		if strings.Contains(text, "infer ") || !strings.Contains(text, "const fs = try FileSystem.FileSystem") {
			Gap(t, target, "incomplete:"+key, "VIP-1 runs and VIP-3 infer slots must both migrate\n%s", text)
			return
		}
		after := toolsCompile(t, w, target, map[string]string{"main.vibe": text})
		defer after.Remove()
		if !toolsErrorFree(after) {
			Gap(t, target, "new-error:"+key, "%s\n%v\n%s", legacyEffectAliasQuote,
				SortedKeys(Keys(after.Dir, after.Diagnostics)), text)
			return
		}
		again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), options)
		if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
			Gap(t, target, "idempotence:"+key, "second migration changes %d files, error %v, refused %+v",
				len(again.Files), again.Err, again.Refused)
			return
		}
		native := after.Outputs["out/main.d.ts"]
		if native == "" {
			t.Fatal("migration emitted no declaration")
		}
		twin := "import { Effect, FileSystem, PlatformError } from \"effect\"\n" +
			"export const work = Effect.fn(function* (path: string): Effect.fn.Return<" + a +
			", PlatformError.PlatformError, FileSystem.FileSystem> { const fs = yield* FileSystem.FileSystem; " + newBody + " })\n"
		check := "import { work as native } from \"./fixed.js\"\nimport { work as twin } from \"./main.js\"\n" +
			"type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false\n" +
			"export const same: Same<ReturnType<typeof native>, ReturnType<typeof twin>> = true\n"
		out, ok := runAnnotationTwinTSC(t, w, tsc, map[string]string{
			"main.ts": twin, "fixed.d.ts": native, "check.ts": check,
		}, `"main.ts", "fixed.d.ts", "check.ts"`)
		if !ok {
			Gap(t, target, "declaration:"+key, "%s\n%s\nfixed:\n%s\ndeclaration:\n%s\ntwin:\n%s",
				legacyEffectAliasQuote, out, text, native, twin)
		}
	})
}
