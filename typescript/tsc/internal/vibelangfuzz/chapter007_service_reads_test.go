package vibelangfuzz

import (
	"os"
	"strings"
	"testing"
)

var chapter007ServiceReadQuotes = []string{
	"A rewrite that can't preserve types, behavior and declaration output refuses at that site.",
}

func TestChapter007ServiceReadHygieneQuoted(t *testing.T) {
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range chapter007ServiceReadQuotes {
		if !strings.Contains(string(text), quote) {
			t.Fatalf("missing Chapter 007 service type-read rule: %s", quote)
		}
	}
}

// Chapter 007 / generated type helper capture neighborhood: docs/design/src/007-tooling.md#cf0d06ac0b0fd37d
// Chapter 007 / value-only ReturnType control: docs/design/src/007-tooling.md#7bf799b8f9e04355
func chapter007ServiceReadScope(files map[string]string, key string) {
	prefix := ""
	switch key {
	case "local-shadow":
		prefix = "type ReturnType<T> = { enabled: \"captured\"; count: 2 }\n"
	case "import-shadow":
		prefix = "import type { ReturnType } from './types.js'\n"
		files["types.ts"] = "export type ReturnType<T> = { enabled: \"captured\"; count: 2 }\n"
	case "value-only":
		prefix = "const ReturnType = 1\n"
	}
	files["main.vibe"] = prefix + files["main.vibe"]
}
