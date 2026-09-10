package compiler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"path"

	"github.com/smithersai/vibelang/compiler/wirejson"
)

func (c *forkCompiler) LowerLanguage(ctx context.Context, request LanguageLoweringRequest) (LanguageLoweringResult, error) {
	payload, err := exchangeFork[json.RawMessage](ctx, c.executable, []string{"--lower-language"}, request)
	if payload == nil || err != nil {
		return LanguageLoweringResult{}, err
	}
	invalid := func(detail string) (LanguageLoweringResult, error) {
		return LanguageLoweringResult{}, &ForkError{Op: "validate response", Detail: detail, Err: ErrForkProtocol}
	}
	var fields map[string]json.RawMessage
	if len(*payload) > 64*1024*1024 || json.Unmarshal(*payload, &fields) != nil || len(fields) != 4 {
		return invalid("invalid SDK lowering response fields or budget")
	}
	for _, key := range []string{"ok", "analysis", "diagnostics", "files"} {
		if fields[key] == nil || bytes.Equal(bytes.TrimSpace(fields[key]), []byte("null")) {
			return invalid("missing SDK lowering response field")
		}
	}
	var result LanguageLoweringResult
	if err := wirejson.Decode(bytes.NewReader(*payload), &result); err != nil {
		return LanguageLoweringResult{}, &ForkError{Op: "decode response", Detail: "invalid SDK lowering fields", Err: errors.Join(ErrForkProtocol, err)}
	}
	analysisBytes := fields["analysis"]
	if _, err := decodeLanguageAnalysis(&analysisBytes, request.Project); err != nil {
		return LanguageLoweringResult{}, err
	}
	sources := map[string]string{}
	for _, file := range request.Project.Files {
		if file.Kind == FileKindVibeLang {
			sources[file.Path] = file.Text
		}
	}
	hasFailure := false
	for _, issue := range result.Diagnostics {
		source, exists := sources[issue.File]
		if !exists || issue.Code == "" || issue.Message == "" || issue.Span == nil || issue.Span.Start < 0 || issue.Span.Length < 0 || issue.Span.Start > utf16Extent(source) ||
			issue.Span.Length > max(1, utf16Extent(source)-issue.Span.Start) || issue.Phase != PhaseLower ||
			(issue.Category != DiagnosticError && issue.Category != DiagnosticWarning && issue.Category != DiagnosticSuggestion && issue.Category != DiagnosticMessage) {
			return invalid("invalid SDK lowering diagnostic")
		}
		hasFailure = hasFailure || issue.Category == DiagnosticError
	}
	if result.OK != (result.Analysis.Checked && !hasFailure) || (!result.OK && len(result.Files) != 0) || len(result.Diagnostics) > 4096 {
		return invalid("inconsistent SDK lowering completion")
	}
	var rawFiles []json.RawMessage
	if json.Unmarshal(fields["files"], &rawFiles) != nil || len(rawFiles) != len(result.Files) {
		return invalid("invalid SDK lowered file array")
	}
	previous, total := "", 0
	for index, file := range result.Files {
		if !sdkRequiredFields(rawFiles[index], "path", "text", "sourceMap") {
			return invalid("invalid SDK lowered file fields")
		}
		source, exists := sources[file.Path]
		if !exists || (previous != "" && compareProtocolUTF16(previous, file.Path) >= 0) || len(file.Text) > 8*1024*1024 {
			return invalid("invalid SDK lowering source identity or budget")
		}
		delete(sources, file.Path)
		previous = file.Path
		total += len(file.Text) + len(file.SourceMap)
		if total > 32*1024*1024 {
			return invalid("SDK lowering output budget exceeded")
		}
		identity, outputName := file.Path, path.Base(file.Path)+".ts"
		for _, output := range request.Outputs {
			if output.Path == file.Path {
				if output.SourceName != "" {
					identity = output.SourceName
				}
				if output.OutputFileName != "" {
					outputName = path.Base(output.OutputFileName)
				}
			}
		}
		// The external-input source-map format permits optional content and
		// normalized paths. Compiler-produced SDK maps have the stricter exact
		// provenance contract: every field and the authored bytes are required.
		if !sdkRequiredFields(json.RawMessage(file.SourceMap), "version", "file", "sourceRoot", "sources", "sourcesContent", "names", "mappings") {
			return invalid("invalid SDK source map fields")
		}
		parsed, err := parseSuppliedSourceMap(file.SourceMap)
		if err != nil || parsed.File != outputName || len(parsed.Sources) != 1 || parsed.Sources[0] != identity ||
			len(parsed.SourcesContent) != 1 || parsed.SourcesContent[0] == nil || *parsed.SourcesContent[0] != source {
			return invalid("invalid SDK source map identity")
		}
		var mapFields map[string]json.RawMessage
		if wirejson.Decode(bytes.NewReader([]byte(file.SourceMap)), &mapFields) != nil {
			return invalid("invalid SDK source map JSON")
		}
		var names []*string
		if json.Unmarshal(mapFields["names"], &names) != nil {
			return invalid("invalid SDK source map names")
		}
		for _, name := range names {
			if name == nil {
				return invalid("invalid SDK source map name")
			}
		}
		if err := validateLoweredSourceMap(identity, source, &LoweredSource{Text: file.Text, SourceMap: file.SourceMap}); err != nil {
			return invalid("invalid SDK lowering source map: " + err.Error())
		}
	}
	if result.OK && len(sources) != 0 {
		return invalid("SDK lowering omitted sources")
	}
	return result, nil
}

func sdkRequiredFields(raw json.RawMessage, keys ...string) bool {
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil || len(fields) != len(keys) {
		return false
	}
	for _, key := range keys {
		if fields[key] == nil || bytes.Equal(bytes.TrimSpace(fields[key]), []byte("null")) {
			return false
		}
	}
	return true
}
