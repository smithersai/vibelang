package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const missingImportRecoveryQuote = "Native lexical, syntax and static errors keep their `TS` codes, as in TypeScript, including independent errors in embedded expressions and types."

func TestMissingRuntimeImportRecoveryQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), missingImportRecoveryQuote) {
		t.Fatal(missingImportRecoveryQuote)
	}
}

var missingImportRecoveryModules = []string{"vibelang-runtime", "vibelang-runtime/experimental", "another-package"}

// Compare the native syntax diagnostics with and without the runtime. A
// missing dependency cannot hide independent syntax errors or crash a semantic
// diagnostic request. Mutations retain the malformed import recovery shape.
func FuzzMissingRuntimeImportRecovery(f *testing.F) {
	startShortBudget(f)
	for _, key := range missingImportRecoveryModules {
		f.Add([]byte(key))
		f.Add([]byte(key + "\x00\r\n"))
	}
	absent, present := NewWorkspace(f), NewWorkspace(f)
	absent.fs = missingRuntimeFuzzFS{absent.fs}
	if err := os.Rename(filepath.Join(absent.Dir, "node_modules", "vibelang-runtime"), filepath.Join(absent.Dir, "disabled-runtime")); err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		TestMissingRuntimeImportRecoveryQuoted(t)
		key, variant, _ := strings.Cut(string(data), "\x00")
		index := slices.Index(missingImportRecoveryModules, key)
		if index < 0 {
			index = 0
			if len(data) > 0 {
				index = int(data[0]) % len(missingImportRecoveryModules)
			}
		}
		key = missingImportRecoveryModules[index]
		source := "import { Data } from \"effect\"\nimport { Control, handle, resumeWithion nee \"" + key + "\"\nclass Busy extends Data.TaggedError(\"Busy\")<{}> {}\n"
		if strings.Contains(variant, "\r") {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		if len(variant) > 0 && variant[0]&1 != 0 {
			source = "// retained\n" + source
		}
		config := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true},"files":["main.vibe"]}`
		var reference []string
		for _, control := range []struct {
			name string
			w    *Workspace
		}{{"installed", present}, {"absent", absent}} {
			r, err := control.w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}, Config: config})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			var syntax []string
			for _, d := range r.Program.GetSyntacticDiagnostics(t.Context(), r.SourceFile("main.vibe")) {
				syntax = append(syntax, fmt.Sprintf("%d:%d:%s", d.Code(), d.Pos(), d.MessageText()))
			}
			if len(syntax) == 0 {
				Gap(t, "FuzzMissingRuntimeImportRecovery", key, "missing malformed-import syntax diagnostics")
				return
			}
			if control.name == "installed" {
				reference = syntax
			} else if !slices.Equal(reference, syntax) {
				Gap(t, "FuzzMissingRuntimeImportRecovery", key, "chapter 7 %q: missing runtime changed syntax diagnostics: installed=%v absent=%v", missingImportRecoveryQuote, reference, syntax)
				return
			}
		}
		ExpectPending(t, "FuzzMissingRuntimeImportRecovery", key)
		ExpectPending(t, "FuzzMissingRuntimeImportRecovery", specCorpusKey(t))
	})
}
