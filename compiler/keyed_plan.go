package compiler

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"regexp"
	"slices"

	"github.com/smithersai/vibelang/compiler/wirejson"
)

// KeyedPlanCompiler operates on inert JSON declarations, not source or runtime
// code. Verification establishes graph integrity, never execution authority.
type KeyedPlanCompiler interface {
	KeyedPlan(context.Context, KeyedPlanRequest) (KeyedPlanResult, error)
}

type KeyedPlanRequest struct {
	Operation string `json:"operation"`
	InputJSON string `json:"inputJson"`
}

type KeyedPlanResult struct {
	OK        bool   `json:"ok"`
	PlanJSON  string `json:"planJson"`
	Key       string `json:"key"`
	ErrorCode string `json:"errorCode"`
	Message   string `json:"message"`
}

func (c *forkCompiler) KeyedPlan(ctx context.Context, request KeyedPlanRequest) (KeyedPlanResult, error) {
	payload, err := exchangeFork[json.RawMessage](ctx, c.executable, []string{"--keyed-plan"}, request)
	if payload == nil || err != nil {
		return KeyedPlanResult{}, err
	}
	return decodeKeyedPlanResult(*payload, request)
}

var keyedPlanStoredKeyPattern = regexp.MustCompile(`^key1_[0-9a-f]{64}$`)

func decodeKeyedPlanResult(payload json.RawMessage, request KeyedPlanRequest) (KeyedPlanResult, error) {
	invalid := func() (KeyedPlanResult, error) {
		return KeyedPlanResult{}, &ForkError{Op: "validate response", Detail: "inconsistent keyed Plan result", Err: ErrForkProtocol}
	}
	var fields map[string]json.RawMessage
	if len(payload) > 40*1024*1024 || wirejson.Decode(bytes.NewReader(payload), &fields) != nil || len(fields) != 5 {
		return invalid()
	}
	for _, field := range []string{"ok", "planJson", "key", "errorCode", "message"} {
		if fields[field] == nil || bytes.Equal(bytes.TrimSpace(fields[field]), []byte("null")) {
			return invalid()
		}
	}
	var out KeyedPlanResult
	if wirejson.Decode(bytes.NewReader(payload), &out) != nil || len(out.PlanJSON) > 16*1024*1024 ||
		len(out.Key) > 69 || len(out.ErrorCode) > 64 || len(out.Message) > 16*1024 {
		return invalid()
	}
	if !out.OK {
		if out.PlanJSON != "" || out.Key != "" || out.Message == "" || !slices.Contains([]string{
			"invalid_json", "invalid_operation", "invalid_node", "invalid_plan", "graph_too_large", "cycle",
			"unknown_dependency", "missing_dependency", "duplicate_node", "overlap_forbidden", "invalid_effects",
		}, out.ErrorCode) {
			return invalid()
		}
		return out, nil
	}
	if out.ErrorCode != "" || out.Message != "" {
		return invalid()
	}
	if request.Operation == "derive-key" {
		if out.PlanJSON != "" || !keyedPlanStoredKeyPattern.MatchString(out.Key) {
			return invalid()
		}
	} else {
		if !slices.Contains([]string{"compile", "verify", "append"}, request.Operation) || out.Key != "" || out.PlanJSON == "" {
			return invalid()
		}
		var artifact map[string]json.RawMessage
		if wirejson.Decode(bytes.NewBufferString(out.PlanJSON), &artifact) != nil || len(artifact) != 6 {
			return invalid()
		}
		var content any
		if json.Unmarshal([]byte(out.PlanJSON), &content) != nil {
			return invalid()
		}
		visited := 0
		var bounded func(any, int) bool
		bounded = func(value any, depth int) bool {
			visited++
			if visited > 1_000_000 || depth > 256 {
				return false
			}
			switch value := value.(type) {
			case float64:
				return !math.IsInf(value, 0) && !math.IsNaN(value) && !(value == 0 && math.Signbit(value))
			case []any:
				for _, child := range value {
					if !bounded(child, depth+1) {
						return false
					}
				}
			case map[string]any:
				for _, child := range value {
					if !bounded(child, depth+1) {
						return false
					}
				}
			}
			return true
		}
		if !bounded(content, 0) {
			return invalid()
		}
		for _, field := range []string{"planId", "flow", "generation", "baseDigest", "digest", "nodes"} {
			if artifact[field] == nil || bytes.Equal(bytes.TrimSpace(artifact[field]), []byte("null")) {
				return invalid()
			}
		}
		var plan struct {
			PlanID     string            `json:"planId"`
			Flow       string            `json:"flow"`
			Generation int               `json:"generation"`
			BaseDigest string            `json:"baseDigest"`
			Digest     string            `json:"digest"`
			Nodes      []json.RawMessage `json:"nodes"`
		}
		if wirejson.Decode(bytes.NewBufferString(out.PlanJSON), &plan) != nil || plan.PlanID == "" || plan.Flow == "" || plan.Nodes == nil ||
			len(plan.Nodes) > 10000 || plan.Generation < 0 || plan.Generation > len(plan.Nodes) ||
			!keyedPlanStoredKeyPattern.MatchString(plan.Digest) || !keyedPlanStoredKeyPattern.MatchString(plan.BaseDigest) {
			return invalid()
		}
		// Full node reconstruction is owned by the pinned native compiler.
	}
	return out, nil
}
