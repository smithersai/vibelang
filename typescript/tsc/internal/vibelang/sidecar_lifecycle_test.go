package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/execute/tsc"
)

func TestDeletedVibeSourcePrunesSidecarsAndReportsTS2307(t *testing.T) {
	_, file, _, _ := editorProgram(t, "export function main() { return 1 }\n")
	dir := filepath.Dir(file.FileName().AsString())

	if err := os.WriteFile(filepath.Join(dir, "helper.vibe"), []byte("export function help(n: number): number { return n + 1 }\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "user.ts"), []byte("import { help } from \"./helper.js\";\nexport const x: number = help(1);\n"), 0600); err != nil {
		t.Fatal(err)
	}
	cfg := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"outDir":"./out"},"include":["*.vibe","*.ts"]}`
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(cfg), 0600); err != nil {
		t.Fatal(err)
	}

	status1, out1 := runVibeCLI(t, dir)
	if status1 != tsc.ExitStatusSuccess {
		t.Fatalf("initial build failed: status=%v\n%s", status1, out1)
	}
	for _, want := range []string{"helper.d.vibe.ts", "helper.d.ts"} {
		if _, err := os.Stat(filepath.Join(dir, want)); err != nil {
			t.Fatalf("expected %s after initial build: %v", want, err)
		}
	}

	if err := os.Remove(filepath.Join(dir, "helper.vibe")); err != nil {
		t.Fatal(err)
	}
	status2, out2 := runVibeCLI(t, dir)
	if status2 == tsc.ExitStatusSuccess || !strings.Contains(out2, "TS2307") {
		t.Fatalf("expected TS2307 after deleting helper.vibe, got status=%v:\n%s", status2, out2)
	}
	for _, gone := range []string{"helper.d.vibe.ts", "helper.d.ts"} {
		if _, err := os.Stat(filepath.Join(dir, gone)); !os.IsNotExist(err) {
			t.Fatalf("expected stale %s to be pruned after deleting helper.vibe", gone)
		}
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	ownerCount := 0
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".vibelang-sidecar-") && strings.HasSuffix(e.Name(), ".owner") {
			ownerCount++
		}
	}
	if ownerCount != 2 {
		t.Fatalf("expected only 2 owner receipts remaining (for main.vibe), got %d", ownerCount)
	}
}

func TestNoEmitOnErrorAndSyntaxErrorPreserveSidecars(t *testing.T) {
	v1 := "export function help(n: number): number { return n + 1 }\nexport function main() { return help(1) }\nexport const read = Effect.try(() => document.title)\n"
	_, file, _, _ := editorProgram(t, v1)
	dir := filepath.Dir(file.FileName().AsString())
	cfg := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"declaration":true,"noEmitOnError":true,"outDir":"./out"},"include":["*.vibe"]}`
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(cfg), 0600); err != nil {
		t.Fatal(err)
	}

	status1, out1 := runVibeCLI(t, dir)
	if status1 != tsc.ExitStatusSuccess || !strings.Contains(out1, "warning EK4402") {
		t.Fatalf("want successful build with an EK4402 warning, got status=%v:\n%s", status1, out1)
	}
	jsPath := filepath.Join(dir, "out", "main.js")
	goodJS, err := os.ReadFile(jsPath)
	if err != nil || len(goodJS) == 0 {
		t.Fatalf("JavaScript missing after the warning: %v", err)
	}
	sidecarPath := filepath.Join(dir, "main.d.vibe.ts")
	goodBytes, err := os.ReadFile(sidecarPath)
	if err != nil {
		t.Fatalf("missing sidecar after v1: %v", err)
	}

	// v2: semantic error under noEmitOnError must keep previous sidecar bytes.
	v2 := "export function help(n: string): string { const bad: number = n; return n }\nexport function main() { return help(\"a\") }\n"
	if err := os.WriteFile(filepath.Join(dir, "main.vibe"), []byte(v2), 0600); err != nil {
		t.Fatal(err)
	}
	status2, out2 := runVibeCLI(t, dir)
	if status2 == tsc.ExitStatusSuccess || !strings.Contains(out2, "TS2322") {
		t.Fatalf("expected TS2322 on v2, got status=%v:\n%s", status2, out2)
	}
	if js, err := os.ReadFile(jsPath); err != nil || string(js) != string(goodJS) {
		t.Fatalf("noEmitOnError changed JavaScript on type error: %v", err)
	}
	afterV2, err := os.ReadFile(sidecarPath)
	if err != nil {
		t.Fatalf("sidecar vanished on v2: %v", err)
	}
	if string(afterV2) != string(goodBytes) {
		t.Fatalf("noEmitOnError rewrote sidecar on type error:\ngot:\n%s\nwant:\n%s", afterV2, goodBytes)
	}

	// v3: syntax error even with noEmitOnError: false must not overwrite sidecar with a truncated recovery tree.
	cfgNoGate := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"declaration":true,"noEmitOnError":false,"outDir":"./out"},"include":["*.vibe"]}`
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(cfgNoGate), 0600); err != nil {
		t.Fatal(err)
	}
	v3 := "export function help(n: number): number { return n + 1\nexport function main() { return help(1) }\n"
	if err := os.WriteFile(filepath.Join(dir, "main.vibe"), []byte(v3), 0600); err != nil {
		t.Fatal(err)
	}
	status3, _ := runVibeCLI(t, dir)
	if status3 == tsc.ExitStatusSuccess {
		t.Fatalf("expected syntax error on v3")
	}
	afterV3, err := os.ReadFile(sidecarPath)
	if err != nil {
		t.Fatalf("sidecar vanished on v3: %v", err)
	}
	if string(afterV3) != string(goodBytes) {
		t.Fatalf("syntax error overwrote sidecar:\ngot:\n%s\nwant:\n%s", afterV3, goodBytes)
	}
}

func TestBuildModeRestoresMissingSidecars(t *testing.T) {
	_, file, _, _ := editorProgram(t, "export function help(n: number): number { return n + 1 }\n")
	dir := filepath.Dir(file.FileName().AsString())
	if err := os.WriteFile(filepath.Join(dir, "user.ts"), []byte("import { help } from \"./main.js\";\nexport const x: number = help(1);\n"), 0600); err != nil {
		t.Fatal(err)
	}
	cfg := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"composite":true,"outDir":"./out"},"include":["*.vibe","*.ts"]}`
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(cfg), 0600); err != nil {
		t.Fatal(err)
	}

	status1, out1 := runVibeCLI(t, dir, "-b", ".")
	if status1 != tsc.ExitStatusSuccess {
		t.Fatalf("initial -b failed: %s", out1)
	}
	sidecar := filepath.Join(dir, "main.d.vibe.ts")
	native := filepath.Join(dir, "main.d.ts")
	if _, err := os.Stat(sidecar); err != nil {
		t.Fatalf("missing sidecar after -b: %v", err)
	}
	if _, err := os.Stat(native); err != nil {
		t.Fatalf("missing native declaration after -b: %v", err)
	}

	if err := os.Remove(sidecar); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(native); err != nil {
		t.Fatal(err)
	}

	status2, out2 := runVibeCLI(t, dir, "-b", ".", "-v")
	if status2 != tsc.ExitStatusSuccess {
		t.Fatalf("second -b failed: %s", out2)
	}
	if _, err := os.Stat(sidecar); err != nil {
		t.Fatalf("vibelang -b did not restore missing main.d.vibe.ts:\n%s", out2)
	}
	if _, err := os.Stat(native); err != nil {
		t.Fatalf("vibelang -b did not restore missing main.d.ts:\n%s", out2)
	}

	status3, out3 := runVibeCLI(t, dir, "-b", ".", "-v")
	if status3 != tsc.ExitStatusSuccess {
		t.Fatalf("third -b failed: %s", out3)
	}
	if !strings.Contains(out3, "is up to date") {
		t.Fatalf("expected third -b to be up to date after sidecars restored:\n%s", out3)
	}
}
