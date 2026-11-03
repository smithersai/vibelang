package vibelangfuzz

import (
	"fmt"
	"maps"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// Chapter 7: --fix keeps an import a module's declaration needs, and only
// those. A prelude name being available without its import does not make the
// import unneeded: once it goes, the emitter can re-add the name out of source
// order or print an inferred Schema.String as an import type. Nor does a
// declaration naming the module make it needed: where the declaration is the
// same bytes without the import, as Option.Option<number> is, the import goes
// (decided detail 277; Smithers' 9 re-recorded modules, opencode-41; main red
// 0d0c6b46ee6e, when keeping every import the declaration wrote stopped the
// prelude rewrites tsforms-option-match-api and the fixed-point tests expect).
// So a program's declaration is the same bytes before and after --fix,
// whichever fix mode and compiler options run it, every .vibe module having a
// declaration, its sidecar; and in a plain run no effect import that --fix
// leaves can go with the declaration unchanged and no error added. Comparing
// the compiler with itself across the fix is this target's oracle.
const fixDeclaredQuote = "Prelude cleanup keeps an explicit Effect import where removing it would change the declaration."

const fixDeclaredOnlyQuote = "Every `.vibe` module has a declaration, its sidecar, so `noEmit` and `declaration: false` change nothing here."

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

// The generated neighbourhood: each import kind of each prelude module, used
// in a type the declaration prints or only in a private one, behind a relative
// import or before it.
var fixDeclaredKinds = []struct{ key, header string }{
	{"named", "import { %[1]s } from \"effect\"\n"},
	{"type-only", "import type { %[1]s } from \"effect\"\n"},
	{"namespace", "import * as %[1]s from \"effect/%[1]s\"\n"},
	{"alias", "import { %[1]s as Local%[1]s } from \"effect\"\n"},
}

var fixDeclaredNames = []struct{ name, typeText string }{
	{"Option", "%s.Option<number>"},
	{"Schema", "%s.Codec<string>"},
	{"Layer", "%s.Layer<never>"},
	{"Duration", "%s.Duration"},
}

func init() {
	for _, kind := range fixDeclaredKinds {
		for _, name := range fixDeclaredNames {
			local := name.name
			if kind.key == "alias" {
				local = "Local" + name.name
			}
			header := fmt.Sprintf(kind.header, name.name)
			typeText := fmt.Sprintf(name.typeText, local)
			for _, used := range []bool{true, false} {
				for _, after := range []bool{false, true} {
					body := "export type T = " + typeText + "\n"
					key := kind.key + "-" + name.name
					if !used {
						body = "type P = " + typeText + "\nexport type T = number\nconst keep: P | undefined = undefined\nexport const n = keep === undefined ? 1 : 0\n"
						key += "-private"
					}
					source := header + "import type { Tag } from \"./h.ts\"\n" + body + "export type U = Tag\n"
					if after {
						source = "import type { Tag } from \"./h.ts\"\n" + header + body + "export type U = Tag\n"
						key += "-after-relative"
					}
					fixDeclaredPrograms = append(fixDeclaredPrograms, struct{ key, source string }{key, source})
				}
			}
		}
	}
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
	for _, quote := range []string{fixDeclaredQuote, fixDeclaredOnlyQuote} {
		if !strings.Contains(string(chapter), quote) {
			tb.Fatalf("chapter 7 no longer says %q", quote)
		}
	}
}

func TestFixDeclaredImportsQuoted(t *testing.T) { fixDeclaredChapter(t) }

// Chapter 007 / prelude cleanup preserves explicit declaration source imports: docs/design/src/007-tooling.md#6d35bc3d7ac16521
// Chapter 007 / prelude cleanup preserves explicit declaration source imports: docs/design/src/007-tooling.md#cc08d856d0ffcb94
// Chapter 007 / prelude cleanup preserves explicit declaration source imports: docs/design/src/007-tooling.md#97560f522c03cbbf

func FuzzFixDeclaredImports(f *testing.F) {
	startShortBudget(f)
	fixDeclaredChapter(f)
	for i, program := range fixDeclaredPrograms {
		config := fixDeclaredConfigs[i%len(fixDeclaredConfigs)]
		f.Add([]byte(program.key + "/" + config.key + "/plain/.vibe"))
	}
	f.Add([]byte("import-order/no-emit/vip-only/.vibex"))
	f.Add([]byte("inferred-name/declaration/migration-only/.vibe"))
	for _, key := range []string{"named-Option", "named-Schema-after-relative", "type-only-Layer-private", "namespace-Duration", "alias-Option-private-after-relative"} {
		f.Add([]byte(key + "/declaration/plain/.vibe"))
	}
	w := NewWorkspace(f)
	var declarationAndErrors func(t *testing.T, name string, files map[string]string) (string, bool, bool)
	declaration := func(t *testing.T, name string, files map[string]string) (string, bool) {
		text, ok, _ := declarationAndErrors(t, name, files)
		return text, ok
	}
	declarationAndErrors = func(t *testing.T, name string, files map[string]string) (string, bool, bool) {
		project := Project{Files: map[string]string{}}
		maps.Copy(project.Files, files)
		project.Config = strings.TrimSuffix(DefaultConfig, "\n}") + ",\n  \"files\": [\"" + name + "\"]\n}"
		project.Config = strings.Replace(project.Config, `"strict": true,`, `"strict": true, "allowImportingTsExtensions": true, "emitDeclarationOnly": true,`, 1)
		r, err := w.Compile(t.Context(), project)
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		errors := false
		for _, d := range r.Diagnostics {
			errors = errors || d.Category() == diagnostics.CategoryError
		}
		text, ok := r.Outputs["out/main.d.ts"]
		return text, ok, errors
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
		after, _, afterErrors := declarationAndErrors(t, name, fixed)
		if after != before {
			Gap(t, "FuzzFixDeclaredImports", key, "chapter 7: %s; %s changed the declaration of:\n%s\nfixed:\n%s\nbefore:\n%s\nafter:\n%s", fixDeclaredQuote, mode.key, program.source, fixed[name], before, after)
			return
		}
		// The other half, for a plain run, which removes prelude imports: no
		// import of a prelude module under its own name that --fix left can go
		// with the declaration the same bytes and no error added.
		if mode.key == "plain" && !afterErrors {
			lines := strings.SplitAfter(fixed[name], "\n")
			for i, line := range lines {
				if !fixDeclaredPreludeImport(line) {
					continue
				}
				without := maps.Clone(fixed)
				without[name] = strings.Join(lines[:i], "") + strings.Join(lines[i+1:], "")
				if text, ok, errors := declarationAndErrors(t, name, without); ok && !errors && text == after {
					Gap(t, "FuzzFixDeclaredImports", key+"/kept", "chapter 7: %s; %s kept %q, though the declaration is the same bytes without it:\n%s\nfixed:\n%s\ndeclaration:\n%s", fixDeclaredOnlyQuote, mode.key, strings.TrimSpace(line), program.source, fixed[name], after)
					return
				}
			}
		}
		ExpectPending(t, "FuzzFixDeclaredImports", key)
		ExpectPending(t, "FuzzFixDeclaredImports", specCorpusKey(t))
	})
}

// fixDeclaredPreludeImport reports whether line imports a prelude module
// under its own name, the imports the prelude rewrite removes: a named import
// of Option, Schema, Layer or Duration from effect's root, type-only or not,
// or a namespace import of one from its own module.
func fixDeclaredPreludeImport(line string) bool {
	for _, name := range fixDeclaredNames {
		for _, form := range []string{"import { %[1]s } from \"effect\"", "import type { %[1]s } from \"effect\"", "import { %[1]s } from 'effect'", "import * as %[1]s from \"effect/%[1]s\""} {
			if strings.TrimSpace(line) == fmt.Sprintf(form, name.name) {
				return true
			}
		}
	}
	return false
}
