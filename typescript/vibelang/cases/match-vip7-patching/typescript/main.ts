import * as Fixed0 from "effect/Cause"
import * as Fixed1 from "effect/Cause"
import * as Fixed2 from "effect/Cause"
import * as Fixed3 from "effect/Cause"
import * as Fixed4 from "effect/Cause"
import * as Fixed5 from "effect/Cause"
import * as Fixed6 from "effect/Schema"
import * as Fixed7 from "effect/Cron"
import * as Fixed8 from "effect/PlatformError"
import * as Fixed9 from "effect/SemVer"
import * as Fixed10 from "effect/Terminal"
import * as Fixed11 from "effect/TextDiff"
import * as Fixed12 from "effect/ai/AiError"
import * as Fixed13 from "effect/ai/McpClientError"
import * as Fixed14 from "effect/crypto/CryptoError"
import * as Fixed15 from "effect/encoding/Csv"
import * as Fixed16 from "effect/encoding/EncodingError"
import * as Fixed17 from "effect/encoding/JsonArray"
import * as Fixed18 from "effect/encoding/Ndjson"
import * as Fixed19 from "effect/encoding/Tar"
import * as Fixed20 from "effect/encoding/Xml"
import * as Fixed21 from "effect/encoding/Zip"
import * as Fixed22 from "effect/graphql/GraphQLClientError"
import * as Fixed23 from "effect/http/Cookies"
import * as Fixed24 from "effect/http/Headers"
import * as Fixed25 from "effect/http/HttpBody"
import * as Fixed26 from "effect/http/HttpClientError"
import * as Fixed27 from "effect/http/HttpServerError"
import * as Fixed28 from "effect/http/Multipart"
import * as Fixed29 from "effect/socket/DatagramSocket"
import * as Fixed30 from "effect/socket/Socket"
import * as Fixed31 from "effect/sql/SqlError"
import * as Fixed32 from "effect/workers/WorkerError"
import * as Predicate from "effect/Predicate"
import * as HttpClient from "effect/http/HttpClient"
import { Effect, Data, Schema, Cause, Config, PlatformError, Option, Exit, Result } from "effect"
import * as AiError from "effect/ai/AiError"
import * as SqlError from "effect/sql/SqlError"
import * as CliError from "effect/cli/CliError"
const customMatcher:unique symbol=Symbol.for("Symbol.customMatcher")
function fixedInvocations():readonly boolean[]{
 const errors=[Fixed0.isNoSuchElementError(null),Fixed1.isTimeoutError(null),Fixed2.isIllegalArgumentError(null),Fixed3.isExceededCapacityError(null),Fixed4.isAsyncFiberError(null),Fixed5.isUnknownError(null),Fixed6.isSchemaError(null),Fixed7.isCronParseError(null),Fixed8.isPlatformError(null),Fixed9.isSemVerError(null),Fixed10.isQuitError(null),Fixed11.isTextDiffError(null),Fixed12.isAiError(null),Fixed13.isMcpClientError(null),Fixed14.isCryptoError(null),Fixed15.isCsvError(null),Fixed16.isEncodingError(null),Fixed17.isJsonArrayError(null),Fixed18.isNdjsonError(null),Fixed19.isTarError(null),Fixed20.isXmlError(null),Fixed21.isZipError(null),Fixed22.isGraphQLClientError(null),Fixed23.isCookiesError(null),Fixed24.isHeaderParseError(null),Fixed25.isHttpBodyError(null),Fixed26.isHttpClientError(null),Fixed27.isHttpServerError(null),Fixed28.isMultipartError(null),Fixed29.isDatagramSocketError(null),Fixed30.isSocketError(null),Fixed31.isSqlError(null),Fixed32.isWorkerError(null)]
 const options=[Option.some(1),Option.none()].map(s=>Option.isSome(s)?s.value===1:true)
 const exits=[Exit.succeed(1),Exit.fail("x")].map(s=>Exit.isSuccess(s)?s.value===1:s.cause.reasons.length===1)
 const results=[Result.succeed(1),Result.fail("x")].map(s=>Result.isSuccess(s)?s.success===1:s.failure==="x")
 return [...errors,...options,...exits,...results]
}
export function patching():readonly boolean[] {
 const roots:object[]=[Function.prototype,Array,Date,Map,Set,Error,RegExp,WeakMap,WeakSet,Promise,Uint8Array,ArrayBuffer,AggregateError,Cause.TimeoutError,Fixed0.NoSuchElementError,Fixed1.TimeoutError,Fixed2.IllegalArgumentError,Fixed3.ExceededCapacityError,Fixed4.AsyncFiberError,Fixed5.UnknownError,Fixed6.SchemaError,Fixed7.CronParseError,Fixed8.PlatformError,Fixed9.SemVerError,Fixed10.QuitError,Fixed11.TextDiffError,Fixed12.AiError,Fixed13.McpClientError,Fixed14.CryptoError,Fixed15.CsvError,Fixed16.EncodingError,Fixed17.JsonArrayError,Fixed18.NdjsonError,Fixed19.TarError,Fixed20.XmlError,Fixed21.ZipError,Fixed22.GraphQLClientError,Fixed23.CookiesError,Fixed24.HeaderParseError,Fixed25.HttpBodyError,Fixed26.HttpClientError,Fixed27.HttpServerError,Fixed28.MultipartError,Fixed29.DatagramSocketError,Fixed30.SocketError,Fixed31.SqlError,Fixed32.WorkerError]
 return [...roots.map(x=>Object.hasOwn(x,customMatcher)),Object.hasOwn(Option,"Some"),Object.hasOwn(Option,"None"),Object.hasOwn(Exit,"Success"),Object.hasOwn(Exit,"Failure"),Object.hasOwn(Result,"Success"),Object.hasOwn(Result,"Failure")]
}
class Plain {}
function constructed():readonly boolean[]{return [Object.create(Plain.prototype),new Plain(),{}].map(s=>s instanceof Plain)}
function predicates(s:unknown):readonly boolean[]{return [Predicate.isError(s),CliError.isCliError(s),HttpClient.isTransientError(s)]}
export function localOption(s:unknown):number {const Option={Some:(x:unknown):x is number=>typeof x==="number"};return Option.Some(s)?1:0}
export function ordinary(s:unknown):readonly boolean[] {return [s instanceof Config.ConfigError,s instanceof PlatformError.BadArgument,s instanceof PlatformError.SystemError,s instanceof AiError.RateLimitError,s instanceof SqlError.ConnectionError,s instanceof CliError.UnrecognizedOption,s instanceof CliError.DuplicateOption,s instanceof CliError.MissingOption,s instanceof CliError.MissingArgument,s instanceof CliError.UnexpectedArgument,s instanceof CliError.InvalidValue,s instanceof CliError.UnknownSubcommand,s instanceof CliError.ValidationError,s instanceof CliError.UserError,s instanceof CliError.ShowHelp]}
export function main():Effect.Effect<readonly unknown[]> {return Effect.sync(()=>[fixedInvocations(),patching(),constructed(),[new Error("x"),null,{}, {_tag:"TimeoutError","~effect/Cause/TimeoutError":"~effect/Cause/TimeoutError"}].map(predicates),localOption(2),localOption("x"),[Config.ConfigError,PlatformError.BadArgument,PlatformError.SystemError,AiError.RateLimitError,SqlError.ConnectionError,CliError.UnrecognizedOption,CliError.DuplicateOption,CliError.MissingOption,CliError.MissingArgument,CliError.UnexpectedArgument,CliError.InvalidValue,CliError.UnknownSubcommand,CliError.ValidationError,CliError.UserError,CliError.ShowHelp].flatMap(C=>[Object.create(C.prototype),{_tag:C.name},null]).map(ordinary)])}
