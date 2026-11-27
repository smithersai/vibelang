package vibelangprotocol

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"unicode"
)

func protocolRepoRoot(t *testing.T) string {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to resolve test file path")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(thisFile), "..", "..", "..", ".."))
}

func TestProducerQueueKeyFormat(t *testing.T) {
	if ProducerQueueKey == "" {
		t.Fatal("ProducerQueueKey must not be empty")
	}
	parts := strings.Split(ProducerQueueKey, "/")
	if len(parts) != 2 {
		t.Fatalf("expected package/service format, got %q", ProducerQueueKey)
	}
	if parts[0] != "vibelang-runtime" {
		t.Fatalf("expected vibelang-runtime namespace, got %q", parts[0])
	}
	if parts[1] != "ProducerQueue" {
		t.Fatalf("expected ProducerQueue symbol, got %q", parts[1])
	}
}

func TestProducerQueueKeyMatchesRuntimeSource(t *testing.T) {
	runtimeFile := filepath.Join(protocolRepoRoot(t), "packages", "runtime", "src", "producers.ts")
	raw, err := os.ReadFile(runtimeFile)
	if err != nil {
		t.Fatalf("read runtime producers.ts: %v", err)
	}
	want := `("` + ProducerQueueKey + `")`
	if !strings.Contains(string(raw), want) {
		t.Fatalf("packages/runtime/src/producers.ts does not declare Context.Service key %s", want)
	}
}

func TestProducerQueueKeyNamespaceMatchesRuntimePackageName(t *testing.T) {
	pkgFile := filepath.Join(protocolRepoRoot(t), "packages", "runtime", "package.json")
	raw, err := os.ReadFile(pkgFile)
	if err != nil {
		t.Fatalf("read runtime package.json: %v", err)
	}
	var manifest struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("parse runtime package.json: %v", err)
	}
	namespace := strings.Split(ProducerQueueKey, "/")[0]
	if namespace != manifest.Name {
		t.Fatalf("ProducerQueueKey namespace %q != packages/runtime package name %q", namespace, manifest.Name)
	}
}

func TestProducerQueueKeyReferencedByNativeCompiler(t *testing.T) {
	compilerFile := filepath.Join(protocolRepoRoot(t), "typescript", "tsc", "internal", "vibelang", "producer_instance.go")
	raw, err := os.ReadFile(compilerFile)
	if err != nil {
		t.Fatalf("read producer_instance.go: %v", err)
	}
	src := string(raw)
	if !strings.Contains(src, "vibelangprotocol.ProducerQueueKey") {
		t.Fatal("native compiler producer_instance.go must reference vibelangprotocol.ProducerQueueKey")
	}
	if strings.Contains(src, `"`+ProducerQueueKey+`"`) {
		t.Fatal("native compiler producer_instance.go must not hardcode raw ProducerQueueKey string literal")
	}
}

func TestProducerQueueKeyReferencedByTSMapper(t *testing.T) {
	mapperFile := filepath.Join(protocolRepoRoot(t), "typescript", "tsc", "internal", "vibelangmapper", "render_exec.go")
	raw, err := os.ReadFile(mapperFile)
	if err != nil {
		t.Fatalf("read render_exec.go: %v", err)
	}
	src := string(raw)
	if !strings.Contains(src, "vibelangprotocol.ProducerQueueKey") {
		t.Fatal("ts-mapper render_exec.go must reference vibelangprotocol.ProducerQueueKey")
	}
	if strings.Contains(src, `"`+ProducerQueueKey+`"`) {
		t.Fatal("ts-mapper render_exec.go must not hardcode raw ProducerQueueKey string literal")
	}
}

func TestProducerQueueKeyNoWhitespace(t *testing.T) {
	if strings.TrimSpace(ProducerQueueKey) != ProducerQueueKey {
		t.Fatalf("ProducerQueueKey must not have leading or trailing whitespace: %q", ProducerQueueKey)
	}
	if strings.ContainsAny(ProducerQueueKey, " \t\r\n") {
		t.Fatalf("ProducerQueueKey must not contain whitespace: %q", ProducerQueueKey)
	}
}

func TestProducerQueueKeyASCIIAndJSONSafe(t *testing.T) {
	for _, r := range ProducerQueueKey {
		if r > unicode.MaxASCII || !unicode.IsPrint(r) {
			t.Fatalf("ProducerQueueKey contains non-printable or non-ASCII rune %U", r)
		}
	}
	encoded, err := json.Marshal(ProducerQueueKey)
	if err != nil {
		t.Fatalf("marshal ProducerQueueKey: %v", err)
	}
	var decoded string
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("unmarshal ProducerQueueKey: %v", err)
	}
	if decoded != ProducerQueueKey {
		t.Fatalf("JSON round-trip mismatch: got %q, want %q", decoded, ProducerQueueKey)
	}
}

func TestProducerQueueKeySingleSlashIdentifier(t *testing.T) {
	if strings.HasPrefix(ProducerQueueKey, "/") || strings.HasSuffix(ProducerQueueKey, "/") {
		t.Fatalf("ProducerQueueKey must not begin or end with '/': %q", ProducerQueueKey)
	}
	if strings.Count(ProducerQueueKey, "/") != 1 {
		t.Fatalf("ProducerQueueKey must contain exactly one '/': %q", ProducerQueueKey)
	}
	symbol := strings.Split(ProducerQueueKey, "/")[1]
	for i, r := range symbol {
		if i == 0 && !unicode.IsUpper(r) {
			t.Fatalf("service symbol %q must start with an uppercase letter", symbol)
		}
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) {
			t.Fatalf("service symbol %q contains unexpected rune %q", symbol, r)
		}
	}
}
