package vibelangprotocol

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

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
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to resolve test file path")
	}
	repoRoot := filepath.Clean(filepath.Join(filepath.Dir(thisFile), "..", "..", "..", ".."))
	runtimeFile := filepath.Join(repoRoot, "packages", "runtime", "src", "producers.ts")
	raw, err := os.ReadFile(runtimeFile)
	if err != nil {
		t.Fatalf("read runtime producers.ts: %v", err)
	}
	want := `("` + ProducerQueueKey + `")`
	if !strings.Contains(string(raw), want) {
		t.Fatalf("packages/runtime/src/producers.ts does not declare Context.Service key %s", want)
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
