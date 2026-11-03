package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const declarationImportFlagsTarget = "FuzzDeclarationImportFlags"
const declarationImportFlagsQuote = "Every \x60.vibe\x60 module has a declaration, its sidecar, so \x60noEmit\x60 and \x60declaration: false\x60 change nothing here."
const declarationImportUnusedQuote = "under \x60noUnusedLocals\x60, an import the fixes leave unused in the source is removed"

func TestDeclarationImportFlagsQuoted(t *testing.T) {
	for _, quote := range []string{declarationImportFlagsQuote, declarationImportUnusedQuote} {
		if !strings.Contains(SpecText("007-tooling.md"), quote) {
			t.Fatalf("import retention authority changed: %q", quote)
		}
	}
}

func FuzzDeclarationImportFlags(f *testing.F) {
	startShortBudget(f)
	keys := []string{"Context:number", "Context:optional", "Context:array", "Ctx:number", "Ctx:optional", "Ctx:array", "ServiceContext:number", "ServiceContext:optional", "ServiceContext:array"}
	for _, key := range keys {
		for variant := uint8(0); variant < 4; variant++ {
			f.Add(key, variant)
		}
	}
	f.Add("alchemy-service-declaration-false-import", uint8(0))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestDeclarationImportFlagsQuoted(t)
		corpus := key == "alchemy-service-declaration-false-import"
		if !corpus && !slices.Contains(keys, key) {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		source, alias := "", "Ctx"
		if corpus {
			data, err := os.ReadFile(filepath.Join("testdata", "declaration-import-flags", key+".vibe"))
			if err != nil {
				t.Fatal(err)
			}
			source = string(data)
		} else {
			parts := strings.Split(key, ":")
			alias = parts[0]
			fields := map[string]string{"number": "readonly value: number", "optional": "readonly value?: string", "array": "readonly value: ReadonlyArray<number>"}[parts[1]]
			source = "import * as " + alias + " from \"effect/Context\"\nexport class Database extends " + alias + ".Service<Database, { " + fields + " }>()(\"alchemy/Database\") {}\n"
		}
		variant %= 4
		noUnused, noEmit := variant&1 != 0, variant&2 != 0
		outputs, texts := [2]string{}, [2]string{}
		// Compare the same repair or unchanged boundary in both configurations.
		// Mandatory fixtures additionally require a repair in the regression units.
		for index, declaration := range []bool{false, true} {
			options := map[string]any{"target": "ES2022", "module": "NodeNext", "strict": true, "skipLibCheck": true, "declaration": declaration, "noEmit": noEmit, "noUnusedLocals": noUnused, "outDir": "out"}
			raw, err := json.Marshal(map[string]any{"compilerOptions": options, "files": []string{"main.vibe"}})
			if err != nil {
				t.Fatal(err)
			}
			config := string(raw)
			result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}, Config: config})
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			if !toolsErrorFree(result) {
				t.Fatalf("invalid native fixture: %v", SortedKeys(Keys(result.Dir, result.Diagnostics)))
			}
			parsed := toolsConfig(w, result.Dir)
			fixed := vibelang.FixProject(t.Context(), w.fs, bundled.LibPath(), parsed)
			text := source
			for name, file := range fixed.Files {
				if filepath.Base(name.AsString()) == "main.vibe" {
					text = file.Text
				}
			}
			label := fmt.Sprintf("%s/%d/declaration=%v", key, variant, declaration)
			if fixed.Err != nil || len(fixed.Refused) != 0 {
				Gap(t, declarationImportFlagsTarget, "repair:"+label, "VIP-27: %s; fix missing/refused: %+v\n%s", declarationImportFlagsQuote, fixed.Refused, text)
				return
			}
			hasAlias := strings.Contains(text, "import * as "+alias+" from \"effect/Context\"")
			if strings.Contains(text, "service Database") && hasAlias == noUnused {
				Gap(t, declarationImportFlagsTarget, "binding:"+label, "VIP-27: declaration needs its written binding; source unused checks take priority (%s):\n%s", declarationImportUnusedQuote, text)
			}
			after, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": text}, Config: config})
			if err != nil {
				t.Fatal(err)
			}
			defer after.Remove()
			if !toolsErrorFree(after) {
				Gap(t, declarationImportFlagsTarget, "check:"+label, "fix added source errors: %v\n%s", SortedKeys(Keys(after.Dir, after.Diagnostics)), text)
				return
			}
			file := after.Program.GetSourceFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(after.Dir, "main.vibe"))))
			after.Program.Emit(t.Context(), compiler.EmitOptions{TargetSourceFiles: []*ast.SourceFile{file}, EmitOnly: compiler.EmitOnlyDts, ForceEmit: true, WriteFile: func(name tspath.RootedFilePath, data string, _ *compiler.WriteFileData) error {
				if tspath.IsDeclarationFileName(name.AsString()) {
					outputs[index] = data
				}
				return nil
			}})
			if outputs[index] == "" {
				t.Fatal("forced declaration unavailable")
			}
			texts[index] = text
		}
		if texts[0] != texts[1] || outputs[0] != outputs[1] {
			Gap(t, declarationImportFlagsTarget, "options:"+fmt.Sprintf("%s/%d", key, variant), "VIP-27: %s; ordinary declaration flag changed repair or declaration:\n%s\n%s", declarationImportFlagsQuote, texts[0], texts[1])
		}
	})
}
