package vibelangfuzz

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const fileSystemServiceAdviceQuote = "A module is a namespace, not a service key"
const fileSystemServiceRunningQuote = "Returning an Effect does not itself execute it."

const fileSystemServiceLookupQuote = "const fs = try FileSystem.FileSystem"

func fileSystemServiceAdviceQuoted(t testing.TB) {
	t.Helper()
	chapterSays(t, "002-running.md", fileSystemServiceRunningQuote)
	text := SpecText("005-services.md")
	for _, quote := range []string{fileSystemServiceAdviceQuote, fileSystemServiceLookupQuote} {
		if !strings.Contains(text, quote) {
			t.Fatalf("chapter 005 no longer says %q", quote)
		}
	}
}
func TestFileSystemServiceAdviceQuoted(t *testing.T) { fileSystemServiceAdviceQuoted(t) }
func FuzzFileSystemServiceAdvice(f *testing.F) {
	startShortBudget(f)
	fileSystemServiceAdviceQuoted(f)
	var rows []struct{ Key, Source, Advice, Replacement string }
	data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/file-system-service-advice.json"))
	if err != nil {
		f.Fatal(err)
	}
	if err = json.Unmarshal(data, &rows); err != nil {
		f.Fatal(err)
	}
	for _, row := range rows {
		f.Add([]byte(row.Key + "\x00\x00"))
		f.Add([]byte(row.Key + "\x00\x01"))
	}
	ambient := ""
	for _, module := range []string{"node:fs", "fs"} {
		quoted, _ := json.Marshal(module)
		ambient += "declare module " + string(quoted) + " { "
		for _, name := range []string{"readFile", "writeFile", "appendFile", "mkdir", "mkdtemp", "rm", "rmdir", "unlink", "stat", "lstat", "exists", "access", "readdir", "opendir", "readlink", "realpath", "rename", "symlink", "link", "chmod", "chown", "copyFile", "cp", "truncate", "utimes", "open", "watch", "glob", "createReadStream", "createWriteStream"} {
			ambient += "export const " + name + ": (...args:any[])=>unknown; "
		}
		ambient += "export const constants: { readonly O_NONBLOCK: number }; }\n"
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		fileSystemServiceAdviceQuoted(t)
		parts := strings.SplitN(string(data), "\x00", 2)
		index := slices.IndexFunc(rows, func(row struct{ Key, Source, Advice, Replacement string }) bool { return row.Key == parts[0] })
		if index < 0 {
			index = len(data) % len(rows)
		}
		row := rows[index]
		source := row.Source
		if len(parts) > 1 && len(parts[1]) > 0 && parts[1][0]&1 != 0 {
			source = "// keep advice through import trivia\n" + strings.ReplaceAll(source, "Native", "Nâtive")
		}
		r, err := w.Compile(t.Context(), Project{Config: `{"compilerOptions":{"strict":true,"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","types":[],"skipLibCheck":true,"noEmit":true},"files":["main.vibe","node.d.ts"]}`, Files: map[string]string{"main.vibe": source, "node.d.ts": ambient, "package.json": `{"type":"module"}`}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		count := 0
		for _, d := range r.Diagnostics {
			if d.Source() == "EK" && d.Code() == 4402 {
				count++
				if !strings.Contains(layerMergeAdviceText(d), row.Advice) {
					Gap(t, "FuzzFileSystemServiceAdvice", row.Key, "%s: want %q, got %s", fileSystemServiceAdviceQuote, row.Advice, layerMergeAdviceText(d))
					return
				}
			}
		}
		if count != 1 {
			Gap(t, "FuzzFileSystemServiceAdvice", row.Key, "want one EK4402, got %d", count)
			return
		}
		if row.Replacement != "" {
			checked, err := w.Compile(t.Context(), Project{Config: `{"compilerOptions":{"strict":true,"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","types":[],"skipLibCheck":true,"noEmit":true},"files":["main.vibe"]}`, Files: map[string]string{"main.vibe": row.Replacement, "package.json": `{"type":"module"}`}})
			if err != nil {
				t.Fatal(err)
			}
			defer checked.Remove()
			for _, d := range checked.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					Gap(t, "FuzzFileSystemServiceAdvice", row.Key+":advice", "replacement rejected: %s", d.String())
					return
				}
			}
		}
		ExpectPending(t, "FuzzFileSystemServiceAdvice", row.Key)
		ExpectPending(t, "FuzzFileSystemServiceAdvice", specCorpusKey(t))
	})
}
