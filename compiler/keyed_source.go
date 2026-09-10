package compiler

import (
	"bytes"
	"context"
	"encoding/json"
	"slices"

	"github.com/smithersai/vibelang/compiler/wirejson"
)

// KeyedSourceCompiler checks source and extracts an explicit static Plan without
// executing the Flow. Providers are declarations, not execution authority.
type KeyedSourceCompiler interface {
	CompileKeyedPlanSource(context.Context, KeyedSourceRequest) (KeyedSourceResult, error)
}

type KeyedSourceRequest struct {
	Source        string                  `json:"source"`
	FileName      string                  `json:"fileName"`
	ExportName    string                  `json:"exportName,omitempty"`
	FlowID        string                  `json:"flowId"`
	FlowVersion   int                     `json:"flowVersion"`
	PlanID        string                  `json:"planId"`
	InputJSON     string                  `json:"inputJson"`
	ProvidersJSON string                  `json:"providersJson"`
	Dependencies  []KeyedSourceDependency `json:"dependencies,omitempty"`
}

// Explicit source modules, not provider code or descriptor-only declarations.
// Native Go checks their actual types/rows and refuses module initialization.
type KeyedSourceDependency struct {
	FileName string `json:"fileName"`
	Source   string `json:"source"`
}

type KeyedSourceResult struct {
	OK          bool         `json:"ok"`
	PlanJSON    string       `json:"planJson"`
	Diagnostics []Diagnostic `json:"diagnostics"`
}

func (c *forkCompiler) CompileKeyedPlanSource(ctx context.Context, request KeyedSourceRequest) (KeyedSourceResult, error) {
	payload, err := exchangeFork[json.RawMessage](ctx, c.executable, []string{"--keyed-plan-source"}, request)
	if payload == nil || err != nil {
		return KeyedSourceResult{}, err
	}
	return decodeKeyedSource(*payload, request)
}

func decodeKeyedSource(payload json.RawMessage, request KeyedSourceRequest) (KeyedSourceResult, error) {
	invalid := func() (KeyedSourceResult, error) {
		return KeyedSourceResult{}, &ForkError{Op: "validate response", Detail: "inconsistent keyed source result", Err: ErrForkProtocol}
	}
	var fields map[string]json.RawMessage
	if len(payload) > 40*1024*1024 || wirejson.Decode(bytes.NewReader(payload), &fields) != nil || len(fields) != 3 {
		return invalid()
	}
	for _, field := range []string{"ok", "planJson", "diagnostics"} {
		if fields[field] == nil || bytes.Equal(bytes.TrimSpace(fields[field]), []byte("null")) {
			return invalid()
		}
	}
	var out KeyedSourceResult
	if wirejson.Decode(bytes.NewReader(payload), &out) != nil || out.Diagnostics == nil || len(out.Diagnostics) > 4096 ||
		out.OK != (len(out.Diagnostics) == 0) || out.OK != (out.PlanJSON != "") {
		return invalid()
	}
	for _, issue := range out.Diagnostics {
		source, present := request.Source, issue.File == request.FileName
		for _, dependency := range request.Dependencies {
			if issue.File == dependency.FileName {
				source, present = dependency.Source, true
				break
			}
		}
		if issue.Code == "" || issue.Message == "" || issue.Category != DiagnosticError ||
			!slices.Contains([]Phase{PhaseParse, PhaseBind, PhaseCheck, PhaseLower, PhaseComptime}, issue.Phase) ||
			!present || issue.Span == nil || issue.Span.Start < 0 || issue.Span.Start > utf16Extent(source) ||
			issue.Span.Length < 1 || issue.Span.Length > max(1, utf16Extent(source)-issue.Span.Start) {
			return invalid()
		}
	}
	if out.OK {
		// Reuse the data endpoint's bounded artifact transport validation. Full
		// source/graph semantics remain in the authenticated native executable.
		wrapper, _ := json.Marshal(KeyedPlanResult{OK: true, PlanJSON: out.PlanJSON})
		if _, err := decodeKeyedPlanResult(wrapper, KeyedPlanRequest{Operation: "compile"}); err != nil {
			return invalid()
		}
		var identity struct{ PlanID, Flow string }
		if json.Unmarshal([]byte(out.PlanJSON), &identity) != nil || identity.PlanID != request.PlanID ||
			(request.FlowID != "" && identity.Flow != request.FlowID) {
			return invalid()
		}
	}
	return out, nil
}
