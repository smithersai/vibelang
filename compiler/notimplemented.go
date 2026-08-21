package compiler

import (
	"context"
	"errors"
	"fmt"
)

// ErrNotImplemented allows callers to branch without matching diagnostic text.
var ErrNotImplemented = errors.New("vibelang compiler feature not implemented")

// NotImplementedError identifies a compiler surface that is only scaffolded.
type NotImplementedError struct {
	Feature string
}

func (e *NotImplementedError) Error() string {
	return fmt.Sprintf("%s: %v", e.Feature, ErrNotImplemented)
}

func (e *NotImplementedError) Unwrap() error { return ErrNotImplemented }

// New returns the M0 compiler scaffold.
func New() Compiler { return notImplementedCompiler{} }

type notImplementedCompiler struct{}

func (notImplementedCompiler) Compile(_ context.Context, request CompileRequest) (CompileResult, error) {
	feature := "VibeLang compilation"
	if len(request.RootNames) == 0 {
		feature = "project discovery"
	}
	diagnostic := Diagnostic{
		Code:     "VIBE0001",
		Category: DiagnosticError,
		Message:  feature + " is not implemented in the Go compiler scaffold",
		Phase:    PhaseParse,
	}
	return CompileResult{
		Diagnostics: []Diagnostic{diagnostic},
		EmitSkipped: true,
	}, &NotImplementedError{Feature: feature}
}
