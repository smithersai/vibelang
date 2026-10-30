package vibelang

// The modules of effect's subpath packages (design decision D310). Every
// module that a subpath package of effect lists in its index, such as
// HttpRouter from effect/http, ChildProcess from effect/process, and
// TestClock from effect/testing, is in scope in a .vibe file without an
// import, under its module name, as effect's root modules are (D146). The
// tiebreaks, in order:
//
//  1. An ECMAScript global of the same name wins in that meaning (VIP-14,
//     isBuiltinGlobal). Platform values such as Headers name Effect's module;
//     ambient global types keep their own meanings.
//  2. A root and subpath module sharing a name require an explicit import.
//  3. The same holds for two subpaths: effectSubpathShared names every
//     exporter, and EK1401 offers an import from each (VIP-14, detail 55).
//  4. A local declaration or an import shadows the name, as it does any
//     prelude name.
//
// A file that may use one resolves the module's package, such as
// effect/http, as an implicit import, and the checker resolves the name to
// that package's export. The emitted JavaScript imports the module itself
// (import * as HttpRouter from "effect/http/HttpRouter"), and a declaration
// file imports it from its package (import type { HttpRouter } from
// "effect/http").
//
// The tables are generated from effect@4.1.0's package.json exports and
// each subpath's dist/<subpath>/index.d.ts, the version VibeLang pins (D1);
// Regenerate with node scripts/generate-effect-subpaths.mjs --write.
// TestEffectSubpathNamesMatchEffect checks them against the installed
// package. Files below a module's own directory, such as
// effect/schema/SchemaJITCompiler/enable, are parts of that module, which no
// index lists, and are not in scope.

// effectSubpathExport is where a subpath module comes from: the package
// that lists it, which the program resolves, and the module the emitted
// JavaScript imports it from.
type effectSubpathExport struct {
	barrel string
	module string
}

// isEffectExportName reports whether name is an effect root export or a
// subpath module in scope (D146, D310).
func isEffectExportName(name string) bool {
	if len(effectSubpathShared[name]) > 0 {
		return false
	}
	if _, ok := effectRootNames[name]; ok {
		return true
	}
	_, ok := effectSubpathNames[name]
	return ok
}

// effectSubpathNames are the subpath modules in scope, by name.

var effectSubpathNames = map[string]effectSubpathExport{
	"Activity":                     {barrel: "effect/workflow", module: "effect/workflow/Activity"},
	"AddressResolver":              {barrel: "effect/net", module: "effect/net/AddressResolver"},
	"Aead":                         {barrel: "effect/crypto", module: "effect/crypto/Aead"},
	"AiError":                      {barrel: "effect/ai", module: "effect/ai/AiError"},
	"AnthropicStructuredOutput":    {barrel: "effect/ai", module: "effect/ai/AnthropicStructuredOutput"},
	"Argument":                     {barrel: "effect/cli", module: "effect/cli/Argument"},
	"AsyncResult":                  {barrel: "effect/reactivity", module: "effect/reactivity/AsyncResult"},
	"Atom":                         {barrel: "effect/reactivity", module: "effect/reactivity/Atom"},
	"AtomHttpApi":                  {barrel: "effect/reactivity", module: "effect/reactivity/AtomHttpApi"},
	"AtomRef":                      {barrel: "effect/reactivity", module: "effect/reactivity/AtomRef"},
	"AtomRegistry":                 {barrel: "effect/reactivity", module: "effect/reactivity/AtomRegistry"},
	"AtomRpc":                      {barrel: "effect/reactivity", module: "effect/reactivity/AtomRpc"},
	"Base64":                       {barrel: "effect/encoding", module: "effect/encoding/Base64"},
	"Base64Url":                    {barrel: "effect/encoding", module: "effect/encoding/Base64Url"},
	"Chat":                         {barrel: "effect/ai", module: "effect/ai/Chat"},
	"ChildProcess":                 {barrel: "effect/process", module: "effect/process/ChildProcess"},
	"ChildProcessSpawner":          {barrel: "effect/process", module: "effect/process/ChildProcessSpawner"},
	"Cipher":                       {barrel: "effect/crypto", module: "effect/crypto/Cipher"},
	"CircuitBreaker":               {barrel: "effect/persistence", module: "effect/persistence/CircuitBreaker"},
	"CliConfig":                    {barrel: "effect/cli", module: "effect/cli/CliConfig"},
	"CliError":                     {barrel: "effect/cli", module: "effect/cli/CliError"},
	"CliOutput":                    {barrel: "effect/cli", module: "effect/cli/CliOutput"},
	"ClusterCron":                  {barrel: "effect/cluster", module: "effect/cluster/ClusterCron"},
	"ClusterError":                 {barrel: "effect/cluster", module: "effect/cluster/ClusterError"},
	"ClusterMetrics":               {barrel: "effect/cluster", module: "effect/cluster/ClusterMetrics"},
	"ClusterSchema":                {barrel: "effect/cluster", module: "effect/cluster/ClusterSchema"},
	"ClusterWorkflowEngine":        {barrel: "effect/cluster", module: "effect/cluster/ClusterWorkflowEngine"},
	"Command":                      {barrel: "effect/cli", module: "effect/cli/Command"},
	"CommandLine":                  {barrel: "effect/process", module: "effect/process/CommandLine"},
	"Completions":                  {barrel: "effect/cli", module: "effect/cli/Completions"},
	"Cookies":                      {barrel: "effect/http", module: "effect/http/Cookies"},
	"CryptoError":                  {barrel: "effect/crypto", module: "effect/crypto/CryptoError"},
	"Csv":                          {barrel: "effect/encoding", module: "effect/encoding/Csv"},
	"DatagramSocket":               {barrel: "effect/socket", module: "effect/socket/DatagramSocket"},
	"Decision":                     {barrel: "effect/ai", module: "effect/ai/Decision"},
	"DecisionModel":                {barrel: "effect/ai", module: "effect/ai/DecisionModel"},
	"DeliverAt":                    {barrel: "effect/cluster", module: "effect/cluster/DeliverAt"},
	"DevTools":                     {barrel: "effect/devtools", module: "effect/devtools/DevTools"},
	"DevToolsClient":               {barrel: "effect/devtools", module: "effect/devtools/DevToolsClient"},
	"DevToolsSchema":               {barrel: "effect/devtools", module: "effect/devtools/DevToolsSchema"},
	"DevToolsServer":               {barrel: "effect/devtools", module: "effect/devtools/DevToolsServer"},
	"Digest":                       {barrel: "effect/crypto", module: "effect/crypto/Digest"},
	"Dns":                          {barrel: "effect/net", module: "effect/net/Dns"},
	"DurableClock":                 {barrel: "effect/workflow", module: "effect/workflow/DurableClock"},
	"DurableDeferred":              {barrel: "effect/workflow", module: "effect/workflow/DurableDeferred"},
	"DurableQueue":                 {barrel: "effect/workflow", module: "effect/workflow/DurableQueue"},
	"EmbeddingModel":               {barrel: "effect/ai", module: "effect/ai/EmbeddingModel"},
	"EncodingError":                {barrel: "effect/encoding", module: "effect/encoding/EncodingError"},
	"Entity":                       {barrel: "effect/cluster", module: "effect/cluster/Entity"},
	"EntityAddress":                {barrel: "effect/cluster", module: "effect/cluster/EntityAddress"},
	"EntityId":                     {barrel: "effect/cluster", module: "effect/cluster/EntityId"},
	"EntityProxy":                  {barrel: "effect/cluster", module: "effect/cluster/EntityProxy"},
	"EntityProxyServer":            {barrel: "effect/cluster", module: "effect/cluster/EntityProxyServer"},
	"EntityResource":               {barrel: "effect/cluster", module: "effect/cluster/EntityResource"},
	"EntityType":                   {barrel: "effect/cluster", module: "effect/cluster/EntityType"},
	"Envelope":                     {barrel: "effect/cluster", module: "effect/cluster/Envelope"},
	"Etag":                         {barrel: "effect/http", module: "effect/http/Etag"},
	"Event":                        {barrel: "effect/eventlog", module: "effect/eventlog/Event"},
	"EventGroup":                   {barrel: "effect/eventlog", module: "effect/eventlog/EventGroup"},
	"EventJournal":                 {barrel: "effect/eventlog", module: "effect/eventlog/EventJournal"},
	"EventLog":                     {barrel: "effect/eventlog", module: "effect/eventlog/EventLog"},
	"EventLogEncryption":           {barrel: "effect/eventlog", module: "effect/eventlog/EventLogEncryption"},
	"EventLogMessage":              {barrel: "effect/eventlog", module: "effect/eventlog/EventLogMessage"},
	"EventLogRemote":               {barrel: "effect/eventlog", module: "effect/eventlog/EventLogRemote"},
	"EventLogServer":               {barrel: "effect/eventlog", module: "effect/eventlog/EventLogServer"},
	"EventLogServerEncrypted":      {barrel: "effect/eventlog", module: "effect/eventlog/EventLogServerEncrypted"},
	"EventLogServerUnencrypted":    {barrel: "effect/eventlog", module: "effect/eventlog/EventLogServerUnencrypted"},
	"EventLogSessionAuth":          {barrel: "effect/eventlog", module: "effect/eventlog/EventLogSessionAuth"},
	"EventRow":                     {barrel: "effect/eventlog", module: "effect/eventlog/EventRow"},
	"FetchHttpClient":              {barrel: "effect/http", module: "effect/http/FetchHttpClient"},
	"FindMyWay":                    {barrel: "effect/http", module: "effect/http/FindMyWay"},
	"Flag":                         {barrel: "effect/cli", module: "effect/cli/Flag"},
	"GlobalFlag":                   {barrel: "effect/cli", module: "effect/cli/GlobalFlag"},
	"GraphQL":                      {barrel: "effect/graphql", module: "effect/graphql/GraphQL"},
	"GraphQLClient":                {barrel: "effect/graphql", module: "effect/graphql/GraphQLClient"},
	"GraphQLClientError":           {barrel: "effect/graphql", module: "effect/graphql/GraphQLClientError"},
	"GraphQLGroup":                 {barrel: "effect/graphql", module: "effect/graphql/GraphQLGroup"},
	"GraphQLMiddleware":            {barrel: "effect/graphql", module: "effect/graphql/GraphQLMiddleware"},
	"GraphQLProtocol":              {barrel: "effect/graphql", module: "effect/graphql/GraphQLProtocol"},
	"GraphQLResolver":              {barrel: "effect/graphql", module: "effect/graphql/GraphQLResolver"},
	"Headers":                      {barrel: "effect/http", module: "effect/http/Headers"},
	"HelpDoc":                      {barrel: "effect/cli", module: "effect/cli/HelpDoc"},
	"Hex":                          {barrel: "effect/encoding", module: "effect/encoding/Hex"},
	"Host":                         {barrel: "effect/net", module: "effect/net/Host"},
	"HttpApi":                      {barrel: "effect/http-api", module: "effect/http-api/HttpApi"},
	"HttpApiBuilder":               {barrel: "effect/http-api", module: "effect/http-api/HttpApiBuilder"},
	"HttpApiClient":                {barrel: "effect/http-api", module: "effect/http-api/HttpApiClient"},
	"HttpApiEndpoint":              {barrel: "effect/http-api", module: "effect/http-api/HttpApiEndpoint"},
	"HttpApiError":                 {barrel: "effect/http-api", module: "effect/http-api/HttpApiError"},
	"HttpApiGroup":                 {barrel: "effect/http-api", module: "effect/http-api/HttpApiGroup"},
	"HttpApiMiddleware":            {barrel: "effect/http-api", module: "effect/http-api/HttpApiMiddleware"},
	"HttpApiScalar":                {barrel: "effect/http-api", module: "effect/http-api/HttpApiScalar"},
	"HttpApiSchema":                {barrel: "effect/http-api", module: "effect/http-api/HttpApiSchema"},
	"HttpApiSecurity":              {barrel: "effect/http-api", module: "effect/http-api/HttpApiSecurity"},
	"HttpApiSwagger":               {barrel: "effect/http-api", module: "effect/http-api/HttpApiSwagger"},
	"HttpApiTest":                  {barrel: "effect/http-api", module: "effect/http-api/HttpApiTest"},
	"HttpBody":                     {barrel: "effect/http", module: "effect/http/HttpBody"},
	"HttpClient":                   {barrel: "effect/http", module: "effect/http/HttpClient"},
	"HttpClientError":              {barrel: "effect/http", module: "effect/http/HttpClientError"},
	"HttpClientRequest":            {barrel: "effect/http", module: "effect/http/HttpClientRequest"},
	"HttpClientResponse":           {barrel: "effect/http", module: "effect/http/HttpClientResponse"},
	"HttpEffect":                   {barrel: "effect/http", module: "effect/http/HttpEffect"},
	"HttpIncomingMessage":          {barrel: "effect/http", module: "effect/http/HttpIncomingMessage"},
	"HttpMethod":                   {barrel: "effect/http", module: "effect/http/HttpMethod"},
	"HttpMiddleware":               {barrel: "effect/http", module: "effect/http/HttpMiddleware"},
	"HttpPlatform":                 {barrel: "effect/http", module: "effect/http/HttpPlatform"},
	"HttpRouter":                   {barrel: "effect/http", module: "effect/http/HttpRouter"},
	"HttpRunner":                   {barrel: "effect/cluster", module: "effect/cluster/HttpRunner"},
	"HttpServer":                   {barrel: "effect/http", module: "effect/http/HttpServer"},
	"HttpServerError":              {barrel: "effect/http", module: "effect/http/HttpServerError"},
	"HttpServerRequest":            {barrel: "effect/http", module: "effect/http/HttpServerRequest"},
	"HttpServerRespondable":        {barrel: "effect/http", module: "effect/http/HttpServerRespondable"},
	"HttpServerResponse":           {barrel: "effect/http", module: "effect/http/HttpServerResponse"},
	"HttpStaticServer":             {barrel: "effect/http", module: "effect/http/HttpStaticServer"},
	"HttpStatus":                   {barrel: "effect/http", module: "effect/http/HttpStatus"},
	"HttpTraceContext":             {barrel: "effect/http", module: "effect/http/HttpTraceContext"},
	"Hydration":                    {barrel: "effect/reactivity", module: "effect/reactivity/Hydration"},
	"IdGenerator":                  {barrel: "effect/ai", module: "effect/ai/IdGenerator"},
	"Ini":                          {barrel: "effect/encoding", module: "effect/encoding/Ini"},
	"IpInterface":                  {barrel: "effect/net", module: "effect/net/IpInterface"},
	"IpNetwork":                    {barrel: "effect/net", module: "effect/net/IpNetwork"},
	"JsonArray":                    {barrel: "effect/encoding", module: "effect/encoding/JsonArray"},
	"K8sHttpClient":                {barrel: "effect/cluster", module: "effect/cluster/K8sHttpClient"},
	"K8sTypes":                     {barrel: "effect/cluster", module: "effect/cluster/K8sTypes"},
	"Kdf":                          {barrel: "effect/crypto", module: "effect/crypto/Kdf"},
	"KeyAgreement":                 {barrel: "effect/crypto", module: "effect/crypto/KeyAgreement"},
	"KeyFormat":                    {barrel: "effect/crypto", module: "effect/crypto/KeyFormat"},
	"KeyValueStore":                {barrel: "effect/persistence", module: "effect/persistence/KeyValueStore"},
	"KeyWrap":                      {barrel: "effect/crypto", module: "effect/crypto/KeyWrap"},
	"LanguageModel":                {barrel: "effect/ai", module: "effect/ai/LanguageModel"},
	"Mac":                          {barrel: "effect/crypto", module: "effect/crypto/Mac"},
	"MachineId":                    {barrel: "effect/cluster", module: "effect/cluster/MachineId"},
	"McpClient":                    {barrel: "effect/ai", module: "effect/ai/McpClient"},
	"McpClientError":               {barrel: "effect/ai", module: "effect/ai/McpClientError"},
	"McpProtocol":                  {barrel: "effect/ai", module: "effect/ai/McpProtocol"},
	"McpSchema":                    {barrel: "effect/ai", module: "effect/ai/McpSchema"},
	"McpServer":                    {barrel: "effect/ai", module: "effect/ai/McpServer"},
	"McpTest":                      {barrel: "effect/ai", module: "effect/ai/McpTest"},
	"Message":                      {barrel: "effect/cluster", module: "effect/cluster/Message"},
	"MessageStorage":               {barrel: "effect/cluster", module: "effect/cluster/MessageStorage"},
	"Migrator":                     {barrel: "effect/sql", module: "effect/sql/Migrator"},
	"Mime":                         {barrel: "effect/http", module: "effect/http/Mime"},
	"Multipart":                    {barrel: "effect/http", module: "effect/http/Multipart"},
	"MultipartParser":              {barrel: "effect/http", module: "effect/http/MultipartParser"},
	"Ndjson":                       {barrel: "effect/encoding", module: "effect/encoding/Ndjson"},
	"NetAddress":                   {barrel: "effect/net", module: "effect/net/NetAddress"},
	"OpenAiStructuredOutput":       {barrel: "effect/ai", module: "effect/ai/OpenAiStructuredOutput"},
	"OpenApi":                      {barrel: "effect/http-api", module: "effect/http-api/OpenApi"},
	"Otlp":                         {barrel: "effect/observability", module: "effect/observability/Otlp"},
	"OtlpExporter":                 {barrel: "effect/observability", module: "effect/observability/OtlpExporter"},
	"OtlpLogger":                   {barrel: "effect/observability", module: "effect/observability/OtlpLogger"},
	"OtlpMetrics":                  {barrel: "effect/observability", module: "effect/observability/OtlpMetrics"},
	"OtlpProxy":                    {barrel: "effect/observability", module: "effect/observability/OtlpProxy"},
	"OtlpResource":                 {barrel: "effect/observability", module: "effect/observability/OtlpResource"},
	"OtlpSerialization":            {barrel: "effect/observability", module: "effect/observability/OtlpSerialization"},
	"OtlpTracer":                   {barrel: "effect/observability", module: "effect/observability/OtlpTracer"},
	"Param":                        {barrel: "effect/cli", module: "effect/cli/Param"},
	"Persistable":                  {barrel: "effect/persistence", module: "effect/persistence/Persistable"},
	"PersistedCache":               {barrel: "effect/persistence", module: "effect/persistence/PersistedCache"},
	"PersistedQueue":               {barrel: "effect/persistence", module: "effect/persistence/PersistedQueue"},
	"Persistence":                  {barrel: "effect/persistence", module: "effect/persistence/Persistence"},
	"Primitive":                    {barrel: "effect/cli", module: "effect/cli/Primitive"},
	"ProblemDetails":               {barrel: "effect/http", module: "effect/http/ProblemDetails"},
	"PrometheusMetrics":            {barrel: "effect/observability", module: "effect/observability/PrometheusMetrics"},
	"RateLimiter":                  {barrel: "effect/persistence", module: "effect/persistence/RateLimiter"},
	"Reactivity":                   {barrel: "effect/reactivity", module: "effect/reactivity/Reactivity"},
	"Redis":                        {barrel: "effect/persistence", module: "effect/persistence/Redis"},
	"Reply":                        {barrel: "effect/cluster", module: "effect/cluster/Reply"},
	"Response":                     {barrel: "effect/ai", module: "effect/ai/Response"},
	"ResponseIdTracker":            {barrel: "effect/ai", module: "effect/ai/ResponseIdTracker"},
	"Rpc":                          {barrel: "effect/rpc", module: "effect/rpc/Rpc"},
	"RpcClient":                    {barrel: "effect/rpc", module: "effect/rpc/RpcClient"},
	"RpcClientError":               {barrel: "effect/rpc", module: "effect/rpc/RpcClientError"},
	"RpcGroup":                     {barrel: "effect/rpc", module: "effect/rpc/RpcGroup"},
	"RpcMessage":                   {barrel: "effect/rpc", module: "effect/rpc/RpcMessage"},
	"RpcMiddleware":                {barrel: "effect/rpc", module: "effect/rpc/RpcMiddleware"},
	"RpcSchema":                    {barrel: "effect/rpc", module: "effect/rpc/RpcSchema"},
	"RpcSerialization":             {barrel: "effect/rpc", module: "effect/rpc/RpcSerialization"},
	"RpcServer":                    {barrel: "effect/rpc", module: "effect/rpc/RpcServer"},
	"RpcTest":                      {barrel: "effect/rpc", module: "effect/rpc/RpcTest"},
	"RpcWorker":                    {barrel: "effect/rpc", module: "effect/rpc/RpcWorker"},
	"Runner":                       {barrel: "effect/cluster", module: "effect/cluster/Runner"},
	"RunnerAddress":                {barrel: "effect/cluster", module: "effect/cluster/RunnerAddress"},
	"RunnerHealth":                 {barrel: "effect/cluster", module: "effect/cluster/RunnerHealth"},
	"RunnerServer":                 {barrel: "effect/cluster", module: "effect/cluster/RunnerServer"},
	"RunnerStorage":                {barrel: "effect/cluster", module: "effect/cluster/RunnerStorage"},
	"Runners":                      {barrel: "effect/cluster", module: "effect/cluster/Runners"},
	"SchemaAOTCompiler":            {barrel: "effect/schema", module: "effect/schema/SchemaAOTCompiler"},
	"SchemaBinary":                 {barrel: "effect/encoding", module: "effect/encoding/SchemaBinary"},
	"SchemaCompiler":               {barrel: "effect/schema", module: "effect/schema/SchemaCompiler"},
	"SchemaJITCompiler":            {barrel: "effect/schema", module: "effect/schema/SchemaJITCompiler"},
	"SecureRandom":                 {barrel: "effect/crypto", module: "effect/crypto/SecureRandom"},
	"ShardId":                      {barrel: "effect/cluster", module: "effect/cluster/ShardId"},
	"Sharding":                     {barrel: "effect/cluster", module: "effect/cluster/Sharding"},
	"ShardingConfig":               {barrel: "effect/cluster", module: "effect/cluster/ShardingConfig"},
	"ShardingRegistrationEvent":    {barrel: "effect/cluster", module: "effect/cluster/ShardingRegistrationEvent"},
	"Signature":                    {barrel: "effect/crypto", module: "effect/crypto/Signature"},
	"SingleRunner":                 {barrel: "effect/cluster", module: "effect/cluster/SingleRunner"},
	"Singleton":                    {barrel: "effect/cluster", module: "effect/cluster/Singleton"},
	"SingletonAddress":             {barrel: "effect/cluster", module: "effect/cluster/SingletonAddress"},
	"Snowflake":                    {barrel: "effect/cluster", module: "effect/cluster/Snowflake"},
	"Socket":                       {barrel: "effect/socket", module: "effect/socket/Socket"},
	"SocketRunner":                 {barrel: "effect/cluster", module: "effect/cluster/SocketRunner"},
	"SocketServer":                 {barrel: "effect/socket", module: "effect/socket/SocketServer"},
	"SqlClient":                    {barrel: "effect/sql", module: "effect/sql/SqlClient"},
	"SqlConnection":                {barrel: "effect/sql", module: "effect/sql/SqlConnection"},
	"SqlError":                     {barrel: "effect/sql", module: "effect/sql/SqlError"},
	"SqlEventJournal":              {barrel: "effect/eventlog", module: "effect/eventlog/SqlEventJournal"},
	"SqlEventLogServerEncrypted":   {barrel: "effect/eventlog", module: "effect/eventlog/SqlEventLogServerEncrypted"},
	"SqlEventLogServerUnencrypted": {barrel: "effect/eventlog", module: "effect/eventlog/SqlEventLogServerUnencrypted"},
	"SqlMessageStorage":            {barrel: "effect/cluster", module: "effect/cluster/SqlMessageStorage"},
	"SqlModel":                     {barrel: "effect/sql", module: "effect/sql/SqlModel"},
	"SqlResolver":                  {barrel: "effect/sql", module: "effect/sql/SqlResolver"},
	"SqlRunnerStorage":             {barrel: "effect/cluster", module: "effect/cluster/SqlRunnerStorage"},
	"SqlSchema":                    {barrel: "effect/sql", module: "effect/sql/SqlSchema"},
	"SqlStream":                    {barrel: "effect/sql", module: "effect/sql/SqlStream"},
	"Sse":                          {barrel: "effect/encoding", module: "effect/encoding/Sse"},
	"Statement":                    {barrel: "effect/sql", module: "effect/sql/Statement"},
	"Tar":                          {barrel: "effect/encoding", module: "effect/encoding/Tar"},
	"Telemetry":                    {barrel: "effect/ai", module: "effect/ai/Telemetry"},
	"Template":                     {barrel: "effect/http", module: "effect/http/Template"},
	"TerminalCapabilities":         {barrel: "effect/cli", module: "effect/cli/TerminalCapabilities"},
	"TestClock":                    {barrel: "effect/testing", module: "effect/testing/TestClock"},
	"TestConsole":                  {barrel: "effect/testing", module: "effect/testing/TestConsole"},
	"TestRunner":                   {barrel: "effect/cluster", module: "effect/cluster/TestRunner"},
	"TestSchema":                   {barrel: "effect/testing", module: "effect/testing/TestSchema"},
	"Tokenizer":                    {barrel: "effect/ai", module: "effect/ai/Tokenizer"},
	"Toml":                         {barrel: "effect/encoding", module: "effect/encoding/Toml"},
	"Tool":                         {barrel: "effect/ai", module: "effect/ai/Tool"},
	"Toolkit":                      {barrel: "effect/ai", module: "effect/ai/Toolkit"},
	"Transferable":                 {barrel: "effect/workers", module: "effect/workers/Transferable"},
	"Url":                          {barrel: "effect/http", module: "effect/http/Url"},
	"UrlParams":                    {barrel: "effect/http", module: "effect/http/UrlParams"},
	"UserDirectories":              {barrel: "effect/persistence", module: "effect/persistence/UserDirectories"},
	"VariantSchema":                {barrel: "effect/schema", module: "effect/schema/VariantSchema"},
	"WebCrypto":                    {barrel: "effect/crypto", module: "effect/crypto/WebCrypto"},
	"Worker":                       {barrel: "effect/workers", module: "effect/workers/Worker"},
	"WorkerError":                  {barrel: "effect/workers", module: "effect/workers/WorkerError"},
	"WorkerRunner":                 {barrel: "effect/workers", module: "effect/workers/WorkerRunner"},
	"Workflow":                     {barrel: "effect/workflow", module: "effect/workflow/Workflow"},
	"WorkflowEngine":               {barrel: "effect/workflow", module: "effect/workflow/WorkflowEngine"},
	"WorkflowProxy":                {barrel: "effect/workflow", module: "effect/workflow/WorkflowProxy"},
	"WorkflowProxyServer":          {barrel: "effect/workflow", module: "effect/workflow/WorkflowProxyServer"},
	"Xml":                          {barrel: "effect/encoding", module: "effect/encoding/Xml"},
	"Yaml":                         {barrel: "effect/encoding", module: "effect/encoding/Yaml"},
	"Zip":                          {barrel: "effect/encoding", module: "effect/encoding/Zip"},
}

// effectSubpathShared are names listed by multiple exporters, including
// the root: none is in scope without an import (rules 2 and 3).
var effectSubpathShared = map[string][]string{
	"Model":  {"effect/ai", "effect/schema"},
	"Prompt": {"effect/ai", "effect/cli"},
	"Utils":  {"effect", "effect/rpc"},
}
