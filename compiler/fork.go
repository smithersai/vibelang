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
	"sort"
	"strconv"
	"strings"
	"time"
)

// PinnedTypeScriptRevision is the exact smithersai/TypeScript revision this
// bridge accepts. Keep it in sync with typescript-fork.json; a test enforces
// the lock.
const PinnedTypeScriptRevision = "c087644e82dc3d48cf87e4c5519eeaaea9daf35c"

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

// forkPatchFiles is the exact ordered, digest-gated patch series compiled into
// this bridge build. Embedding it keeps a distributed smithersc-go binary
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
	{target: "cmd/tsc/smitherslowering.go", source: &forkLoweringSource},
	{target: "cmd/tsc/smitherscomptime.go", source: &forkComptimeSource},
	{target: "cmd/tsc/smithersdurable.go", source: &forkDurableSource},
	{target: "cmd/tsc/smitherseffectmanifest.go", source: &forkEffectManifestSource},
	{target: "cmd/tsc/smithershostrules.go", source: &forkHostRulesSource},
	{target: "cmd/tsc/smithersretired.go", source: &forkRetiredSyntaxSource},
	{target: "cmd/tsc/smithersnativeprovenance.go", source: &forkNativeProvenanceSource},
	{target: "cmd/tsc/smithersassets.go", source: &forkAssetSource},
	{target: "cmd/tsc/smithersmustconsume.go", source: &forkMustConsumeSource},
	{target: "internal/checker/smithersbridge.go", source: &forkCheckerBridgeSource},
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

type forkCompiler struct {
	executable string
}

type forkEnvelope struct {
	APIVersion       int            `json:"apiVersion"`
	CompilerRevision string         `json:"compilerRevision"`
	Result           *CompileResult `json:"result"`
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

	payload, err := json.Marshal(request)
	if err != nil {
		return CompileResult{EmitSkipped: true}, &ForkError{Op: "encode request", Err: errors.Join(ErrForkProtocol, err)}
	}

	command := exec.CommandContext(ctx, c.executable)
	command.Stdin = bytes.NewReader(payload)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return CompileResult{EmitSkipped: true}, ctxErr
		}
		return CompileResult{EmitSkipped: true}, &ForkError{
			Op:     "execute bridge",
			Detail: strings.TrimSpace(stderr.String()),
			Err:    errors.Join(ErrForkUnavailable, err),
		}
	}

	decoder := json.NewDecoder(bytes.NewReader(stdout.Bytes()))
	decoder.DisallowUnknownFields()
	var envelope forkEnvelope
	if err := decoder.Decode(&envelope); err != nil {
		return CompileResult{EmitSkipped: true}, &ForkError{Op: "decode response", Detail: stderr.String(), Err: errors.Join(ErrForkProtocol, err)}
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return CompileResult{EmitSkipped: true}, &ForkError{Op: "decode response", Detail: stderr.String(), Err: errors.Join(ErrForkProtocol, fmt.Errorf("expected one JSON value: %w", err))}
	}
	if envelope.APIVersion != forkBridgeAPIVersion || envelope.CompilerRevision != PinnedTypeScriptRevision {
		return CompileResult{EmitSkipped: true}, &ForkError{
			Op:     "validate response",
			Detail: fmt.Sprintf("got API %d revision %q", envelope.APIVersion, envelope.CompilerRevision),
			Err:    ErrForkProtocol,
		}
	}
	if envelope.Result == nil || envelope.Result.Diagnostics == nil || envelope.Result.Artifacts == nil {
		return CompileResult{EmitSkipped: true}, &ForkError{Op: "validate response", Detail: "missing result or result collections", Err: ErrForkProtocol}
	}
	if envelope.Error != nil {
		return *envelope.Result, &ForkError{
			Op:     envelope.Error.Code,
			Detail: envelope.Error.Message,
			Err:    ErrForkProtocol,
		}
	}
	return *envelope.Result, nil
}

func hydrateCompileRequest(request CompileRequest) (CompileRequest, CompileResult, error) {
	if len(request.RootNames) == 0 {
		result := CompileResult{
			Diagnostics: []Diagnostic{{
				Code:     "SMITHERS0002",
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
				Code:     "SMITHERS0004",
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
					Code:     "SMITHERS0003",
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
//     `./a.sm` and `a.sm` cannot mint two identities for one file.
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
	case ".sm":
		return FileKindSmithers
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
		cacheBase = filepath.Join(cacheBase, "smithers", "typescript-bridge")
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
	cacheDirectory := filepath.Join(cacheBase, PinnedTypeScriptRevision+"-"+series.identity+"-"+hex.EncodeToString(digest[:])+"-"+runtime.GOOS+"-"+runtime.GOARCH)
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
	if err := verifyAndApplyPinnedCheckout(ctx, checkout, cacheDirectory, series); err != nil {
		return "", err
	}

	executableName := "smithers-typescript-bridge"
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
	if handshakeErr != nil || identity.Revision != PinnedTypeScriptRevision || identity.PatchSeries != series.identity {
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

func acquireForkPreparationLock(ctx context.Context, directory string) (func(), error) {
	for {
		if err := os.Mkdir(directory, 0o700); err == nil {
			return func() { _ = os.Remove(directory) }, nil
		} else if !errors.Is(err, os.ErrExist) {
			return nil, err
		}
		timer := time.NewTimer(25 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
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
	Revision    string `json:"revision"`
	PatchSeries string `json:"patchSeries"`
}

func bridgeHasIdentity(ctx context.Context, executable string, patchSeries string) bool {
	identity, err := bridgeBuildIdentity(ctx, executable)
	return err == nil && identity.Revision == PinnedTypeScriptRevision && identity.PatchSeries == patchSeries
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
