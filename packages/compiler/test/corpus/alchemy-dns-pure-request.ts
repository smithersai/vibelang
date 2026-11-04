import * as HttpClientRequest from "effect/http/HttpClientRequest"
export const make = (name: string, value: string) =>
  HttpClientRequest.get("https://dns.example").pipe(
    HttpClientRequest.setUrlParams({ name, type: "TXT", value }),
    HttpClientRequest.setHeader("Accept", "application/dns-json"),
  )
