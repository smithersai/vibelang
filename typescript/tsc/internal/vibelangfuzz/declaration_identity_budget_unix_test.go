//go:build linux || darwin

package vibelangfuzz

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDeclarationIdentityScopedWorkerCPUCharged(t *testing.T) {
	if os.Getenv("VIBELANG_DECLARATION_BUDGET_PROBE") == "1" {
		enforceFuzzBudget(t, time.Nanosecond)
		registerDeclarationIdentityScope(t)
		dirs := []string{t.TempDir(), t.TempDir()}
		for _, dir := range dirs {
			if err := os.WriteFile(filepath.Join(dir, "index.d.ts"), []byte("export declare const value:string;\n"), 0600); err != nil {
				t.Fatal(err)
			}
		}
		if diff := compareDeclarationTrees(t, dirs[0], dirs[1]); diff != "" {
			t.Fatal(diff)
		}
		return
	}
	cmd := exec.Command(os.Args[0], "-test.v", "-test.run=^TestDeclarationIdentityScopedWorkerCPUCharged$")
	cmd.Env = append(os.Environ(), "VIBELANG_DECLARATION_BUDGET_PROBE=1")
	out, err := cmd.CombinedOutput()
	if err == nil || !strings.Contains(string(out), "short seed CPU budget exceeded") {
		t.Fatalf("persistent worker CPU escaped the unchanged guard: %v\n%s", err, out)
	}
}
