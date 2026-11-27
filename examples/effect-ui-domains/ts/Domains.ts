// Side-by-side Effect TypeScript equivalent of VibeLang's Domain schema,
// SearchUnavailable tagged error, Domains service, DomainsApi, and SearchDomains query.
import { Query } from "@effect/ui"
import { Context, Effect, Layer, Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api"
import { Domain, DomainSearch, searchSample } from "../src/domain/Domain.vibe"

export class TsSearchUnavailable
  extends Schema.TaggedError<TsSearchUnavailable>()("SearchUnavailable", {})
{}

export class TsDomainsApi extends HttpApi.make("domains").add(
  HttpApiGroup.make("domains").add(
    HttpApiEndpoint.get("search", "/api/domains", {
      query: DomainSearch.fields,
      success: Schema.Array(Domain),
      error: TsSearchUnavailable.pipe(HttpApiSchema.status(503))
    })
  )
) {}

export class TsDomains extends Context.Service<TsDomains, {
  search(
    search: DomainSearch
  ): Effect.Effect<ReadonlyArray<Domain>, TsSearchUnavailable>
}>()("domains/TsDomains") {
  static readonly layerSample = Layer.succeed(TsDomains)(
    TsDomains.of({ search: (search) => Effect.sync(() => searchSample(search)) })
  )
}

export class TsSearchDomains extends Query.Service<TsSearchDomains>()(
  "domains/TsSearchDomains",
  {
    args: DomainSearch.fields,
    success: Schema.Array(Domain),
    error: TsSearchUnavailable,
    staleTime: "5 minutes"
  }
) {
  static readonly layer = this.toLayer(
    TsDomains.useSync((domains) => domains.search)
  )
}
