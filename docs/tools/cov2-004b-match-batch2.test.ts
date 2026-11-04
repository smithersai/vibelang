// Assigned chapter 004 coverage obligations; pending is intentional.
// Conformance has not been verified: preserve the full required assertion for promotion.
import { test } from "bun:test"

// rule-evidence: docs/design/src/004-match.md#1e6c69af3231efda
// Chapter 004: retained Option.Some guard and extraction
test.todo("retained Option.Some guard and extraction — docs/design/src/004-match.md#1e6c69af3231efda — | `Option.Some` | `Option.isOption(s) && Option.isSome(s)` | `[s.value]` |")

// rule-evidence: docs/design/src/004-match.md#f58c9910d05787e9
// Chapter 004: retained Option.None guard and extraction
test.todo("retained Option.None guard and extraction — docs/design/src/004-match.md#f58c9910d05787e9 — | `Option.None` | `Option.isOption(s) && Option.isNone(s)` | `[]` |")

// rule-evidence: docs/design/src/004-match.md#404297d8eaf7ae93
// Chapter 004: retained Exit.Success guard and extraction
test.todo("retained Exit.Success guard and extraction — docs/design/src/004-match.md#404297d8eaf7ae93 — | `Exit.Success` | `Exit.isExit(s) && Exit.isSuccess(s)` | `[s.value]` |")

// rule-evidence: docs/design/src/004-match.md#f9a9e674c90e8fff
// Chapter 004: retained Exit.Failure guard and extraction
test.todo("retained Exit.Failure guard and extraction — docs/design/src/004-match.md#f9a9e674c90e8fff — | `Exit.Failure` | `Exit.isExit(s) && Exit.isFailure(s)` | `[s.cause]` |")

// rule-evidence: docs/design/src/004-match.md#9bfeee3be2fa86fa
// Chapter 004: retained Result.Success guard and extraction
test.todo("retained Result.Success guard and extraction — docs/design/src/004-match.md#9bfeee3be2fa86fa — | `Result.Success` | `Result.isResult(s) && Result.isSuccess(s)` | `[s.success]` |")

// rule-evidence: docs/design/src/004-match.md#d9c7341c78933092
// Chapter 004: retained Result.Failure guard and extraction
test.todo("retained Result.Failure guard and extraction — docs/design/src/004-match.md#d9c7341c78933092 — | `Result.Failure` | `Result.isResult(s) && Result.isFailure(s)` | `[s.failure]` |")

// rule-evidence: docs/design/src/004-match.md#d56c89529faeebcf
// Chapter 004: retained Cause.NoSuchElementError guard and extraction
test.todo("retained Cause.NoSuchElementError guard and extraction — docs/design/src/004-match.md#d56c89529faeebcf — | `Cause.NoSuchElementError` | `Cause.isNoSuchElementError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#5f2d32da2e456251
// Chapter 004: retained Cause.TimeoutError guard and extraction
test.todo("retained Cause.TimeoutError guard and extraction — docs/design/src/004-match.md#5f2d32da2e456251 — | `Cause.TimeoutError` | `Cause.isTimeoutError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#dedc7b68cebfe608
// Chapter 004: retained Cause.IllegalArgumentError guard and extraction
test.todo("retained Cause.IllegalArgumentError guard and extraction — docs/design/src/004-match.md#dedc7b68cebfe608 — | `Cause.IllegalArgumentError` | `Cause.isIllegalArgumentError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#703f7cd0efb51bd3
// Chapter 004: retained Cause.ExceededCapacityError guard and extraction
test.todo("retained Cause.ExceededCapacityError guard and extraction — docs/design/src/004-match.md#703f7cd0efb51bd3 — | `Cause.ExceededCapacityError` | `Cause.isExceededCapacityError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#833664c0b3d0786a
// Chapter 004: retained Cause.AsyncFiberError guard and extraction
test.todo("retained Cause.AsyncFiberError guard and extraction — docs/design/src/004-match.md#833664c0b3d0786a — | `Cause.AsyncFiberError` | `Cause.isAsyncFiberError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#665c95936d69c13d
// Chapter 004: retained Cause.UnknownError guard and extraction
test.todo("retained Cause.UnknownError guard and extraction — docs/design/src/004-match.md#665c95936d69c13d — | `Cause.UnknownError` | `Cause.isUnknownError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#c752df5c87cf5776
// Chapter 004: retained Schema.SchemaError guard and extraction
test.todo("retained Schema.SchemaError guard and extraction — docs/design/src/004-match.md#c752df5c87cf5776 — | `Schema.SchemaError` | `Schema.isSchemaError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#e48540007ba378ed
// Chapter 004: retained Cron.CronParseError guard and extraction
test.todo("retained Cron.CronParseError guard and extraction — docs/design/src/004-match.md#e48540007ba378ed — | `Cron.CronParseError` | `Cron.isCronParseError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#fdd13407f40df20a
// Chapter 004: retained PlatformError.PlatformError guard and extraction
test.todo("retained PlatformError.PlatformError guard and extraction — docs/design/src/004-match.md#fdd13407f40df20a — | `PlatformError.PlatformError` | `PlatformError.isPlatformError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#d61a302479592b51
// Chapter 004: retained SemVer.SemVerError guard and extraction
test.todo("retained SemVer.SemVerError guard and extraction — docs/design/src/004-match.md#d61a302479592b51 — | `SemVer.SemVerError` | `SemVer.isSemVerError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#ff01a0d5aca512eb
// Chapter 004: retained Terminal.QuitError guard and extraction
test.todo("retained Terminal.QuitError guard and extraction — docs/design/src/004-match.md#ff01a0d5aca512eb — | `Terminal.QuitError` | `Terminal.isQuitError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#d12d9f0dfbacc3f0
// Chapter 004: retained TextDiff.TextDiffError guard and extraction
test.todo("retained TextDiff.TextDiffError guard and extraction — docs/design/src/004-match.md#d12d9f0dfbacc3f0 — | `TextDiff.TextDiffError` | `TextDiff.isTextDiffError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#326be9b32a831230
// Chapter 004: retained AiError.AiError (effect/ai/AiError) guard and extraction
test.todo("retained AiError.AiError (effect/ai/AiError) guard and extraction — docs/design/src/004-match.md#326be9b32a831230 — | `AiError.AiError` (`effect/ai/AiError`) | `AiError.isAiError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#82a97e466cbe3d32
// Chapter 004: retained McpClientError.McpClientError (effect/ai/McpClientError) guard and extraction
test.todo("retained McpClientError.McpClientError (effect/ai/McpClientError) guard and extraction — docs/design/src/004-match.md#82a97e466cbe3d32 — | `McpClientError.McpClientError` (`effect/ai/McpClientError`) | `McpClientError.isMcpClientError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#d7d991ac41ec346c
// Chapter 004: retained CryptoError.CryptoError (effect/crypto/CryptoError) guard and extraction
test.todo("retained CryptoError.CryptoError (effect/crypto/CryptoError) guard and extraction — docs/design/src/004-match.md#d7d991ac41ec346c — | `CryptoError.CryptoError` (`effect/crypto/CryptoError`) | `CryptoError.isCryptoError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#969e430282790194
// Chapter 004: retained Csv.CsvError (effect/encoding/Csv) guard and extraction
test.todo("retained Csv.CsvError (effect/encoding/Csv) guard and extraction — docs/design/src/004-match.md#969e430282790194 — | `Csv.CsvError` (`effect/encoding/Csv`) | `Csv.isCsvError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#d5c02d958c2f348a
// Chapter 004: retained EncodingError.EncodingError (effect/encoding/EncodingError) guard and extraction
test.todo("retained EncodingError.EncodingError (effect/encoding/EncodingError) guard and extraction — docs/design/src/004-match.md#d5c02d958c2f348a — | `EncodingError.EncodingError` (`effect/encoding/EncodingError`) | `EncodingError.isEncodingError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#32abe6cadfafb16e
// Chapter 004: retained JsonArray.JsonArrayError (effect/encoding/JsonArray) guard and extraction
test.todo("retained JsonArray.JsonArrayError (effect/encoding/JsonArray) guard and extraction — docs/design/src/004-match.md#32abe6cadfafb16e — | `JsonArray.JsonArrayError` (`effect/encoding/JsonArray`) | `JsonArray.isJsonArrayError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#37f7876e47ce5608
// Chapter 004: retained Ndjson.NdjsonError (effect/encoding/Ndjson) guard and extraction
test.todo("retained Ndjson.NdjsonError (effect/encoding/Ndjson) guard and extraction — docs/design/src/004-match.md#37f7876e47ce5608 — | `Ndjson.NdjsonError` (`effect/encoding/Ndjson`) | `Ndjson.isNdjsonError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#9798b01a5338755d
// Chapter 004: retained Tar.TarError (effect/encoding/Tar) guard and extraction
test.todo("retained Tar.TarError (effect/encoding/Tar) guard and extraction — docs/design/src/004-match.md#9798b01a5338755d — | `Tar.TarError` (`effect/encoding/Tar`) | `Tar.isTarError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#de065f5bb62bacff
// Chapter 004: retained Xml.XmlError (effect/encoding/Xml) guard and extraction
test.todo("retained Xml.XmlError (effect/encoding/Xml) guard and extraction — docs/design/src/004-match.md#de065f5bb62bacff — | `Xml.XmlError` (`effect/encoding/Xml`) | `Xml.isXmlError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#86eef7470f96c69e
// Chapter 004: retained Zip.ZipError (effect/encoding/Zip) guard and extraction
test.todo("retained Zip.ZipError (effect/encoding/Zip) guard and extraction — docs/design/src/004-match.md#86eef7470f96c69e — | `Zip.ZipError` (`effect/encoding/Zip`) | `Zip.isZipError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#9d8549a753d948dc
// Chapter 004: retained GraphQLClientError.GraphQLClientError (effect/graphql/GraphQLClientError) guard and extraction
test.todo("retained GraphQLClientError.GraphQLClientError (effect/graphql/GraphQLClientError) guard and extraction — docs/design/src/004-match.md#9d8549a753d948dc — | `GraphQLClientError.GraphQLClientError` (`effect/graphql/GraphQLClientError`) | `GraphQLClientError.isGraphQLClientError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#57549eb6c3795c6d
// Chapter 004: retained Cookies.CookiesError (effect/http/Cookies) guard and extraction
test.todo("retained Cookies.CookiesError (effect/http/Cookies) guard and extraction — docs/design/src/004-match.md#57549eb6c3795c6d — | `Cookies.CookiesError` (`effect/http/Cookies`) | `Cookies.isCookiesError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#d324fc9041880dd0
// Chapter 004: retained Headers.HeaderParseError (effect/http/Headers) guard and extraction
test.todo("retained Headers.HeaderParseError (effect/http/Headers) guard and extraction — docs/design/src/004-match.md#d324fc9041880dd0 — | `Headers.HeaderParseError` (`effect/http/Headers`) | `Headers.isHeaderParseError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#88429853a3671c71
// Chapter 004: retained HttpBody.HttpBodyError (effect/http/HttpBody) guard and extraction
test.todo("retained HttpBody.HttpBodyError (effect/http/HttpBody) guard and extraction — docs/design/src/004-match.md#88429853a3671c71 — | `HttpBody.HttpBodyError` (`effect/http/HttpBody`) | `HttpBody.isHttpBodyError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#701c3eef95359c87
// Chapter 004: retained HttpClientError.HttpClientError (effect/http/HttpClientError) guard and extraction
test.todo("retained HttpClientError.HttpClientError (effect/http/HttpClientError) guard and extraction — docs/design/src/004-match.md#701c3eef95359c87 — | `HttpClientError.HttpClientError` (`effect/http/HttpClientError`) | `HttpClientError.isHttpClientError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#96409b4f9d3408bb
// Chapter 004: retained HttpServerError.HttpServerError (effect/http/HttpServerError) guard and extraction
test.todo("retained HttpServerError.HttpServerError (effect/http/HttpServerError) guard and extraction — docs/design/src/004-match.md#96409b4f9d3408bb — | `HttpServerError.HttpServerError` (`effect/http/HttpServerError`) | `HttpServerError.isHttpServerError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#b07eb34169f77266
// Chapter 004: retained Multipart.MultipartError (effect/http/Multipart) guard and extraction
test.todo("retained Multipart.MultipartError (effect/http/Multipart) guard and extraction — docs/design/src/004-match.md#b07eb34169f77266 — | `Multipart.MultipartError` (`effect/http/Multipart`) | `Multipart.isMultipartError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#361eb3f3bb314a42
// Chapter 004: retained DatagramSocket.DatagramSocketError (effect/socket/DatagramSocket) guard and extraction
test.todo("retained DatagramSocket.DatagramSocketError (effect/socket/DatagramSocket) guard and extraction — docs/design/src/004-match.md#361eb3f3bb314a42 — | `DatagramSocket.DatagramSocketError` (`effect/socket/DatagramSocket`) | `DatagramSocket.isDatagramSocketError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#45aed0f394fd2a97
// Chapter 004: retained Socket.SocketError (effect/socket/Socket) guard and extraction
test.todo("retained Socket.SocketError (effect/socket/Socket) guard and extraction — docs/design/src/004-match.md#45aed0f394fd2a97 — | `Socket.SocketError` (`effect/socket/Socket`) | `Socket.isSocketError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#f3f98c4f81288bd7
// Chapter 004: retained SqlError.SqlError (effect/sql/SqlError) guard and extraction
test.todo("retained SqlError.SqlError (effect/sql/SqlError) guard and extraction — docs/design/src/004-match.md#f3f98c4f81288bd7 — | `SqlError.SqlError` (`effect/sql/SqlError`) | `SqlError.isSqlError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#bea523589de8fac7
// Chapter 004: retained WorkerError.WorkerError (effect/workers/WorkerError) guard and extraction
test.todo("retained WorkerError.WorkerError (effect/workers/WorkerError) guard and extraction — docs/design/src/004-match.md#bea523589de8fac7 — | `WorkerError.WorkerError` (`effect/workers/WorkerError`) | `WorkerError.isWorkerError(s)` | `[s]` |")

// rule-evidence: docs/design/src/004-match.md#918177e53293ee32
// Chapter 004: retained guards cross-copy brand and tag-only rejection
test.todo("retained guards cross-copy brand and tag-only rejection — docs/design/src/004-match.md#918177e53293ee32 — The tagged-error guards recognize Effect's brands across installed copies and reject an unbranded object with only the same `_tag`.")

// rule-evidence: docs/design/src/004-match.md#32cbda75098e6070
// Chapter 004: unguarded constructors use ordinary class dispatch
test.todo("unguarded constructors use ordinary class dispatch — docs/design/src/004-match.md#32cbda75098e6070 — Every other constructor, including `Config.ConfigError` (no guard), `PlatformError.BadArgument` and `PlatformError.SystemError`, follows [Class patterns](#class-patterns): its own `Symbol.customMatcher` if present, otherwise `instanceof`.")
