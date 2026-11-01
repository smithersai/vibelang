// A Worker runtime's own declaration of the Fetch Response, as
// @cloudflare/workers-types writes it, with no DOM lib.
interface Response {
  readonly status: number
}
declare var Response: {
  prototype: Response
  new (body?: string | null): Response
  json(data: unknown): Response
}
