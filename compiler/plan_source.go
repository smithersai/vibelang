package compiler

import (
	"bytes"
	"context"
	"encoding/json"
	"slices"

	"github.com/smithersai/vibelang/compiler/wirejson"
)

// PlanSourceCompiler returns a bounded Plan or an independently derived source
// Manifest. It neither emits executable code nor certifies arbitrary source as
// a checked program. Runtime artifact validation remains a separate boundary.
type PlanSourceRequest struct {
	Source      string                    `json:"source"`
	FileName    string                    `json:"fileName"`
	FlowID      string                    `json:"flowId"`
	FlowVersion int                       `json:"flowVersion"`
	Mode        string                    `json:"mode"`
	Actions     []PlanSourceActionBinding `json:"actions,omitempty"`
	Flows       []PlanSourceFlowBinding   `json:"flows,omitempty"`
}
type PlanSourceActionBinding struct {
	ModuleSpecifier string `json:"moduleSpecifier"`
	ExportName      string `json:"exportName"`
	DescriptorJSON  string `json:"descriptorJson"`
}
type PlanSourceFlowBinding struct {
	ModuleSpecifier string `json:"moduleSpecifier"`
	ExportName      string `json:"exportName"`
	PlanJSON        string `json:"planJson"`
	ManifestJSON    string `json:"manifestJson,omitempty"`
}
type PlanSourceResult struct {
	Status          string              `json:"status"`
	Diagnostics     []Diagnostic        `json:"diagnostics"`
	PlanJSON        string              `json:"planJson"`
	ManifestJSON    string              `json:"manifestJson"`
	ManifestFailure string              `json:"manifestFailure"`
	DerivedActions  []BodyDerivedAction `json:"derivedActions"`
}
type PlanSourceCompiler interface {
	CompilePlanSource(context.Context, PlanSourceRequest) (PlanSourceResult, error)
}

func (c *forkCompiler) CompilePlanSource(ctx context.Context, request PlanSourceRequest) (PlanSourceResult, error) {
	payload, err := exchangeFork[json.RawMessage](ctx, c.executable, []string{"--plan-source"}, request)
	if payload == nil || err != nil {
		return PlanSourceResult{}, err
	}
	return decodePlanSource(*payload, request)
}

func decodePlanSource(payload json.RawMessage, request PlanSourceRequest) (PlanSourceResult, error) {
	invalid := func(message string) (PlanSourceResult, error) {
		return PlanSourceResult{}, &ForkError{Op: "validate response", Detail: message, Err: ErrForkProtocol}
	}
	keys := []string{"status", "diagnostics", "planJson", "manifestJson", "manifestFailure", "derivedActions"}
	var fields map[string]json.RawMessage
	if len(payload) > 40*1024*1024 || wirejson.Decode(bytes.NewReader(payload), &fields) != nil || len(fields) != len(keys) {
		return invalid("invalid Plan source result fields/budget")
	}
	for _, key := range keys {
		if fields[key] == nil || bytes.Equal(bytes.TrimSpace(fields[key]), []byte("null")) {
			return invalid("missing Plan source field")
		}
	}
	var out PlanSourceResult
	if wirejson.Decode(bytes.NewReader(payload), &out) != nil || !slices.Contains([]string{"plan", "manifest", "unrepresentable", "refused"}, out.Status) ||
		out.Diagnostics == nil || len(out.Diagnostics) > 4096 || out.DerivedActions == nil || len(out.DerivedActions) > 100_000 ||
		len(out.PlanJSON) > 16*1024*1024 || len(out.ManifestJSON) > 16*1024*1024 || len(out.ManifestFailure) > 16*1024 {
		return invalid("invalid Plan source completion")
	}
	extent := utf16Extent(request.Source)
	for _, issue := range out.Diagnostics {
		if issue.File != request.FileName || issue.Code == "" || issue.Message == "" || issue.Category != DiagnosticError ||
			!slices.Contains([]Phase{PhaseParse, PhaseBind, PhaseCheck, PhaseLower}, issue.Phase) || issue.Span == nil ||
			issue.Span.Start < 0 || issue.Span.Start > extent || issue.Span.Length < 1 || issue.Span.Length > max(1, extent-issue.Span.Start) {
			return invalid("invalid Plan source diagnostic")
		}
	}
	if (out.Status == "refused") != (len(out.Diagnostics) > 0) {
		return invalid("inconsistent Plan source refusal")
	}
	if out.Status == "refused" || out.Status == "unrepresentable" {
		if out.PlanJSON != "" || out.ManifestJSON != "" || out.ManifestFailure != "" || len(out.DerivedActions) != 0 ||
			(out.Status == "unrepresentable" && request.Mode != "plan") {
			return invalid("refused Plan source leaked artifacts")
		}
		return out, nil
	}
	if out.Status != request.Mode || (out.Status == "plan") != (out.PlanJSON != "") ||
		(out.ManifestJSON != "") == (out.ManifestFailure != "") || (out.Status == "manifest" && out.ManifestFailure != "") {
		return invalid("inconsistent Plan source artifacts")
	}
	for _, artifact := range []string{out.PlanJSON, out.ManifestJSON} {
		if artifact == "" {
			continue
		}
		var value map[string]json.RawMessage
		if wirejson.Decode(bytes.NewBufferString(artifact), &value) != nil || value == nil {
			return invalid("invalid Plan source artifact JSON")
		}
		var id string
		var version int
		if json.Unmarshal(value["flowId"], &id) != nil || id == "" || (request.FlowID != "" && id != request.FlowID) ||
			json.Unmarshal(value["flowVersion"], &version) != nil || version != request.FlowVersion {
			return invalid("incorrect Plan source artifact identity")
		}
	}
	previous := -1
	for _, action := range out.DerivedActions {
		if action.Name == "" || action.ID != request.FileName+"#"+action.Name || action.Start < 0 || action.Start < previous || action.End <= action.Start || action.End > extent {
			return invalid("invalid Plan source Action declaration")
		}
		previous = action.Start
	}
	return out, nil
}
