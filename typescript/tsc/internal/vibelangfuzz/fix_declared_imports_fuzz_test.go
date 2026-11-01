package vibelangfuzz

import (
	"maps"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// Chapter 7: --fix keeps an import a module's declaration needs. A prelude name
// being available without its import does not make the import unneeded: once it
// goes, the emitter re-adds the name out of source order and prints an inferred
// Schema.String as an import type. So a program's declaration is the same bytes
// before and after --fix, whichever fix mode and compiler options run it, and
// every .vibe module has a declaration, its sidecar, so noEmit changes nothing
// (decided detail 277; Smithers' 9 re-recorded modules, opencode-41).
// Comparing the compiler with itself across the fix is this target's oracle.
const fixDeclaredQuote = "`--fix` keeps an import that a module's declaration needs"

var fixDeclaredPrograms = []struct{ key, source string }{
	{"scope-only-type", "import type { Scope } from \"effect\"\nimport { Effect } from \"effect\"\nexport const a = (x: Effect.Effect<number>): Effect.Effect<number, never, Scope.Scope> => x\n"},
	{"inferred-name", "import { Schema } from \"effect\"\nexport const S = Schema.String\n"},
	{"alias", "import { Layer, Path as EffectPath } from \"effect\"\nexport const live: Layer.Layer<EffectPath.Path> = EffectPath.layer\n"},
	{"import-order", "import type { Tag } from \"./h.ts\"\nimport { Layer, Path as EffectPath, Schema } from \"effect\"\nexport const S = Schema.String\nexport const live: Layer.Layer<EffectPath.Path> = EffectPath.layer\nexport type T = Tag\n"},
	{"import-after-relative", "import { Schema } from \"effect\"\nimport type { Tag } from \"./h.ts\"\nexport const S: Schema.String = Schema.String\nexport type T = Tag\n"},
	{"named-order", "import { Schema, Option, Layer } from \"effect\"\nexport const S = Schema.String\nexport const o: Option.Option<number> = Option.none()\nexport type L = Layer.Layer<never>\n"},
	{"re-export", "import { Option } from \"effect\"\nexport { Option }\nexport const o: Option.Option<number> = Option.none()\n"},
	{"single-quotes", "import { Option } from 'effect'\nexport const o: Option.Option<number> = Option.none()\n"},
	{"namespace", "import * as Option from \"effect/Option\"\nexport const o: Option.Option<number> = Option.none()\n"},
	{"unused-value", "import { Option } from \"effect\"\nexport const n: number = Option.getOrElse(Option.some(1), () => 0)\n"},
}

var fixDeclaredConfigs = []struct{ key, options string }{
	{"declaration", ""},
	{"no-emit", `"noEmit": true, "declaration": false, "sourceMap": false, "outDir": null,`},
	{"no-declaration", `"declaration": false,`},
}

var fixDeclaredModes = []struct {
	key     string
	options vibelang.FixOptions
}{
	{"plain", vibelang.FixOptions{}},
	{"migration-only", vibelang.FixOptions{MigrationOnly: true}},
	{"vip-only", vibelang.FixOptions{VIPOnly: true}},
}

var fixDeclaredSuffixes = []string{".vibe", ".vibex"}

func fixDeclaredChapter(tb testing.TB) {
	chapter, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		tb.Fatal(err)
	}
	if !strings.Contains(string(chapter), fixDeclaredQuote) {
		tb.Fatalf("chapter 7 no longer says %q", fixDeclaredQuote)
	}
}

func TestFixDeclaredImportsQuoted(t *testing.T) { fixDeclaredChapter(t) }

func FuzzFixDeclaredImports(f *testing.F) {
	startShortBudget(f)
	fixDeclaredChapter(f)
	for i, program := range fixDeclaredPrograms {
		config := fixDeclaredConfigs[i%len(fixDeclaredConfigs)]
		f.Add([]byte(program.key + "/" + config.key + "/plain/.vibe"))
	}
	f.Add([]byte("import-order/no-emit/vip-only/.vibex"))
	f.Add([]byte("inferred-name/declaration/migration-only/.vibe"))
	w := NewWorkspace(f)
	declaration := func(t *testing.T, name string, files map[string]string) (string, bool) {
		project := Project{Files: map[string]string{}}
		maps.Copy(project.Files, files)
		project.Config = strings.TrimSuffix(DefaultConfig, "\n}") + ",\n  \"files\": [\"" + name + "\"]\n}"
		project.Config = strings.Replace(project.Config, `"strict": true,`, `"strict": true, "allowImportingTsExtensions": true, "emitDeclarationOnly": true,`, 1)
		r, err := w.Compile(t.Context(), project)
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		text, ok := r.Outputs["out/main.d.ts"]
		return text, ok
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		pi, ci, mi, si := 0, 0, 0, 0
		for i, b := range data {
			switch i {
			case 0:
				pi = int(b) % len(fixDeclaredPrograms)
			case 1:
				ci = int(b) % len(fixDeclaredConfigs)
			case 2:
				mi = int(b) % len(fixDeclaredModes)
			case 3:
				si = int(b) % len(fixDeclaredSuffixes)
			}
		}
		for a, program := range fixDeclaredPrograms {
			for b, config := range fixDeclaredConfigs {
				for c, mode := range fixDeclaredModes {
					for d, suffix := range fixDeclaredSuffixes {
						if string(data) == program.key+"/"+config.key+"/"+mode.key+"/"+suffix {
							pi, ci, mi, si = a, b, c, d
						}
					}
				}
			}
		}
		program, config, mode, suffix := fixDeclaredPrograms[pi], fixDeclaredConfigs[ci], fixDeclaredModes[mi], fixDeclaredSuffixes[si]
		key := program.key + "/" + config.key
		name := "main" + suffix
		files := map[string]string{name: program.source, "h.ts": "export type Tag = \"tag\"\n"}
		before, ok := declaration(t, name, files)
		if !ok {
			return // the control has no declaration to keep
		}
		tsconfig := strings.TrimSuffix(DefaultConfig, "\n}") + ",\n  \"files\": [\"" + name + "\"]\n}"
		tsconfig = strings.Replace(tsconfig, `"strict": true,`, `"strict": true, "allowImportingTsExtensions": true, "emitDeclarationOnly": true, `+config.options, 1)
		if config.key != "declaration" {
			tsconfig = strings.Replace(tsconfig, `"emitDeclarationOnly": true, `, "", 1)
			tsconfig = strings.Replace(tsconfig, `"declaration": true,`, "", 1)
			tsconfig = strings.Replace(tsconfig, `"sourceMap": true,`, "", 1)
			tsconfig = strings.Replace(tsconfig, `"sourceMap": false, `, "", 1)
			tsconfig = strings.Replace(tsconfig, `"outDir": "out",`, "", 1)
			tsconfig = strings.Replace(tsconfig, `"outDir": null,`, "", 1)
		}
		r, err := w.Compile(t.Context(), Project{Files: files, Config: tsconfig})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		parsed := toolsConfig(w, r.Dir)
		if r.Program == nil || parsed == nil || len(parsed.Errors) > 0 {
			t.Fatalf("%s: the project does not parse: %v", key, parsed)
		}
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), parsed, mode.options)
		if result.Err != nil {
			t.Fatal(result.Err)
		}
		fixed := maps.Clone(files)
		for path, file := range result.Files {
			fixed[path.AsString()[strings.LastIndex(path.AsString(), "/")+1:]] = file.Text
		}
		after, _ := declaration(t, name, fixed)
		if after != before {
			Gap(t, "FuzzFixDeclaredImports", key, "chapter 7: %s; %s changed the declaration of:\n%s\nfixed:\n%s\nbefore:\n%s\nafter:\n%s", fixDeclaredQuote, mode.key, program.source, fixed[name], before, after)
			return
		}
		ExpectPending(t, "FuzzFixDeclaredImports", key)
		ExpectPending(t, "FuzzFixDeclaredImports", specCorpusKey(t))
	})
}
