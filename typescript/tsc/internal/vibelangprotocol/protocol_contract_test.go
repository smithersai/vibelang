package vibelangprotocol

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"unicode/utf8"
)

func protocolRepoRoot(t *testing.T) string {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to resolve test file path")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(thisFile), "..", "..", "..", ".."))
}

func readRepoFile(t *testing.T, rel string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(protocolRepoRoot(t), rel))
	if err != nil {
		t.Fatalf("read %s: %v", rel, err)
	}
	return string(data)
}

func TestProducerQueueKeyValidServiceKey(t *testing.T) {
	if !IsValidServiceKey(ProducerQueueKey) {
		t.Fatalf("ProducerQueueKey %q must be a valid service key", ProducerQueueKey)
	}
}

func TestProducerQueueKeyParseRoundTrip(t *testing.T) {
	ns, sym, ok := ParseServiceKey(ProducerQueueKey)
	if !ok || ns != RuntimeNamespace || sym != "ProducerQueue" {
		t.Fatalf("unexpected parse result: (%q, %q, %v)", ns, sym, ok)
	}
	rebuilt, ok := FormatServiceKey(ns, sym)
	if !ok || rebuilt != ProducerQueueKey {
		t.Fatalf("roundtrip mismatch: got %q (%v), want %q", rebuilt, ok, ProducerQueueKey)
	}
}

func TestRuntimeNamespaceMatchesProducerPrefix(t *testing.T) {
	if !strings.HasPrefix(ProducerQueueKey, RuntimeNamespace+"/") {
		t.Fatalf("ProducerQueueKey %q must start with %q", ProducerQueueKey, RuntimeNamespace+"/")
	}
}

func TestProducerQueueKeySingleSlash(t *testing.T) {
	if strings.Count(ProducerQueueKey, "/") != 1 {
		t.Fatalf("expected exactly one slash in %q", ProducerQueueKey)
	}
}

func TestProducerQueueKeyPureASCII(t *testing.T) {
	for i := 0; i < len(ProducerQueueKey); i++ {
		if ProducerQueueKey[i] >= utf8.RuneSelf {
			t.Fatalf("non-ASCII byte at %d in %q", i, ProducerQueueKey)
		}
	}
}

func TestProducerQueueKeyValidUTF8(t *testing.T) {
	if !utf8.ValidString(ProducerQueueKey) {
		t.Fatalf("ProducerQueueKey is not valid UTF-8: %q", ProducerQueueKey)
	}
}

func TestProducerQueueKeyNoControlChars(t *testing.T) {
	for i := 0; i < len(ProducerQueueKey); i++ {
		if ProducerQueueKey[i] < 0x20 || ProducerQueueKey[i] == 0x7f {
			t.Fatalf("control byte %#x in %q", ProducerQueueKey[i], ProducerQueueKey)
		}
	}
}

func TestProducerQueueKeyJSONRoundTrip(t *testing.T) {
	b, err := json.Marshal(ProducerQueueKey)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}
	var decoded string
	if err := json.Unmarshal(b, &decoded); err != nil {
		t.Fatalf("json.Unmarshal failed: %v", err)
	}
	if decoded != ProducerQueueKey {
		t.Fatalf("JSON roundtrip mismatch: %q vs %q", decoded, ProducerQueueKey)
	}
}

func TestProducerQueueKeyGoQuoteRoundTrip(t *testing.T) {
	quoted := strconv.Quote(ProducerQueueKey)
	if quoted != `"`+ProducerQueueKey+`"` {
		t.Fatalf("expected unescaped Go quote, got %s", quoted)
	}
	unquoted, err := strconv.Unquote(quoted)
	if err != nil || unquoted != ProducerQueueKey {
		t.Fatalf("unquote failed: %q (%v)", unquoted, err)
	}
}

func TestProducerQueueKeyNoQuoteEscapeNeeded(t *testing.T) {
	if strings.ContainsAny(ProducerQueueKey, "\"'`\\") {
		t.Fatalf("ProducerQueueKey must not contain quote/escape chars: %q", ProducerQueueKey)
	}
}

func TestProducerQueueKeyReferencedByCompilerBackend(t *testing.T) {
	src := readRepoFile(t, "typescript/tsc/internal/vibelang/producer_instance.go")
	if !strings.Contains(src, "vibelangprotocol.ProducerQueueKey") {
		t.Fatal("internal/vibelang/producer_instance.go must reference vibelangprotocol.ProducerQueueKey")
	}
}

func TestProducerQueueKeyReferencedByMapperBackend(t *testing.T) {
	src := readRepoFile(t, "typescript/tsc/internal/vibelangmapper/render_exec.go")
	if !strings.Contains(src, "vibelangprotocol.ProducerQueueKey") {
		t.Fatal("internal/vibelangmapper/render_exec.go must reference vibelangprotocol.ProducerQueueKey")
	}
}

func TestCompilerBackendDoesNotHardcodeProducerQueueLiteral(t *testing.T) {
	src := readRepoFile(t, "typescript/tsc/internal/vibelang/producer_instance.go")
	if strings.Contains(src, `"`+ProducerQueueKey+`"`) {
		t.Fatal("producer_instance.go should use vibelangprotocol.ProducerQueueKey instead of hardcoding the literal")
	}
}

func TestMapperBackendDoesNotHardcodeProducerQueueLiteral(t *testing.T) {
	src := readRepoFile(t, "typescript/tsc/internal/vibelangmapper/render_exec.go")
	if strings.Contains(src, `"`+ProducerQueueKey+`"`) {
		t.Fatal("render_exec.go should use vibelangprotocol.ProducerQueueKey instead of hardcoding the literal")
	}
}

func TestRuntimeProducersExportsProducerQueue(t *testing.T) {
	src := readRepoFile(t, "packages/runtime/src/producers.ts")
	if !strings.Contains(src, "ProducerQueue") {
		t.Fatal("packages/runtime/src/producers.ts must define ProducerQueue")
	}
}

func TestRuntimeProducersUsesContextServiceKey(t *testing.T) {
	src := readRepoFile(t, "packages/runtime/src/producers.ts")
	if !strings.Contains(src, "Context.Service") || !strings.Contains(src, ProducerQueueKey) {
		t.Fatal("packages/runtime/src/producers.ts must bind ProducerQueue via Context.Service")
	}
}

func TestParseServiceKeyEmptyString(t *testing.T) {
	if _, _, ok := ParseServiceKey(""); ok {
		t.Fatal("empty key must fail")
	}
}

func TestParseServiceKeyMissingSlash(t *testing.T) {
	if _, _, ok := ParseServiceKey("vibelang-runtime"); ok {
		t.Fatal("key without slash must fail")
	}
}

func TestParseServiceKeyLeadingSlash(t *testing.T) {
	if _, _, ok := ParseServiceKey("/ProducerQueue"); ok {
		t.Fatal("leading slash must fail")
	}
}

func TestParseServiceKeyTrailingSlash(t *testing.T) {
	if _, _, ok := ParseServiceKey("vibelang-runtime/"); ok {
		t.Fatal("trailing slash must fail")
	}
}

func TestParseServiceKeyOnlySlash(t *testing.T) {
	if _, _, ok := ParseServiceKey("/"); ok {
		t.Fatal("bare slash must fail")
	}
}

func TestParseServiceKeyMultipleSlashes(t *testing.T) {
	if _, _, ok := ParseServiceKey("vibelang-runtime/sub/ProducerQueue"); ok {
		t.Fatal("multiple slashes must fail")
	}
}

func TestParseServiceKeyDoubleSlash(t *testing.T) {
	if _, _, ok := ParseServiceKey("vibelang-runtime//ProducerQueue"); ok {
		t.Fatal("double slash must fail")
	}
}

func TestParseServiceKeyLeadingSpace(t *testing.T) {
	if _, _, ok := ParseServiceKey(" vibelang-runtime/ProducerQueue"); ok {
		t.Fatal("leading space must fail")
	}
}

func TestParseServiceKeyTrailingSpace(t *testing.T) {
	if _, _, ok := ParseServiceKey("vibelang-runtime/ProducerQueue "); ok {
		t.Fatal("trailing space must fail")
	}
}

func TestParseServiceKeyInternalSpace(t *testing.T) {
	if _, _, ok := ParseServiceKey("vibelang runtime/ProducerQueue"); ok {
		t.Fatal("internal space must fail")
	}
}

func TestParseServiceKeyTabCharacter(t *testing.T) {
	if _, _, ok := ParseServiceKey("vibelang-runtime/Producer\tQueue"); ok {
		t.Fatal("tab character must fail")
	}
}

func TestParseServiceKeyNewlineCharacter(t *testing.T) {
	if _, _, ok := ParseServiceKey("vibelang-runtime/Producer\nQueue"); ok {
		t.Fatal("newline character must fail")
	}
}

func TestParseServiceKeyCarriageReturn(t *testing.T) {
	if _, _, ok := ParseServiceKey("vibelang-runtime/Producer\rQueue"); ok {
		t.Fatal("carriage return must fail")
	}
}

func TestParseServiceKeyDoubleQuote(t *testing.T) {
	if _, _, ok := ParseServiceKey(`vibelang-runtime/"ProducerQueue"`); ok {
		t.Fatal("double quote must fail")
	}
}

func TestParseServiceKeySingleQuote(t *testing.T) {
	if _, _, ok := ParseServiceKey("vibelang-runtime/'ProducerQueue'"); ok {
		t.Fatal("single quote must fail")
	}
}

func TestParseServiceKeyBacktick(t *testing.T) {
	if _, _, ok := ParseServiceKey("vibelang-runtime/`ProducerQueue`"); ok {
		t.Fatal("backtick must fail")
	}
}

func TestParseServiceKeyBackslash(t *testing.T) {
	if _, _, ok := ParseServiceKey(`vibelang-runtime/Producer\Queue`); ok {
		t.Fatal("backslash must fail")
	}
}

func TestParseServiceKeyNullByte(t *testing.T) {
	if _, _, ok := ParseServiceKey("vibelang-runtime/Producer\x00Queue"); ok {
		t.Fatal("null byte must fail")
	}
}

func TestParseServiceKeyDeleteByte(t *testing.T) {
	if _, _, ok := ParseServiceKey("vibelang-runtime/Producer\x7fQueue"); ok {
		t.Fatal("DEL byte must fail")
	}
}

func TestParseServiceKeyNonASCII(t *testing.T) {
	if _, _, ok := ParseServiceKey("vibelang-runtime/Prödücer"); ok {
		t.Fatal("non-ASCII must fail")
	}
}

func TestParseServiceKeyUppercaseNamespaceRejected(t *testing.T) {
	if _, _, ok := ParseServiceKey("VibeLang/ProducerQueue"); ok {
		t.Fatal("uppercase namespace must fail")
	}
}

func TestParseServiceKeyLeadingHyphenNamespaceRejected(t *testing.T) {
	if _, _, ok := ParseServiceKey("-vibelang/ProducerQueue"); ok {
		t.Fatal("leading hyphen in namespace must fail")
	}
}

func TestParseServiceKeyTrailingHyphenNamespaceRejected(t *testing.T) {
	if _, _, ok := ParseServiceKey("vibelang-/ProducerQueue"); ok {
		t.Fatal("trailing hyphen in namespace must fail")
	}
}

func TestParseServiceKeyScopedNamespaceAllowed(t *testing.T) {
	ns, sym, ok := ParseServiceKey("@vibelang.core/Queue")
	if !ok || ns != "@vibelang.core" || sym != "Queue" {
		t.Fatalf("scoped namespace should succeed, got (%q, %q, %v)", ns, sym, ok)
	}
}

func TestParseServiceKeyNumericNamespaceAllowed(t *testing.T) {
	ns, sym, ok := ParseServiceKey("vibe2/Service1")
	if !ok || ns != "vibe2" || sym != "Service1" {
		t.Fatalf("alphanumeric namespace/symbol should succeed, got (%q, %q, %v)", ns, sym, ok)
	}
}

func TestParseServiceKeyUnderscoreNamespaceAllowed(t *testing.T) {
	ns, sym, ok := ParseServiceKey("vibe_runtime/Queue_V2")
	if !ok || ns != "vibe_runtime" || sym != "Queue_V2" {
		t.Fatalf("underscore namespace/symbol should succeed, got (%q, %q, %v)", ns, sym, ok)
	}
}

func TestParseServiceKeyDollarPrefixedSymbolAllowed(t *testing.T) {
	ns, sym, ok := ParseServiceKey("vibelang-runtime/$ProducerQueue")
	if !ok || ns != "vibelang-runtime" || sym != "$ProducerQueue" {
		t.Fatalf("dollar-prefixed JS symbol should succeed, got (%q, %q, %v)", ns, sym, ok)
	}
}

func TestParseServiceKeyUnderscorePrefixedSymbolAllowed(t *testing.T) {
	ns, sym, ok := ParseServiceKey("vibelang-runtime/_InternalQueue")
	if !ok || ns != "vibelang-runtime" || sym != "_InternalQueue" {
		t.Fatalf("underscore-prefixed symbol should succeed, got (%q, %q, %v)", ns, sym, ok)
	}
}

func TestParseServiceKeyDigitPrefixedSymbolRejected(t *testing.T) {
	if _, _, ok := ParseServiceKey("vibelang-runtime/1Queue"); ok {
		t.Fatal("digit-prefixed symbol must fail")
	}
}

func TestParseServiceKeyHyphenInSymbolRejected(t *testing.T) {
	if _, _, ok := ParseServiceKey("vibelang-runtime/Producer-Queue"); ok {
		t.Fatal("hyphen in symbol must fail")
	}
}

func TestParseServiceKeyDotInSymbolRejected(t *testing.T) {
	if _, _, ok := ParseServiceKey("vibelang-runtime/Producer.Queue"); ok {
		t.Fatal("dot in symbol must fail")
	}
}

func TestIsValidServiceKeyMatchesParseSuccess(t *testing.T) {
	cases := []string{
		ProducerQueueKey,
		"effect/Clock",
		"vibelang-runtime/$Scope",
		"",
		"no-slash",
		"bad/a/b",
		"BAD/Name",
		"good/1bad",
	}
	for _, tc := range cases {
		_, _, parsed := ParseServiceKey(tc)
		if IsValidServiceKey(tc) != parsed {
			t.Fatalf("IsValidServiceKey(%q) != ParseServiceKey ok (%v)", tc, parsed)
		}
	}
}

func TestFormatServiceKeyValid(t *testing.T) {
	key, ok := FormatServiceKey("vibelang-runtime", "ProducerQueue")
	if !ok || key != ProducerQueueKey {
		t.Fatalf("got (%q, %v), want (%q, true)", key, ok, ProducerQueueKey)
	}
}

func TestFormatServiceKeyRejectsEmptyNamespace(t *testing.T) {
	if _, ok := FormatServiceKey("", "ProducerQueue"); ok {
		t.Fatal("empty namespace must fail")
	}
}

func TestFormatServiceKeyRejectsEmptySymbol(t *testing.T) {
	if _, ok := FormatServiceKey("vibelang-runtime", ""); ok {
		t.Fatal("empty symbol must fail")
	}
}

func TestFormatServiceKeyRejectsSlashInNamespace(t *testing.T) {
	if _, ok := FormatServiceKey("a/b", "Queue"); ok {
		t.Fatal("slash in namespace must fail")
	}
}

func TestFormatServiceKeyRejectsSlashInSymbol(t *testing.T) {
	if _, ok := FormatServiceKey("vibelang-runtime", "A/B"); ok {
		t.Fatal("slash in symbol must fail")
	}
}

func TestFormatServiceKeyRejectsInvalidSymbolStart(t *testing.T) {
	if _, ok := FormatServiceKey("vibelang-runtime", "9Invalid"); ok {
		t.Fatal("digit-starting symbol must fail")
	}
}

func TestFormatServiceKeyRejectsWhitespace(t *testing.T) {
	if _, ok := FormatServiceKey("vibelang runtime", "ProducerQueue"); ok {
		t.Fatal("whitespace in namespace must fail")
	}
}

func TestProducerQueueKeyStableLengthBounds(t *testing.T) {
	if len(ProducerQueueKey) < 5 || len(ProducerQueueKey) > 128 {
		t.Fatalf("unexpected ProducerQueueKey length %d", len(ProducerQueueKey))
	}
}
