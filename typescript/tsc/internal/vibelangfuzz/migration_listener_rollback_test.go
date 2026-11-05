package vibelangfuzz

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const migrationListenerRollbackTarget = "FuzzMigrationListenerRollback"
const migrationListenerRollbackQuote = "| any other \x60.vibe\x60 code | a compile error, \x60EK0401\x60 ([Plain code never throws](#plain-code-never-throws)) |"

func TestMigrationListenerRollbackQuoted(t *testing.T) {
	r4Quoted(t, "003-failures.md", migrationListenerRollbackQuote)
}

// Native listener cleanup may rethrow in its TypeScript boundary. The same
// written throw in a plain VibeLang callback remains forbidden, including
// within a nested function or another native try statement.
func FuzzMigrationListenerRollback(f *testing.F) {
	startShortBudget(f)
	keys := []string{"foldkit-map", "nested-block", "nested-arrow", "cleanup-finally", "typed-catch", "return-control"}
	for _, key := range keys {
		f.Add(key, uint8(0))
		f.Add(key, uint8(1))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMigrationListenerRollbackQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		handler := "stop(); throw error"
		switch key {
		case "nested-block":
			handler = "{ stop(); { throw error } }"
		case "nested-arrow":
			handler = "const rollback = () => { stop(); throw error }; rollback()"
		case "cleanup-finally":
			handler = "try { stop() } finally { throw error }"
		case "return-control":
			handler = "stop(); return"
		}
		binding := "error"
		if key == "typed-catch" {
			binding += ": unknown"
		}
		body := "try { start() } catch (" + binding + ") { " + handler + " }"
		source := "export const register = (start: () => void, stop: () => void) => { " + body + " }\n"
		if key == "foldkit-map" && mode&1 == 0 {
			raw, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", "foldkit-map-listener-rollback.vibe"))
			if err != nil {
				t.Fatal(err)
			}
			source = string(raw)
			if !strings.Contains(source, "try { start() }") {
				t.Fatal("listener rollback corpus lost its rethrow")
			}
		}
		if mode&1 != 0 {
			source = "export function register(start: () => void, stop: () => void) { " + body + " }\n"
		}
		for _, native := range []bool{true, false} {
			file := "main.vibe"
			if native {
				file = "main.ts"
			}
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{file: source}})
			if err != nil {
				t.Fatal(err)
			}
			got := r4Errors(r.Diagnostics)
			r.Remove()
			var want []string
			if !native && key != "return-control" {
				want = []string{"EK0401"}
			}
			if !slices.Equal(got, want) {
				Gap(t, migrationListenerRollbackTarget, key, "%s; native=%t got %v want %v\n%s", migrationListenerRollbackQuote, native, got, want, source)
			}
		}
	})
}
