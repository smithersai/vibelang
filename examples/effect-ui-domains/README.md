# Effect UI Domains (VibeLang)

A full-stack domain search app built with `@effect/ui`, `@effect/ui-kit`, `@effect/ui-devtools`, and Effect `HttpApi`, ported from [`Effect-TS/ui/examples/domains`](https://github.com/Effect-TS/ui/tree/main/examples/domains).

## What it shows

- `schema` (`DomainName`, `DomainRange`, `DomainSearch`, `AvailabilityFilter`, `SortOrder`, `AppModel`) and `schema error SearchUnavailable`
- Shared `HttpApi` (`DomainsApi`) served by `HttpApiBuilder` (`DomainsApiLive`) and consumed by `HttpApiClient`
- `service Domains` + `Layer.effect` (`DomainsHttpLive`) and `Layer.succeed` (`DomainsSampleLive`)
- `Query.Service` (`SearchDomains`) wired into `Html.component` with debounced queries and `Command.make` retry invalidation
- `@effect/ui-kit` headless primitives (`Button`, `Dialog`, `Select`) and exhaustive `match` over `data SearchState` and `Domain`
- Side-by-side Effect TS parity module in [`ts/Domains.ts`](ts/Domains.ts), verified by the same Vitest suite alongside `Story` and `HtmlScene` tests

## Run

```sh
bun install
bun run dev
```

## Check, test, and build

```sh
bun run test
```
