package vibelangfuzz

import (
	"fmt"
	"maps"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

func TestAbstractErrorInheritanceRepairsQuoted(t *testing.T) {
	const quote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"
	if !strings.Contains(SpecText("007-tooling.md"), quote) {
		t.Fatal("preserving repair rule moved")
	}
	const inheritance = "| an `extends` clause, `error UserNotFound extends NotFound { … }`, in either error form | `EK2117` |"
	if !strings.Contains(SpecText("003-failures.md"), inheritance) {
		t.Fatal("inheritance rejection moved")
	}
}

func FuzzAbstractErrorInheritanceRepairs(f *testing.F) {
	startShortBudget(f)
	keys := []string{"required", "optional", "getter", "unicode", "collision", "imported", "namespace"}
	for _, key := range keys {
		for mode := uint8(0); mode < 3; mode++ {
			f.Add(key, mode)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestAbstractErrorInheritanceRepairsQuoted(t)
		name := "value"
		if key == "unicode" {
			name = "値"
		}
		body := name + ": number"
		if key == "optional" {
			body = name + "?: number"
		}
		if key == "getter" {
			body += "; get label(): string { return String(this." + name + ") }"
		}
		parent := "export abstract error Base\n"
		child := "export error Child extends Base { " + body + " }\n"
		if key == "collision" {
			parent = "const Data=0; const $ErrorData=1\n" + parent
		}
		files := map[string]string{"main.vibe": parent + child}
		if key == "imported" {
			files = map[string]string{"base.vibe": parent, "main.vibe": "import { Base } from './base.vibe'\n" + child}
		}
		if key == "namespace" {
			files["main.vibe"] = "export namespace Family {\n" + parent + child + "}\n"
		}
		if mode&1 != 0 {
			for name, text := range files {
				files[name] = strings.ReplaceAll(text, "\n", "\r\n")
			}
		}
		before := toolsCompile(t, w, "FuzzAbstractErrorInheritanceRepairs", files)
		defer before.Remove()
		errors := 0
		for _, d := range before.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if !IsEK(d) || d.Code() != 2117 {
				t.Fatalf("unexpected original error: %s", d.String())
			}
			errors++
		}
		if errors != 1 {
			t.Fatalf("original errors %v; want exactly EK2117", before.Diagnostics)
		}
		options := []vibelang.FixOptions{{}, {MigrationOnly: true}, {VIPOnly: true}}[int(mode)%3]
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), options)
		if result.Err != nil || len(result.Refused) != 0 {
			t.Fatalf("repair failed key=%s options=%+v err=%v refused=%+v", key, options, result.Err, result.Refused)
		}
		fixed := maps.Clone(files)
		for name, file := range result.Files {
			fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
		}
		if len(result.Files) == 0 {
			t.Fatal("no preserving fixes")
		}
		after := toolsCompile(t, w, "FuzzAbstractErrorInheritanceRepairs", fixed)
		defer after.Remove()
		if !toolsErrorFree(after) {
			t.Fatalf("fixed errors=%v; source=%v", after.Diagnostics, fixed)
		}
		for name, text := range before.Outputs {
			if strings.HasSuffix(name, ".d.ts") && after.Outputs[name] != text {
				t.Fatalf("declaration %s changed before=%s after=%s", name, text, after.Outputs[name])
			}
		}
		for name, text := range fixed {
			if strings.Contains(text, "abstract error") || strings.Contains(text, "error Child extends") {
				t.Fatalf("unconverted source %s: %s", name, text)
			}
		}
		second := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), options)
		if second.Err != nil || len(second.Files) != 0 || len(second.Refused) != 0 {
			t.Fatalf("not idempotent: %s", fmt.Sprint(second))
		}
	})
}
