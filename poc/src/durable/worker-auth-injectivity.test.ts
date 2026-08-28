import { expect, test } from "bun:test"
import {
  generateWorkerTransportSecret,
  signWorkerHttpMessage,
  verifyWorkerHttpMessage
} from "./worker-protocol.ts"

/**
 * The worker transport MAC covers a NEWLINE-JOINED message, and two of its six
 * fields are supplied by the caller verbatim and sit next to each other.
 *
 * A join with a separator a component can contain is not injective, and here
 * the consequence is not a cosmetic name clash: a signature over one
 * (method, path) pair authorizes a different one. This is the only site in the
 * sweep where the collision is an authentication bypass rather than a wrong
 * artifact, which is why it is fixed by REFUSAL — an escape would change the
 * bytes and so change every MAC, leaving a coordinator at one revision unable
 * to talk to a worker at another.
 *
 * Nothing legitimate is refused: RFC 9110 forbids a newline in both a method
 * token and a request target, so a message this rejects could not have crossed
 * an HTTP connection.
 */

const SECRET = generateWorkerTransportSecret()
const BODY = new TextEncoder().encode("{}")
const NOW = 1_700_000_000_000

test("a signature does not carry across the method/path boundary", () => {
  // MEASURED on the shipped code, not inferred. With a 64-`a` secret and
  // timestamp 1700000000000, these two split points both signed
  // "v1.1700000000000.84d371650430f09f3ba1053be7d5542383e6d43f8201d636bfdc053b75844bc0"
  // — byte for byte the same header for two different requests, because both
  // join to "…\\nGET\\n/SMITHERS/WORKER/V1/INVOKE\\n\\n<body>".
  //
  // The pair has to be uppercase, and that is worth writing down rather than
  // leaving as a puzzle for the next reader: `method.toUpperCase()` is applied
  // before the join, so the path text that migrates into the method position
  // survives the move only if it is already upper-case. The fold NARROWS the
  // reachable collisions; it does not remove them, and a request target of
  // upper-case ASCII is an ordinary thing.
  const sign = (method: string, path: string) => () =>
    signWorkerHttpMessage(SECRET, { role: "request", method, path, bodyBytes: BODY, timestampMs: NOW })

  expect(sign("GET\n/SMITHERS/WORKER/V1/INVOKE", ""))
    .toThrow("worker auth method and path cannot contain the field separator")
  expect(sign("GET", "/SMITHERS/WORKER/V1/INVOKE\n"))
    .toThrow("worker auth method and path cannot contain the field separator")

  // Both spellings of the ambiguity are gone, so no header exists that names
  // either. A message that IS signable cannot be re-split, because a re-split
  // of an unambiguous message needs a newline that is no longer there.
  const honest = signWorkerHttpMessage(SECRET, {
    role: "request",
    method: "GET",
    path: "/a/b",
    bodyBytes: BODY,
    timestampMs: NOW
  })
  expect(
    verifyWorkerHttpMessage(SECRET, honest, {
      role: "request",
      method: "GET/a",
      path: "b",
      bodyBytes: BODY,
      nowMs: NOW
    })
  ).toBe(false)
})

test("verification fails closed on a hostile method rather than throwing", () => {
  const header = signWorkerHttpMessage(SECRET, {
    role: "request",
    method: "GET",
    path: "/invoke",
    bodyBytes: BODY,
    timestampMs: NOW
  })
  expect(
    verifyWorkerHttpMessage(SECRET, header, {
      role: "request",
      method: "GET\ninjected",
      path: "/invoke",
      bodyBytes: BODY,
      nowMs: NOW
    })
  ).toBe(false)
})

test("an ordinary message still signs and verifies unchanged", () => {
  for (const [method, path] of [["GET", "/health"], ["POST", "/invoke?x=1&y=2"], ["M-SEARCH", "/a/b"]]) {
    const header = signWorkerHttpMessage(SECRET, {
      role: "request",
      method,
      path,
      bodyBytes: BODY,
      timestampMs: NOW
    })
    expect(
      verifyWorkerHttpMessage(SECRET, header, { role: "request", method, path, bodyBytes: BODY, nowMs: NOW })
    ).toBe(true)
    // The case fold is deliberate and is part of the accepted domain: HTTP
    // methods are case-insensitive, so `get` and `GET` name one request.
    expect(
      verifyWorkerHttpMessage(SECRET, header, {
        role: "request",
        method: method.toLowerCase(),
        path,
        bodyBytes: BODY,
        nowMs: NOW
      })
    ).toBe(true)
  }
})
