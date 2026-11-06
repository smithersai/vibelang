package vibelangfuzz

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const refusedRenameQuote = "A rewrite that can't preserve types, behavior and declaration output refuses at that site."
const refusedRenameFixedPointQuote = "One `vibelang --fix` run applies fixes until none applies; running it again changes nothing."

func TestRefusedRenameSitesQuoted(t *testing.T) {
	for _, quote := range []string{refusedRenameQuote, refusedRenameFixedPointQuote} {
		if !strings.Contains(SpecText("007-tooling.md"), quote) {
			t.Fatal(quote)
		}
	}
}

// Vary the reserved binding, the number and separation of its uses, and
// independent shorthand repairs between them. Refusing the rename protects
// its edits; it must not reserve unrelated text between those edits.
func FuzzRefusedRenameSites(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"join", "fork"} {
		for variant := byte(0); variant < 3; variant++ {
			f.Add(key, variant)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant byte) {
		TestRefusedRenameSitesQuoted(t)
		if key != "fork" {
			key = "join"
		}
		count := 2 + int(variant%3)
		var b strings.Builder
		fmt.Fprintf(&b, "import { Effect } from \"effect\"\nimport { %s } from \"./helper.ts\"\nexport function plain() { return %s(\"p\", \"q\") }\n", key, key)
		for i := 0; i < count; i++ {
			fmt.Fprintf(&b, "export const p%d = Effect.gen(function* () {\n  yield* Effect.void\n  return %s(\"a\", \"b\")\n})\n", i, key)
			if i+1 < count {
				fmt.Fprintf(&b, "// preserve λ %d\nexport type T%d = Effect.Effect<number>\n", i, i)
			}
		}
		source := b.String()
		config := `{"compilerOptions":{"strict":true,"target":"ES2022","module":"NodeNext","skipLibCheck":true,"noEmit":true,"allowImportingTsExtensions":true},"files":["main.vibe","helper.ts"]}`
		files := map[string]string{
			"main.vibe":    source,
			"helper.ts":    fmt.Sprintf("/** @throws {RangeError} */\nexport function %s(a: string, b: string): string { return a + b }\n", key),
			"package.json": `{"type":"module"}`,
		}
		before, err := w.Compile(t.Context(), Project{Config: config, Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
		fixed := source
		for name, file := range result.Files {
			if filepath.Base(name.AsString()) == "main.vibe" {
				fixed = file.Text
			}
		}
		if result.Err != nil || len(result.Changed) != 0 {
			Gap(t, "FuzzRefusedRenameSites", key, "%s: refused bytes changed: %v %+v\n%s", refusedRenameQuote, result.Err, result.Changed, source)
			return
		}
		for _, refusal := range result.Refused {
			if refusal.Label == "fork and join binding renames" && (!refusal.Spanned || refusal.End-refusal.Start > len(key)) {
				Gap(t, "FuzzRefusedRenameSites", key, "%s: refusal includes unrelated text: %+v\n%s", refusedRenameQuote, refusal, source)
				return
			}
		}
		for _, site := range result.Sites {
			if filepath.Base(site.File.AsString()) == "main.vibe" && !vibelang.SiteHolds(source, fixed, site) {
				Gap(t, "FuzzRefusedRenameSites", key, "%s: %+v\n%s", refusedRenameQuote, site, source)
				return
			}
		}
		if strings.Contains(fixed, "Effect.Effect<number>") {
			Gap(t, "FuzzRefusedRenameSites", key, "%s: independent type repairs between uses were held\n%s\nafter:\n%s", refusedRenameFixedPointQuote, source, fixed)
			return
		}
		ExpectPending(t, "FuzzRefusedRenameSites", key)
		ExpectPending(t, "FuzzRefusedRenameSites", specCorpusKey(t))
	})
}
