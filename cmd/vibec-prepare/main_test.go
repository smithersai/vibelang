package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/smithersai/vibelang/compiler"
)

func TestPreparationCommand(t *testing.T) {
	for _, args := range [][]string{nil, {"--unknown"}, {"--fork-checkout", "/fork", "source.ts"}, {"--fork-checkout", "/fork", "--timeout", "0s"}} {
		var stdout, stderr bytes.Buffer
		called := false
		code := run(args, &stdout, &stderr, func(context.Context, compiler.ForkConfig) (compiler.PreparedFork, error) {
			called = true
			return compiler.PreparedFork{}, nil
		})
		if code != 64 || called || stdout.Len() != 0 || stderr.Len() == 0 {
			t.Fatalf("invalid invocation: %v (%d, called=%v)", args, code, called)
		}
	}
	t.Run("reports a bounded exact preparation", func(t *testing.T) {
		var stdout, stderr bytes.Buffer
		want := compiler.PreparedFork{Executable: "/cache/native", APIVersion: compiler.APIVersion, Revision: compiler.PinnedTypeScriptRevision, SHA256: "digest"}
		code := run([]string{"--fork-checkout", "/fork", "--fork-cache", "/cache", "--go-command", "/go"}, &stdout, &stderr,
			func(ctx context.Context, config compiler.ForkConfig) (compiler.PreparedFork, error) {
				if _, ok := ctx.Deadline(); !ok {
					t.Fatal("missing deadline")
				}
				if config.CheckoutDirectory != "/fork" || config.CacheDirectory != "/cache" || config.GoCommand != "/go" {
					t.Fatalf("wrong config: %+v", config)
				}
				return want, nil
			})
		var got compiler.PreparedFork
		if err := json.Unmarshal(stdout.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		if code != 0 || stderr.Len() != 0 || got != want {
			t.Fatalf("wrong report: %+v (%d)", got, code)
		}
	})
	t.Run("failed preparation has no success report", func(t *testing.T) {
		var stdout, stderr bytes.Buffer
		code := run([]string{"--fork-checkout", "/fork"}, &stdout, &stderr,
			func(context.Context, compiler.ForkConfig) (compiler.PreparedFork, error) {
				return compiler.PreparedFork{}, errors.New("cannot build")
			})
		if code != 1 || stdout.Len() != 0 || stderr.String() != "cannot build\n" {
			t.Fatalf("wrong failure: %d %q %q", code, stdout.String(), stderr.String())
		}
	})
}
