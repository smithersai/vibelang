package vibelangfuzz

import (
	"fmt"
	"strings"
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

var fixDeclaredSuffixes = []string{".vibe", ".vibex"}

// Chapter 007 / prelude cleanup preserves explicit declaration source imports: docs/design/src/007-tooling.md#6d35bc3d7ac16521
// Chapter 007 / prelude cleanup preserves explicit declaration source imports: docs/design/src/007-tooling.md#cc08d856d0ffcb94
// Chapter 007 / prelude cleanup preserves explicit declaration source imports: docs/design/src/007-tooling.md#97560f522c03cbbf

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
