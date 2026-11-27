package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/printer"
)

func TestDiagnosticRegistrationNoDuplicates(t *testing.T) {
	t.Parallel()
	if len(diagnosticRegistrationErrors) != 0 {
		t.Fatalf("unexpected diagnostic registration errors: %v", diagnosticRegistrationErrors)
	}
}

func TestRegisterDiagnosticRejectsDuplicateWithoutPanic(t *testing.T) {
	prevErrors := len(diagnosticRegistrationErrors)
	defer func() {
		diagnosticRegistrationErrors = diagnosticRegistrationErrors[:prevErrors]
	}()

	const testCode int32 = 99991
	first := message(testCode, errorCategory, "first message")
	second := message(testCode, errorCategory, "second message")
	defer delete(registry, testCode)

	if err := registerDiagnostic(first); err != nil {
		t.Fatalf("unexpected error registering fresh code: %v", err)
	}
	if err := registerDiagnostic(first); err != nil {
		t.Fatalf("re-registering identical message should succeed: %v", err)
	}
	err := registerDiagnostic(second)
	if err == nil || !strings.Contains(err.Error(), "duplicate diagnostic") {
		t.Fatalf("expected duplicate diagnostic error, got %v", err)
	}
	if registry[testCode] != first {
		t.Fatalf("duplicate registration overwrote existing message")
	}
	if err := registerDiagnostic(nil); err == nil {
		t.Fatalf("expected error registering nil message")
	}
}

func TestVisitScopedFallbackDoesNotPanic(t *testing.T) {
	t.Parallel()
	ctx := printer.NewEmitContext()
	tx := &lowering{}
	tx.NewTransformer(func(n *ast.Node) *ast.Node { return n }, ctx)
	node := ctx.Factory.NewIdentifier("plain")
	got := tx.visitScoped(node)
	if got != node {
		t.Fatalf("expected unexpected scope node to fall back unchanged, got %v", got)
	}
}
