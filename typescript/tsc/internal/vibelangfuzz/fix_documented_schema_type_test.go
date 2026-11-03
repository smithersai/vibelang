package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// Detail 256 (VIP-15, VIP-27): "One written, nongeneric `type X = typeof
// X.Type` in the same scope replaces the synthesized alias" and keeps its own
// JSDoc, so vibelang --fix (EK4832; the alias form's EK4841 is covered by
// TestSchemaConstantKeepsDocumentedType) rewrites a native pair whose type carries its own
// documentation into the schema declaration with that type kept beside it,
// and removes an undocumented own type as before. Chapter 7: "A quick fix is
// offered only when it preserves evaluation order, coldness, types,
// comments, and declaration output": the fixed module's declaration file
// must equal, byte for byte, stock TypeScript's declaration of the native
// pair. foldkit's canvas/shape.ts (one text on both names) and
// runtime/modelPreservation.ts (two texts) are the corpus.
func FuzzFixDocumentedSchemaType(f *testing.F) {
	startShortBudget(f)
	// TestSchemaWrittenTypeQuoted separately tracks the deferred fold-details text;
	// the bytes oracle below runs on the landed compiler rule either way.
	w := NewWorkspace(f)
	tsc := StockTypeScript(f)
	for _, mode := range []uint16{0, 2, 4, 6, 8, 12, 14, 30, 38, 46, 78, 142, 222} {
		f.Add("foldkit-canvas-shape-documented-pair", mode)
	}
	f.Fuzz(func(t *testing.T, key string, mode uint16) {
		TestMigrationDeclarationFixQuoted(t)
		const target = "FuzzFixDocumentedSchemaType"
		defer recoverCompilerPanic(t, target)
		// A keyed placement can be replayed even if the list of seeds changes.
		if key != "foldkit-canvas-shape-documented-pair" {
			key = "foldkit-canvas-shape-documented-pair"
		}
		pair := documentedSchemaPair(mode)
		gapKey := fmt.Sprintf("%s:%d", key, mode&255)
		config := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"declaration":true,"emitDeclarationOnly":true,"outDir":"out"},"files":["main.%s"]}`
		original := Project{Files: map[string]string{"main.vibe": pair.source}, Config: fmt.Sprintf(config, "vibe")}
		var before *Compilation
		var err error
		within(t, "compile", func() { before, err = w.CompileOrdered(t.Context(), original, OrderTsc, true) })
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		if before.Program == nil || HasError(before.Diagnostics) {
			t.Fatalf("invalid generated source: %v\n%s", SortedKeys(Keys(before.Dir, before.Diagnostics)), pair.source)
		}
		var fixed *vibelang.FixResult
		within(t, "fix", func() {
			fixed = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
		})
		if fixed.Err != nil {
			t.Fatal(fixed.Err)
		}
		after := pair.source
		for _, file := range fixed.Files {
			after = file.Text
		}
		switch {
		case !strings.Contains(after, "schema Point"):
			Gap(t, target, "fix:"+gapKey, "--fix left the native pair (refused %v)\nsource:\n%s\nfixed:\n%s", fixed.Refused, pair.source, after)
		case pair.typeDoc != "" && !strings.Contains(after, pair.typeDoc+pair.alias):
			Gap(t, target, "fix:"+gapKey, "--fix did not keep the documented type %q with its JSDoc\nsource:\n%s\nfixed:\n%s", pair.alias, pair.source, after)
		case pair.typeDoc == "" && strings.Contains(after, "typeof Point.Type"):
			Gap(t, target, "fix:"+gapKey, "--fix kept an undocumented own type\nsource:\n%s\nfixed:\n%s", pair.source, after)
		}
		var compiled *Compilation
		within(t, "compile", func() {
			compiled, err = w.CompileOrdered(t.Context(), Project{Files: map[string]string{"main.vibe": after}, Config: original.Config}, OrderTsc, true)
		})
		if err != nil {
			t.Fatal(err)
		}
		defer compiled.Remove()
		if compiled.Program == nil || HasError(compiled.Diagnostics) {
			Gap(t, target, "errors:"+gapKey, "the fixed source reports %v\nsource:\n%s\nfixed:\n%s", SortedKeys(Keys(compiled.Dir, compiled.Diagnostics)), pair.source, after)
		}
		want := stockDeclaration(t, w, tsc, Project{Config: fmt.Sprintf(config, "ts"), Files: map[string]string{"main.ts": pair.source}}, "out/main.d.ts")
		got, exists := compiled.Outputs["out/main.d.ts"]
		if !exists || got != want {
			Gap(t, target, "bytes:"+gapKey, "Chapter 7: %s\nmode %d\nsource:\n%s\nfixed:\n%s\ngot:\n%s\nstock tsc:\n%s", migrationDeclarationFixQuote, mode, pair.source, after, got, want)
		}
	})
}

type schemaPair struct {
	source  string // the native pair, TypeScript forms in a .vibe module
	alias   string // the own type's line, type Point = typeof Point.Type;
	typeDoc string // the own type's JSDoc line, "" when undocumented
}

// documentedSchemaPair writes a native constant/type pair for mode: bit 2 a
// JSDoc on the constant, 4 a JSDoc on the type, 8 exported, 16 the same text on both (as
// foldkit's canvas/shape.ts), 32 inside a namespace, 64 a multi-line struct,
// 128 a blank line between the two declarations.
func documentedSchemaPair(mode uint16) schemaPair {
	constant := "const Point = Schema.Struct({ x: Schema.Number, y: Schema.Number });"
	if mode&64 != 0 {
		constant = "const Point = Schema.Struct({\n  x: Schema.Number,\n  y: Schema.Number\n});"
	}
	alias := "type Point = typeof Point.Type;"
	if mode&8 != 0 {
		constant, alias = "export "+constant, "export "+alias
	}
	constantDoc, typeDoc := "", ""
	if mode&2 != 0 {
		constantDoc = "/** A 2D point in canvas-local coordinates. */\n"
	}
	if mode&4 != 0 {
		typeDoc = "/** The decoded point. */\n"
		if mode&16 != 0 {
			typeDoc = "/** A 2D point in canvas-local coordinates. */\n"
		}
	}
	separator := "\n"
	if mode&128 != 0 {
		separator = "\n\n"
	}
	body := constantDoc + constant + separator + typeDoc + alias + "\nexport declare const witness: Point;\n"
	if mode&32 != 0 {
		body = "export namespace Model {\n" + body + "}\n"
	}
	return schemaPair{source: "import { Schema } from \"effect\";\n" + body, alias: alias, typeDoc: typeDoc}
}
