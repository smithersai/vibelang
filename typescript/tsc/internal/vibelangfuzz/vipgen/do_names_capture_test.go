package vipgen

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestDoNamesCaptureCorpus(t *testing.T) {
	for name, pattern := range map[string]string{
		"conditional":          "true ?",
		"logical":              "||",
		"coalescing":           "??",
		"match-subject":        "match (",
		"receiver-depth-1":     ".read(",
		"computed-key-depth-1": "Symbol.toPrimitive",
	} {
		kind := "arrow"
		if strings.Contains(name, "depth") {
			kind = "class"
		}
		path := filepath.Join("..", "testdata", "fuzz", "FuzzVIPDifferential", fmt.Sprintf("do-names-%s-%s", kind, name))
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		lines := strings.Split(strings.TrimSpace(string(raw)), "\n")
		input, err := strconv.Unquote(strings.TrimSuffix(strings.TrimPrefix(lines[1], "[]byte("), ")"))
		if err != nil {
			t.Fatal(err)
		}
		program := Generate([]byte(input), nil)
		if program == nil || program.Focus != "vip02.do-names-plain" {
			t.Fatalf("%s lost its named construct", name)
		}
		vibe, native := PrintVibe(program), PrintEffect(program)
		if !strings.Contains(vibe, pattern) {
			t.Fatalf("%s lost %q:\n%s", name, pattern, vibe)
		}
		if name == "match-subject" {
			if strings.Contains(native, "match (") {
				t.Fatal("native subject must retain value-only evaluation")
			}
		} else if !strings.Contains(native, pattern) {
			t.Fatalf("native %s lost %q:\n%s", name, pattern, native)
		}
	}
}

func TestPipeCaptureNamesCorpus(t *testing.T) {
	for _, name := range []string{"arrow", "class", "named-class"} {
		path := filepath.Join("..", "testdata", "fuzz", "FuzzVIPDifferential", "pipe-capture-name-"+name)
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		lines := strings.Split(strings.TrimSpace(string(raw)), "\n")
		input, err := strconv.Unquote(strings.TrimSuffix(strings.TrimPrefix(lines[1], "[]byte("), ")"))
		if err != nil {
			t.Fatal(err)
		}
		program := Generate([]byte(input), nil)
		if program == nil || program.Focus != "vip23.pipe-plain" {
			t.Fatalf("%s lost its pipe construct", name)
		}
		vibe, native := PrintVibe(program), PrintEffect(program)
		if !strings.Contains(vibe, "|> [%.name, %") || !strings.Contains(native, "value.name, value.") {
			t.Fatalf("%s lost its naming oracle:\n%s\n%s", name, vibe, native)
		}
	}
}

func TestRegionReturnNamesCorpus(t *testing.T) {
	kinds := map[string]bool{}
	for i := 1; i <= 8; i++ {
		path := filepath.Join("..", "testdata", "fuzz", "FuzzVIPDifferential", fmt.Sprintf("region-return-name-%d", i))
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		lines := strings.Split(strings.TrimSpace(string(raw)), "\n")
		input, err := strconv.Unquote(strings.TrimSuffix(strings.TrimPrefix(lines[1], "[]byte("), ")"))
		if err != nil {
			t.Fatal(err)
		}
		program := Generate([]byte(input), nil)
		if program == nil || program.Focus != "vip22.return-evaluation" {
			t.Fatalf("%s lost its named return construct", path)
		}
		source, reference := PrintVibe(program), PrintEffect(program)
		if !strings.Contains(source, "regionCapture") || !strings.Contains(reference, "Effect.uninterruptibleMask") {
			t.Fatalf("%s lost its value-only return oracle:\n%s\n%s", path, source, reference)
		}
		for _, kind := range []string{"() => 1", "function ()", "function written", "class {", "class Written"} {
			kinds[kind] = kinds[kind] || strings.Contains(source, kind)
		}
	}
	for kind, seen := range kinds {
		if !seen {
			t.Errorf("corpus lost %s", kind)
		}
	}
}
