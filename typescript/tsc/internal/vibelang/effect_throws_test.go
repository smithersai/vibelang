package vibelang

import (
	"encoding/json"
	"fmt"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

// effectThrowsFile is the generated table, relative to this package.
const effectThrowsFile = "effect_throws_table.txt"

// effectThrowsAuditPattern matches declaration names that must be explicitly
// audited as either throwing (effectThrowsCurated) or reviewed non-throwing
// (effectThrowsReviewedNever), so an Effect version bump cannot silently
// default a new throwing *Unsafe, *Sync, *OrThrow, parse*, decode*, or encode*
// export to "never".
var effectThrowsAuditPattern = regexp.MustCompile(`(Unsafe$|Sync$|OrThrow|^(parse|decode|encode))`)

func effectKeyRequiresAudit(key string) bool {
	if strings.HasSuffix(key, ".factory") {
		return false
	}
	_, member, ok := strings.Cut(key, ":")
	if !ok {
		return false
	}
	clean := strings.TrimRight(member, "()")
	last := clean
	if dot := strings.LastIndexByte(clean, '.'); dot >= 0 {
		last = clean[dot+1:]
	}
	return effectThrowsAuditPattern.MatchString(last)
}

// effectThrowsReviewedNever records every pinned-package key matching
// effectThrowsAuditPattern that was audited and verified to throw never (or is
// an Effect runner gated by runners.go / a builder whose returned callable is
// curated separately).
var effectThrowsReviewedNever = map[string]bool{
	"effect/dist/BigDecimal:toNumberUnsafe":                                        true,
	"effect/dist/Channel:decodeText":                                               true,
	"effect/dist/Channel:encodeText":                                               true,
	"effect/dist/Channel:endSync":                                                  true,
	"effect/dist/Channel:failCauseSync":                                            true,
	"effect/dist/Channel:failSync":                                                 true,
	"effect/dist/ChannelSchema:decode":                                             true,
	"effect/dist/ChannelSchema:decode()":                                           true,
	"effect/dist/ChannelSchema:decodeUnknown":                                      true,
	"effect/dist/ChannelSchema:decodeUnknown()":                                    true,
	"effect/dist/ChannelSchema:encode":                                             true,
	"effect/dist/ChannelSchema:encode()":                                           true,
	"effect/dist/ChannelSchema:encodeUnknown":                                      true,
	"effect/dist/ChannelSchema:encodeUnknown()":                                    true,
	"effect/dist/Chunk:fromArrayUnsafe":                                            true,
	"effect/dist/Chunk:fromNonEmptyArrayUnsafe":                                    true,
	"effect/dist/Clock:Clock.currentTimeMillisUnsafe":                              true,
	"effect/dist/Clock:Clock.currentTimeNanosUnsafe":                               true,
	"effect/dist/Clock:Clock.monotonicTimeNanosUnsafe":                             true,
	"effect/dist/Config:Config.parse":                                              true,
	"effect/dist/Context:Service.useSync":                                          true,
	"effect/dist/Context:addUnsafe":                                                true,
	"effect/dist/Context:makeUnsafe":                                               true,
	"effect/dist/Cron:parse":                                                       true,
	"effect/dist/DateTime:isFutureUnsafe":                                          true,
	"effect/dist/DateTime:isPastUnsafe":                                            true,
	"effect/dist/Deferred:dieSync()":                                               true,
	"effect/dist/Deferred:dieSync()()":                                             true,
	"effect/dist/Deferred:doneUnsafe":                                              true,
	"effect/dist/Deferred:failCauseSync()":                                         true,
	"effect/dist/Deferred:failCauseSync()()":                                       true,
	"effect/dist/Deferred:failSync()":                                              true,
	"effect/dist/Deferred:failSync()()":                                            true,
	"effect/dist/Deferred:isDoneUnsafe":                                            true,
	"effect/dist/Deferred:makeUnsafe":                                              true,
	"effect/dist/Duration:divideUnsafe()":                                          true,
	"effect/dist/Duration:divideUnsafe()()":                                        true,
	"effect/dist/Effect:failCauseSync":                                             true,
	"effect/dist/Effect:failSync":                                                  true,
	"effect/dist/Effect:requestUnsafe":                                             true,
	"effect/dist/Effect:requestUnsafe()":                                           true,
	"effect/dist/Equal:byReferenceUnsafe":                                          true,
	"effect/dist/Fiber:Fiber.interruptUnsafe":                                      true,
	"effect/dist/Fiber:Fiber.pollUnsafe":                                           true,
	"effect/dist/FiberHandle:getUnsafe":                                            true,
	"effect/dist/FiberHandle:setUnsafe()":                                          true,
	"effect/dist/FiberHandle:setUnsafe()()":                                        true,
	"effect/dist/FiberMap:getUnsafe()":                                             true,
	"effect/dist/FiberMap:getUnsafe()()":                                           true,
	"effect/dist/FiberMap:hasUnsafe()":                                             true,
	"effect/dist/FiberMap:hasUnsafe()()":                                           true,
	"effect/dist/FiberMap:setUnsafe()":                                             true,
	"effect/dist/FiberMap:setUnsafe()()":                                           true,
	"effect/dist/FiberSet:addUnsafe()":                                             true,
	"effect/dist/FiberSet:addUnsafe()()":                                           true,
	"effect/dist/JsonPointer:parseUriFragment":                                     true,
	"effect/dist/Latch:Latch.closeUnsafe":                                          true,
	"effect/dist/Latch:Latch.openUnsafe":                                           true,
	"effect/dist/Latch:closeUnsafe":                                                true,
	"effect/dist/Latch:makeUnsafe":                                                 true,
	"effect/dist/Latch:openUnsafe":                                                 true,
	"effect/dist/Layer:forkMemoMapUnsafe":                                          true,
	"effect/dist/Layer:makeMemoMapUnsafe":                                          true,
	"effect/dist/ManagedRuntime:ManagedRuntime.runSync":                            true,
	"effect/dist/Match:instanceOfUnsafe":                                           true,
	"effect/dist/Match:instanceOfUnsafe()":                                         true,
	"effect/dist/Metric:Metric.modifyUnsafe":                                       true,
	"effect/dist/Metric:Metric.updateUnsafe":                                       true,
	"effect/dist/Metric:Metric.valueUnsafe":                                        true,
	"effect/dist/Metric:registerUnsafe":                                            true,
	"effect/dist/Metric:removeUnsafe":                                              true,
	"effect/dist/Metric:snapshotUnsafe":                                            true,
	"effect/dist/MutableList:appendAllUnsafe":                                      true,
	"effect/dist/MutableList:prependAllUnsafe":                                     true,
	"effect/dist/Number:parse":                                                     true,
	"effect/dist/PartitionedSemaphore:makeUnsafe":                                  true,
	"effect/dist/Path:Path.parse":                                                  true,
	"effect/dist/PubSub:BackPressureStrategy.completePollersUnsafe":                true,
	"effect/dist/PubSub:BackPressureStrategy.completeSubscribersUnsafe":            true,
	"effect/dist/PubSub:BackPressureStrategy.onPubSubEmptySpaceUnsafe":             true,
	"effect/dist/PubSub:BackPressureStrategy.removeUnsafe":                         true,
	"effect/dist/PubSub:DroppingStrategy.completePollersUnsafe":                    true,
	"effect/dist/PubSub:DroppingStrategy.completeSubscribersUnsafe":                true,
	"effect/dist/PubSub:DroppingStrategy.onPubSubEmptySpaceUnsafe":                 true,
	"effect/dist/PubSub:PubSub.Strategy.completePollersUnsafe":                     true,
	"effect/dist/PubSub:PubSub.Strategy.completeSubscribersUnsafe":                 true,
	"effect/dist/PubSub:PubSub.Strategy.onPubSubEmptySpaceUnsafe":                  true,
	"effect/dist/PubSub:SlidingStrategy.completePollersUnsafe":                     true,
	"effect/dist/PubSub:SlidingStrategy.completeSubscribersUnsafe":                 true,
	"effect/dist/PubSub:SlidingStrategy.onPubSubEmptySpaceUnsafe":                  true,
	"effect/dist/PubSub:SlidingStrategy.slidingPublishUnsafe":                      true,
	"effect/dist/PubSub:endUnsafe()":                                               true,
	"effect/dist/PubSub:endUnsafe()()":                                             true,
	"effect/dist/PubSub:isShutdownUnsafe":                                          true,
	"effect/dist/PubSub:publishUnsafe()":                                           true,
	"effect/dist/PubSub:publishUnsafe()()":                                         true,
	"effect/dist/PubSub:remainingUnsafe":                                           true,
	"effect/dist/PubSub:sizeUnsafe":                                                true,
	"effect/dist/Queue:endUnsafe":                                                  true,
	"effect/dist/Queue:failCauseUnsafe":                                            true,
	"effect/dist/Queue:flushUnsafe":                                                true,
	"effect/dist/Queue:isFullUnsafe":                                               true,
	"effect/dist/Queue:offerAllUnsafe":                                             true,
	"effect/dist/Queue:offerUnsafe":                                                true,
	"effect/dist/Queue:shutdownUnsafe":                                             true,
	"effect/dist/Queue:sizeUnsafe":                                                 true,
	"effect/dist/Queue:takeUnsafe":                                                 true,
	"effect/dist/Random:Random.nextDoubleUnsafe":                                   true,
	"effect/dist/Random:Random.nextIntUnsafe":                                      true,
	"effect/dist/Redacted:wipeUnsafe":                                              true,
	"effect/dist/Ref:getUnsafe":                                                    true,
	"effect/dist/Ref:makeUnsafe":                                                   true,
	"effect/dist/Request:Entry.completeUnsafe":                                     true,
	"effect/dist/Request:makeEntry.options.completeUnsafe":                         true,
	"effect/dist/Schema:decode":                                                    true,
	"effect/dist/Schema:decode()":                                                  true,
	"effect/dist/Schema:decodeEffect":                                              true,
	"effect/dist/Schema:decodeEffect()":                                            true,
	"effect/dist/Schema:decodeExit":                                                true,
	"effect/dist/Schema:decodeExit()":                                              true,
	"effect/dist/Schema:decodeOption":                                              true,
	"effect/dist/Schema:decodeOption()":                                            true,
	"effect/dist/Schema:decodePromise":                                             true,
	"effect/dist/Schema:decodePromise()":                                           true,
	"effect/dist/Schema:decodeResult":                                              true,
	"effect/dist/Schema:decodeResult()":                                            true,
	"effect/dist/Schema:decodeSync":                                                true,
	"effect/dist/Schema:decodeTo":                                                  true,
	"effect/dist/Schema:decodeTo()":                                                true,
	"effect/dist/Schema:decodeUnknownEffect":                                       true,
	"effect/dist/Schema:decodeUnknownEffect()":                                     true,
	"effect/dist/Schema:decodeUnknownExit":                                         true,
	"effect/dist/Schema:decodeUnknownExit()":                                       true,
	"effect/dist/Schema:decodeUnknownOption":                                       true,
	"effect/dist/Schema:decodeUnknownOption()":                                     true,
	"effect/dist/Schema:decodeUnknownPromise":                                      true,
	"effect/dist/Schema:decodeUnknownPromise()":                                    true,
	"effect/dist/Schema:decodeUnknownResult":                                       true,
	"effect/dist/Schema:decodeUnknownResult()":                                     true,
	"effect/dist/Schema:decodeUnknownSync":                                         true,
	"effect/dist/Schema:encode":                                                    true,
	"effect/dist/Schema:encode()":                                                  true,
	"effect/dist/Schema:encodeEffect":                                              true,
	"effect/dist/Schema:encodeEffect()":                                            true,
	"effect/dist/Schema:encodeExit":                                                true,
	"effect/dist/Schema:encodeExit()":                                              true,
	"effect/dist/Schema:encodeKeys":                                                true,
	"effect/dist/Schema:encodeKeys()":                                              true,
	"effect/dist/Schema:encodeOption":                                              true,
	"effect/dist/Schema:encodeOption()":                                            true,
	"effect/dist/Schema:encodePromise":                                             true,
	"effect/dist/Schema:encodePromise()":                                           true,
	"effect/dist/Schema:encodeResult":                                              true,
	"effect/dist/Schema:encodeResult()":                                            true,
	"effect/dist/Schema:encodeSync":                                                true,
	"effect/dist/Schema:encodeTo":                                                  true,
	"effect/dist/Schema:encodeTo()":                                                true,
	"effect/dist/Schema:encodeUnknownEffect":                                       true,
	"effect/dist/Schema:encodeUnknownEffect()":                                     true,
	"effect/dist/Schema:encodeUnknownExit":                                         true,
	"effect/dist/Schema:encodeUnknownExit()":                                       true,
	"effect/dist/Schema:encodeUnknownOption":                                       true,
	"effect/dist/Schema:encodeUnknownOption()":                                     true,
	"effect/dist/Schema:encodeUnknownPromise":                                      true,
	"effect/dist/Schema:encodeUnknownPromise()":                                    true,
	"effect/dist/Schema:encodeUnknownResult":                                       true,
	"effect/dist/Schema:encodeUnknownResult()":                                     true,
	"effect/dist/Schema:encodeUnknownSync":                                         true,
	"effect/dist/Schema:middlewareDecoding.decode":                                 true,
	"effect/dist/Schema:middlewareEncoding.encode":                                 true,
	"effect/dist/SchemaAST:decodeTo":                                               true,
	"effect/dist/SchemaGetter:decodeBase64":                                        true,
	"effect/dist/SchemaGetter:decodeBase64String":                                  true,
	"effect/dist/SchemaGetter:decodeBase64Url":                                     true,
	"effect/dist/SchemaGetter:decodeBase64UrlString":                               true,
	"effect/dist/SchemaGetter:decodeFormData":                                      true,
	"effect/dist/SchemaGetter:decodeHex":                                           true,
	"effect/dist/SchemaGetter:decodeHexString":                                     true,
	"effect/dist/SchemaGetter:decodeURLSearchParams":                               true,
	"effect/dist/SchemaGetter:decodeUriComponent":                                  true,
	"effect/dist/SchemaGetter:encodeBase64":                                        true,
	"effect/dist/SchemaGetter:encodeBase64Url":                                     true,
	"effect/dist/SchemaGetter:encodeFormData":                                      true,
	"effect/dist/SchemaGetter:encodeHex":                                           true,
	"effect/dist/SchemaGetter:encodeURLSearchParams":                               true,
	"effect/dist/SchemaGetter:encodeUriComponent":                                  true,
	"effect/dist/SchemaGetter:parseJson":                                           true,
	"effect/dist/SchemaParser:decodeEffect":                                        true,
	"effect/dist/SchemaParser:decodeEffect()":                                      true,
	"effect/dist/SchemaParser:decodeExit":                                          true,
	"effect/dist/SchemaParser:decodeExit()":                                        true,
	"effect/dist/SchemaParser:decodePromise":                                       true,
	"effect/dist/SchemaParser:decodePromise()":                                     true,
	"effect/dist/SchemaParser:decodeResult":                                        true,
	"effect/dist/SchemaParser:decodeResult()":                                      true,
	"effect/dist/SchemaParser:decodeSync":                                          true,
	"effect/dist/SchemaParser:decodeUnknownEffect":                                 true,
	"effect/dist/SchemaParser:decodeUnknownEffect()":                               true,
	"effect/dist/SchemaParser:decodeUnknownExit":                                   true,
	"effect/dist/SchemaParser:decodeUnknownExit()":                                 true,
	"effect/dist/SchemaParser:decodeUnknownPromise":                                true,
	"effect/dist/SchemaParser:decodeUnknownPromise()":                              true,
	"effect/dist/SchemaParser:decodeUnknownResult":                                 true,
	"effect/dist/SchemaParser:decodeUnknownResult()":                               true,
	"effect/dist/SchemaParser:decodeUnknownSync":                                   true,
	"effect/dist/SchemaParser:encodeEffect":                                        true,
	"effect/dist/SchemaParser:encodeEffect()":                                      true,
	"effect/dist/SchemaParser:encodeExit":                                          true,
	"effect/dist/SchemaParser:encodeExit()":                                        true,
	"effect/dist/SchemaParser:encodePromise":                                       true,
	"effect/dist/SchemaParser:encodePromise()":                                     true,
	"effect/dist/SchemaParser:encodeResult":                                        true,
	"effect/dist/SchemaParser:encodeResult()":                                      true,
	"effect/dist/SchemaParser:encodeSync":                                          true,
	"effect/dist/SchemaParser:encodeUnknownEffect":                                 true,
	"effect/dist/SchemaParser:encodeUnknownEffect()":                               true,
	"effect/dist/SchemaParser:encodeUnknownExit":                                   true,
	"effect/dist/SchemaParser:encodeUnknownExit()":                                 true,
	"effect/dist/SchemaParser:encodeUnknownPromise":                                true,
	"effect/dist/SchemaParser:encodeUnknownPromise()":                              true,
	"effect/dist/SchemaParser:encodeUnknownResult":                                 true,
	"effect/dist/SchemaParser:encodeUnknownResult()":                               true,
	"effect/dist/SchemaParser:encodeUnknownSync":                                   true,
	"effect/dist/SchemaTransformation:Middleware.decode":                           true,
	"effect/dist/SchemaTransformation:Middleware.encode":                           true,
	"effect/dist/SchemaTransformation:transform.options.decode":                    true,
	"effect/dist/SchemaTransformation:transform.options.encode":                    true,
	"effect/dist/SchemaTransformation:transformEffect.options.decode":              true,
	"effect/dist/SchemaTransformation:transformEffect.options.encode":              true,
	"effect/dist/SchemaTransformation:transformOptional.options.decode":            true,
	"effect/dist/SchemaTransformation:transformOptional.options.encode":            true,
	"effect/dist/Scope:closeUnsafe":                                                true,
	"effect/dist/Scope:forkUnsafe":                                                 true,
	"effect/dist/Scope:makeUnsafe":                                                 true,
	"effect/dist/ScopedRef:getUnsafe":                                              true,
	"effect/dist/SemVer:parse":                                                     true,
	"effect/dist/SemVerRange:parse":                                                true,
	"effect/dist/Semaphore:makeUnsafe":                                             true,
	"effect/dist/Sink:failCauseSync":                                               true,
	"effect/dist/Sink:failSync":                                                    true,
	"effect/dist/Stream:decodeText":                                                true,
	"effect/dist/Stream:decodeText()":                                              true,
	"effect/dist/Stream:encodeText":                                                true,
	"effect/dist/Stream:failCauseSync":                                             true,
	"effect/dist/Stream:failSync":                                                  true,
	"effect/dist/SubscriptionRef:getUnsafe":                                        true,
	"effect/dist/SynchronizedRef:getUnsafe":                                        true,
	"effect/dist/SynchronizedRef:makeUnsafe":                                       true,
	"effect/dist/TxChunk:makeUnsafe":                                               true,
	"effect/dist/TxRef:makeUnsafe":                                                 true,
	"effect/dist/ai/McpProtocol:PayloadCodecs.decode":                              true,
	"effect/dist/ai/McpProtocol:PayloadCodecs.encode":                              true,
	"effect/dist/ai/McpServer:decodeNameHeader":                                    true,
	"effect/dist/ai/ResponseIdTracker:Service.clearUnsafe":                         true,
	"effect/dist/ai/ResponseIdTracker:Service.prepareUnsafe":                       true,
	"effect/dist/cli/Command:provideSync()":                                        true,
	"effect/dist/cli/Command:provideSync()()":                                      true,
	"effect/dist/cli/Primitive:Primitive.parse":                                    true,
	"effect/dist/cli/internal/command:CommandInternal.parse":                       true,
	"effect/dist/cli/internal/command:CommandInternal.parseContext":                true,
	"effect/dist/cli/internal/command:makeCommand.options.parse":                   true,
	"effect/dist/cli/internal/command:makeCommand.options.parseContext":            true,
	"effect/dist/cluster/ClusterWorkflowEngine:make.interruptUnsafe":               true,
	"effect/dist/cluster/Snowflake:Snowflake.Generator.nextUnsafe":                 true,
	"effect/dist/crypto/KeyFormat:decodePrivate":                                   true,
	"effect/dist/crypto/KeyFormat:decodePublic":                                    true,
	"effect/dist/crypto/KeyFormat:decodeSecret":                                    true,
	"effect/dist/crypto/KeyFormat:encode":                                          true,
	"effect/dist/crypto/SecureRandom:ulidUnsafe":                                   true,
	"effect/dist/crypto/SecureRandom:uuidV4Unsafe()":                               true,
	"effect/dist/crypto/SecureRandom:uuidV7Unsafe()":                               true,
	"effect/dist/devtools/DevToolsClient:DevToolsClient_base.sendUnsafe":           true,
	"effect/dist/encoding/Base64:decode":                                           true,
	"effect/dist/encoding/Base64:decodeString":                                     true,
	"effect/dist/encoding/Base64:encode":                                           true,
	"effect/dist/encoding/Base64Url:decode":                                        true,
	"effect/dist/encoding/Base64Url:decodeString":                                  true,
	"effect/dist/encoding/Base64Url:encode":                                        true,
	"effect/dist/encoding/Base64Url:encodePadded":                                  true,
	"effect/dist/encoding/Csv:decode()":                                            true,
	"effect/dist/encoding/Csv:decodeSchema":                                        true,
	"effect/dist/encoding/Csv:decodeSchema()":                                      true,
	"effect/dist/encoding/Csv:decodeSchemaString":                                  true,
	"effect/dist/encoding/Csv:decodeSchemaString()":                                true,
	"effect/dist/encoding/Csv:decodeString()":                                      true,
	"effect/dist/encoding/Csv:encode()":                                            true,
	"effect/dist/encoding/Csv:encodeSchema":                                        true,
	"effect/dist/encoding/Csv:encodeSchema()":                                      true,
	"effect/dist/encoding/Csv:encodeSchemaString":                                  true,
	"effect/dist/encoding/Csv:encodeSchemaString()":                                true,
	"effect/dist/encoding/Csv:encodeString()":                                      true,
	"effect/dist/encoding/Hex:decode":                                              true,
	"effect/dist/encoding/Hex:decodeString":                                        true,
	"effect/dist/encoding/Hex:encode":                                              true,
	"effect/dist/encoding/Ini:parse":                                               true,
	"effect/dist/encoding/JsonArray:decode":                                        true,
	"effect/dist/encoding/JsonArray:decodeSchema":                                  true,
	"effect/dist/encoding/JsonArray:decodeSchema()":                                true,
	"effect/dist/encoding/JsonArray:decodeSchemaString":                            true,
	"effect/dist/encoding/JsonArray:decodeSchemaString()":                          true,
	"effect/dist/encoding/JsonArray:decodeString":                                  true,
	"effect/dist/encoding/JsonArray:encode":                                        true,
	"effect/dist/encoding/JsonArray:encodeSchema":                                  true,
	"effect/dist/encoding/JsonArray:encodeSchema()":                                true,
	"effect/dist/encoding/JsonArray:encodeSchemaString":                            true,
	"effect/dist/encoding/JsonArray:encodeSchemaString()":                          true,
	"effect/dist/encoding/JsonArray:encodeString":                                  true,
	"effect/dist/encoding/Ndjson:decode":                                           true,
	"effect/dist/encoding/Ndjson:decodeSchema":                                     true,
	"effect/dist/encoding/Ndjson:decodeSchema()":                                   true,
	"effect/dist/encoding/Ndjson:decodeSchemaString":                               true,
	"effect/dist/encoding/Ndjson:decodeSchemaString()":                             true,
	"effect/dist/encoding/Ndjson:decodeString":                                     true,
	"effect/dist/encoding/Ndjson:encode":                                           true,
	"effect/dist/encoding/Ndjson:encodeSchema":                                     true,
	"effect/dist/encoding/Ndjson:encodeSchema()":                                   true,
	"effect/dist/encoding/Ndjson:encodeSchemaString":                               true,
	"effect/dist/encoding/Ndjson:encodeSchemaString()":                             true,
	"effect/dist/encoding/Ndjson:encodeString":                                     true,
	"effect/dist/encoding/SchemaBinary:decode":                                     true,
	"effect/dist/encoding/SchemaBinary:decode()":                                   true,
	"effect/dist/encoding/SchemaBinary:encode":                                     true,
	"effect/dist/encoding/SchemaBinary:encode()":                                   true,
	"effect/dist/encoding/SchemaBinary:encoder":                                    true,
	"effect/dist/encoding/SchemaBinary:parser":                                     true,
	"effect/dist/encoding/Sse:decode":                                              true,
	"effect/dist/encoding/Sse:decodeDataSchema":                                    true,
	"effect/dist/encoding/Sse:decodeSchema":                                        true,
	"effect/dist/encoding/Sse:encode":                                              true,
	"effect/dist/encoding/Sse:encodeSchema":                                        true,
	"effect/dist/encoding/Tar:decode":                                              true,
	"effect/dist/encoding/Tar:encode":                                              true,
	"effect/dist/encoding/Toml:parse":                                              true,
	"effect/dist/encoding/Xml:decode":                                              true,
	"effect/dist/encoding/Xml:decodeString":                                        true,
	"effect/dist/encoding/Xml:encode":                                              true,
	"effect/dist/encoding/Xml:encodeString":                                        true,
	"effect/dist/encoding/Zip:decode":                                              true,
	"effect/dist/encoding/Zip:encode":                                              true,
	"effect/dist/eventlog/EventJournal:Entry.decodeArray":                          true,
	"effect/dist/eventlog/EventJournal:Entry.encodeArray":                          true,
	"effect/dist/eventlog/EventJournal:makeRemoteIdUnsafe":                         true,
	"effect/dist/eventlog/EventLog:Registry_base.registerHandlerUnsafe":            true,
	"effect/dist/eventlog/EventLogMessage:ChangesRpc.decodeEncrypted":              true,
	"effect/dist/eventlog/EventLogMessage:ChangesRpc.decodeUnencrypted":            true,
	"effect/dist/eventlog/EventLogMessage:ChangesRpc.encodeEncrypted":              true,
	"effect/dist/eventlog/EventLogMessage:ChangesRpc.encodeUnencrypted":            true,
	"effect/dist/eventlog/EventLogMessage:CompactionInputRpc.decodeHeaders":        true,
	"effect/dist/eventlog/EventLogMessage:CompactionInputRpc.encodeHeaders":        true,
	"effect/dist/eventlog/EventLogMessage:CompactionPartRpc.decodeSegment":         true,
	"effect/dist/eventlog/EventLogMessage:CompactionPartRpc.encodeSegment":         true,
	"effect/dist/eventlog/EventLogMessage:WriteEntries.decode":                     true,
	"effect/dist/eventlog/EventLogMessage:WriteEntries.encode":                     true,
	"effect/dist/eventlog/EventLogMessage:WriteEntriesUnencrypted.decode":          true,
	"effect/dist/eventlog/EventLogMessage:WriteEntriesUnencrypted.encode":          true,
	"effect/dist/eventlog/EventLogRemote:makeWith.options.decodeChanges":           true,
	"effect/dist/eventlog/EventLogRemote:makeWith.options.encodeWrite":             true,
	"effect/dist/eventlog/EventLogSessionAuth:decodeSessionAuthPayload":            true,
	"effect/dist/eventlog/EventLogSessionAuth:encodeSessionAuthPayload":            true,
	"effect/dist/http-api/HttpApiClient:decodeResponse":                            true,
	"effect/dist/http-api/HttpApiSchema:encodeToWithHeaders":                       true,
	"effect/dist/http-api/HttpApiSchema:encodeToWithHeaders()":                     true,
	"effect/dist/http-api/HttpApiSchema:encodeToWithHeaders.transformation.decode": true,
	"effect/dist/http-api/HttpApiSchema:encodeToWithHeaders.transformation.encode": true,
	"effect/dist/http/Cookies:parseHeader":                                         true,
	"effect/dist/http/FindMyWay/internal/queryString:parse":                        true,
	"effect/dist/http/Headers:fromRecordUnsafe":                                    true,
	"effect/dist/http/Headers:parseHttpDate":                                       true,
	"effect/dist/http/Headers:parseRetryAfter":                                     true,
	"effect/dist/http/HttpEffect:appendPreResponseHandlerUnsafe":                   true,
	"effect/dist/http/MultipartParser/internal/contentType:parse":                  true,
	"effect/dist/http/MultipartParser/internal/contentType:parseDisposition":       true,
	"effect/dist/http/MultipartParser/internal/multipart:decodeField":              true,
	"effect/dist/http/MultipartParser:decodeField":                                 true,
	"effect/dist/internal/graphqlHeaders:parseRetryAfter":                          true,
	"effect/dist/jose/Jwt:decodeUnverified":                                        true,
	"effect/dist/net/Host:parseHostsFile":                                          true,
	"effect/dist/net/NetAddress:ipv4FromBytesUnsafe":                               true,
	"effect/dist/net/NetAddress:ipv6FromBytesUnsafe":                               true,
	"effect/dist/observability/PrometheusMetrics:formatUnsafe":                     true,
	"effect/dist/process/ChildProcess:parseFdName":                                 true,
	"effect/dist/reactivity/Atom:Serializable.[SerializableTypeId].decode":         true,
	"effect/dist/reactivity/Atom:Serializable.[SerializableTypeId].encode":         true,
	"effect/dist/reactivity/Atom:fnSync()":                                         true,
	"effect/dist/reactivity/Atom:fnSync()()":                                       true,
	"effect/dist/reactivity/Reactivity:Reactivity.invalidateUnsafe":                true,
	"effect/dist/reactivity/Reactivity:Reactivity.registerUnsafe":                  true,
	"effect/dist/reactivity/Reactivity:Reactivity.registerUnsafe()":                true,
	"effect/dist/rpc/RpcSerialization:RpcSerialization_base.makeUnsafe":            true,
	"effect/dist/testing/TestClock:make.currentTimeMillisUnsafe":                   true,
	"effect/dist/testing/TestClock:make.currentTimeNanosUnsafe":                    true,
	"effect/dist/testing/TestClock:make.monotonicTimeNanosUnsafe":                  true,
	"effect/dist/testing/TestSchema:Decoding.decodeUnknownEffect":                  true,
	"effect/dist/testing/TestSchema:Encoding.encodeUnknownEffect":                  true,
	"effect/dist/workers/Transferable:Collector_base.addAllUnsafe":                 true,
	"effect/dist/workers/Transferable:Collector_base.clearUnsafe":                  true,
	"effect/dist/workers/Transferable:Collector_base.readUnsafe":                   true,
	"effect/dist/workers/Transferable:makeCollectorUnsafe":                         true,
	"effect/dist/workers/Worker:makeUnsafe":                                        true,
	"effect/dist/workers/WorkerRunner:WorkerRunner.sendUnsafe":                     true,
	"effect/dist/workflow/DurableDeferred:TokenParsed.encode":                      true,
	"effect/dist/workflow/WorkflowEngine:Encoded.interruptUnsafe":                  true,
	"effect/dist/workflow/WorkflowEngine:WorkflowEngine_base.interruptUnsafe":      true,
	"effect/dist/workflow/WorkflowEngine:makeUnsafe":                               true,
}

// effectPackageDirs are the pinned packages' installs, relative to this
// package, as the editor fixtures install them.
func effectPackageDir(name string) string {
	return filepath.Join("..", "..", "..", "..", "packages", "runtime", "node_modules", filepath.FromSlash(name))
}

// TestEffectThrowsTable regenerates the table from the declaration files of
// the Effect packages VibeLang pins and fails when the committed table
// differs: a pinned Effect with a declaration the table lacks, as a version
// bump brings, fails here until the table is regenerated and reviewed.
func TestEffectThrowsTable(t *testing.T) {
	keys := effectDeclarationKeys(t)
	if len(keys) < 5000 {
		t.Fatalf("found %d Effect declarations; the declaration walk is broken", len(keys))
	}
	var b strings.Builder
	b.WriteString("# Generated by TestEffectThrowsTable from effectThrowsCurated and the declaration files of\n")
	b.WriteString("# the pinned Effect packages, effect " + supportedEffectVersion + ". DO NOT EDIT.\n")
	b.WriteString("# Regenerate with UPDATE_EFFECT_THROWS=1 go test ./internal/vibelang -run TestEffectThrowsTable.\n")
	for _, key := range keys {
		throws, ok := effectThrowsCurated[key]
		if !ok {
			throws = "never"
		}
		b.WriteString(key + "\t" + throws + "\n")
	}
	want := b.String()
	if os.Getenv("UPDATE_EFFECT_THROWS") == "1" {
		if err := os.WriteFile(effectThrowsFile, []byte(want), 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	got, err := os.ReadFile(effectThrowsFile)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != want {
		t.Fatalf("%s is out of date; regenerate it with UPDATE_EFFECT_THROWS=1 go test ./internal/vibelang -run TestEffectThrowsTable, and review effectThrowsCurated for each new declaration that throws", effectThrowsFile)
	}
	for key := range effectThrowsCurated {
		if _, found := slices.BinarySearch(keys, key); !found {
			t.Errorf("effectThrowsCurated lists %s, which names no declaration of the pinned packages", key)
		}
	}
	for _, key := range keys {
		if !effectKeyRequiresAudit(key) {
			continue
		}
		_, curated := effectThrowsCurated[key]
		reviewed := effectThrowsReviewedNever[key]
		if !curated && !reviewed {
			t.Errorf("unreviewed Effect declaration %s matches audit pattern; classify it in effectThrowsCurated or effectThrowsReviewedNever", key)
		}
	}
	for key := range effectThrowsReviewedNever {
		if _, found := slices.BinarySearch(keys, key); !found {
			t.Errorf("effectThrowsReviewedNever lists %s, which names no declaration of the pinned packages", key)
		}
		if _, curated := effectThrowsCurated[key]; curated {
			t.Errorf("%s appears in both effectThrowsCurated and effectThrowsReviewedNever", key)
		}
	}
}

// TestEffectThrowsTableVersion checks that the installs the table is
// generated from are the pinned version.
func TestEffectThrowsTableVersion(t *testing.T) {
	for _, name := range effectPinnedPackages {
		data, err := os.ReadFile(filepath.Join(effectPackageDir(name), "package.json"))
		if err != nil {
			t.Fatal(err)
		}
		var manifest struct{ Version string }
		if err := json.Unmarshal(data, &manifest); err != nil {
			t.Fatal(err)
		}
		if manifest.Version != supportedEffectVersion {
			t.Errorf("%s is %s; the table covers the pinned %s", name, manifest.Version, supportedEffectVersion)
		}
	}
}

// TestEffectThrowsCuratedClassesResolve builds one real program containing
// every module named in effectThrowsCurated, walks every curated key to its
// declaration node, and verifies that every listed error class resolves to a
// class failure (including qualified namespace imports and import type aliases).
func TestEffectThrowsCuratedClassesResolve(t *testing.T) {
	modules := map[string]bool{}
	for key := range effectThrowsCurated {
		mod, _, ok := strings.Cut(key, ":")
		if !ok {
			t.Fatalf("malformed curated key %q", key)
		}
		modules[mod] = true
	}
	sortedMods := make([]string, 0, len(modules))
	for mod := range modules {
		sortedMods = append(sortedMods, mod)
	}
	slices.Sort(sortedMods)

	var src strings.Builder
	for i, mod := range sortedMods {
		// Convert "effect/dist/net/Host" -> "effect/net/Host" or direct path.
		var spec string
		if sub, ok := strings.CutPrefix(mod, "effect/dist/"); ok {
			spec = "effect/" + sub
		} else if sub, ok := strings.CutPrefix(mod, "@effect/platform-node-shared/dist/"); ok {
			spec = "@effect/platform-node-shared/" + sub
		} else {
			t.Fatalf("unexpected module prefix in %q", mod)
		}
		fmt.Fprintf(&src, "import type * as M%d from %q\n", i, spec)
	}
	src.WriteString("export type Keep = [")
	for i := range sortedMods {
		if i > 0 {
			src.WriteString(", ")
		}
		fmt.Fprintf(&src, "typeof M%d", i)
	}
	src.WriteString("]\n")

	dir := t.TempDir()
	root, err := filepath.Abs(filepath.Join("..", "..", "..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	links := map[string]string{
		"effect":                       filepath.Join(root, "packages", "runtime", "node_modules", "effect"),
		"@effect/platform-node-shared": filepath.Join(root, "packages", "runtime", "node_modules", "@effect", "platform-node-shared"),
		"vibelang-runtime":             filepath.Join(root, "packages", "runtime"),
	}
	for name, target := range links {
		dest := filepath.Join(dir, "node_modules", filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(target, dest); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "main.vibe"), []byte(src.String()), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(`{"compilerOptions":{"strict":true,"target":"es2022","module":"nodenext","moduleResolution":"nodenext","types":[],"skipLibCheck":true},"files":["main.vibe"]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	fsys := bundled.WrapFS(osvfs.FS())
	parsed, errs := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePath(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fsys, nil)
	if len(errs) != 0 || len(parsed.Errors) != 0 {
		t.Fatalf("config: %v / %v", errs, parsed.Errors)
	}
	program := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fsys, bundled.LibPath(), nil, nil, nil)})
	file := program.GetSourceFile(tspath.RootedFilePath(filepath.ToSlash(filepath.Join(dir, "main.vibe"))))
	c, done := program.GetTypeCheckerForFile(t.Context(), file)
	defer done()

	decls := map[string]*ast.Node{}
	for _, sf := range program.GetSourceFiles() {
		mod, ok := pinnedEffectModule(c, sf)
		if !ok || !modules[mod] {
			continue
		}
		var visit func(*ast.Node) bool
		visit = func(n *ast.Node) bool {
			if effectCallable(n) {
				key := effectTableKey(mod, n)
				if _, exists := decls[key]; !exists {
					decls[key] = n
				}
			}
			return n.ForEachChild(visit)
		}
		sf.AsNode().ForEachChild(visit)
	}

	curatedKeys := make([]string, 0, len(effectThrowsCurated))
	for key := range effectThrowsCurated {
		curatedKeys = append(curatedKeys, key)
	}
	slices.Sort(curatedKeys)

	for _, key := range curatedKeys {
		throws := effectThrowsCurated[key]
		decl := decls[key]
		if decl == nil {
			t.Errorf("%s: declaration not found in program", key)
			continue
		}
		if throws == "unknown" {
			continue
		}
		failures, unknown := resolveEffectThrowsSpec(c, decl, throws)
		if unknown || len(failures) == 0 {
			t.Errorf("%s: throws %q failed to resolve (failures=%d, unknown=%v)", key, throws, len(failures), unknown)
			continue
		}
		parts := strings.Split(throws, "|")
		if len(failures) != len(parts) {
			t.Errorf("%s: throws %q resolved %d failures, want %d", key, throws, len(failures), len(parts))
		}
	}

	// Verify unresolved curated class names fail safe to unknown (never degrade to never).
	anyDecl := decls["effect/dist/DateTime:makeUnsafe"]
	if anyDecl == nil {
		t.Fatal("missing DateTime:makeUnsafe declaration")
	}
	for _, bad := range []string{"NoSuchErrorClass", "Schema.NoSuchErrorClass", "NoSuchNs.NoSuchClass", ""} {
		failures, unknown := resolveEffectThrowsSpec(c, anyDecl, bad)
		if !unknown || len(failures) != 0 {
			t.Errorf("resolveEffectThrowsSpec(%q) = (%v, %v); want (nil, true)", bad, failures, unknown)
		}
	}
}

// TestEffectThrowsTrustEndToEnd tests each Effect trust outcome end to end:
// curated throwing calls (EK0403 in effect, EK0401 in plain, 0 in bridges),
// curated unknown calls, non-throwing never calls, effectful returns,
// rethrowing callbacks, and unlisted declarations in a pinned package.
func TestEffectThrowsTrustEndToEnd(t *testing.T) {
	t.Run("curated-throwing-in-effect-and-plain", func(t *testing.T) {
		source := `import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"
import * as ByteSize from "effect/ByteSize"
import * as Redacted from "effect/Redacted"
import * as Host from "effect/net/Host"
import * as EventLog from "effect/eventlog/EventLog"

export effect function inEffect(s: string, dIn: Duration.Input, bIn: ByteSize.Input, o: Option.Option<number>, r: Redacted.Redacted<string>) {
  const dec = Schema.decodeUnknownSync(Schema.String)
  const enc = Schema.encodeUnknownSync(Schema.Number)
  const a = dec(42)
  const b = enc(s)
  const c = DateTime.makeUnsafe(s)
  const d = Duration.fromInputUnsafe(dIn)
  const e = ByteSize.fromInputUnsafe(bIn)
  const f = Option.getOrThrow(o)
  const g = Redacted.value(r)
  const h = Host.hostFromStringUnsafe(s)
  const i = EventLog.decodeIdentityString(s)
  return [a, b, c, d, e, f, g, h, i]
}

export function inPlain(s: string, dIn: Duration.Input, o: Option.Option<number>, r: Result.Result<number, string>) {
  const dec = Schema.decodeUnknownSync(Schema.String)
  const a = dec(s)
  const b = DateTime.makeUnsafe(s)
  const c = Duration.fromInputUnsafe(dIn)
  const d = Option.getOrThrow(o)
  const e = Result.getOrThrow(r)
  return [a, b, c, d, e]
}`
		program, file, _, _ := editorProgram(t, source)
		var ek403, ek401 []string
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			switch d.Code() {
			case EK0403.Code:
				ek403 = append(ek403, d.MessageText())
			case EK0401.Code:
				ek401 = append(ek401, d.MessageText())
			default:
				t.Errorf("unexpected error diagnostic: %s", diagnosticWithNotes(d))
			}
		}
		if len(ek403) != 9 {
			t.Fatalf("got %d EK0403 diagnostics (%v); want 9", len(ek403), ek403)
		}
		if len(ek401) != 5 {
			t.Fatalf("got %d EK0401 diagnostics (%v); want 5", len(ek401), ek401)
		}
		// Verify qualified classes display clean class names (SchemaError, NetAddressError).
		joined := strings.Join(ek403, "\n")
		for _, wantClass := range []string{"SchemaError", "IllegalArgumentError", "NetAddressError", "Error"} {
			if !strings.Contains(joined, wantClass) {
				t.Errorf("EK0403 messages missing %q:\n%s", wantClass, joined)
			}
		}
	})

	t.Run("never-and-wrapped-and-effectful-compile-cleanly", func(t *testing.T) {
		source := `import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"
import * as Schedule from "effect/Schedule"

export effect function ok(xs: ReadonlyArray<number>, raw: unknown) {
  const o = Option.some(1)
  const d = Duration.seconds(5)
  const s = Schedule.recurs(3)
  const mapped = pipe(xs, Effect.Array.map((n) => n + 1))
  const dec = Schema.decodeUnknownSync(Schema.String)
  const decoded = try Effect.try(() => dec(raw))
  const dt = try Effect.try(() => DateTime.makeUnsafe("2026-01-01"))
  const ef = try Schema.decodeUnknownEffect(Schema.String)(raw)
  return [Option.isSome(o), d, s, mapped, decoded, dt, ef]
}

export function plainWrapped(raw: unknown) {
  const dec = Schema.decodeUnknownSync(Schema.String)
  try {
    return dec(raw)
  } catch {
    return "fallback"
  }
}`
		program, file, _, _ := editorProgram(t, source)
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("unexpected error: %s", diagnosticWithNotes(d))
			}
		}
	})

	t.Run("dual-partial-application-vs-direct-and-returned-call", func(t *testing.T) {
		source := `export effect function duals(xs: ReadonlyArray<number>) {
  const half = Effect.Number.divideUnsafe(2)
  const get0 = Effect.Array.getUnsafe(0)
  const direct = Effect.Number.divideUnsafe(4, 2)
  const applied = half(4)
  const elem = get0(xs)
  return [direct, applied, elem]
}`
		program, file, _, _ := editorProgram(t, source)
		found := 0
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Category() == diagnostics.CategoryError && d.Code() == EK0403.Code {
				found++
			} else if d.Category() == diagnostics.CategoryError {
				t.Errorf("unexpected error: %s", diagnosticWithNotes(d))
			}
		}
		if found != 3 {
			t.Fatalf("got %d EK0403 errors; want 3 (direct, applied, elem; factory lines must stay clean)", found)
		}
	})

	t.Run("try-of-throwing-effect-unwrapper-still-reports-EK0403", func(t *testing.T) {
		source := `export effect function f(opt: Option.Option<Effect.Effect<number>>) {
  return try Option.getOrThrow(opt)
}`
		program, file, _, _ := editorProgram(t, source)
		found := 0
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Category() == diagnostics.CategoryError && d.Code() == EK0403.Code {
				found++
			} else if d.Category() == diagnostics.CategoryError {
				t.Errorf("unexpected error: %s", diagnosticWithNotes(d))
			}
		}
		if found != 1 {
			t.Fatalf("got %d EK0403 errors; want 1", found)
		}
	})

	t.Run("rethrows-array-map-curried-dual-throwing-callback", func(t *testing.T) {
		source := `export effect function f(xs: ReadonlyArray<number>) {
  return xs.map(Effect.Number.divideUnsafe(2))
}`
		program, file, _, _ := editorProgram(t, source)
		found := 0
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Category() == diagnostics.CategoryError && d.Code() == EK0403.Code {
				found++
			} else if d.Category() == diagnostics.CategoryError {
				t.Errorf("unexpected error: %s", diagnosticWithNotes(d))
			}
		}
		if found != 1 {
			t.Fatalf("got %d EK0403 errors; want 1", found)
		}
	})

	t.Run("rethrows-array-map-effect-throwing-callback", func(t *testing.T) {
		source := `import * as DateTime from "effect/DateTime"
export effect function f(xs: ReadonlyArray<string>) {
  return xs.map(DateTime.makeUnsafe)
}`
		program, file, _, _ := editorProgram(t, source)
		found := 0
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Category() == diagnostics.CategoryError && d.Code() == EK0403.Code {
				found++
			} else if d.Category() == diagnostics.CategoryError {
				t.Errorf("unexpected error: %s", diagnosticWithNotes(d))
			}
		}
		if found != 1 {
			t.Fatalf("got %d EK0403 errors; want 1", found)
		}
	})

	t.Run("unlisted-pinned-export-throws-unknown", func(t *testing.T) {
		files := map[string]string{
			"/node_modules/effect/package.json":     `{"name":"effect","version":"4.1.1","types":"index.d.ts"}`,
			"/node_modules/effect/index.d.ts":       `export * as Future from "./dist/Future"`,
			"/node_modules/effect/dist/Future.d.ts": `export declare function newExport(x: string): number`,
			"/main.vibe":                            `import { Future } from "effect"; export effect function main() { return Future.newExport("x") }`,
			"/tsconfig.json":                        `{"compilerOptions":{"strict":true},"files":["main.vibe"]}`,
		}
		fsys := bundled.WrapFS(vfstest.FromMap(fixtureRuntime(files), tspath.CaseSensitive))
		parsed, errs := tsoptions.GetParsedCommandLineOfConfigFile("/tsconfig.json", &core.CompilerOptions{}, nil, fsys, nil)
		if len(errs) != 0 || len(parsed.Errors) != 0 {
			t.Fatalf("config: %v / %v", errs, parsed.Errors)
		}
		p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fsys, bundled.LibPath(), nil, nil, nil)})
		found := 0
		for _, d := range p.GetSemanticDiagnostics(t.Context(), p.GetSourceFile("/main.vibe")) {
			if d.Code() == EK0403.Code {
				found++
			} else if d.Category() == diagnostics.CategoryError && d.Code() != EK1011.Code {
				t.Errorf("unexpected diagnostic: %v", d)
			}
		}
		if found != 1 {
			t.Fatalf("unlisted pinned export: got %d EK0403, want 1", found)
		}
	})
}

// FuzzEffectThrowsTable exercises table lookup and throws-spec parsing across
// real rows and arbitrary inputs, ensuring non-"never" rows never silently
// degrade to non-throwing and lookup never panics.
func FuzzEffectThrowsTable(f *testing.F) {
	for key, throws := range effectThrowsCurated {
		f.Add(key, throws)
	}
	f.Add("effect/dist/Option:some", "never")
	f.Add("effect/dist/Future:unlisted", "unknown")
	f.Add("", "")
	f.Fuzz(func(t *testing.T, key, spec string) {
		if throws, ok := effectThrowsOf(key); ok {
			if strings.TrimSpace(throws) == "" {
				t.Fatalf("table row %q has empty throws value", key)
			}
		}
		// Verify pure structural invariants on arbitrary spec strings with nil checker
		// for never/unknown/empty forms (class resolution requires a live checker).
		if spec == "never" || spec == "unknown" || spec == "" {
			failures, unknown := resolveEffectThrowsSpec(nil, nil, spec)
			if spec == "never" && (unknown || len(failures) != 0) {
				t.Fatalf("never spec resolved to (%v, %v)", failures, unknown)
			}
			if (spec == "unknown" || spec == "") && !unknown {
				t.Fatalf("%q spec failed to resolve as unknown", spec)
			}
		}
		// Also exercise AST declaration key generation for valid identifier names.
		if mod, member, ok := strings.Cut(key, ":"); ok && mod != "" {
			returned := strings.HasSuffix(member, "()")
			base := strings.TrimSuffix(member, "()")
			if token.IsIdentifier(base) {
				src := "export declare const " + base + ": () => number"
				want := mod + ":" + base
				if returned {
					src = "export declare const " + base + ": () => () => number"
					want += "()"
				}
				if pf := parseDeclarations("/probe.d.ts", src); len(pf.Diagnostics()) == 0 {
					var last *ast.Node
					var visit func(*ast.Node) bool
					visit = func(n *ast.Node) bool {
						if effectCallable(n) {
							last = n
						}
						return n.ForEachChild(visit)
					}
					pf.AsNode().ForEachChild(visit)
					if last != nil && effectTableKey(mod, last) != want {
						t.Fatalf("effectTableKey(%q) = %q, want %q", src, effectTableKey(mod, last), want)
					}
				}
			}
		}
	})
}

// effectDeclarationKeys returns the sorted keys of every callable declaration
// in the pinned packages' declaration files.
func effectDeclarationKeys(t *testing.T) []string {
	t.Helper()
	seen := map[string]bool{}
	for _, name := range effectPinnedPackages {
		// An install may link the package directory, as the merge queue's
		// shared dependency installs do; WalkDir does not follow a linked root.
		root, err := filepath.EvalSymlinks(effectPackageDir(name))
		if err != nil {
			t.Fatal(err)
		}
		err = filepath.WalkDir(root, func(file string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.IsDir() {
				if entry.Name() == "node_modules" {
					return filepath.SkipDir
				}
				return nil
			}
			if !strings.HasSuffix(file, ".d.ts") && !strings.HasSuffix(file, ".d.mts") && !strings.HasSuffix(file, ".d.cts") {
				return nil
			}
			relative, err := filepath.Rel(root, file)
			if err != nil {
				return err
			}
			text, err := os.ReadFile(file)
			if err != nil {
				return err
			}
			module := effectModuleName(name, filepath.ToSlash(relative))
			parsed := parseDeclarations("/"+module+".d.ts", string(text))
			var visit func(node *ast.Node) bool
			visit = func(node *ast.Node) bool {
				if effectCallable(node) {
					seen[effectTableKey(module, node)] = true
				}
				return node.ForEachChild(visit)
			}
			parsed.AsNode().ForEachChild(visit)
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	keys := make([]string, 0, len(seen))
	for key := range seen {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	return keys
}

// effectCallable reports whether node declares a signature a call, a new
// expression or a tagged template can resolve to.
func effectCallable(node *ast.Node) bool {
	switch node.Kind {
	case ast.KindFunctionDeclaration, ast.KindMethodSignature, ast.KindMethodDeclaration, ast.KindFunctionType,
		ast.KindConstructorType, ast.KindCallSignature, ast.KindConstructSignature, ast.KindConstructor:
		return true
	}
	return false
}
