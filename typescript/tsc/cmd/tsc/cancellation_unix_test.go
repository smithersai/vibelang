//go:build unix

package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestCompilerCancellationHelper(t *testing.T) {
	if os.Getenv("VIBELANG_TEST_CANCELLATION") != "1" {
		return
	}
	for i, arg := range os.Args {
		if arg == "--" {
			os.Args = append(os.Args[:1], os.Args[i+1:]...)
			os.Exit(runMain())
		}
	}
	t.Fatal("missing compiler arguments")
}

// Opening the configuration pipe proves the compiler has installed its signal
// handler and started real command work. Release it only after interruption,
// avoiding a race against process startup or a particularly fast compilation.
func compilerCancellation(t *testing.T, mode byte, interrupt bool) {
	t.Helper()
	root := t.TempDir()
	config := filepath.Join(root, "tsconfig.json")
	text := "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"ESNext\",\"outDir\":\"out\"},\"files\":[\"main.ts\"]}"
	if err := os.WriteFile(filepath.Join(root, "main.ts"), []byte("export const value = 1\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := syscall.Mkfifo(config, 0600); err != nil {
		t.Fatal(err)
	}
	modes := [][]string{
		{"-p", config, "--noEmit"},
		{"-p", config},
		{"-p", config, "--fix", "--noEmit"},
		{"-b", config},
	}
	args := append([]string{"-test.run=^TestCompilerCancellationHelper$", "--"}, modes[int(mode)%len(modes)]...)
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], args...)
	cmd.Dir = root
	cmd.Env = append(os.Environ(), "VIBELANG_TEST_CANCELLATION=1")
	var output strings.Builder
	cmd.Stdout = &output
	cmd.Stderr = &output
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill() })
	var fd int
	for {
		var err error
		fd, err = syscall.Open(config, syscall.O_WRONLY|syscall.O_NONBLOCK, 0)
		if err == nil {
			break
		}
		if !errors.Is(err, syscall.ENXIO) {
			t.Fatal(err)
		}
		select {
		case <-ctx.Done():
			t.Fatal("compiler did not read its configuration")
		case <-time.After(time.Millisecond):
		}
	}
	writer := os.NewFile(uintptr(fd), config)
	defer writer.Close()
	if interrupt {
		signal := syscall.SIGTERM
		if mode&4 != 0 {
			signal = syscall.SIGINT
		}
		if err := cmd.Process.Signal(signal); err != nil {
			t.Fatal(err)
		}
	}
	// Later reads see an ordinary file, including --fix's second compile.
	if err := os.WriteFile(config+".next", []byte(text), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(config+".next", config); err != nil {
		t.Fatal(err)
	}
	if _, err := writer.WriteString(text); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	err := cmd.Wait()
	if ctx.Err() != nil {
		t.Fatal("compiler did not finish after its configuration was released")
	}
	if !interrupt {
		if err != nil {
			t.Fatalf("uninterrupted command failed: %v\n%s", err, output.String())
		}
		return
	}
	if err == nil {
		t.Fatalf("interrupted compiler reported success\n%s", output.String())
	}
	if !strings.Contains(output.String(), "interrupted") && !strings.Contains(output.String(), "cancelled") {
		t.Fatalf("interruption needs an explicit diagnostic: %v\n%s", err, output.String())
	}
}

func TestCompilerCancellation(t *testing.T) {
	for mode := byte(0); mode < 8; mode++ {
		t.Run(fmt.Sprint(mode), func(t *testing.T) { compilerCancellation(t, mode, true) })
	}
	t.Run("uninterrupted", func(t *testing.T) { compilerCancellation(t, 0, false) })
}

func FuzzCompilerCancellation(f *testing.F) {
	for mode := byte(0); mode < 8; mode++ {
		f.Add(mode)
	}
	f.Fuzz(func(t *testing.T, mode byte) { compilerCancellation(t, mode, true) })
}
