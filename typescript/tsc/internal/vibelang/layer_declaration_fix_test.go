package vibelang

import (
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// VIP-9/12 and Chapter 7: a migration keeps declarations and execution.
// Setup runs when the layer builds, not when its declaration is evaluated.
func TestLayerDeclarationFixUsesExplicitEffect(t *testing.T) {
	const prelude = "service Counter { static readonly key = \"test/Counter\"; value: number }\n"
	for _, body := range []string{
		"const start = 1\n readonly value = start",
		"const start = try Effect.succeed(1)\n readonly value = start",
		"const start = 1\n const next = start + 1\n readonly value = next",
	} {
		source := prelude + "export layer Live: Counter {\n " + body + "\n}\n"
		_, file, _, _ := editorProgram(t, source)
		replacement, ok := layerDeclarationText(file, file.Statements.Nodes[1])
		if !ok {
			t.Fatal("no layer rewrite")
		}
		fixed := prelude + replacement + "\n"
		if !strings.Contains(fixed, "Layer.effect(Counter, effect {") {
			t.Fatalf("migration still writes a retired trailing block:\n%s", fixed)
		}
		if errors := errorsOf(t, fixed); len(errors) != 0 {
			t.Fatalf("migrated layer reports %v:\n%s", errors, fixed)
		}
		before := layerMigrationDeclarations(t, source, EK2121.Code)
		after := layerMigrationDeclarations(t, fixed)
		if before != after {
			t.Fatalf("declarations changed:\nbefore:\n%s\nafter:\n%s", before, after)
		}
	}
}

// The old declaration calls an intrinsic even when source Layer is shadowed.
// A source rewrite cannot use that shadowed binding.
func TestLayerDeclarationFixRefusesCapturedNamespace(t *testing.T) {
	source := "service Counter { static readonly key = \"test/Counter\"; value: number }\n" +
		"const Layer = { succeed() { return \"captured\" }, effect() { return \"captured\" } }\n" +
		"export layer Live: Counter { readonly value = 1 }\n"
	p, file, _, _ := editorProgram(t, source)
	statement := file.Statements.Nodes[len(file.Statements.Nodes)-1]
	call := layerDeclarationCall(statement)
	actions, err := layerDeclarationFix.GetCodeActions(t.Context(), &ls.CodeFixContext{Program: p, SourceFile: file, Span: call.Expression().Expression().Loc})
	if err != nil {
		t.Fatal(err)
	}
	if len(actions) != 0 {
		t.Fatalf("captured Layer has an unsafe automatic rewrite: %+v", actions)
	}
}

func TestLayerDeclarationFixNamespaceImports(t *testing.T) {
	for _, prefix := range []string{"", "import { Layer } from \"effect\"\n", "import * as Layer from \"effect/Layer\"\n"} {
		source := prefix + "service Counter { static readonly key = \"test/Counter\"; value: number }\nexport layer Live: Counter { readonly value = 1 }\n"
		p, file, _, _ := editorProgram(t, source)
		statement := file.Statements.Nodes[len(file.Statements.Nodes)-1]
		call := layerDeclarationCall(statement)
		actions, err := layerDeclarationFix.GetCodeActions(t.Context(), &ls.CodeFixContext{Program: p, SourceFile: file, Span: call.Expression().Expression().Loc})
		if err != nil {
			t.Fatal(err)
		}
		if len(actions) != 1 {
			t.Fatalf("real Effect namespace has no repair: prefix=%q actions=%v", prefix, actions)
		}
	}
}

// Use the installed Effect declarations, as editorProgram does, rather than
// the computed-key helper's deliberately minimal virtual library.
func layerMigrationDeclarations(t *testing.T, source string, migrationCodes ...int32) string {
	t.Helper()
	p, _, _, _ := editorProgram(t, source)
	for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Category() == diagnostics.CategoryError && !slices.Contains(migrationCodes, d.Code()) {
			t.Fatalf("source: %s", d.String())
		}
	}
	out := map[string]string{}
	var mu sync.Mutex
	result := p.Emit(t.Context(), compiler.EmitOptions{ForceEmit: true, EmitOnly: compiler.EmitOnlyDts, WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
		if strings.HasSuffix(name.AsString(), "main.d.ts") || strings.HasSuffix(name.AsString(), "main.d.vibe.ts") {
			mu.Lock()
			out[name.AsString()] = text
			mu.Unlock()
		}
		return nil
	}})
	for _, d := range result.Diagnostics {
		if d.Category() == diagnostics.CategoryError && !slices.Contains(migrationCodes, d.Code()) {
			t.Fatalf("emit: %s", d.String())
		}
	}
	for name, text := range out {
		if strings.HasSuffix(name, "main.d.ts") {
			return text
		}
	}
	for _, text := range out {
		return text
	}
	t.Fatal("no public declaration emitted")
	return ""
}

func TestLayerDeclarationFixRefusesTypeOnlyNamespaces(t *testing.T) {
	for _, prefix := range []string{"import type { Layer } from \"effect\"\n", "import type * as Layer from \"effect/Layer\"\n"} {
		source := prefix + "service Counter { static readonly key = \"test/Counter\"; value: number }\nexport layer Live: Counter { readonly value = 1 }\n"
		p, file, _, _ := editorProgram(t, source)
		statement := file.Statements.Nodes[len(file.Statements.Nodes)-1]
		call := layerDeclarationCall(statement)
		actions, err := layerDeclarationFix.GetCodeActions(t.Context(), &ls.CodeFixContext{Program: p, SourceFile: file, Span: call.Expression().Expression().Loc})
		if err != nil {
			t.Fatal(err)
		}
		if len(actions) != 0 {
			t.Fatalf("type-only Layer has no runtime value: prefix=%q actions=%v", prefix, actions)
		}
	}
}
