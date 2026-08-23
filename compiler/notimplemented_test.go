package compiler_test

import (
	"context"
	"errors"
	"testing"

	"github.com/smithersai/smithers/compiler"
)

func TestScaffoldReturnsStructuredNotImplemented(t *testing.T) {
	result, err := compiler.New().Compile(context.Background(), compiler.CompileRequest{
		RootNames: []string{"main.sm"},
		Lowering:  compiler.LoweringInternal,
	})
	if !errors.Is(err, compiler.ErrNotImplemented) {
		t.Fatalf("expected ErrNotImplemented, got %v", err)
	}
	if !result.EmitSkipped || len(result.Diagnostics) != 1 {
		t.Fatalf("unexpected result: %#v", result)
	}
	if result.Diagnostics[0].Code != "SMITHERS0001" {
		t.Fatalf("unexpected diagnostic: %#v", result.Diagnostics[0])
	}
}
