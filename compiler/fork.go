package compiler

import (
	"bytes"
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"slices"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"

	"github.com/smithersai/vibelang/compiler/wirejson"
	runtimesources "github.com/smithersai/vibelang/poc"
)

// PinnedTypeScriptRevision is the exact smithersai/TypeScript revision this
// bridge accepts. Keep it in sync with typescript-fork.json; a test enforces
// the lock.
const PinnedTypeScriptRevision = "bf7f49d6f5ad3254d03ed83dd07ab510ae4e582a"

const forkBridgeAPIVersion = APIVersion

var (
	// ErrForkUnavailable means the exact source checkout or required Go
	// toolchain could not be used. There is deliberately no JavaScript fallback.
	ErrForkUnavailable = errors.New("pinned TypeScript fork unavailable")
	// ErrForkProtocol means the pinned bridge returned an invalid or explicitly
	// rejected request/response.
	ErrForkProtocol = errors.New("pinned TypeScript fork protocol error")
)

// ForkConfig locates an exact TypeScript checkout and a disposable/cacheable
// directory for the bridge binary. CheckoutDirectory is the repository root
// containing tsc/go.mod, not the tsc directory itself. A pristine checkout is
// advanced to the embedded forkpatch post-image; an already-applied checkout
// is accepted only after the same digest gates pass.
type ForkConfig struct {
	CheckoutDirectory string
	CacheDirectory    string
	GoCommand         string
}

// ForkError preserves the failed operation while allowing errors.Is checks.
type ForkError struct {
	Op     string
	Detail string
	Err    error
}

func (e *ForkError) Error() string {
	if e.Detail == "" {
		return fmt.Sprintf("TypeScript fork %s: %v", e.Op, e.Err)
	}
	return fmt.Sprintf("TypeScript fork %s: %s: %v", e.Op, e.Detail, e.Err)
}

func (e *ForkError) Unwrap() error { return e.Err }

//go:embed forkbridge/main.go.txt
var forkBridgeSource []byte

//go:embed forkbridge/lowering.go.txt
var forkLoweringSource []byte

//go:embed forkbridge/checker.go.txt
var forkCheckerBridgeSource []byte

//go:embed forkbridge/comptime.go.txt
var forkComptimeSource []byte

//go:embed forkbridge/durable.go.txt
var forkDurableSource []byte

//go:embed forkbridge/durable_templates.go.txt
var forkDurableTemplatesSource []byte

//go:embed forkbridge/durable_contract_compatibility.go.txt
var forkDurableContractCompatibilitySource []byte

//go:embed forkbridge/durable_bindings.go.txt
var forkDurableBindingsSource []byte

//go:embed forkbridge/plan_child_flows.go.txt
var forkPlanChildFlowsSource []byte

//go:embed forkbridge/plan_source.go.txt
var forkPlanSource []byte

//go:embed forkbridge/keyed_plan.go.txt
var forkKeyedPlanSource []byte

//go:embed forkbridge/keyed_plan_keys.go.txt
var forkKeyedPlanKeysSource []byte

//go:embed forkbridge/keyed_plan_effects.go.txt
var forkKeyedPlanEffectsSource []byte

//go:embed forkbridge/keyed_plan_unicode.go.txt
var forkKeyedPlanUnicodeSource []byte

//go:embed forkbridge/keyed_source.go.txt
var forkKeyedSource []byte

//go:embed forkbridge/keyed_source_check.go.txt
var forkKeyedSourceCheck []byte

//go:embed forkbridge/keyed_source_values.go.txt
var forkKeyedSourceValues []byte

//go:embed forkbridge/keyed_source_expand.go.txt
var forkKeyedSourceExpand []byte

//go:embed forkbridge/keyed_source_branch.go.txt
var forkKeyedSourceBranch []byte

//go:embed forkbridge/keyed_source_statements.go.txt
var forkKeyedSourceStatements []byte

//go:embed forkbridge/keyed_source_facts.go.txt
var forkKeyedSourceFacts []byte

//go:embed forkbridge/durable_source_flows.go.txt
var forkDurableSourceFlows []byte

//go:embed forkbridge/effectmanifest.go.txt
var forkEffectManifestSource []byte

//go:embed forkbridge/hostrules.go.txt
var forkHostRulesSource []byte

//go:embed forkbridge/retired.go.txt
var forkRetiredSyntaxSource []byte

//go:embed forkbridge/nativeprovenance.go.txt
var forkNativeProvenanceSource []byte

//go:embed forkbridge/assets.go.txt
var forkAssetSource []byte

//go:embed forkbridge/mustconsume.go.txt
var forkMustConsumeSource []byte

//go:embed forkbridge/callablerows.go.txt
var forkCallableRowsSource []byte

//go:embed forkbridge/declarations.go.txt
var forkDeclarationsSource []byte

//go:embed forkbridge/declaration_emit.go.txt
var forkDeclarationEmitSource []byte

//go:embed forkbridge/ownershipflow.go.txt
var forkOwnershipFlowSource []byte

//go:embed forkbridge/typescript.go.txt
var forkTypeScriptSource []byte

//go:embed forkbridge/inspect.go.txt
var forkInspectSource []byte

//go:embed forkbridge/format.go.txt
var forkFormatSource []byte

//go:embed forkbridge/loader_registration.go.txt
var forkLoaderRegistrationSource []byte

//go:embed forkbridge/asset_output.go.txt
var forkAssetOutputSource []byte

//go:embed forkbridge/asset_imports.go.txt
var forkAssetImportsSource []byte

//go:embed forkbridge/transpile.go.txt
var forkTranspileSource []byte

//go:embed forkbridge/bundle_modules.go.txt
var forkBundleModulesSource []byte

//go:embed forkbridge/canonical_function.go.txt
var forkCanonicalFunctionSource []byte

//go:embed forkbridge/runtime_modules.go.txt
var forkRuntimeModulesSource []byte

//go:embed forkbridge/durable_module.go.txt
var forkDurableModuleSource []byte

//go:embed forkbridge/schema_syntax.go.txt
var forkSyntaxSchemaSource []byte

//go:embed forkbridge/checked_schemas.go.txt
var forkCheckedSchemasSource []byte

//go:embed forkbridge/source_recovery.go.txt
var forkSourceRecoverySource []byte

//go:embed forkbridge/comptime_plan.go.txt
var forkComptimePlanSource []byte

//go:embed forkbridge/language_analysis.go.txt
var forkLanguageAnalysisSource []byte

//go:embed forkbridge/language_analysis_runtime.go.txt
var forkLanguageAnalysisRuntimeSource []byte

//go:embed forkbridge/sdk_lowering.go.txt
var forkSDKLoweringSource []byte

//go:embed forkbridge/sdk_declarations.go.txt
var forkSDKDeclarationsSource []byte

//go:embed forkbridge/sdk_source_map.go.txt
var forkSDKSourceMapSource []byte

//go:embed forkbridge/language_lowering.go.txt
var forkLanguageLoweringSource []byte

//go:embed forkbridge/comptime_strings.go.txt
var forkComptimeStringsSource []byte

//go:embed forkbridge/runtime_factory.go.txt
var forkRuntimeFactorySource []byte

//go:embed forkbridge/action_contract.go.txt
var forkActionContractSource []byte

//go:embed forkbridge/checked_function.go.txt
var forkCheckedFunctionSource []byte

//go:embed forkbridge/generated_project.go.txt
var forkGeneratedProjectSource []byte

//go:embed forkbridge/project_config.go.txt
var forkProjectConfigSource []byte

//go:embed forkbridge/dependency_trace.go.txt
var forkDependencyTraceSource []byte

//go:embed forkbridge/declaration_text.go.txt
var forkDeclarationTextSource []byte

//go:embed forkbridge/generated_declarations.go.txt
var forkGeneratedDeclarationsSource []byte

//go:embed forkbridge/body_contract.go.txt
var forkBodyContractSource []byte

//go:embed forkbridge/body_lowering.go.txt
var forkBodyLoweringSource []byte

//go:embed forkbridge/schema.go.txt
var forkSchemaSource []byte

// Runtime source is a build input, included in the executable/cache identity.
// Quoting it as Go data avoids an independent generated copy of the validator.
var forkSchemaRuntimeSource = []byte("package main\nconst schemaRuntimeSource = " + strconv.Quote(runtimesources.Schema) + "\n")

// The same Unicode-preserving JSON boundary is compiled into the Go host and
// the standalone fork executable; it is not reimplemented in the overlay.
//
//go:embed wirejson/wire.go
var forkWireJSONSource []byte

// forkPatchFiles is the exact ordered, digest-gated patch series compiled into
// this bridge build. Embedding it keeps a distributed vibec-go binary
// fail-closed: preparation never depends on finding a mutable repository next
// to the executable, and changing series.json or any recorded patch changes
// the bridge cache identity.
//
//go:embed forkpatch/series.json forkpatch/patches/*.patch
var forkPatchFiles embed.FS

type forkPatchManifest struct {
	SchemaVersion int `json:"schemaVersion"`
	Revision      string
	Generator     json.RawMessage `json:"generator"`
	Patches       []struct {
		File    string
		SHA256  string `json:"sha256"`
		Kind    string `json:"kind"`
		Summary string `json:"summary"`
	} `json:"patches"`
	Generated []string          `json:"generated"`
	Created   []string          `json:"created"`
	PreImage  map[string]string `json:"preImage"`
	PostImage map[string]string `json:"postImage"`
}

type pinnedForkPatchSeries struct {
	manifest forkPatchManifest
	patches  map[string][]byte
	identity string
}

// forkBridgeFiles are the Go sources this module owns and injects through the
// build overlay, keyed by their paths inside the tsc module. main.go replaces
// the upstream entry point; the lowering joins that package and the checker
// seam joins the fork's checker package.
var forkBridgeFiles = []struct {
	target string
	source *[]byte
}{
	{target: "cmd/tsc/main.go", source: &forkBridgeSource},
	{target: "cmd/tsc/vibelanglowering.go", source: &forkLoweringSource},
	{target: "cmd/tsc/vibecomptime.go", source: &forkComptimeSource},
	{target: "cmd/tsc/vibelangdurable.go", source: &forkDurableSource},
	{target: "cmd/tsc/vibelangdurabletemplates.go", source: &forkDurableTemplatesSource},
	{target: "cmd/tsc/vibelangdurablecontractcompatibility.go", source: &forkDurableContractCompatibilitySource},
	{target: "cmd/tsc/vibelangdurablebindings.go", source: &forkDurableBindingsSource},
	{target: "cmd/tsc/vibelangplanchildflows.go", source: &forkPlanChildFlowsSource},
	{target: "cmd/tsc/vibelangplansource.go", source: &forkPlanSource},
	{target: "cmd/tsc/vibelangkeyedplan.go", source: &forkKeyedPlanSource},
	{target: "cmd/tsc/vibelangkeyedplankeys.go", source: &forkKeyedPlanKeysSource},
	{target: "cmd/tsc/vibelangkeyedplaneffects.go", source: &forkKeyedPlanEffectsSource},
	{target: "cmd/tsc/vibelangkeyedplanunicode.go", source: &forkKeyedPlanUnicodeSource},
	{target: "cmd/tsc/vibelangkeyedsource.go", source: &forkKeyedSource},
	{target: "cmd/tsc/vibelangkeyedsourcecheck.go", source: &forkKeyedSourceCheck},
	{target: "cmd/tsc/vibelangkeyedsourcevalues.go", source: &forkKeyedSourceValues},
	{target: "cmd/tsc/vibelangkeyedsourceexpand.go", source: &forkKeyedSourceExpand},
	{target: "cmd/tsc/vibelangkeyedsourcebranch.go", source: &forkKeyedSourceBranch},
	{target: "cmd/tsc/vibelangkeyedsourcestatements.go", source: &forkKeyedSourceStatements},
	{target: "cmd/tsc/vibelangkeyedsourcefacts.go", source: &forkKeyedSourceFacts},
	{target: "cmd/tsc/vibelangdurablesourceflows.go", source: &forkDurableSourceFlows},
	{target: "cmd/tsc/vibelangeffectmanifest.go", source: &forkEffectManifestSource},
	{target: "cmd/tsc/vibelanghostrules.go", source: &forkHostRulesSource},
	{target: "cmd/tsc/vibelangretired.go", source: &forkRetiredSyntaxSource},
	{target: "cmd/tsc/vibelangnativeprovenance.go", source: &forkNativeProvenanceSource},
	{target: "cmd/tsc/vibelangassets.go", source: &forkAssetSource},
	{target: "cmd/tsc/vibelangmustconsume.go", source: &forkMustConsumeSource},
	{target: "cmd/tsc/vibecallablerows.go", source: &forkCallableRowsSource},
	{target: "cmd/tsc/vibelangdeclarations.go", source: &forkDeclarationsSource},
	{target: "cmd/tsc/vibelangdeclarationemit.go", source: &forkDeclarationEmitSource},
	{target: "cmd/tsc/vibelangownershipflow.go", source: &forkOwnershipFlowSource},
	{target: "cmd/tsc/vibelangtypescript.go", source: &forkTypeScriptSource},
	{target: "cmd/tsc/vibelanginspect.go", source: &forkInspectSource},
	{target: "cmd/tsc/vibelangformat.go", source: &forkFormatSource},
	{target: "cmd/tsc/vibelangloaderregistration.go", source: &forkLoaderRegistrationSource},
	{target: "cmd/tsc/vibelangassetoutput.go", source: &forkAssetOutputSource},
	{target: "cmd/tsc/vibelangassetimports.go", source: &forkAssetImportsSource},
	{target: "cmd/tsc/vibelangtranspile.go", source: &forkTranspileSource},
	{target: "cmd/tsc/vibelangbundlemodules.go", source: &forkBundleModulesSource},
	{target: "cmd/tsc/vibelangcanonicalfunction.go", source: &forkCanonicalFunctionSource},
	{target: "cmd/tsc/vibelangruntimemodules.go", source: &forkRuntimeModulesSource},
	{target: "cmd/tsc/vibelangdurablemodule.go", source: &forkDurableModuleSource},
	{target: "cmd/tsc/vibelangsyntaxschema.go", source: &forkSyntaxSchemaSource},
	{target: "cmd/tsc/vibelangcheckedschemas.go", source: &forkCheckedSchemasSource},
	{target: "cmd/tsc/vibelangsourcerecovery.go", source: &forkSourceRecoverySource},
	{target: "cmd/tsc/vibelangcomptimeplan.go", source: &forkComptimePlanSource},
	{target: "cmd/tsc/vibelanglanguageanalysis.go", source: &forkLanguageAnalysisSource},
	{target: "cmd/tsc/vibelangsdklowering.go", source: &forkSDKLoweringSource},
	{target: "cmd/tsc/vibelangsdkdeclarations.go", source: &forkSDKDeclarationsSource},
	{target: "cmd/tsc/vibelangsdkmap.go", source: &forkSDKSourceMapSource},
	{target: "cmd/tsc/vibelanglanguagelowering.go", source: &forkLanguageLoweringSource},
	{target: "cmd/tsc/vibelanglanguageanalysisruntime.go", source: &forkLanguageAnalysisRuntimeSource},
	{target: "cmd/tsc/vibelangcomptimestrings.go", source: &forkComptimeStringsSource},
	{target: "cmd/tsc/vibelangruntimefactory.go", source: &forkRuntimeFactorySource},
	{target: "cmd/tsc/vibelangactioncontract.go", source: &forkActionContractSource},
	{target: "cmd/tsc/vibelangcheckedfunction.go", source: &forkCheckedFunctionSource},
	{target: "cmd/tsc/vibelanggeneratedproject.go", source: &forkGeneratedProjectSource},
	{target: "cmd/tsc/vibelangprojectconfig.go", source: &forkProjectConfigSource},
	{target: "cmd/tsc/vibelangdependencytrace.go", source: &forkDependencyTraceSource},
	{target: "cmd/tsc/vibelangdeclarationtext.go", source: &forkDeclarationTextSource},
	{target: "cmd/tsc/vibelanggenerateddeclarations.go", source: &forkGeneratedDeclarationsSource},
	{target: "cmd/tsc/vibelangbodycontract.go", source: &forkBodyContractSource},
	{target: "cmd/tsc/vibelangbodylowering.go", source: &forkBodyLoweringSource},
	{target: "cmd/tsc/vibelangschema.go", source: &forkSchemaSource},
	{target: "cmd/tsc/vibelangschemaruntime.go", source: &forkSchemaRuntimeSource},
	{target: "cmd/tsc/vibewirejson/wire.go", source: &forkWireJSONSource},
	{target: "internal/checker/vibelangbridge.go", source: &forkCheckerBridgeSource},
}

// NewPinnedFork verifies the exact locked fork revision, applies or verifies
// the embedded digest-gated patch series, then builds and handshakes with that
// exact compiler. Overlay-owned bridge sources remain outside the checkout;
// forkpatch-owned upstream modifications remain visible and digest-verifiable.
func NewPinnedFork(ctx context.Context, config ForkConfig) (Compiler, error) {
	executable, err := preparePinnedForkBridge(ctx, config)
	if err != nil {
		return nil, err
	}
	return &forkCompiler{executable: executable}, nil
}

// PreparedFork describes a verified standalone native compiler. The executable
// embeds the upstream libraries and accepts CompileRequest JSON on stdin; it
// does not need this module, a source checkout, or Go after preparation. SHA256
// covers the actual executable bytes, not just its declared source identity.
type PreparedFork struct {
	Executable      string `json:"executable"`
	APIVersion      int    `json:"apiVersion"`
	Revision        string `json:"revision"`
	PatchSeries     string `json:"patchSeries"`
	CompilerVersion string `json:"compilerVersion"`
	SHA256          string `json:"sha256"`
	OS              string `json:"os"`
	Arch            string `json:"arch"`
}

// PreparePinnedFork is the build/package boundary for native host bindings.
// It uses exactly the preparation and identity checks of NewPinnedFork.
func PreparePinnedFork(ctx context.Context, config ForkConfig) (PreparedFork, error) {
	executable, err := preparePinnedForkBridge(ctx, config)
	if err != nil {
		return PreparedFork{}, err
	}
	identity, err := bridgeBuildIdentity(ctx, executable)
	if err != nil {
		return PreparedFork{}, err
	}
	file, err := os.Open(executable)
	if err != nil {
		return PreparedFork{}, err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return PreparedFork{}, err
	}
	return PreparedFork{
		Executable: executable, APIVersion: identity.APIVersion, Revision: identity.Revision,
		PatchSeries: identity.PatchSeries, CompilerVersion: identity.CompilerVersion,
		SHA256: hex.EncodeToString(hash.Sum(nil)), OS: runtime.GOOS, Arch: runtime.GOARCH,
	}, nil
}

type forkCompiler struct {
	executable string
}

type forkEnvelope[T any] struct {
	APIVersion       int            `json:"apiVersion"`
	CompilerRevision string         `json:"compilerRevision"`
	Result           *T             `json:"result"`
	Error            *forkWireError `json:"error,omitempty"`
}

type forkWireError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (c *forkCompiler) Compile(ctx context.Context, request CompileRequest) (CompileResult, error) {
	if err := ctx.Err(); err != nil {
		return CompileResult{EmitSkipped: true}, err
	}
	request, result, err := hydrateCompileRequest(request)
	if err != nil {
		return result, err
	}
	if err := ctx.Err(); err != nil {
		return CompileResult{EmitSkipped: true}, err
	}

	compiled, err := exchangeFork[CompileResult](ctx, c.executable, nil, request)
	if compiled == nil {
		return CompileResult{EmitSkipped: true}, err
	}
	if compiled.Diagnostics == nil || compiled.Artifacts == nil {
		return CompileResult{EmitSkipped: true}, &ForkError{Op: "validate response", Detail: "missing result or result collections", Err: ErrForkProtocol}
	}
	return *compiled, err
}

func (c *forkCompiler) Inspect(ctx context.Context, request InspectionRequest) (InspectionResult, error) {
	inspected, err := exchangeFork[InspectionResult](ctx, c.executable, []string{"--inspect"}, request)
	if inspected == nil {
		return InspectionResult{}, err
	}
	if err != nil {
		return *inspected, err
	}
	if inspected.Files == nil || len(inspected.Files) != len(request.Files) {
		return InspectionResult{}, &ForkError{Op: "validate response", Detail: "missing inspected sources", Err: ErrForkProtocol}
	}
	for index, file := range inspected.Files {
		json := request.Files[index].ScriptKind == "json"
		if file.Path != request.Files[index].Path || file.Diagnostics == nil || file.ModuleSyntax == nil ||
			json != (file.JSONDuplicateKeys != nil) || (json && len(file.ModuleSyntax) != 0) ||
			request.Files[index].DeclarationBindings != (file.DeclarationBindings != nil) || (json && file.DeclarationBindings != nil) {
			return InspectionResult{}, &ForkError{Op: "validate response", Detail: "missing inspection collections", Err: ErrForkProtocol}
		}
		extent := utf16Extent(request.Files[index].Text)
		if file.DeclarationBindings != nil {
			bindings := *file.DeclarationBindings
			if bindings == nil || len(bindings) > 100_000 || (len(file.Diagnostics) != 0 && len(bindings) != 0) {
				return InspectionResult{}, &ForkError{Op: "validate response", Detail: "invalid declaration inventory", Err: ErrForkProtocol}
			}
			previousEnd := 0
			for _, binding := range bindings {
				where := binding.Span
				valid := (binding.Kind == "variable" || binding.Kind == "function") &&
					where.Start >= previousEnd && where.Length >= 1 && where.Start <= extent && where.Length <= extent-where.Start &&
					(binding.Name == nil || *binding.Name != "")
				if name := binding.NameSpan; name == nil {
					valid = valid && binding.Kind == "function" && binding.Name == nil
				} else {
					valid = valid && name.Start >= where.Start && name.Length >= 1 && name.Start <= where.Start+where.Length &&
						name.Length <= where.Start+where.Length-name.Start && (binding.Kind != "function" || binding.Name != nil)
				}
				if !valid {
					return InspectionResult{}, &ForkError{Op: "validate response", Detail: "invalid declaration binding range/identity", Err: ErrForkProtocol}
				}
				previousEnd = where.Start + where.Length
			}
		}
		for _, item := range file.ModuleSyntax {
			valid := item.Span.Start >= 0 && item.Span.Length >= 0 && item.Span.Start <= extent && item.Span.Length <= extent-item.Span.Start
			if item.Specifier == nil {
				valid = valid && item.SpecifierSpan == nil && item.SpecifierKind == ""
			} else {
				literal := item.SpecifierSpan
				valid = valid && literal != nil && (item.SpecifierKind == "string" || item.SpecifierKind == "template")
				if literal != nil {
					valid = valid && literal.Start >= item.Span.Start && literal.Length >= 0 && literal.Start <= item.Span.Start+item.Span.Length && literal.Length <= item.Span.Start+item.Span.Length-literal.Start
				}
			}
			if !valid {
				return InspectionResult{}, &ForkError{Op: "validate response", Detail: "invalid module literal range/kind", Err: ErrForkProtocol}
			}
		}
	}
	return *inspected, err
}

func (c *forkCompiler) Format(ctx context.Context, request FormatRequest) (FormatResult, error) {
	formatted, err := exchangeFork[FormatResult](ctx, c.executable, []string{"--format"}, request)
	if formatted == nil {
		return FormatResult{Code: request.Text, Diagnostics: []FormatDiagnostic{}}, err
	}
	if err == nil && (formatted.Diagnostics == nil || formatted.Changed != (formatted.Code != request.Text) ||
		(!formatted.OK && (formatted.Code != request.Text || len(formatted.Diagnostics) == 0)) ||
		(formatted.OK && len(formatted.Diagnostics) != 0)) {
		return FormatResult{Code: request.Text}, &ForkError{Op: "validate response", Detail: "inconsistent formatting result", Err: ErrForkProtocol}
	}
	return *formatted, err
}

func (c *forkCompiler) TokenAt(ctx context.Context, request TokenRequest) (TokenResult, error) {
	located, err := exchangeFork[TokenResult](ctx, c.executable, []string{"--token-at"}, request)
	if located == nil {
		return TokenResult{}, err
	}
	return *located, err
}

func (c *forkCompiler) LoaderRegistration(ctx context.Context, request LoaderRegistrationRequest) (LoaderRegistrationResult, error) {
	result, err := exchangeFork[LoaderRegistrationResult](ctx, c.executable, []string{"--loader-registration"}, request)
	if result == nil {
		return LoaderRegistrationResult{}, err
	}
	if err == nil && (result.Diagnostics == nil || result.OK != (len(result.Diagnostics) == 0) ||
		(result.Registration != nil && (!result.OK || !result.Identified || result.Registration.FileName != request.FileName)) ||
		(request.Mode == "recognize" && result.OK && result.Registration == nil) ||
		(request.Mode == "discover" && (!result.OK || result.Identified || result.Registration != nil))) {
		return LoaderRegistrationResult{}, &ForkError{Op: "validate response", Detail: "inconsistent loader registration result", Err: ErrForkProtocol}
	}
	return *result, err
}

func (c *forkCompiler) ValidateAssetOutput(ctx context.Context, request AssetOutputRequest) (AssetOutputResult, error) {
	result, err := exchangeFork[AssetOutputResult](ctx, c.executable, []string{"--asset-output"}, request)
	if result == nil {
		return AssetOutputResult{}, err
	}
	if err == nil && (result.References == nil || result.OK != (result.Message == "") || (!result.OK && len(result.References) != 0)) {
		return AssetOutputResult{}, &ForkError{Op: "validate response", Detail: "inconsistent asset-output validation", Err: ErrForkProtocol}
	}
	return *result, err
}

func (c *forkCompiler) AssetImports(ctx context.Context, request AssetImportsRequest) (AssetImportsResult, error) {
	result, err := exchangeFork[AssetImportsResult](ctx, c.executable, []string{"--asset-imports"}, request)
	if result == nil {
		return AssetImportsResult{}, err
	}
	if err != nil {
		return *result, err
	}
	if result.Files == nil || len(result.Files) != len(request.Files) {
		return AssetImportsResult{}, &ForkError{Op: "validate response", Detail: "missing asset import sources", Err: ErrForkProtocol}
	}
	for index, file := range result.Files {
		if file.Path != request.Files[index].Path || file.Requests == nil || file.OrdinaryImports == nil || file.Diagnostics == nil ||
			(len(file.Diagnostics) != 0 && (len(file.Requests) != 0 || len(file.OrdinaryImports) != 0)) {
			return AssetImportsResult{}, &ForkError{Op: "validate response", Detail: "inconsistent asset import collections", Err: ErrForkProtocol}
		}
	}
	return *result, nil
}

func (c *forkCompiler) Transpile(ctx context.Context, request TranspileRequest) (TranspileResult, error) {
	result, err := exchangeFork[TranspileResult](ctx, c.executable, []string{"--transpile"}, request)
	if result == nil {
		return TranspileResult{}, err
	}
	if err != nil {
		return *result, err
	}
	if result.Files == nil || len(result.Files) != len(request.Files) {
		return TranspileResult{}, &ForkError{Op: "validate response", Detail: "missing transpiled sources", Err: ErrForkProtocol}
	}
	for index, file := range result.Files {
		hasErrors := false
		for _, diagnostic := range file.Diagnostics {
			hasErrors = hasErrors || diagnostic.Category == DiagnosticError
		}
		if file.Path != request.Files[index].Path || file.Diagnostics == nil || file.EmitSkipped != hasErrors ||
			(file.EmitSkipped && (file.JavaScript != "" || file.SourceMap != "")) {
			return TranspileResult{}, &ForkError{Op: "validate response", Detail: "inconsistent transpiled source", Err: ErrForkProtocol}
		}
	}
	return *result, nil
}

func (c *forkCompiler) BundleModules(ctx context.Context, request BundleModulesRequest) (BundleModulesResult, error) {
	result, err := exchangeFork[BundleModulesResult](ctx, c.executable, []string{"--bundle-modules"}, request)
	if result == nil {
		return BundleModulesResult{}, err
	}
	if err != nil {
		return *result, err
	}
	paths := map[string]bool{}
	for _, source := range request.Files {
		paths[source.Path] = true
	}
	valid := result.Diagnostics != nil && result.Registrations != nil && (len(result.Diagnostics) == 0 || len(result.Registrations) == 0)
	for _, diagnostic := range result.Diagnostics {
		valid = valid && paths[diagnostic.Path] && diagnostic.Message != ""
	}
	classes := map[string]bool{}
	for _, item := range result.Registrations {
		valid = valid && paths[item.Path] && item.ClassName != "" && !classes[item.ClassName]
		classes[item.ClassName] = true
	}
	if !valid {
		return BundleModulesResult{}, &ForkError{Op: "validate response", Detail: "inconsistent bundle module facts", Err: ErrForkProtocol}
	}
	return *result, nil
}

func (c *forkCompiler) CanonicalFunction(ctx context.Context, request CanonicalFunctionRequest) (CanonicalFunctionResult, error) {
	result, err := exchangeFork[CanonicalFunctionResult](ctx, c.executable, []string{"--canonical-function"}, request)
	if result == nil {
		return CanonicalFunctionResult{}, err
	}
	if err == nil && (result.OK != (result.Message == "") || result.OK != (result.Code != "")) {
		return CanonicalFunctionResult{}, &ForkError{Op: "validate response", Detail: "inconsistent canonical function", Err: ErrForkProtocol}
	}
	return *result, err
}

func (c *forkCompiler) RuntimeModules(ctx context.Context, request RuntimeModulesRequest) (RuntimeModulesResult, error) {
	result, err := exchangeFork[RuntimeModulesResult](ctx, c.executable, []string{"--runtime-modules"}, request)
	if result == nil {
		return RuntimeModulesResult{}, err
	}
	if err != nil {
		return *result, err
	}
	valid := result.Files != nil && len(result.Files) == len(request.Files)
	if valid {
		for index, file := range result.Files {
			valid = valid && file.Path == request.Files[index].Path && file.Edges != nil && file.Diagnostics != nil && file.ParseDiagnostics != nil && file.Resolutions != nil &&
				(len(file.Diagnostics) == 0 || (len(file.Edges) == 0 && len(file.Resolutions) == 0 && !file.LeadingNoThrow)) &&
				(request.ResolutionRoot != "" || len(file.Resolutions) == 0)
		}
	}
	if !valid {
		return RuntimeModulesResult{}, &ForkError{Op: "validate response", Detail: "inconsistent runtime module facts", Err: ErrForkProtocol}
	}
	return *result, nil
}

func (c *forkCompiler) DurableModule(ctx context.Context, request DurableModuleRequest) (DurableModuleResult, error) {
	result, err := exchangeFork[DurableModuleResult](ctx, c.executable, []string{"--durable-module"}, request)
	if result == nil || err != nil {
		return DurableModuleResult{}, err
	}
	valid := result.Diagnostics != nil && result.Imports != nil && result.Calls != nil && result.Removals != nil &&
		(len(result.Diagnostics) == 0 || len(result.Imports)+len(result.Calls)+len(result.Removals) == 0) &&
		(len(result.Calls) == 1 || len(result.Removals) == 0)
	limit := utf16Extent(request.Source)
	for _, spans := range [][]Span{result.Imports, result.Calls, result.Removals} {
		previous := -1
		for _, item := range spans {
			valid = valid && item.Start > previous && item.Start >= 0 && item.Length > 0 && item.Start <= limit && item.Length <= limit-item.Start
			previous = item.Start
		}
	}
	if !valid {
		return DurableModuleResult{}, &ForkError{Op: "validate response", Detail: "inconsistent durable module facts", Err: ErrForkProtocol}
	}
	return *result, nil
}

func (c *forkCompiler) SyntaxSchema(ctx context.Context, request SyntaxSchemaRequest) (SyntaxSchemaResult, error) {
	result, err := exchangeFork[SyntaxSchemaResult](ctx, c.executable, []string{"--syntax-schema"}, request)
	if result == nil || err != nil {
		return SyntaxSchemaResult{}, err
	}
	if result.OK != (result.SchemaJSON != "") || result.OK != (result.Message == "") || (result.OK && result.ParseError) ||
		(result.OK && (len(result.SchemaJSON) > 16*1024*1024 || !json.Valid([]byte(result.SchemaJSON)))) {
		return SyntaxSchemaResult{}, &ForkError{Op: "validate response", Detail: "inconsistent syntax schema", Err: ErrForkProtocol}
	}
	return *result, nil
}

func (c *forkCompiler) CheckedSchemas(ctx context.Context, request CheckedSchemasRequest) (CheckedSchemasResult, error) {
	result, err := exchangeFork[CheckedSchemasResult](ctx, c.executable, []string{"--checked-schemas"}, request)
	if result == nil || err != nil {
		return CheckedSchemasResult{}, err
	}
	valid := len(result.Schemas) == len(request.Queries)
	for _, schema := range result.Schemas {
		valid = valid && schema.OK == (schema.SchemaJSON != "") && schema.OK == (schema.Message == "") &&
			((schema.OK && schema.Failure == "" && len(schema.SchemaJSON) <= 2*1024*1024 && json.Valid([]byte(schema.SchemaJSON))) ||
				(!schema.OK && (schema.Failure == "unsupported" || schema.Failure == "budget")))
	}
	if !valid {
		return CheckedSchemasResult{}, &ForkError{Op: "validate response", Detail: "inconsistent checked schemas", Err: ErrForkProtocol}
	}
	return *result, nil
}

func (c *forkCompiler) PlanComptime(ctx context.Context, request ComptimePlanRequest) (ComptimePlanResult, error) {
	result, err := exchangeFork[ComptimePlanResult](ctx, c.executable, []string{"--comptime-plan"}, request)
	if result == nil || err != nil {
		return ComptimePlanResult{}, err
	}
	extents := map[string]int{}
	for _, file := range request.Files {
		extents[file.Path] = utf16Extent(file.Text)
	}
	validRange := func(where ComptimePlanRange) bool {
		extent, exists := extents[where.File]
		return exists && where.Span.Start >= 0 && where.Span.Length >= 0 && where.Span.Start <= extent-where.Span.Length
	}
	valid := result.Diagnostics != nil && result.Reads != nil && result.Calls != nil && result.Edits != nil &&
		result.Complete == (len(result.Diagnostics) == 0 && len(result.Reads) == 0) &&
		(result.Complete || (len(result.Calls) == 0 && len(result.Edits) == 0))
	for _, issue := range result.Diagnostics {
		valid = valid && validRange(issue.At) && issue.Message != "" && (strings.HasPrefix(issue.Code, "VCT10") || strings.HasPrefix(issue.Code, "VCT12"))
	}
	for _, read := range result.Reads {
		valid = valid && validRange(read.At) && read.Specifier != ""
	}
	for _, call := range result.Calls {
		valid = valid && validRange(call.At) && validRange(call.Argument) && validRange(call.MappedOrigin) && call.Origins != nil && call.Inputs != nil && len(call.ValueJSON) <= 8*1024*1024 && json.Valid([]byte(call.ValueJSON))
		for _, origin := range call.Origins {
			valid = valid && validRange(origin)
		}
		previous := -1
		for _, index := range call.Inputs {
			valid = valid && index > previous && index < len(request.Inputs)
			previous = index
		}
	}
	for _, edit := range result.Edits {
		valid = valid && validRange(edit.At) && validRange(edit.MappedOrigin) && edit.Origins != nil &&
			(edit.Kind == "remove-import" || edit.Kind == "function-marker" || edit.Kind == "intrinsic-call" || edit.Kind == "schema-runtime-import" || edit.Kind == "type-alias")
		for _, origin := range edit.Origins {
			valid = valid && validRange(origin)
		}
	}
	if !valid {
		return ComptimePlanResult{}, &ForkError{Op: "validate response", Detail: "inconsistent comptime phase plan", Err: ErrForkProtocol}
	}
	return *result, nil
}

func (c *forkCompiler) AnalyzeLanguage(ctx context.Context, request LanguageAnalysisRequest) (LanguageAnalysisResult, error) {
	payload, err := exchangeFork[json.RawMessage](ctx, c.executable, []string{"--analyze-language"}, request)
	if payload == nil || err != nil {
		return LanguageAnalysisResult{}, err
	}
	return decodeLanguageAnalysis(payload, request)
}

func decodeLanguageAnalysis(payload *json.RawMessage, request LanguageAnalysisRequest) (LanguageAnalysisResult, error) {
	var decoded LanguageAnalysisResult
	if len(*payload) > 32*1024*1024 || !languageAnalysisWireShape(*payload, request.TraceDependencies) {
		return LanguageAnalysisResult{}, &ForkError{Op: "validate response", Detail: "missing or oversized language analysis fields", Err: ErrForkProtocol}
	}
	if err := wirejson.Decode(bytes.NewReader(*payload), &decoded); err != nil {
		return LanguageAnalysisResult{}, &ForkError{Op: "decode response", Detail: "invalid language analysis fields", Err: errors.Join(ErrForkProtocol, err)}
	}
	result := &decoded
	inputs := map[string][]uint16{}
	allInputs := map[string]int{}
	for _, file := range request.Files {
		allInputs[file.Path] = utf16Extent(file.Text)
		if file.Kind == FileKindVibeLang {
			inputs[file.Path] = utf16.Encode([]rune(file.Text))
		}
	}
	valid := result.Files != nil && result.Diagnostics != nil && len(result.Files) == len(inputs) && len(result.Diagnostics) <= 4096
	previous := ""
	declarations := 0
	rowsValid := func(rows []string) bool {
		if rows == nil || len(rows) > 10_000 {
			return false
		}
		for i, name := range rows {
			if name == "" || len(name) > 64*1024 || strings.ContainsRune(name, 0) || (i > 0 && compareProtocolUTF16(rows[i-1], name) >= 0) {
				return false
			}
		}
		return true
	}
	for _, file := range result.Files {
		source, exists := inputs[file.Path]
		valid = valid && exists && (previous == "" || compareProtocolUTF16(previous, file.Path) < 0) && file.Errors != nil && file.Functions != nil &&
			(file.Analyzed || len(file.Errors)+len(file.Functions) == 0) && (!result.Checked || file.Analyzed)
		previous = file.Path
		declarations += len(file.Errors) + len(file.Functions)
		valid = valid && declarations <= 100_000
		last := -1
		for _, e := range file.Errors {
			valid = valid && e.Name != "" && e.Start > last && e.Start >= 0 && e.End > e.Start && e.End <= len(source) && len(utf16.Encode([]rune(e.FieldsSource))) <= e.End-e.Start
			if valid {
				valid = strings.Contains(string(utf16.Decode(source[e.Start:e.End])), e.FieldsSource)
			}
			last = e.Start
		}
		last = -1
		for _, f := range file.Functions {
			valid = valid && f.Name != "" && (f.Channel == "plain" || f.Channel == "result") && f.Start > last && f.Start >= 0 &&
				f.End > f.Start && f.End <= len(source) && f.BodyStart >= f.Start && f.BodyEnd >= f.BodyStart && f.BodyEnd <= f.End &&
				rowsValid(f.Failures) && rowsValid(f.Requirements) && (f.Channel != "plain" || len(f.Failures) == 0)
			last = f.Start
		}
	}
	hasFailure := false
	for _, issue := range result.Diagnostics {
		hasFailure = hasFailure || issue.Category == DiagnosticError
		valid = valid && issue.Code != "" && issue.Message != "" &&
			(issue.Category == DiagnosticError || issue.Category == DiagnosticWarning || issue.Category == DiagnosticMessage || issue.Category == DiagnosticSuggestion) &&
			(issue.Phase == "" || issue.Phase == PhaseParse || issue.Phase == PhaseBind || issue.Phase == PhaseCheck || issue.Phase == PhaseLower || issue.Phase == PhaseEmit || issue.Phase == PhaseComptime)
		if issue.Span != nil {
			valid = valid && issue.Span.Start >= 0 && issue.Span.Length >= 0 && issue.File != ""
			if extent, exists := allInputs[issue.File]; exists {
				valid = valid && issue.Span.Start <= extent && issue.Span.Length <= max(1, extent-issue.Span.Start)
			}
		}
	}
	valid = valid && result.Checked != hasFailure && validDependencyTrace(result.Dependencies, request.TraceDependencies, request.ResolutionRoot)
	if request.TraceDependencies && request.ResolutionRoot == "" && result.Dependencies != nil {
		valid = valid && len(result.Dependencies.Files)+len(result.Dependencies.Directories) == 0
	}
	if !valid {
		return LanguageAnalysisResult{}, &ForkError{Op: "validate response", Detail: "inconsistent language analysis", Err: ErrForkProtocol}
	}
	return *result, nil
}

// encoding/json otherwise treats absent/null booleans as false. In particular,
// a lost moduleScope flag would silently change the public row-table owner.
func languageAnalysisWireShape(raw json.RawMessage, trace bool) bool {
	record := func(raw json.RawMessage, keys ...string) map[string]json.RawMessage {
		var fields map[string]json.RawMessage
		if json.Unmarshal(raw, &fields) != nil || len(fields) != len(keys) {
			return nil
		}
		for _, key := range keys {
			if fields[key] == nil || bytes.Equal(bytes.TrimSpace(fields[key]), []byte("null")) {
				return nil
			}
		}
		return fields
	}
	keys := []string{"checked", "diagnostics", "files"}
	if trace {
		keys = append(keys, "dependencies")
	}
	root := record(raw, keys...)
	if root == nil {
		return false
	}
	var files []json.RawMessage
	if json.Unmarshal(root["files"], &files) != nil {
		return false
	}
	for _, raw := range files {
		file := record(raw, "path", "analyzed", "errors", "functions")
		if file == nil {
			return false
		}
		var errors, functions []json.RawMessage
		if json.Unmarshal(file["errors"], &errors) != nil || json.Unmarshal(file["functions"], &functions) != nil {
			return false
		}
		for _, item := range errors {
			if record(item, "name", "fieldsSource", "start", "end") == nil {
				return false
			}
		}
		for _, item := range functions {
			if record(item, "name", "exported", "async", "channel", "explicitReturn", "start", "end", "bodyStart", "bodyEnd", "moduleScope", "failures", "requirements") == nil {
				return false
			}
		}
	}
	return true
}

func (c *forkCompiler) RecoverSource(ctx context.Context, request SourceRecoveryRequest) (SourceRecoveryResult, error) {
	result, err := exchangeFork[SourceRecoveryResult](ctx, c.executable, []string{"--recover-source"}, request)
	if result == nil || err != nil {
		return SourceRecoveryResult{}, err
	}
	// Decode each string once. Source maps can contain many runs; repeatedly
	// scanning the whole source for every range made validation quadratic.
	authored, derived := utf16.Encode([]rune(request.Text)), utf16.Encode([]rune(result.Code))
	valid := result.Changed == (result.Code != request.Text) && len(derived) <= 4*1024*1024+65536 && len(result.Tokens) <= 1_000_000 &&
		result.Tokens != nil && result.Verbatim != nil && result.Glue != nil && result.Diagnostics != nil && result.RejectedStarts != nil
	type interval struct{ start, end int }
	ranges := []interval{}
	previous := 0
	for _, run := range result.Verbatim {
		inBounds := run.DerivedStart >= previous && run.AuthoredStart >= 0 && run.Length >= 0 && run.AuthoredStart <= len(authored)-run.Length && run.DerivedStart <= len(derived)-run.Length
		valid = valid && inBounds
		if inBounds {
			valid = valid && slices.Equal(authored[run.AuthoredStart:run.AuthoredStart+run.Length], derived[run.DerivedStart:run.DerivedStart+run.Length])
		}
		previous = run.DerivedStart + run.Length
		ranges = append(ranges, interval{run.DerivedStart, previous})
	}
	previous = 0
	for _, run := range result.Glue {
		valid = valid && run.DerivedStart >= previous && run.Length > 0 && run.Anchor >= 0 && run.Anchor <= len(authored) && run.DerivedStart <= len(derived)-run.Length
		previous = run.DerivedStart + run.Length
		ranges = append(ranges, interval{run.DerivedStart, previous})
	}
	sort.Slice(ranges, func(i, j int) bool {
		if ranges[i].start == ranges[j].start {
			return ranges[i].end < ranges[j].end
		}
		return ranges[i].start < ranges[j].start
	})
	covered := 0
	for _, span := range ranges {
		valid = valid && span.start == covered
		covered = span.end
	}
	valid = valid && covered == len(derived)
	previous = -1
	for _, start := range result.RejectedStarts {
		valid = valid && start > previous && start <= len(derived)
		previous = start
	}
	for _, issue := range result.Diagnostics {
		valid = valid && issue.Severity == "error" && issue.Code == "VIBE1717" && issue.Message != "" && issue.Start >= 0 && issue.Start <= len(authored)
	}
	previous = 0
	for _, token := range result.Tokens {
		inBounds := token.Start >= previous && token.End > token.Start && token.End <= len(authored)
		valid = valid && inBounds && token.Kind != ""
		if inBounds {
			valid = valid && slices.Equal(authored[token.Start:token.End], utf16.Encode([]rune(token.Text)))
		}
		for i, character := range token.Kind {
			valid = valid && ((character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z') || (i > 0 && character >= '0' && character <= '9'))
		}
		previous = token.End
	}
	if result.IdentityFallback {
		valid = valid && !result.Changed && len(result.Diagnostics) == 1 && len(result.RejectedStarts) == 0 && len(result.Glue) == 0
	}
	if !valid {
		return SourceRecoveryResult{}, &ForkError{Op: "validate response", Detail: "inconsistent source recovery", Err: ErrForkProtocol}
	}
	return *result, nil
}

func (c *forkCompiler) RuntimeFactory(ctx context.Context, request RuntimeFactoryRequest) (RuntimeFactoryResult, error) {
	result, err := exchangeFork[RuntimeFactoryResult](ctx, c.executable, []string{"--runtime-factory"}, request)
	if result == nil || err != nil {
		return RuntimeFactoryResult{}, err
	}
	if result.OK != (result.Code != "") || result.OK != (result.Message == "") || utf16Extent(result.Code) > 4*1024*1024 {
		return RuntimeFactoryResult{}, &ForkError{Op: "validate response", Detail: "inconsistent runtime factory", Err: ErrForkProtocol}
	}
	return *result, nil
}

func (c *forkCompiler) ActionContract(ctx context.Context, request ActionContractRequest) (ActionContractResult, error) {
	result, err := exchangeFork[ActionContractResult](ctx, c.executable, []string{"--action-contract"}, request)
	if result == nil || err != nil {
		return ActionContractResult{}, err
	}
	valid := result.OK == (result.ContractJSON != "") && result.OK == (len(result.Diagnostics) == 0) && result.Diagnostics != nil &&
		len(result.Diagnostics) <= 32 && len(result.ContractJSON) <= 16*1024*1024
	if result.OK {
		valid = valid && json.Valid([]byte(result.ContractJSON))
	}
	for _, issue := range result.Diagnostics {
		valid = valid && issue.File == request.FileName && issue.Category == DiagnosticError && issue.Phase == PhaseCheck &&
			(issue.Code == "VIBE4200" || issue.Code == "VIBE4201" || issue.Code == "VIBE4202" || issue.Code == "VIBE4203")
	}
	if !valid {
		return ActionContractResult{}, &ForkError{Op: "validate response", Detail: "inconsistent Action contract", Err: ErrForkProtocol}
	}
	return *result, nil
}

func (c *forkCompiler) ValidateConfig(ctx context.Context, request ConfigFile) (ConfigValidationResult, error) {
	result, err := exchangeFork[ConfigValidationResult](ctx, c.executable, []string{"--validate-config"}, request)
	if result == nil || err != nil {
		return ConfigValidationResult{}, err
	}
	valid := result.Diagnostics != nil && len(result.Diagnostics) <= 4096
	for _, issue := range result.Diagnostics {
		valid = valid && issue.File == request.Path && issue.Category == DiagnosticError && issue.Span != nil
		if issue.Span != nil {
			valid = valid && issue.Span.Start >= 0 && issue.Span.Length >= 0 && issue.Span.Start <= utf16Extent(request.Text) && issue.Span.Length <= utf16Extent(request.Text)-issue.Span.Start
		}
	}
	if !valid {
		return ConfigValidationResult{}, &ForkError{Op: "validate response", Detail: "inconsistent configuration diagnostics", Err: ErrForkProtocol}
	}
	return *result, nil
}

func (c *forkCompiler) DiscoverProject(ctx context.Context, request ProjectConfigRequest) (ProjectConfigResult, error) {
	result, err := exchangeFork[ProjectConfigResult](ctx, c.executable, []string{"--discover-project"}, request)
	if result == nil || err != nil {
		return ProjectConfigResult{}, err
	}
	absolute := func(value string) bool {
		return value != "" && len(value) <= 16*1024 && !strings.ContainsAny(value, "\x00\\") && filepath.IsAbs(value) && filepath.Clean(value) == value
	}
	valid := result.Files != nil && len(result.Files) <= 4096 && result.Configurations != nil && len(result.Configurations) <= 1024 && result.Diagnostics != nil && len(result.Diagnostics) <= 4096
	seen := map[string]bool{}
	for _, file := range result.Files {
		valid = valid && absolute(file) && !seen[file]
		seen[file] = true
	}
	sources := map[string]string{}
	bytes := 0
	for _, source := range result.Configurations {
		_, duplicate := sources[source.Path]
		valid = valid && absolute(source.Path) && !duplicate && len(source.Text) <= 2*1024*1024
		sources[source.Path] = source.Text
		bytes += len(source.Text)
	}
	valid = valid && bytes <= 8*1024*1024 && (result.Options.RootDir == "" || absolute(result.Options.RootDir)) && (result.Options.OutDir == "" || absolute(result.Options.OutDir))
	for _, issue := range result.Diagnostics {
		valid = valid && issue.Category == DiagnosticError
		if issue.File == "" {
			valid = valid && issue.Span == nil
			continue
		}
		source, found := sources[issue.File]
		valid = valid && found
		if issue.Span != nil {
			valid = valid && issue.Span.Start >= 0 && issue.Span.Length >= 0 && issue.Span.Start <= utf16Extent(source) && issue.Span.Length <= utf16Extent(source)-issue.Span.Start
		}
	}
	if !valid {
		return ProjectConfigResult{}, &ForkError{Op: "validate response", Detail: "inconsistent project configuration", Err: ErrForkProtocol}
	}
	return *result, nil
}

func (c *forkCompiler) CheckGeneratedProject(ctx context.Context, request GeneratedProjectRequest) (GeneratedProjectResult, error) {
	result, err := exchangeFork[GeneratedProjectResult](ctx, c.executable, []string{"--check-generated-project"}, request)
	if result == nil || err != nil {
		return GeneratedProjectResult{}, err
	}
	extents := make(map[string]int, len(request.Files))
	for _, file := range request.Files {
		extents[file.Path] = utf16Extent(file.Text)
	}
	valid := result.Diagnostics != nil && len(result.Diagnostics) <= 4096 && validDependencyTrace(result.Dependencies, request.TraceDependencies, "")
	if request.TraceDependencies && !request.DiskDependencies && result.Dependencies != nil {
		valid = valid && len(result.Dependencies.Files)+len(result.Dependencies.Directories) == 0
	}
	for _, issue := range result.Diagnostics {
		code, numeric := strings.CutPrefix(issue.Code, "TS")
		_, codeError := strconv.ParseUint(code, 10, 32)
		valid = valid && numeric && codeError == nil && (issue.Phase == PhaseParse || issue.Phase == PhaseBind || issue.Phase == PhaseCheck) &&
			(issue.Category == DiagnosticError || issue.Category == DiagnosticWarning || issue.Category == DiagnosticSuggestion || issue.Category == DiagnosticMessage)
		if issue.File == "" {
			valid = valid && issue.Span == nil
			continue
		}
		extent, found := extents[issue.File]
		valid = valid && found
		if issue.Span != nil {
			valid = valid && issue.Span.Start >= 0 && issue.Span.Length >= 0 && issue.Span.Start <= extent && issue.Span.Length <= extent-issue.Span.Start
		}
	}
	if !valid {
		return GeneratedProjectResult{}, &ForkError{Op: "validate response", Detail: "inconsistent generated-project diagnostics", Err: ErrForkProtocol}
	}
	return *result, nil
}

func (c *forkCompiler) DeclarationText(ctx context.Context, request DeclarationTextRequest) (DeclarationTextResult, error) {
	result, err := exchangeFork[DeclarationTextResult](ctx, c.executable, []string{"--declaration-text"}, request)
	if result == nil || err != nil {
		return DeclarationTextResult{}, err
	}
	valid := len(result.Text) <= 4*1024*1024 && result.Effects != nil && len(result.Effects) <= 4096
	if request.Operation == "read" {
		valid = valid && result.Text == request.Text
	} else {
		valid = valid && len(result.Effects) == 0
	}
	for name, row := range result.Effects {
		valid = valid && name != "" && len(name) <= 4096 && row.Failures != nil && row.Requirements != nil && len(row.Failures) <= 1024 && len(row.Requirements) <= 1024
		for _, list := range [][]string{row.Failures, row.Requirements} {
			for index, name := range list {
				valid = valid && name != "" && utf16Extent(name) <= 1024 && (index == 0 || compareProtocolUTF16(list[index-1], name) < 0)
			}
		}
	}
	if !valid {
		return DeclarationTextResult{}, &ForkError{Op: "validate response", Detail: "inconsistent declaration text result", Err: ErrForkProtocol}
	}
	return *result, nil
}

func (c *forkCompiler) BodyContract(ctx context.Context, request BodyContractRequest) (BodyContractResult, error) {
	result, err := exchangeFork[BodyContractResult](ctx, c.executable, []string{"--body-contract"}, request)
	if result == nil || err != nil {
		return BodyContractResult{}, err
	}
	valid := result.Diagnostics != nil && len(result.Diagnostics) <= 4096 && len(result.Message) <= 16*1024 && len(result.SchemasJSON) <= 16*1024*1024 &&
		(result.Reason == "" || result.Reason == "check" || result.Reason == "entry" || result.Reason == "boundary") &&
		result.OK == (result.Reason == "") && result.OK == (result.Message == "") && result.OK == (result.SchemasJSON != "")
	extents := make(map[string]int)
	for _, file := range request.Project.Files {
		extents[file.Path] = utf16Extent(file.Text)
	}
	hasErrors := false
	for _, issue := range result.Diagnostics {
		code, numeric := strings.CutPrefix(issue.Code, "TS")
		_, codeError := strconv.ParseUint(code, 10, 32)
		valid = valid && numeric && codeError == nil && (issue.Phase == PhaseParse || issue.Phase == PhaseBind || issue.Phase == PhaseCheck) &&
			(issue.Category == DiagnosticError || issue.Category == DiagnosticWarning || issue.Category == DiagnosticSuggestion || issue.Category == DiagnosticMessage)
		hasErrors = hasErrors || issue.Category == DiagnosticError
		if issue.File == "" {
			valid = valid && issue.Span == nil
		} else {
			extent, found := extents[issue.File]
			valid = valid && found
			if issue.Span != nil {
				valid = valid && issue.Span.Start >= 0 && issue.Span.Length >= 0 && issue.Span.Start <= extent && issue.Span.Length <= extent-issue.Span.Start
			}
		}
	}
	valid = valid && hasErrors == (result.Reason == "check")
	if result.OK {
		var schemas map[string]map[string]json.RawMessage
		valid = valid && json.Unmarshal([]byte(result.SchemasJSON), &schemas) == nil && len(schemas) == 3
		for key, role := range map[string]string{"inputSchema": "input", "successSchema": "success", "failureSchema": "error"} {
			schema := schemas[key]
			var format, actualRole, shape, source, digest string
			var version int
			valid = valid && len(schema) == 7 && json.Unmarshal(schema["format"], &format) == nil && format == "canonical-json" &&
				json.Unmarshal(schema["schemaVersion"], &version) == nil && version == 1 && json.Unmarshal(schema["role"], &actualRole) == nil && actualRole == role &&
				json.Unmarshal(schema["shape"], &shape) == nil && shape == "structural" && json.Unmarshal(schema["source"], &source) == nil && source == "compiler-derived" &&
				json.Unmarshal(schema["digest"], &digest) == nil && len(digest) == 64 && len(schema["descriptor"]) > 0 && schema["descriptor"][0] == '{'
			if _, err := hex.DecodeString(digest); err != nil {
				valid = false
			}
		}
	}
	if !valid {
		return BodyContractResult{}, &ForkError{Op: "validate response", Detail: "inconsistent body contract", Err: ErrForkProtocol}
	}
	return *result, nil
}

func compareProtocolUTF16(left, right string) int {
	a, b := utf16.Encode([]rune(left)), utf16.Encode([]rune(right))
	for index := 0; index < len(a) && index < len(b); index++ {
		if a[index] < b[index] {
			return -1
		}
		if a[index] > b[index] {
			return 1
		}
	}
	return len(a) - len(b)
}

func (c *forkCompiler) EmitGeneratedDeclarations(ctx context.Context, request GeneratedDeclarationsRequest) (GeneratedDeclarationsResult, error) {
	result, err := exchangeFork[GeneratedDeclarationsResult](ctx, c.executable, []string{"--emit-generated-declarations"}, request)
	if result == nil || err != nil {
		return GeneratedDeclarationsResult{}, err
	}
	valid := result.Outputs != nil && result.Diagnostics != nil && len(result.Outputs) <= len(request.Project.Files) && len(result.Diagnostics) <= 4096
	expected := make(map[string]bool)
	extents := make(map[string]int)
	for _, file := range request.Project.Files {
		name := file.Path
		if !strings.HasSuffix(name, ".d.ts") && !strings.HasSuffix(name, ".d.mts") && !strings.HasSuffix(name, ".d.cts") {
			ext := filepath.Ext(name)
			suffix := ".d.ts"
			if ext == ".mts" || ext == ".mjs" {
				suffix = ".d.mts"
			}
			if ext == ".cts" || ext == ".cjs" {
				suffix = ".d.cts"
			}
			name = strings.TrimSuffix(name, ext) + suffix
		}
		expected[name] = true
		extents[file.Path] = utf16Extent(file.Text)
	}
	bytes := 0
	for _, file := range result.Outputs {
		valid = valid && expected[file.Path] && len(file.Text) <= 4*1024*1024
		delete(expected, file.Path)
		bytes += len(file.Text)
	}
	valid = valid && bytes <= 16*1024*1024 && (!result.OK || len(expected) == 0) && (result.OK || len(result.Outputs) == 0)
	for _, issue := range result.Diagnostics {
		code, numeric := strings.CutPrefix(issue.Code, "TS")
		_, codeError := strconv.ParseUint(code, 10, 32)
		valid = valid && numeric && codeError == nil && (issue.Phase == PhaseParse || issue.Phase == PhaseBind || issue.Phase == PhaseCheck || issue.Phase == PhaseEmit)
		valid = valid && (issue.Category == DiagnosticError || issue.Category == DiagnosticWarning || issue.Category == DiagnosticSuggestion || issue.Category == DiagnosticMessage) && (!result.OK || issue.Category != DiagnosticError)
		if issue.File == "" {
			valid = valid && issue.Span == nil
		} else {
			extent, found := extents[issue.File]
			valid = valid && found
			if issue.Span != nil {
				valid = valid && issue.Span.Start >= 0 && issue.Span.Length >= 0 && issue.Span.Start <= extent && issue.Span.Length <= extent-issue.Span.Start
			}
		}
	}
	if !valid {
		return GeneratedDeclarationsResult{}, &ForkError{Op: "validate response", Detail: "inconsistent generated declaration result", Err: ErrForkProtocol}
	}
	return *result, nil
}

func (c *forkCompiler) CheckedFunction(ctx context.Context, request CheckedFunctionRequest) (CheckedFunctionResult, error) {
	result, err := exchangeFork[CheckedFunctionResult](ctx, c.executable, []string{"--checked-function"}, request)
	if result == nil || err != nil {
		return CheckedFunctionResult{}, err
	}
	valid := result.Diagnostics != nil && len(result.Diagnostics) <= 4096 &&
		result.OK == (result.Function != nil) && result.OK == (result.Message == "") && len(result.Message) <= 16*1024
	for _, issue := range result.Diagnostics {
		valid = valid && (!result.OK || issue.Category != DiagnosticError)
	}
	if result.OK {
		fn := result.Function
		valid = valid && fn.File == request.EntryFile && fn.Name == request.ExportName &&
			fn.Span.Start >= 0 && fn.Span.Length > 0 && fn.Requirements != nil && fn.TypedFailures != nil &&
			len(fn.FailureSchemaJSON) <= 8*1024*1024 && validCheckedFunctionSchema([]byte(fn.FailureSchemaJSON), "error")
		if request.DurableBoundary {
			var schemas map[string]json.RawMessage
			valid = valid && len(fn.ValueSchemasJSON) <= 16*1024*1024 && wirejson.ValidateUnique([]byte(fn.ValueSchemasJSON)) == nil &&
				wirejson.Decode(strings.NewReader(fn.ValueSchemasJSON), &schemas) == nil && len(schemas) == 3 &&
				validCheckedFunctionSchema(schemas["inputSchema"], "input") && validCheckedFunctionSchema(schemas["successSchema"], "success")
			var completion string
			valid = valid && json.Unmarshal(schemas["completion"], &completion) == nil && (completion == "value" || completion == "promise")
		} else {
			valid = valid && fn.ValueSchemasJSON == ""
		}
		found := false
		for _, file := range request.Files {
			if file.Path == fn.File {
				found = true
				valid = valid && fn.Span.Start <= utf16Extent(file.Text) && fn.Span.Length <= utf16Extent(file.Text)-fn.Span.Start
			}
		}
		valid = valid && found
	}
	if !valid {
		return CheckedFunctionResult{}, &ForkError{Op: "validate response", Detail: "inconsistent checked function", Err: ErrForkProtocol}
	}
	return *result, nil
}

func validCheckedFunctionSchema(raw []byte, role string) bool {
	var schema map[string]json.RawMessage
	if wirejson.ValidateUnique(raw) != nil || wirejson.Decode(bytes.NewReader(raw), &schema) != nil || len(schema) != 7 {
		return false
	}
	var format, actualRole, shape, source, digest string
	var version int
	if json.Unmarshal(schema["format"], &format) != nil || format != "canonical-json" ||
		json.Unmarshal(schema["schemaVersion"], &version) != nil || version != 1 ||
		json.Unmarshal(schema["role"], &actualRole) != nil || actualRole != role ||
		json.Unmarshal(schema["shape"], &shape) != nil || shape != "structural" ||
		json.Unmarshal(schema["source"], &source) != nil || source != "compiler-derived" ||
		json.Unmarshal(schema["digest"], &digest) != nil || len(digest) != 64 || strings.ToLower(digest) != digest {
		return false
	}
	if _, err := hex.DecodeString(digest); err != nil {
		return false
	}
	var descriptor map[string]json.RawMessage
	return json.Unmarshal(schema["descriptor"], &descriptor) == nil && descriptor != nil
}

func exchangeFork[T any](ctx context.Context, executable string, args []string, request any) (*T, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	payload, err := wirejson.Marshal(request)
	if err != nil {
		return nil, &ForkError{Op: "encode request", Err: errors.Join(ErrForkProtocol, err)}
	}

	command := exec.CommandContext(ctx, executable, args...)
	command.Stdin = bytes.NewReader(payload)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return nil, ctxErr
		}
		return nil, &ForkError{
			Op:     "execute bridge",
			Detail: strings.TrimSpace(stderr.String()),
			Err:    errors.Join(ErrForkUnavailable, err),
		}
	}

	var envelope forkEnvelope[T]
	if err := wirejson.Decode(bytes.NewReader(stdout.Bytes()), &envelope); err != nil {
		return nil, &ForkError{Op: "decode response", Detail: stderr.String(), Err: errors.Join(ErrForkProtocol, err)}
	}
	if envelope.APIVersion != forkBridgeAPIVersion || envelope.CompilerRevision != PinnedTypeScriptRevision {
		return nil, &ForkError{
			Op:     "validate response",
			Detail: fmt.Sprintf("got API %d revision %q", envelope.APIVersion, envelope.CompilerRevision),
			Err:    ErrForkProtocol,
		}
	}
	if envelope.Error != nil {
		return envelope.Result, &ForkError{
			Op:     envelope.Error.Code,
			Detail: envelope.Error.Message,
			Err:    ErrForkProtocol,
		}
	}
	if envelope.Result == nil {
		return nil, &ForkError{Op: "validate response", Detail: "missing result or result collections", Err: ErrForkProtocol}
	}
	return envelope.Result, nil
}

func hydrateCompileRequest(request CompileRequest) (CompileRequest, CompileResult, error) {
	if len(request.RootNames) == 0 {
		result := CompileResult{
			Diagnostics: []Diagnostic{{
				Code:     "VIBE0002",
				Category: DiagnosticError,
				Message:  "the pinned compiler bridge requires at least one root name",
				Phase:    PhaseParse,
			}},
			EmitSkipped: true,
		}
		return request, result, &ForkError{Op: "validate request", Err: ErrForkProtocol}
	}
	if err := validateLoweredRequest(request); err != nil {
		result := CompileResult{
			Diagnostics: []Diagnostic{{
				Code:     "VIBE0004",
				Category: DiagnosticError,
				Message:  err.Error(),
				Phase:    PhaseLower,
			}},
			EmitSkipped: true,
		}
		return request, result, &ForkError{Op: "validate request", Detail: err.Error(), Err: ErrForkProtocol}
	}
	if len(request.Files) != 0 {
		return request, CompileResult{}, nil
	}

	originalRootNames := request.RootNames
	logicalNames, err := identityPathsForDiskRoots(originalRootNames, request.RootDir)
	if err != nil {
		return request, CompileResult{EmitSkipped: true}, err
	}
	request.RootNames = make([]string, 0, len(originalRootNames))
	request.Files = make([]SourceFile, 0, len(originalRootNames))
	for index, rootName := range originalRootNames {
		diskName := rootName
		if request.RootDir != "" && !filepath.IsAbs(diskName) {
			// A stated root makes a relative root name mean "beneath the project
			// root", never "beneath wherever this process happens to be".
			diskName = filepath.Join(request.RootDir, diskName)
		}
		content, err := os.ReadFile(diskName)
		if err != nil {
			result := CompileResult{
				Diagnostics: []Diagnostic{{
					Code:     "VIBE0003",
					Category: DiagnosticError,
					Message:  err.Error(),
					// The logical name, as every other Diagnostic.File in this
					// compiler is. This was the one place the raw argv string —
					// possibly a full machine path — reached the output wire.
					// The attempted path is still in Message and in ForkError.Detail.
					File:  logicalNames[index],
					Phase: PhaseParse,
				}},
				EmitSkipped: true,
			}
			return request, result, &ForkError{Op: "read root", Detail: rootName, Err: errors.Join(ErrForkProtocol, err)}
		}
		request.RootNames = append(request.RootNames, logicalNames[index])
		request.Files = append(request.Files, SourceFile{
			Path: logicalNames[index],
			Kind: fileKindForPath(rootName),
			Text: string(content),
		})
	}
	return request, CompileResult{}, nil
}

// identityPathsForDiskRoots is THE one place a filesystem path becomes a logical
// name in this package, and therefore the one place an identity, a digest, or a
// journal key can acquire a file component.
//
// It NEVER consults the process working directory. That is the whole point.
// Until 2026-08-28 it did: an absolute root name was restated relative to
// the process working directory, so compiling one file from two directories minted two different
// `flowId`s, two Action `id`s, two `contractDigest`s, two `plan.digest`s and two
// sets of nominal failure identities for byte-identical source. The digests
// agreed between the two backends and disagreed between two terminals, which is
// the opposite of what a signable artifact needs. The working-directory
// accessor is deliberately ABSENT from this file now rather than merely unused,
// so the next author has nothing to reach for;
// TestForkIdentityPathIsNotAllowedToReachTheWorkingDirectory keeps it absent.
//
// The rule is the Go half of the reference's `identityFileName`
// (`poc/src/language/semantic.ts`): root-relative, POSIX-separated, extension
// intact, a pure function of its arguments.
//
//   - A relative root name is ALREADY a logical name. It is only normalized, so
//     `./a.vibe` and `a.vibe` cannot mint two identities for one file.
//   - An absolute root name is restated relative to the project root. A stated
//     `rootDir` is that root; with none stated, the root is the deepest
//     directory containing every absolute root name. For a single absolute root
//     that is its own directory, so the logical name is the basename — exactly
//     the rule `identityFileName` uses when it has no root to be relative to.
//
// Two root names that reduce to one logical name are refused rather than
// silently collapsed: one file must have one identity, and so must one identity
// have one file.
func identityPathsForDiskRoots(rootNames []string, rootDir string) ([]string, error) {
	if rootDir != "" && !filepath.IsAbs(rootDir) {
		return nil, &ForkError{
			Op:     "canonicalize root",
			Detail: fmt.Sprintf("project root %q must be absolute", rootDir),
			Err:    ErrForkProtocol,
		}
	}
	base := rootDir
	if base == "" {
		base = commonAncestorDirectory(rootNames)
	}
	logicalNames := make([]string, 0, len(rootNames))
	seen := make(map[string]string, len(rootNames))
	for _, rootName := range rootNames {
		logicalName := filepath.Clean(rootName)
		if filepath.IsAbs(logicalName) {
			if base == "" {
				return nil, &ForkError{
					Op:     "canonicalize root",
					Detail: rootName + " is absolute and no project root was stated",
					Err:    ErrForkProtocol,
				}
			}
			relative, err := filepath.Rel(base, logicalName)
			if err != nil {
				return nil, &ForkError{Op: "canonicalize root", Detail: rootName, Err: errors.Join(ErrForkProtocol, err)}
			}
			logicalName = relative
		}
		if logicalName == "." || logicalName == ".." || strings.HasPrefix(logicalName, ".."+string(filepath.Separator)) {
			detail := rootName + " is outside the project root"
			if base != "" {
				detail += " " + base
			}
			return nil, &ForkError{Op: "canonicalize root", Detail: detail, Err: ErrForkProtocol}
		}
		logicalName = filepath.ToSlash(logicalName)
		if previous, duplicate := seen[logicalName]; duplicate {
			return nil, &ForkError{
				Op:     "canonicalize root",
				Detail: fmt.Sprintf("%q and %q both name %q under the project root", previous, rootName, logicalName),
				Err:    ErrForkProtocol,
			}
		}
		seen[logicalName] = rootName
		logicalNames = append(logicalNames, logicalName)
	}
	return logicalNames, nil
}

// commonAncestorDirectory is the deepest directory containing every absolute
// name in the set, or "" when the set holds none. Relative names are already
// logical and are deliberately ignored: they carry no filesystem location to be
// an ancestor of.
//
// Compared path element by path element rather than by string prefix, so
// `/checkout/apple` cannot be read as living beneath `/checkout/app`.
func commonAncestorDirectory(names []string) string {
	var ancestor []string
	found := false
	for _, name := range names {
		if !filepath.IsAbs(name) {
			continue
		}
		parts := strings.Split(filepath.ToSlash(filepath.Dir(filepath.Clean(name))), "/")
		if !found {
			ancestor = parts
			found = true
			continue
		}
		limit := len(ancestor)
		if len(parts) < limit {
			limit = len(parts)
		}
		shared := 0
		for shared < limit && ancestor[shared] == parts[shared] {
			shared++
		}
		ancestor = ancestor[:shared]
	}
	if !found {
		return ""
	}
	joined := strings.Join(ancestor, "/")
	if joined == "" {
		// Every absolute name diverged at the filesystem root itself.
		joined = "/"
	}
	return filepath.FromSlash(joined)
}

func fileKindForPath(name string) FileKind {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".vibe":
		return FileKindVibeLang
	default:
		return FileKindTypeScript
	}
}

func loadPinnedForkPatchSeries() (*pinnedForkPatchSeries, error) {
	manifestBytes, err := forkPatchFiles.ReadFile("forkpatch/series.json")
	if err != nil {
		return nil, fmt.Errorf("read embedded series.json: %w", err)
	}
	var manifest forkPatchManifest
	decoder := json.NewDecoder(bytes.NewReader(manifestBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil {
		return nil, fmt.Errorf("decode embedded series.json: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return nil, fmt.Errorf("decode embedded series.json: expected one JSON value")
	}
	if manifest.SchemaVersion != 1 {
		return nil, fmt.Errorf("series.json schemaVersion is %d; require 1", manifest.SchemaVersion)
	}
	if manifest.Revision != PinnedTypeScriptRevision {
		return nil, fmt.Errorf("series.json records revision %q; require %q", manifest.Revision, PinnedTypeScriptRevision)
	}
	if len(manifest.Patches) == 0 {
		return nil, errors.New("series.json lists no patches")
	}

	patches := make(map[string][]byte, len(manifest.Patches))
	recorded := make(map[string]struct{}, len(manifest.Patches))
	hasher := sha256.New()
	fmt.Fprintf(hasher, "apiVersion:%d\x00", forkBridgeAPIVersion)
	hasher.Write(manifestBytes)
	hasher.Write([]byte{0})
	for _, entry := range manifest.Patches {
		if entry.File == "" || path.Clean(entry.File) != entry.File || !strings.HasPrefix(entry.File, "patches/") || strings.Contains(entry.File, "\\") {
			return nil, fmt.Errorf("series.json contains invalid patch path %q", entry.File)
		}
		if _, exists := recorded[entry.File]; exists {
			return nil, fmt.Errorf("series.json lists %q more than once", entry.File)
		}
		recorded[entry.File] = struct{}{}
		content, err := forkPatchFiles.ReadFile("forkpatch/" + entry.File)
		if err != nil {
			return nil, fmt.Errorf("read embedded %s: %w", entry.File, err)
		}
		digest := sha256.Sum256(content)
		if hex.EncodeToString(digest[:]) != entry.SHA256 {
			return nil, fmt.Errorf("patch file digest mismatch: %s", entry.File)
		}
		patches[entry.File] = content
		hasher.Write([]byte(entry.File))
		hasher.Write([]byte{0})
		hasher.Write(content)
		hasher.Write([]byte{0})
	}
	embeddedPatches, err := fs.Glob(forkPatchFiles, "forkpatch/patches/*.patch")
	if err != nil {
		return nil, fmt.Errorf("list embedded patches: %w", err)
	}
	for _, embeddedPath := range embeddedPatches {
		name := strings.TrimPrefix(embeddedPath, "forkpatch/")
		if _, exists := recorded[name]; !exists {
			return nil, fmt.Errorf("%s is embedded but not listed in series.json", name)
		}
	}
	if len(embeddedPatches) != len(recorded) {
		return nil, errors.New("series.json patch count does not match the embedded patch set")
	}
	if err := validateForkPatchImages(manifest); err != nil {
		return nil, err
	}
	return &pinnedForkPatchSeries{
		manifest: manifest,
		patches:  patches,
		identity: hex.EncodeToString(hasher.Sum(nil)),
	}, nil
}

func validateForkPatchImages(manifest forkPatchManifest) error {
	created := make(map[string]struct{}, len(manifest.Created))
	for _, name := range manifest.Created {
		if err := validateForkPatchImagePath(name); err != nil {
			return fmt.Errorf("series.json created path: %w", err)
		}
		if _, exists := created[name]; exists {
			return fmt.Errorf("series.json lists created path %q more than once", name)
		}
		created[name] = struct{}{}
		if _, exists := manifest.PreImage[name]; exists {
			return fmt.Errorf("created path %q unexpectedly has a pre-image", name)
		}
	}
	if len(manifest.PreImage) == 0 || len(manifest.PostImage) == 0 {
		return errors.New("series.json must record non-empty preImage and postImage maps")
	}
	for name, digest := range manifest.PreImage {
		if err := validateForkPatchImage(name, digest); err != nil {
			return fmt.Errorf("series.json preImage: %w", err)
		}
		if _, exists := manifest.PostImage[name]; !exists {
			return fmt.Errorf("pre-image path %q has no post-image", name)
		}
	}
	for name, digest := range manifest.PostImage {
		if err := validateForkPatchImage(name, digest); err != nil {
			return fmt.Errorf("series.json postImage: %w", err)
		}
		if _, exists := manifest.PreImage[name]; !exists {
			if _, exists := created[name]; !exists {
				return fmt.Errorf("post-image path %q is neither modified nor created", name)
			}
		}
	}
	for name := range created {
		if _, exists := manifest.PostImage[name]; !exists {
			return fmt.Errorf("created path %q has no post-image", name)
		}
	}
	return nil
}

func validateForkPatchImage(name string, digest string) error {
	if err := validateForkPatchImagePath(name); err != nil {
		return err
	}
	decoded, err := hex.DecodeString(digest)
	if err != nil || len(decoded) != sha256.Size || digest != strings.ToLower(digest) {
		return fmt.Errorf("path %q has invalid SHA-256 %q", name, digest)
	}
	return nil
}

func validateForkPatchImagePath(name string) error {
	if name == "" || path.Clean(name) != name || path.IsAbs(name) || strings.Contains(name, "\\") {
		return fmt.Errorf("invalid checkout path %q", name)
	}
	return nil
}

func preparePinnedForkBridge(ctx context.Context, config ForkConfig) (string, error) {
	if config.CheckoutDirectory == "" {
		return "", &ForkError{Op: "locate checkout", Detail: "CheckoutDirectory is empty", Err: ErrForkUnavailable}
	}
	checkout, err := filepath.Abs(config.CheckoutDirectory)
	if err != nil {
		return "", &ForkError{Op: "locate checkout", Err: errors.Join(ErrForkUnavailable, err)}
	}
	checkout, err = filepath.EvalSymlinks(checkout)
	if err != nil {
		return "", &ForkError{Op: "locate checkout", Err: errors.Join(ErrForkUnavailable, err)}
	}
	series, err := loadPinnedForkPatchSeries()
	if err != nil {
		return "", &ForkError{Op: "verify patch series", Err: errors.Join(ErrForkUnavailable, err)}
	}

	cacheBase := config.CacheDirectory
	if cacheBase == "" {
		cacheBase, err = os.UserCacheDir()
		if err != nil {
			return "", &ForkError{Op: "locate cache", Err: errors.Join(ErrForkUnavailable, err)}
		}
		cacheBase = filepath.Join(cacheBase, "vibelang", "typescript-bridge")
	}
	cacheBase, err = resolvePathForCreation(cacheBase)
	if err != nil {
		return "", &ForkError{Op: "locate cache", Err: errors.Join(ErrForkUnavailable, err)}
	}
	hasher := sha256.New()
	for _, file := range forkBridgeFiles {
		hasher.Write([]byte(file.target))
		hasher.Write([]byte{0})
		hasher.Write(*file.source)
		hasher.Write([]byte{0})
	}
	digest := [sha256.Size]byte(hasher.Sum(nil))
	// The former layout used a mkdir lock whose owner could disappear without
	// removing it. Never steal/remove one of those locks or share its output
	// directory with an older, possibly still-running preparation process.
	cacheDirectory := filepath.Join(cacheBase, forkPreparationCacheLayout, PinnedTypeScriptRevision+"-"+series.identity+"-"+hex.EncodeToString(digest[:])+"-"+runtime.GOOS+"-"+runtime.GOARCH)
	if pathsOverlap(checkout, cacheDirectory) {
		return "", &ForkError{
			Op:     "locate cache",
			Detail: "bridge cache and TypeScript checkout must not overlap",
			Err:    ErrForkUnavailable,
		}
	}
	if err := os.MkdirAll(cacheDirectory, 0o755); err != nil {
		return "", &ForkError{Op: "create cache", Err: errors.Join(ErrForkUnavailable, err)}
	}
	release, err := acquireForkPreparationLock(ctx, filepath.Join(cacheDirectory, "prepare.lock"))
	if err != nil {
		return "", &ForkError{Op: "lock preparation", Err: errors.Join(ErrForkUnavailable, err)}
	}
	defer release()
	// The lock above is per bridge cache; the checkout is shared by every cache
	// that names it, so patching it needs a lock of its own or two preparations
	// given different caches patch the same tree at once. It is held only while
	// the checkout is verified or patched: once the series is applied nothing
	// mutates the tree again, and the build below may read it freely.
	checkoutLockPath, err := checkoutPreparationLockPath(checkout)
	if err != nil {
		return "", &ForkError{Op: "lock checkout", Err: errors.Join(ErrForkUnavailable, err)}
	}
	releaseCheckout, err := acquireForkPreparationLock(ctx, checkoutLockPath)
	if err != nil {
		return "", &ForkError{Op: "lock checkout", Err: errors.Join(ErrForkUnavailable, err)}
	}
	checkoutErr := verifyAndApplyPinnedCheckout(ctx, checkout, cacheDirectory, series)
	releaseCheckout()
	if checkoutErr != nil {
		return "", checkoutErr
	}

	executableName := "vibelang-typescript-bridge"
	if runtime.GOOS == "windows" {
		executableName += ".exe"
	}
	executable := filepath.Join(cacheDirectory, executableName)
	if bridgeHasIdentity(ctx, executable, series.identity) {
		return executable, nil
	}

	buildDirectory, err := os.MkdirTemp(cacheDirectory, "build-*")
	if err != nil {
		return "", &ForkError{Op: "create build directory", Err: errors.Join(ErrForkUnavailable, err)}
	}
	defer os.RemoveAll(buildDirectory)
	replacements := make(map[string]string, len(forkBridgeFiles))
	for _, file := range forkBridgeFiles {
		replacement := filepath.Join(buildDirectory, filepath.FromSlash(file.target))
		if err := os.MkdirAll(filepath.Dir(replacement), 0o755); err != nil {
			return "", &ForkError{Op: "materialize overlay", Err: errors.Join(ErrForkUnavailable, err)}
		}
		if err := os.WriteFile(replacement, *file.source, 0o644); err != nil {
			return "", &ForkError{Op: "materialize overlay", Err: errors.Join(ErrForkUnavailable, err)}
		}
		replacements[filepath.Join(checkout, "tsc", filepath.FromSlash(file.target))] = replacement
	}
	overlayPath := filepath.Join(buildDirectory, "overlay.json")
	overlay := struct {
		Replace map[string]string `json:"Replace"`
	}{Replace: replacements}
	overlayJSON, err := json.Marshal(overlay)
	if err != nil {
		return "", &ForkError{Op: "encode overlay", Err: errors.Join(ErrForkUnavailable, err)}
	}
	if err := os.WriteFile(overlayPath, overlayJSON, 0o644); err != nil {
		return "", &ForkError{Op: "materialize overlay", Err: errors.Join(ErrForkUnavailable, err)}
	}

	goCommand := config.GoCommand
	if goCommand == "" {
		goCommand = "go"
	}
	temporaryExecutable := filepath.Join(buildDirectory, executableName)
	command := exec.CommandContext(
		ctx,
		goCommand,
		"build",
		"-trimpath",
		"-overlay", overlayPath,
		"-ldflags", "-X main.compilerRevision="+PinnedTypeScriptRevision+" -X main.compilerPatchSeries="+series.identity+" -X main.bridgeAPIVersion="+strconv.Itoa(forkBridgeAPIVersion),
		"-o", temporaryExecutable,
		"./cmd/tsc",
	)
	command.Dir = filepath.Join(checkout, "tsc")
	command.Env = environmentWithout("GOWORK")
	command.Env = append(command.Env, "GOWORK=off")
	var buildOutput bytes.Buffer
	command.Stdout = &buildOutput
	command.Stderr = &buildOutput
	if err := command.Run(); err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return "", ctxErr
		}
		return "", &ForkError{
			Op:     "build bridge",
			Detail: strings.TrimSpace(buildOutput.String()),
			Err:    errors.Join(ErrForkUnavailable, err),
		}
	}
	if err := os.Rename(temporaryExecutable, executable); err != nil {
		// Another cold-cache builder may have atomically installed the same exact
		// build first. Accept only a successful revision-and-series handshake.
		if bridgeHasIdentity(ctx, executable, series.identity) {
			return executable, nil
		}
		return "", &ForkError{Op: "install bridge", Err: errors.Join(ErrForkUnavailable, err)}
	}
	identity, handshakeErr := bridgeBuildIdentity(ctx, executable)
	if handshakeErr != nil || identity.APIVersion != forkBridgeAPIVersion || identity.Revision != PinnedTypeScriptRevision || identity.PatchSeries != series.identity {
		detail := fmt.Sprintf("bridge reported revision %q patch series %q", identity.Revision, identity.PatchSeries)
		if handshakeErr != nil {
			detail += ": " + handshakeErr.Error()
		}
		return "", &ForkError{Op: "handshake", Detail: detail, Err: ErrForkProtocol}
	}
	return executable, nil
}

// resolvePathForCreation resolves symlinks in the deepest existing ancestor
// without creating the requested path. This lets overlap checks happen before
// any cache directory is written.
func resolvePathForCreation(name string) (string, error) {
	absolute, err := filepath.Abs(name)
	if err != nil {
		return "", err
	}
	candidate := filepath.Clean(absolute)
	missing := make([]string, 0)
	for {
		resolved, err := filepath.EvalSymlinks(candidate)
		if err == nil {
			for index := len(missing) - 1; index >= 0; index-- {
				resolved = filepath.Join(resolved, missing[index])
			}
			return filepath.Clean(resolved), nil
		}
		if !errors.Is(err, os.ErrNotExist) {
			return "", err
		}
		parent := filepath.Dir(candidate)
		if parent == candidate {
			return "", err
		}
		missing = append(missing, filepath.Base(candidate))
		candidate = parent
	}
}

func pathsOverlap(first string, second string) bool {
	return pathContains(first, second) || pathContains(second, first)
}

func pathContains(parent string, child string) bool {
	relative, err := filepath.Rel(parent, child)
	if err != nil {
		return false
	}
	return relative == "." || relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

type forkPatchCheckoutState struct {
	state            string
	pristineProblems []string
	appliedProblems  []string
}

func verifyAndApplyPinnedCheckout(ctx context.Context, checkout string, scratchDirectory string, series *pinnedForkPatchSeries) error {
	revisionCommand := exec.CommandContext(ctx, "git", "-C", checkout, "rev-parse", "HEAD")
	revisionBytes, err := revisionCommand.Output()
	if err != nil {
		return &ForkError{Op: "verify revision", Detail: checkout, Err: errors.Join(ErrForkUnavailable, err)}
	}
	if revision := strings.TrimSpace(string(revisionBytes)); revision != PinnedTypeScriptRevision {
		return &ForkError{
			Op:     "verify revision",
			Detail: fmt.Sprintf("got %q, require %q", revision, PinnedTypeScriptRevision),
			Err:    ErrForkUnavailable,
		}
	}
	modulePath := filepath.Join(checkout, "tsc", "go.mod")
	moduleBytes, err := os.ReadFile(modulePath)
	if err != nil {
		return &ForkError{Op: "verify compiler module", Detail: modulePath, Err: errors.Join(ErrForkUnavailable, err)}
	}
	if !strings.Contains(string(moduleBytes), "module github.com/microsoft/TypeScript/tsc") {
		return &ForkError{Op: "verify compiler module", Detail: "unexpected tsc/go.mod module path", Err: ErrForkUnavailable}
	}
	state, err := classifyForkPatchCheckout(checkout, series.manifest)
	if err != nil {
		return &ForkError{Op: "verify patch digests", Err: errors.Join(ErrForkUnavailable, err)}
	}
	switch state.state {
	case "applied":
		if err := verifyForkPatchWorktree(ctx, checkout, series.manifest, true); err != nil {
			return &ForkError{Op: "verify patched worktree", Err: errors.Join(ErrForkUnavailable, err)}
		}
		return nil
	case "mixed":
		return &ForkError{
			Op: "verify patch digests",
			Detail: fmt.Sprintf(
				"checkout is neither pristine nor fully patched (%d pristine-image mismatch(es), %d applied-image mismatch(es)); first divergent path: %s",
				len(state.pristineProblems), len(state.appliedProblems), firstForkPatchProblem(state),
			),
			Err: ErrForkUnavailable,
		}
	case "pristine":
		if err := verifyForkPatchWorktree(ctx, checkout, series.manifest, false); err != nil {
			return &ForkError{Op: "verify pristine worktree", Err: errors.Join(ErrForkUnavailable, err)}
		}
	default:
		return &ForkError{Op: "verify patch digests", Detail: "unknown checkout state " + state.state, Err: ErrForkUnavailable}
	}

	patchDirectory, err := os.MkdirTemp(scratchDirectory, "patches-*")
	if err != nil {
		return &ForkError{Op: "materialize patch series", Err: errors.Join(ErrForkUnavailable, err)}
	}
	defer os.RemoveAll(patchDirectory)
	patchPaths := make([]string, 0, len(series.manifest.Patches))
	for index, entry := range series.manifest.Patches {
		name := filepath.Join(patchDirectory, fmt.Sprintf("%04d.patch", index))
		if err := os.WriteFile(name, series.patches[entry.File], 0o600); err != nil {
			return &ForkError{Op: "materialize patch series", Detail: entry.File, Err: errors.Join(ErrForkUnavailable, err)}
		}
		patchPaths = append(patchPaths, name)
	}
	appliedPatches := make([]string, 0, len(patchPaths))
	for _, patchPath := range patchPaths {
		if output, err := runGitApply(ctx, checkout, true, false, []string{patchPath}); err != nil {
			rollbackForkPatches(ctx, checkout, appliedPatches)
			return &ForkError{Op: "check patch series", Detail: strings.TrimSpace(output), Err: errors.Join(ErrForkUnavailable, err)}
		}
		if output, err := runGitApply(ctx, checkout, false, false, []string{patchPath}); err != nil {
			rollbackForkPatches(ctx, checkout, appliedPatches)
			return &ForkError{Op: "apply patch series", Detail: strings.TrimSpace(output), Err: errors.Join(ErrForkUnavailable, err)}
		}
		appliedPatches = append(appliedPatches, patchPath)
	}
	after, err := classifyForkPatchCheckout(checkout, series.manifest)
	if err != nil {
		return &ForkError{Op: "verify applied patch digests", Err: errors.Join(ErrForkUnavailable, err)}
	}
	if after.state != "applied" {
		return &ForkError{
			Op:     "verify applied patch digests",
			Detail: "patch command completed but post-image gates do not match; first divergent path: " + firstForkPatchProblem(after),
			Err:    ErrForkUnavailable,
		}
	}
	if err := verifyForkPatchWorktree(ctx, checkout, series.manifest, true); err != nil {
		return &ForkError{Op: "verify patched worktree", Err: errors.Join(ErrForkUnavailable, err)}
	}
	return nil
}

func classifyForkPatchCheckout(checkout string, manifest forkPatchManifest) (forkPatchCheckoutState, error) {
	state := forkPatchCheckoutState{}
	for name, expected := range manifest.PreImage {
		matches, err := forkPatchFileMatches(filepath.Join(checkout, filepath.FromSlash(name)), expected)
		if err != nil {
			return state, err
		}
		if !matches {
			state.pristineProblems = append(state.pristineProblems, name)
		}
	}
	for _, name := range manifest.Created {
		_, err := os.Stat(filepath.Join(checkout, filepath.FromSlash(name)))
		switch {
		case err == nil:
			state.pristineProblems = append(state.pristineProblems, name)
		case errors.Is(err, os.ErrNotExist):
		default:
			return state, err
		}
	}
	for name, expected := range manifest.PostImage {
		matches, err := forkPatchFileMatches(filepath.Join(checkout, filepath.FromSlash(name)), expected)
		if err != nil {
			return state, err
		}
		if !matches {
			state.appliedProblems = append(state.appliedProblems, name)
		}
	}
	sort.Strings(state.pristineProblems)
	sort.Strings(state.appliedProblems)
	switch {
	case len(state.pristineProblems) == 0:
		state.state = "pristine"
	case len(state.appliedProblems) == 0:
		state.state = "applied"
	default:
		state.state = "mixed"
	}
	return state, nil
}

func forkPatchFileMatches(name string, expected string) (bool, error) {
	content, err := os.ReadFile(name)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	digest := sha256.Sum256(content)
	return hex.EncodeToString(digest[:]) == expected, nil
}

func firstForkPatchProblem(state forkPatchCheckoutState) string {
	if len(state.appliedProblems) != 0 {
		return state.appliedProblems[0]
	}
	if len(state.pristineProblems) != 0 {
		return state.pristineProblems[0]
	}
	return "unknown"
}

func verifyForkPatchWorktree(ctx context.Context, checkout string, manifest forkPatchManifest, applied bool) error {
	command := exec.CommandContext(ctx, "git", "-C", checkout, "status", "--porcelain=v1", "-z", "--untracked-files=all")
	output, err := command.Output()
	if err != nil {
		return err
	}
	expected := make(map[string]string)
	if applied {
		for name, before := range manifest.PreImage {
			if manifest.PostImage[name] != before {
				expected[name] = " M"
			}
		}
		for _, name := range manifest.Created {
			expected[name] = "??"
		}
	}
	observed := make(map[string]string)
	for _, record := range bytes.Split(output, []byte{0}) {
		if len(record) == 0 {
			continue
		}
		if len(record) < 4 || record[2] != ' ' {
			return fmt.Errorf("unexpected git status record %q", record)
		}
		status := string(record[:2])
		name := filepath.ToSlash(string(record[3:]))
		if status != " M" && status != "??" {
			return fmt.Errorf("checkout contains unsupported worktree state %q for %s", status, name)
		}
		observed[name] = status
	}
	for name, status := range expected {
		if observed[name] != status {
			return fmt.Errorf("expected git status %q for %s, got %q", status, name, observed[name])
		}
		delete(observed, name)
	}
	if len(observed) != 0 {
		names := make([]string, 0, len(observed))
		for name := range observed {
			names = append(names, name)
		}
		sort.Strings(names)
		return fmt.Errorf("checkout has unrecorded worktree change %q", names[0])
	}
	return nil
}

func rollbackForkPatches(ctx context.Context, checkout string, applied []string) {
	for index := len(applied) - 1; index >= 0; index-- {
		_, _ = runGitApply(ctx, checkout, false, true, []string{applied[index]})
	}
}

func runGitApply(ctx context.Context, checkout string, check bool, reverse bool, patchPaths []string) (string, error) {
	arguments := []string{"-C", checkout, "apply", "--whitespace=nowarn"}
	if check {
		arguments = append(arguments, "--check")
	}
	if reverse {
		arguments = append(arguments, "--reverse")
	}
	arguments = append(arguments, patchPaths...)
	command := exec.CommandContext(ctx, "git", arguments...)
	output, err := command.CombinedOutput()
	return string(output), err
}

type forkBridgeBuildIdentity struct {
	APIVersion      int    `json:"apiVersion"`
	Revision        string `json:"revision"`
	PatchSeries     string `json:"patchSeries"`
	CompilerVersion string `json:"compilerVersion"`
}

func bridgeHasIdentity(ctx context.Context, executable string, patchSeries string) bool {
	identity, err := bridgeBuildIdentity(ctx, executable)
	return err == nil && identity.APIVersion == forkBridgeAPIVersion && identity.Revision == PinnedTypeScriptRevision && identity.PatchSeries == patchSeries
}

func bridgeBuildIdentity(ctx context.Context, executable string) (forkBridgeBuildIdentity, error) {
	var identity forkBridgeBuildIdentity
	if _, err := os.Stat(executable); err != nil {
		return identity, err
	}
	command := exec.CommandContext(ctx, executable, "--build-identity")
	output, err := command.CombinedOutput()
	if err != nil {
		return identity, fmt.Errorf("%w (%s)", err, strings.TrimSpace(string(output)))
	}
	decoder := json.NewDecoder(bytes.NewReader(output))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&identity); err != nil {
		return identity, err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return identity, errors.New("expected one build identity JSON value")
	}
	return identity, nil
}

func bridgeRevision(ctx context.Context, executable string) (string, error) {
	if _, err := os.Stat(executable); err != nil {
		return "", err
	}
	command := exec.CommandContext(ctx, executable, "--revision")
	output, err := command.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("%w (%s)", err, strings.TrimSpace(string(output)))
	}
	return strings.TrimSpace(string(output)), nil
}

func environmentWithout(name string) []string {
	prefix := name + "="
	environment := os.Environ()
	result := environment[:0]
	for _, entry := range environment {
		if !strings.HasPrefix(entry, prefix) {
			result = append(result, entry)
		}
	}
	return result
}
