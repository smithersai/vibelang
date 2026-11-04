package vibelangfuzz

// The existing Chapter 7 migration oracle also covers the DNS module's pure
// dual transforms, arrays of cold programs and provider construction order.
func init() {
	migrationPipeStagePrograms = append(migrationPipeStagePrograms, struct{ key, source string }{"alchemy-dns-pure-request", `import * as HttpClientRequest from "effect/http/HttpClientRequest"
export const make = (name: string, value: string) =>
  HttpClientRequest.get("https://dns.example").pipe(
    HttpClientRequest.setUrlParams({ name, type: "TXT", value }),
    HttpClientRequest.setHeader("Accept", "application/dns-json"),
  )
export const main = () => Effect.succeed(make("example.org", "value").urlParams)
`})
}
