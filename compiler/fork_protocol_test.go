package compiler

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestForkProtocolRejectsTrailingOrIncompleteResponse(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is Unix-only")
	}
	validResult := fmt.Sprintf(`{"apiVersion":%d,"compilerRevision":%q,"result":{"diagnostics":[],"artifacts":[],"emitSkipped":false}}`, APIVersion, PinnedTypeScriptRevision)
	for _, test := range []struct {
		name   string
		output string
	}{
		{name: "trailing JSON", output: validResult + "\n{}\n"},
		{name: "missing result", output: fmt.Sprintf(`{"apiVersion":%d,"compilerRevision":%q}`, APIVersion, PinnedTypeScriptRevision)},
		{name: "null collections", output: fmt.Sprintf(`{"apiVersion":%d,"compilerRevision":%q,"result":{"diagnostics":null,"artifacts":null,"emitSkipped":false}}`, APIVersion, PinnedTypeScriptRevision)},
	} {
		t.Run(test.name, func(t *testing.T) {
			executable := filepath.Join(t.TempDir(), "bridge")
			script := "#!/bin/sh\nprintf '%s' '" + test.output + "'\n"
			if err := os.WriteFile(executable, []byte(script), 0o755); err != nil {
				t.Fatal(err)
			}
			backend := &forkCompiler{executable: executable}
			_, err := backend.Compile(context.Background(), CompileRequest{
				RootNames: []string{"main.vibe"},
				Files:     []SourceFile{{Path: "main.vibe", Kind: FileKindVibe, Text: "export {};\n"}},
			})
			if !errors.Is(err, ErrForkProtocol) {
				t.Fatalf("expected ErrForkProtocol, got %v", err)
			}
		})
	}
}
