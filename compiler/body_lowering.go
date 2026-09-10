package compiler

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"path"
	"slices"
	"strings"

	"github.com/smithersai/vibelang/compiler/wirejson"
)

// BodyLoweringRequest selects the private executable calling convention. The
// output is TypeScript, not a checked/signed executable artifact: BodyContract
// must check the generated SDK program and derive its durable boundary.
type BodyLoweringRequest struct {
	Source         string              `json:"source"`
	FileName       string              `json:"fileName"`
	FlowID         string              `json:"flowId"`
	FlowVersion    int                 `json:"flowVersion"`
	RuntimeImport  string              `json:"runtimeImport"`
	OutputFileName string              `json:"outputFileName"`
	SourceOrigin   *BodyLoweringOrigin `json:"sourceOrigin,omitempty"`
}
type BodyLoweringOrigin struct {
	Text             string `json:"text"`
	SourceMap        string `json:"sourceMap"`
	LoweringIdentity string `json:"loweringIdentity"`
}
type BodyDerivedAction struct {
	Name  string `json:"name"`
	ID    string `json:"id"`
	Start int    `json:"start"`
	End   int    `json:"end"`
}
type BodyErrorIdentity struct {
	Durable string `json:"durable"`
	Nominal string `json:"nominal"`
}
type BodyLoweringResult struct {
	OK             bool                `json:"ok"`
	Reason         string              `json:"reason"`
	Diagnostics    []Diagnostic        `json:"diagnostics"`
	Code           string              `json:"code"`
	SourceMap      string              `json:"sourceMap"`
	ManifestJSON   string              `json:"manifestJson"`
	Entry          string              `json:"entry"`
	EntrySpan      *Span               `json:"entrySpan"`
	FunctionSpan   *Span               `json:"functionSpan"`
	Async          bool                `json:"async"`
	Resumable      bool                `json:"resumable"`
	DerivedActions []BodyDerivedAction `json:"derivedActions"`
	Errors         []BodyErrorIdentity `json:"errors"`
}
type BodyLowerer interface {
	LowerBody(context.Context, BodyLoweringRequest) (BodyLoweringResult, error)
}

func (c *forkCompiler) LowerBody(ctx context.Context, request BodyLoweringRequest) (BodyLoweringResult, error) {
	payload, err := exchangeFork[json.RawMessage](ctx, c.executable, []string{"--lower-body"}, request)
	if payload == nil || err != nil {
		return BodyLoweringResult{}, err
	}
	return decodeBodyLowering(*payload, request)
}

func decodeBodyLowering(payload json.RawMessage, request BodyLoweringRequest) (BodyLoweringResult, error) {
	invalid := func(message string) (BodyLoweringResult, error) {
		return BodyLoweringResult{}, &ForkError{Op: "validate response", Detail: message, Err: ErrForkProtocol}
	}
	var fields map[string]json.RawMessage
	keys := []string{"ok", "reason", "diagnostics", "code", "sourceMap", "manifestJson", "entry", "entrySpan", "functionSpan", "async", "resumable", "derivedActions", "errors"}
	if len(payload) > 48*1024*1024 || wirejson.Decode(bytes.NewReader(payload), &fields) != nil || len(fields) != len(keys) {
		return invalid("invalid body lowering fields/budget")
	}
	for _, key := range keys {
		if fields[key] == nil || (key != "entrySpan" && key != "functionSpan" && bytes.Equal(bytes.TrimSpace(fields[key]), []byte("null"))) {
			return invalid("missing body lowering field")
		}
	}
	var result BodyLoweringResult
	if err := wirejson.Decode(bytes.NewReader(payload), &result); err != nil {
		return invalid("invalid body lowering response")
	}
	if !slices.Contains([]string{"", "source", "entry", "boundary", "unsupported", "provenance"}, result.Reason) || result.OK != (result.Reason == "") ||
		result.Diagnostics == nil || len(result.Diagnostics) > 4096 || result.DerivedActions == nil || len(result.DerivedActions) > 100_000 || result.Errors == nil || len(result.Errors) > 100_000 {
		return invalid("invalid body lowering result")
	}
	extent, failed := utf16Extent(request.Source), false
	validSpan := func(where *Span, minimum int) bool {
		return where != nil && where.Start >= 0 && where.Length >= minimum && where.Start <= extent && where.Length <= extent-where.Start
	}
	for _, issue := range result.Diagnostics {
		if issue.Code == "" || issue.Message == "" || (issue.File != "" && issue.File != request.FileName) ||
			!slices.Contains([]Phase{PhaseParse, PhaseBind, PhaseCheck, PhaseLower}, issue.Phase) ||
			!slices.Contains([]DiagnosticCategory{DiagnosticError, DiagnosticWarning, DiagnosticSuggestion, DiagnosticMessage}, issue.Category) ||
			(issue.Span != nil && !validSpan(issue.Span, 0) && !(issue.Span.Start == extent && issue.Span.Length == 1)) {
			return invalid("invalid body diagnostic")
		}
		failed = failed || issue.Category == DiagnosticError
	}
	if result.OK == failed || result.OK != (result.Code != "") || result.OK != (result.SourceMap != "") || result.OK != (result.ManifestJSON != "") || result.OK != (result.Entry != "") ||
		len(result.Code) > 8*1024*1024 || len(result.SourceMap) > 16*1024*1024 || len(result.ManifestJSON) > 16*1024*1024 || utf16Extent(result.Entry) > 2048 {
		return invalid("inconsistent body lowering completion")
	}
	if !result.OK {
		if result.EntrySpan != nil || result.FunctionSpan != nil || result.Async || result.Resumable || len(result.DerivedActions) != 0 || len(result.Errors) != 0 {
			return invalid("refused body leaked partial artifacts")
		}
		return result, nil
	}
	if !sdkRequiredFields(fields["entrySpan"], "start", "length") || !sdkRequiredFields(fields["functionSpan"], "start", "length") ||
		!validSpan(result.EntrySpan, 1) || !validSpan(result.FunctionSpan, 1) {
		return invalid("invalid body source spans")
	}
	if !sdkRequiredFields(json.RawMessage(result.SourceMap), "version", "file", "sourceRoot", "sources", "sourcesContent", "names", "mappings") {
		return invalid("invalid body source map fields")
	}
	parsed, err := parseSuppliedSourceMap(result.SourceMap)
	if err != nil || parsed.File != path.Base(request.OutputFileName) || len(parsed.Sources) != 1 || parsed.Sources[0] != request.FileName ||
		len(parsed.SourcesContent) != 1 || parsed.SourcesContent[0] == nil || *parsed.SourcesContent[0] != request.Source {
		return invalid("invalid body source map identity")
	}
	if err := validateLoweredSourceMap(request.FileName, request.Source, &LoweredSource{Text: result.Code, SourceMap: result.SourceMap}); err != nil {
		return invalid("invalid body source map: " + err.Error())
	}
	if !sdkRequiredFields(json.RawMessage(result.ManifestJSON), "manifestVersion", "flowId", "flowVersion", "actions", "requirements", "contracts", "failures", "sites", "digest") {
		return invalid("invalid body manifest fields")
	}
	var manifest struct {
		ManifestVersion                                   int
		FlowID                                            string
		FlowVersion                                       int
		Actions, Requirements, Contracts, Failures, Sites []json.RawMessage
		Digest                                            string
	}
	flowID := request.FlowID
	if flowID == "" {
		flowID = request.FileName + "#" + result.Entry
	}
	if json.Unmarshal([]byte(result.ManifestJSON), &manifest) != nil || manifest.ManifestVersion != 1 || manifest.FlowID != flowID || manifest.FlowVersion != request.FlowVersion ||
		len(manifest.Digest) != 64 || strings.ToLower(manifest.Digest) != manifest.Digest {
		return invalid("invalid body manifest identity")
	}
	if _, err := hex.DecodeString(manifest.Digest); err != nil {
		return invalid("invalid body manifest digest")
	}
	for _, rows := range [][]json.RawMessage{manifest.Actions, manifest.Requirements, manifest.Contracts, manifest.Failures, manifest.Sites} {
		if rows == nil || len(rows) > 100_000 {
			return invalid("invalid body manifest table")
		}
	}
	var actions, errors []json.RawMessage
	if json.Unmarshal(fields["derivedActions"], &actions) != nil || json.Unmarshal(fields["errors"], &errors) != nil {
		return invalid("invalid body declaration tables")
	}
	seen, end := map[string]bool{}, 0
	for index, action := range result.DerivedActions {
		if !sdkRequiredFields(actions[index], "name", "id", "start", "end") || action.Name == "" || seen[action.Name] || action.ID != request.FileName+"#"+action.Name ||
			action.Start < end || action.End <= action.Start || action.End > extent {
			return invalid("invalid body Action identity/span")
		}
		seen[action.Name], end = true, action.End
	}
	previous := ""
	for index, item := range result.Errors {
		if !sdkRequiredFields(errors[index], "durable", "nominal") || item.Durable <= previous || item.Nominal == "" || len(item.Durable) > 4096 || len(item.Nominal) > 4096 {
			return invalid("invalid body Error identity")
		}
		previous = item.Durable
	}
	return result, nil
}
