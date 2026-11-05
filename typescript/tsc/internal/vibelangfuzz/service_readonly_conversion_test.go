package vibelangfuzz

import (
	"context"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const serviceReadonlyWholeShapeQuote = "This form adds no shape helper and no namespace"

func TestServiceReadonlyConversionQuoted(t *testing.T) {
	serviceReadonlyConversionQuoted(t)
}

func serviceReadonlyConversionQuoted(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("005-services.md"), serviceReadonlyWholeShapeQuote) {
		t.Fatalf("005-services.md no longer says %q", serviceReadonlyWholeShapeQuote)
	}
}

// Generate each member independently, so fuzzing explores combinations rather
// than selecting from a fixed list. The oracle is stock tsc's original .ts API.
func FuzzServiceReadonlyConversion(f *testing.F) {
	startShortBudget(f)
	registerDeclarationIdentityScope(f)
	serviceReadonlyConversionQuoted(f)
	// Keyed corpora already cover 0, 511 and 1023.
	for _, mode := range []uint16{1, 2, 3, 15, 31, 63, 127, 255} {
		f.Add(mode)
	}
	tsc := StockTypeScript(f)
	api := declarationIdentityAPI(f)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, mode uint16) {
		modifier := func(bit uint16) string {
			if mode&bit != 0 {
				return "readonly "
			}
			return ""
		}
		optional := func(bit uint16) string {
			if mode&bit != 0 {
				return "?"
			}
			return ""
		}
		members := modifier(1) + "id" + optional(2) + ": string; " +
			modifier(4) + "count" + optional(8) + ": number; " +
			modifier(16) + "nested" + optional(32) + ": { " + modifier(64) + "value: number; label?: string }; " +
			"load" + optional(128) + "(): Effect.Effect<number>; " +
			modifier(256) + "callback: (value: number) => Effect.Effect<string>;"
		prefix := "import { Context, Effect } from \"effect\";\n"
		shape := "{ " + members + " }"
		source := prefix + "export class Store extends Context.Service<Store, " + shape + ">()(\"test/Store\") {}\n"
		if mode&512 != 0 {
			source = prefix + "export interface API " + shape + "\nexport class Store extends Context.Service<Store, API>()(\"test/Store\") {}\n"
		}
		// The whole-shape conversion preserves the original native class API;
		// its TypeScript twin must not invent a Shape namespace.
		stock := emitDeclarationIdentityStock(t, w, tsc, Project{Files: map[string]string{"main.ts": source, "package.json": "{\"type\":\"module\"}"}})
		defer os.RemoveAll(stock)
		files := map[string]string{"main.vibe": source, "package.json": "{\"type\":\"module\"}"}
		before := toolsCompile(t, w, "FuzzServiceReadonlyConversion", files)
		defer before.Remove()
		fixed := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
		if fixed.Err != nil || len(fixed.Refused) != 0 {
			t.Fatalf("fix mode %d: %+v", mode, fixed)
		}
		files = maps.Clone(files)
		for name, file := range fixed.Files {
			files[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
		}
		if !strings.Contains(files["main.vibe"], "service Store: ") {
			t.Fatalf("mode %d was not converted to a whole shape:\n%s", mode, files["main.vibe"])
		}
		after := toolsCompile(t, w, "FuzzServiceReadonlyConversion", files)
		defer after.Remove()
		if !toolsErrorFree(after) {
			t.Fatalf("mode %d: %v\n%s", mode, SortedKeys(Keys(after.Dir, after.Diagnostics)), files["main.vibe"])
		}
		current := filepath.Join(after.Dir, "__service_declarations")
		for name, text := range after.Outputs {
			if rel, ok := strings.CutPrefix(name, "out/"); ok && isDeclaration(name) {
				if err := writeInside(current, rel, text); err != nil {
					t.Fatal(err)
				}
			}
		}
		ctx, cancel := context.WithTimeout(t.Context(), 2*HangLimit)
		defer cancel()
		diff, err := declarationIdentityProbeFor(t, api)(ctx, api, filepath.Join(stock, "out"), current)
		if err != nil {
			t.Fatal(err)
		}
		if diff != "" {
			t.Fatalf("stock tsc API differs for mode %d:\n%s\noriginal:\n%s\nfixed:\n%s", mode, diff, source, files["main.vibe"])
		}
		again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), vibelang.FixOptions{})
		if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
			t.Fatal(fmt.Sprintf("non-idempotent mode %d: %+v", mode, again))
		}
	})
}
