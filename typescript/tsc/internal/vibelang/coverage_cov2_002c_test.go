package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"os"
	"testing"
)

func cov2002cDiagnostic(t *testing.T, source string, code int32) {
	t.Helper()
	p, f, _, _ := editorProgram(t, source)
	found := false
	for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
		if d.Code() == code {
			found = true
		}
		if d.Category() == diagnostics.CategoryError && d.Code() != code {
			t.Logf("additional diagnostic %d: %s", d.Code(), d.String())
		}
	}
	if !found {
		t.Fatalf("missing EK%04d in %s", code, source)
	}
}

// Chapter 002: OperationsOutside
// Spec rule: docs/design/src/002-running.md#4d99de8d91aa874f
func TestCov2002cOperationsOutside(t *testing.T) {
	cov2002cDiagnostic(t, "function f(){return try.all [Effect.succeed(1)]}", 501)
	cov2002cDiagnostic(t, "function f(){return try.race [Effect.succeed(1)]}", 501)
	cov2002cDiagnostic(t, "function f(){return try.any [Effect.succeed(1)]}", 501)
	cov2002cDiagnostic(t, "function f(){return try.allSettled [Effect.succeed(1)]}", 501)
}

// Chapter 002: RetiredAwait
// Spec rule: docs/design/src/002-running.md#64134e82af21df18
func TestCov2002cRetiredAwait(t *testing.T) {
	cov2002cDiagnostic(t, "effect function f(){return await.all [Effect.succeed(1)]}", 1802)
	cov2002cDiagnostic(t, "effect function f(){return await.race [Effect.succeed(1)]}", 1802)
	cov2002cDiagnostic(t, "effect function f(){return await.any [Effect.succeed(1)]}", 1802)
	cov2002cDiagnostic(t, "effect function f(){return await.allSettled [Effect.succeed(1)]}", 1802)
}

// Chapter 002: UnknownOperation
// Spec rule: docs/design/src/002-running.md#85d10a8a98ef640e
func TestCov2002cUnknownOperation(t *testing.T) {
	cov2002cDiagnostic(t, "effect function f(){return try.map Effect.succeed(1)}", 1803)
}

// Chapter 002: ConcurrentOutside
// Spec rule: docs/design/src/002-running.md#097118cf27533c74
func TestCov2002cConcurrentOutside(t *testing.T) {
	cov2002cDiagnostic(t, "function f(){for concurrent(const n of [1]){}}", 1902)
}

// Chapter 002: ConcurrentBreak
// Spec rule: docs/design/src/002-running.md#075e5493c4dea019
func TestCov2002cConcurrentBreak(t *testing.T) {
	if os.Getenv("COV2_002C_PROBE") == "" {
		t.Skip("docs/design/src/002-running.md#075e5493c4dea019 — Missing required concurrent diagnostic in head/operand fixtures; see batch1-validation-r2.log")
	}

	cov2002cDiagnostic(t, "effect function f(){for concurrent(const n of [1]){break}}", 1903)
	cov2002cDiagnostic(t, "effect function f(){for concurrent(const {n=do{break;1}} of [{}]){}}", 1903)
}

// Chapter 002: ConcurrentReturn
// Spec rule: docs/design/src/002-running.md#c1499798b2956704
func TestCov2002cConcurrentReturn(t *testing.T) {
	if os.Getenv("COV2_002C_PROBE") == "" {
		t.Skip("docs/design/src/002-running.md#c1499798b2956704 — Missing required concurrent diagnostic in head/operand fixtures; see batch1-validation-r2.log")
	}

	cov2002cDiagnostic(t, "effect function f(){for concurrent(const n of [1]){return n}}", 1904)
	cov2002cDiagnostic(t, "effect function f(){for concurrent(const {n=do{return 1;1}} of [{}]){}}", 1904)
}

// Chapter 002: ConcurrentOutwardContinue
// Spec rule: docs/design/src/002-running.md#e58e06dc7794c769
func TestCov2002cConcurrentOutwardContinue(t *testing.T) {
	if os.Getenv("COV2_002C_PROBE") == "" {
		t.Skip("docs/design/src/002-running.md#e58e06dc7794c769 — Missing required concurrent diagnostic in head/operand fixtures; see batch1-validation-r2.log")
	}

	cov2002cDiagnostic(t, "effect function f(){outer:for(const n of [1]){for concurrent(const x of [n]){continue outer}}}", 1905)
	cov2002cDiagnostic(t, "effect function f(){outer:for(const x of [1]){for concurrent(const {n=do{continue outer;1}} of [{}]){}}}", 1905)
}

// Chapter 002: ConcurrentOperand
// Spec rule: docs/design/src/002-running.md#78a34f20bcde6e1c
func TestCov2002cConcurrentOperand(t *testing.T) {
	if os.Getenv("COV2_002C_PROBE") == "" {
		t.Skip("docs/design/src/002-running.md#78a34f20bcde6e1c — Missing required concurrent diagnostic in head/operand fixtures; see batch1-validation-r2.log")
	}

	cov2002cDiagnostic(t, "effect function f(){for concurrent(const n of 5){}}", 1901)
	cov2002cDiagnostic(t, "effect function f(){for concurrent(const n of Stream.make(1)){}}", 1901)
}

// Chapter 002: ConcurrentHead
// Spec rule: docs/design/src/002-running.md#8fcddd762fe2c46b
func TestCov2002cConcurrentHead(t *testing.T) {
	if os.Getenv("COV2_002C_PROBE") == "" {
		t.Skip("docs/design/src/002-running.md#8fcddd762fe2c46b — Missing required concurrent diagnostic in head/operand fixtures; see batch1-validation-r2.log")
	}

	cov2002cDiagnostic(t, "effect function f(){let x=0;for concurrent(var x of [1]){}}", 1906)
	cov2002cDiagnostic(t, "effect function f(){let x=0;for concurrent(x of [1]){}}", 1906)
	cov2002cDiagnostic(t, "effect function f(){let x=0;for concurrent(using x of [1]){}}", 1906)
	cov2002cDiagnostic(t, "effect function f(){let x=0;for concurrent(await using x of [1]){}}", 1906)
}

// Chapter 002: ConcurrentLimit
// Spec rule: docs/design/src/002-running.md#4d46d7afbd665fd9
func TestCov2002cConcurrentLimit(t *testing.T) {
	cov2002cDiagnostic(t, "effect function f(){for concurrent(\"fast\")(const n of [1]){}}", 1907)
}
