package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const pipeDeclarationAliasesTarget = "FuzzPipeDeclarationAliases"

func TestPipeDeclarationAliasesQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), migrationDeclarationFixQuote) {
		t.Fatalf("Chapter 7 no longer says %q", migrationDeclarationFixQuote)
	}
}

func TestOpencodeReconnectDeclarationAliases(t *testing.T) {
	w := NewWorkspace(t)
	for mode := uint8(0); mode < 6; mode++ {
		t.Run(fmt.Sprintf("stage-%d", mode), func(t *testing.T) { checkPipeDeclarationAliases(t, w, mode, true, true) })
	}
}

// A curried stage gets contextual types from native .pipe. Uncurrying must
// preserve its public alias spelling, including aliases inside later arrays.
func FuzzPipeDeclarationAliases(f *testing.F) {
	startShortBudget(f)
	for mode := uint8(0); mode < 6; mode++ {
		f.Add(mode, true, true)
		if !testing.Short() || toolsFuzzing() {
			for _, readonly := range []bool{false, true} {
				for _, nullable := range []bool{false, true} {
					f.Add(mode, readonly, nullable)
				}
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, mode uint8, readonly, nullable bool) {
		checkPipeDeclarationAliases(t, w, mode, readonly, nullable)
	})
}

func checkPipeDeclarationAliases(t *testing.T, w *Workspace, mode uint8, readonly, nullable bool) {
	t.Helper()
	TestPipeDeclarationAliasesQuoted(t)
	mark := ""
	if readonly {
		mark = "readonly "
	}
	password, value := "string", `""`
	if nullable {
		password, value = "string | null", "null"
	}
	stage := `Effect.tap(next => Ref.set(current, Exit.succeed(next)))`
	expressions := []string{
		`options.reconnect.pipe(` + stage + `)`,
		`options.reconnect.pipe(` + stage + `, Effect.map(next => [next]))`,
		`options.reconnect.pipe(Effect.map(next => next), ` + stage + `)`,
		`Effect.succeed(0).pipe(Effect.map(() => payload), ` + stage + `)`,
		`options.reconnect.pipe(` + stage + `, Effect.asVoid)`,
		`Effect.succeed(1).pipe(Effect.tap(() => Ref.set(current, Exit.succeed(payload))))`,
	}
	constructor := `Effect.fn("make")`
	if mode%2 != 0 {
		constructor = "Effect.fnUntraced"
	}
	source := `import { Effect, Ref, Exit } from "effect"
import type { Data } from "./creds.js"
export const make = ` + constructor + `(function* (options: { reconnect: Effect.Effect<Data> }) {
 const payload: Data = { url: "ready", password: ` + value + ` }
 const current = yield* Ref.make<Exit.Exit<Data> | undefined>(undefined)
 return { reconnect: ` + expressions[mode%6] + ` }
})
`
	files := map[string]string{"main.ts": source, "model.ts": "export interface Ready { " + mark + "url: string }\n", "creds.ts": `import type { Ready } from "./model.js"` + "\nexport type Data = Ready & { password: " + password + " }\n"}
	native := toolsCompile(t, w, pipeDeclarationAliasesTarget, files)
	defer native.Remove()
	if !toolsErrorFree(native) {
		t.Fatalf("native source must compile: %v\n%s", SortedKeys(Keys(native.Dir, native.Diagnostics)), source)
	}
	delete(files, "main.ts")
	files["main.vibe"] = source
	migrated := toolsCompile(t, w, pipeDeclarationAliasesTarget, files)
	defer migrated.Remove()
	config := toolsConfig(w, migrated.Dir)
	if config == nil || len(config.Errors) > 0 {
		t.Fatal("invalid generated config")
	}
	var fixed *vibelang.FixResult
	toolsRun(t, pipeDeclarationAliasesTarget, "fix", source, nil, func() {
		fixed = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
	})
	key := fmt.Sprintf("aliases:%d:readonly=%t:nullable=%t", mode%6, readonly, nullable)
	if fixed.Err != nil {
		Gap(t, pipeDeclarationAliasesTarget, key, "fix failed: %v", fixed.Err)
	}
	for path, file := range fixed.Files {
		rel := strings.TrimPrefix(path.AsString(), strings.TrimSuffix(migrated.Dir, "/")+"/")
		if rel != "main.vibe" {
			t.Fatalf("fix changed a native dependency: %s", rel)
		}
		files[rel] = file.Text
	}
	after := toolsCompile(t, w, pipeDeclarationAliasesTarget, files)
	defer after.Remove()
	if !toolsErrorFree(after) {
		Gap(t, pipeDeclarationAliasesTarget, key, "fixed source must compile: %v\n%s", SortedKeys(Keys(after.Dir, after.Diagnostics)), files["main.vibe"])
	}
	declaration := func(r *Result) string {
		for path, text := range r.Outputs {
			if strings.HasSuffix(path, "/main.d.ts") {
				return text
			}
		}
		t.Fatal("missing main.d.ts")
		return ""
	}
	want, got := declaration(native), declaration(after)
	if diff := compareDeclarationResults(t, native, after); diff != "" {
		Gap(t, pipeDeclarationAliasesTarget, key, "Chapter 7: %q\nnative:\n%s\nfixed:\n%s\nsource:\n%s\nAPI:\n%s", migrationDeclarationFixQuote, want, got, files["main.vibe"], diff)
	}
	if mode%6 == 5 && strings.Contains(files["main.vibe"], ".pipe(") {
		t.Fatal("a primitive pipeline with unchanged inference must still get its quick fix")
	}
	againConfig := toolsConfig(w, after.Dir)
	var again *vibelang.FixResult
	toolsRun(t, pipeDeclarationAliasesTarget, "fixed point", files["main.vibe"], nil, func() {
		again = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), againConfig, vibelang.FixOptions{})
	})
	if again.Err != nil || len(again.Files) != 0 {
		Gap(t, pipeDeclarationAliasesTarget, key, "second fix must keep the source unchanged: %v, %v", again.Err, again.Order)
	}
}
