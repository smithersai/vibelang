package compiler

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// This source belongs only to the Go test binary. It is never embedded in the
// production bridge and introduces no fault-injection flag in its protocol.
//
//go:embed testdata/native-invariants_test.go.txt
var nativeInvariantTests []byte

func TestPinnedForkInternalInvariants(t *testing.T) {
	_, ctx := newPinnedTestBackend(t) // Verify revision, libraries and patches.
	checkout, err := filepath.EvalSymlinks(os.Getenv("VIBELANG_TYPESCRIPT_FORK"))
	if err != nil {
		t.Fatal(err)
	}
	checkout, err = filepath.Abs(checkout)
	if err != nil {
		t.Fatal(err)
	}
	directory := t.TempDir()
	replacements := map[string]string{}
	for _, file := range forkBridgeFiles {
		source := *file.source
		if file.target == "cmd/tsc/vibelanglowering.go" {
			const signature = "func stableErrorIdentity(sourceName string, name string) string {"
			if bytes.Count(source, []byte(signature)) != 1 {
				t.Fatal("nominal identity injection anchor changed")
			}
			// Rename the original only in this temporary build. A _test.go
			// wrapper supplies the deliberately non-injective historical mint.
			// Every real lowering/checking/diagnostic call site stays untouched.
			source = bytes.Replace(source, []byte(signature), []byte("func productionStableErrorIdentity(sourceName string, name string) string {"), 1)
		}
		local := filepath.Join(directory, filepath.FromSlash(file.target))
		if err := os.MkdirAll(filepath.Dir(local), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(local, source, 0o644); err != nil {
			t.Fatal(err)
		}
		replacements[filepath.Join(checkout, "tsc", filepath.FromSlash(file.target))] = local
	}
	testPath := filepath.Join(directory, "native-invariants_test.go")
	if err := os.WriteFile(testPath, nativeInvariantTests, 0o644); err != nil {
		t.Fatal(err)
	}
	replacements[filepath.Join(checkout, "tsc/cmd/tsc/vibelang_invariants_test.go")] = testPath
	overlay, err := json.Marshal(struct{ Replace map[string]string }{replacements})
	if err != nil {
		t.Fatal(err)
	}
	overlayPath := filepath.Join(directory, "overlay.json")
	if err := os.WriteFile(overlayPath, overlay, 0o644); err != nil {
		t.Fatal(err)
	}
	vectors, err := filepath.Abs("../conformance/identity/module-row-qualifier.json")
	if err != nil {
		t.Fatal(err)
	}
	// Go vet cannot chdir into a package directory that exists only through an
	// overlay (vibewirejson). This child measures execution, not static vetting;
	// it must not create compiler-owned directories in the shared checkout.
	command := exec.CommandContext(ctx, "go", "test", "-vet=off", "-json", "-count=1", "-timeout=2m", "-overlay", overlayPath,
		"-ldflags", "-X main.compilerRevision="+PinnedTypeScriptRevision+" -X main.bridgeAPIVersion="+strconv.Itoa(APIVersion),
		"-run", "^TestNativeInvariant", "./cmd/tsc")
	command.Dir = filepath.Join(checkout, "tsc")
	command.Env = append(environmentWithout("GOWORK"), "GOWORK=off", "VIBELANG_NATIVE_INVARIANT_VECTORS="+vectors)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("native invariant tests: %v\n%s", err, output)
	}
	passed := map[string]bool{}
	for _, line := range bytes.Split(output, []byte("\n")) {
		if len(line) == 0 {
			continue
		}
		var event struct {
			Action string
			Test   string
			Output string
		}
		if err := json.Unmarshal(line, &event); err != nil {
			t.Fatalf("non-JSON native test output: %s", line)
		}
		if event.Action == "skip" || event.Action == "fail" {
			t.Fatalf("native invariant not measured: %s", line)
		}
		if event.Action == "pass" && strings.HasPrefix(event.Test, "TestNativeInvariant") {
			passed[event.Test] = true
		}
	}
	want := []string{"TestNativeInvariantNominalCollision", "TestNativeInvariantNominalCompileScope", "TestNativeInvariantNominalIdempotence", "TestNativeInvariantNominalProductionControl", "TestNativeInvariantModuleQualifiers",
		"TestNativeInvariantContextClassification", "TestNativeInvariantEffectSiteIdentity", "TestNativeInvariantDurableCapabilityClassifier", "TestNativeInvariantCompilerModuleIdentity", "TestNativeInvariantDurableWireCompatibility", "TestNativeInvariantExplicitPlanBindings"}
	if len(passed) != len(want) {
		t.Fatalf("native test inventory %v\n%s", passed, output)
	}
	for _, name := range want {
		if !passed[name] {
			t.Fatalf("native invariant %s was not measured\n%s", name, output)
		}
	}
	t.Logf("%d native internal invariants passed in an isolated test-only overlay", len(passed))
}
