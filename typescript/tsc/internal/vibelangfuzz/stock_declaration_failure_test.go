package vibelangfuzz

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
)

type stockDeclarationFailureFixture struct {
	name, output, want string
	status             int
}

var stockDeclarationFailureFixtures = []stockDeclarationFailureFixture{
	{"node-module", "Error [ERR_MODULE_NOT_FOUND]: Cannot find module './lib/tsc.js'\n", "fail", 1},
	{"node-syntax", "SyntaxError: Unexpected token\n", "fail", 1},
	{"empty-error", "", "fail", 1},
	{"loader-status-two", "Error: failed to load the compiler\n", "fail", 2},
	{"permission", "permission denied\n", "fail", 1},
	{"diagnostic-word", "node: this is not an error TS2322: diagnostic\n", "fail", 1},
	{"warning-only", "warning TS6133: unused variable\n", "fail", 1},
	{"file-diagnostic", "main.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.\n", "skip", 2},
	{"global-diagnostic", "error TS5023: Unknown compiler option.\n", "skip", 1},
	{"unicode-crlf", "δ.ts(2,3): error TS2304: Cannot find name 'missing'.\r\n", "skip", 1},
	{"unsupported-exit", "main.ts(1,1): error TS1005: ';' expected.\n", "fail", 3},
	{"success", "", "pass", 0},
}

// Exercise the actual declaration-baseline helper in a child test process:
// infrastructure failures must fail that test, while source diagnostics
// retain its ordinary invalid-input skip and a successful compiler returns.
func TestStockDeclarationEmitFailures(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the fake compiler uses a POSIX shell")
	}
	if name := os.Getenv("VIBELANG_STOCK_EMIT_PROBE"); name != "" {
		for _, fixture := range stockDeclarationFailureFixtures {
			if fixture.name != name {
				continue
			}
			w := &Workspace{Dir: t.TempDir()}
			compiler := filepath.Join(t.TempDir(), "tsc")
			script := "#!/bin/sh\ncat <<'STOCK_DECLARATION_OUTPUT'\n" + fixture.output +
				"\nSTOCK_DECLARATION_OUTPUT\nexit " + strconv.Itoa(fixture.status) + "\n"
			if err := os.WriteFile(compiler, []byte(script), 0o700); err != nil {
				t.Fatal(err)
			}
			dir := emitDeclarationIdentityStock(t, w, compiler, Project{Files: map[string]string{"main.ts": "export const value = 1\n"}})
			defer os.RemoveAll(dir)
			fmt.Println("STOCK_EMIT_PROBE_RETURNED")
			return
		}
		t.Fatalf("unknown stock declaration fixture %q", name)
	}
	for _, fixture := range stockDeclarationFailureFixtures {
		t.Run(fixture.name, func(t *testing.T) {
			cmd := exec.Command(os.Args[0], "-test.run=^TestStockDeclarationEmitFailures$", "-test.v")
			cmd.Env = append(os.Environ(), "VIBELANG_STOCK_EMIT_PROBE="+fixture.name)
			out, err := cmd.CombinedOutput()
			text := string(out)
			switch fixture.want {
			case "fail":
				if err == nil || !strings.Contains(text, "stock declaration emit failed") {
					t.Fatalf("broken compiler must fail the oracle: exit=%v\n%s", err, text)
				}
			case "skip":
				if err != nil || !strings.Contains(text, "--- SKIP: TestStockDeclarationEmitFailures") {
					t.Fatalf("invalid TypeScript must remain a skipped input: exit=%v\n%s", err, text)
				}
			case "pass":
				if err != nil || !strings.Contains(text, "STOCK_EMIT_PROBE_RETURNED") || strings.Contains(text, "--- SKIP") {
					t.Fatalf("successful compiler must return its baseline: exit=%v\n%s", err, text)
				}
			}
		})
	}
}
