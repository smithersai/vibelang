/**
 * Composing platform capabilities through a Layer.
 *
 *   bun examples/platform/demo.ts
 *
 * The same two functions run twice: once against the deterministic TestPlatform
 * and once against live Node services (with the network stubbed, so the demo
 * makes no outbound request). Neither function names an implementation and
 * neither takes a context argument — `Service.context()` resolves whatever the
 * enclosing `Layer.provide` supplied.
 */

import * as os from "node:os";
import * as path from "node:path";
import { Layer } from "../../src/runtime/layer.ts";
import { __vsInspectResult, __vsResultFailure, __vsResultSuccess, type Result } from "../../src/runtime/result.ts";
import {
  Clock,
  Config,
  type ConfigError,
  Console,
  Duration,
  Environment,
  type FileError,
  FileSystem,
  HttpClient,
  type HttpError,
  Instant,
  Path,
  type PlatformLayer,
  Process,
  Random,
  Schedule,
  Socket,
  type SocketConnection,
  type SocketError,
  StubHttpClient,
  Terminal,
  type TerminalError,
  TestPlatform,
  TestSleeper,
  nodePlatform,
} from "../../src/platform/index.ts";

const FEED_URL = "https://api.example.test/reports/latest";

interface ReportHeader {
  readonly startedAt: string;
  readonly region: string;
  readonly runId: string;
}

/** Requirements inferred from the calls: Clock, Environment, Random, Console. */
function beginReport(): ReportHeader {
  const clock = Clock.context();
  const environment = Environment.context();
  const random = Random.context();
  const console = Console.context();

  const header: ReportHeader = {
    startedAt: new Date(clock.now()).toISOString(),
    region: environment.get("REGION").unwrapOr("unknown"),
    runId: [...random.bytes(6)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
  };
  console.info(`run ${header.runId} started in ${header.region}`);
  return header;
}

/**
 * Configuration specs are built once, at module scope, with no capability in
 * sight: describing what the program needs is pure. Only `Config.read` touches
 * the Environment, and the same is true of time — `Duration` arithmetic is pure,
 * reading the clock is not.
 */
const RUN_SETTINGS = {
  region: Config.string("REGION").withDefault("unknown"),
  timeout: Config.duration("REQUEST_TIMEOUT").withDefault(Duration.seconds(30)),
  retries: Config.number("MAX_RETRIES").withDefault(2),
};

interface RunPlan {
  readonly region: string;
  readonly timeout: string;
  readonly startedAt: string;
  readonly deadline: string;
}

/** Requirements inferred from the calls: Environment (via Config) and Clock. */
function planRun(): Result<RunPlan, ConfigError> {
  const clock = Clock.context();
  return Config.readAll(RUN_SETTINGS).map((settings) => {
    const startedAt = clock.instant();
    // Pure Instant/Duration arithmetic: one attempt plus its retries.
    const budget = settings.timeout.times(settings.retries + 1);
    return {
      region: settings.region,
      timeout: settings.timeout.toString(),
      startedAt: Instant.format(startedAt),
      deadline: Instant.format(Instant.plus(startedAt, budget)),
    };
  });
}

/**
 * Requirements: HttpClient, FileSystem, Console. Every capability is resolved
 * before the first `await` because a base Layer keeps its environment only for
 * the synchronous body on hosts without an exact Promise settlement hook.
 */
function fetchAndArchive(
  header: ReportHeader,
  destination: string,
): Promise<Result<number, HttpError | FileError>> {
  const http = HttpClient.context();
  const files = FileSystem.context();
  const console = Console.context();

  return (async () => {
    const fetched = __vsInspectResult(await http.get(FEED_URL));
    if (!fetched.ok) {
      console.error(`fetch failed: ${fetched.error.message}`);
      return __vsResultFailure(fetched.error);
    }
    const parsed = __vsInspectResult(fetched.value.json());
    if (!parsed.ok) {
      console.error(`feed was not JSON: ${parsed.error.message}`);
      return __vsResultFailure(parsed.error);
    }
    const archive = JSON.stringify({ header, status: fetched.value.status, feed: parsed.value }, null, 2);
    const written = __vsInspectResult(await files.writeText(destination, archive));
    if (!written.ok) {
      console.error(`archive failed: ${written.error.message}`);
      return __vsResultFailure(written.error);
    }
    console.info(`archived ${archive.length} bytes to ${destination}`);
    return (await files.readText(destination)).map((text) => text.length);
  })();
}

/**
 * `Layer.provide` fails closed on an async body where Promise settlement cannot
 * be observed synchronously (Bun today). The scope therefore stays synchronous:
 * the body starts the work and the Promise settles outside it.
 */
function provideStarted<T>(layer: PlatformLayer, body: () => Promise<T>): Promise<T> {
  return Layer.provide(layer, () => ({ pending: body() })).pending;
}

function feedRoute(): StubHttpClient {
  return StubHttpClient.make().route("GET", FEED_URL, {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ open: 3, closed: 41 }),
  });
}

async function deterministicRun(): Promise<unknown> {
  const platform = TestPlatform.make({
    now: "2026-08-20T12:00:00Z",
    seed: 20_260_820,
    environment: { REGION: "eu-west-1", REQUEST_TIMEOUT: "45s", MAX_RETRIES: "3" },
    files: { "/archive/.keep": "" },
  });
  platform.http.route("GET", FEED_URL, {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ open: 3, closed: 41 }),
  });

  const header = Layer.provide(platform.layer, beginReport);
  const plan = Layer.provide(platform.layer, planRun);
  const archived = await provideStarted(platform.layer, () => fetchAndArchive(header, "/archive/report.json"));

  return {
    header,
    plan: plan.match({ ok: (value) => value, error: (error) => error.message }),
    archivedBytes: archived.unwrapOr(-1),
    requests: platform.http.requests.map((request) => `${request.method} ${request.url}`),
    files: platform.fileSystem.paths(),
    console: platform.console.entries,
  };
}

async function liveRun(): Promise<unknown> {
  const directory = path.join(os.tmpdir(), `vibelang-platform-demo-${Date.now()}`);
  // Live filesystem, clock, randomness and environment; the network stays stubbed
  // so the demo stays offline and reproducible.
  const layer = nodePlatform({ http: feedRoute() });
  const destination = path.join(directory, "report.json");

  const header = Layer.provide(layer, beginReport);
  const prepared = await provideStarted(layer, async () => FileSystem.context().mkdir(directory, { recursive: true }));
  prepared.unwrap();
  const archived = await provideStarted(layer, () => fetchAndArchive(header, destination));
  const cleaned = await provideStarted(layer, async () =>
    FileSystem.context().remove(directory, { recursive: true }));
  cleaned.unwrap();

  return {
    header: { ...header, startedAt: "<live clock>", runId: `<${header.runId.length} hex chars>` },
    archivedBytes: archived.unwrapOr(-1),
    destination: `<tmp>/${path.basename(destination)}`,
  };
}

/**
 * A retry policy is an ordinary value, built the same way a `ConfigSpec` is:
 * at module scope, with no capability in sight. Only *running* it under
 * `Schedule.retry` needs a Clock, something to sleep with, and — because this
 * one jitters — Random.
 */
const FLAKY_UPSTREAM = Schedule.exponential(Duration.millis(250))
  .withMaxDelay(Duration.seconds(2))
  .jittered()
  .and(Schedule.recurs(5));

/**
 * The deterministic bundle plus a `TestSleeper`: the TestClock sees the whole
 * backoff go by while the demo finishes instantly and touches no host timer.
 */
async function retryRun(): Promise<unknown> {
  const platform = TestPlatform.make({ now: "2026-08-20T12:00:00Z", seed: 20_260_820 });
  const sleeper = TestSleeper.make({ clock: platform.clock });
  let attempts = 0;

  const settled = await provideStarted(platform.layer, () =>
    Schedule.retry(FLAKY_UPSTREAM, (): Result<string, Error> => {
      attempts += 1;
      return attempts < 4
        ? __vsResultFailure(new Error("upstream unavailable"))
        : __vsResultSuccess(`recovered on attempt ${attempts}`);
    }, { sleeper }));

  return {
    policy: FLAKY_UPSTREAM.toString(),
    // Pure: the delays the policy describes, before any jitter is drawn.
    planned: FLAKY_UPSTREAM.preview(5).map(String),
    // What the driver actually waited, jitter and all — reproducible from the seed.
    waited: sleeper.sleeps.map(String),
    attempts,
    elapsed: Duration.millis(platform.clock.monotonic()).toString(),
    outcome: settled.unwrapOr("gave up"),
  };
}

/**
 * `Path` is pure: joining and normalizing need no capability at all, so this
 * runs at module scope, outside every Layer.
 */
const ARCHIVE_LAYOUT = {
  reports: Path.join("archive", "reports"),
  latest: Path.normalize("archive/reports/../reports/./latest.json"),
  extension: Path.extname("latest.json"),
};

interface Answer {
  readonly who: string;
  readonly destination: string;
}

/**
 * Requirements: Terminal and Process (the latter through `Path.forHost()`, the
 * one path helper that consults the host). Reading a line can fail — the input
 * can end — so it returns a Result; writing to the terminal cannot.
 */
function askWhoFor(): Promise<Result<Answer, TerminalError>> {
  const terminal = Terminal.context();
  const runningProcess = Process.context();
  const host = Path.forHost();
  const argv = runningProcess.argv();

  return (async () => {
    const answered = __vsInspectResult(await terminal.readLine("who is this report for? "));
    if (!answered.ok) return __vsResultFailure(answered.error);
    // Host-shaped resolution: the style and the working directory both come
    // from `Process`, so this is reproducible under the test bundle.
    const destination = host.resolve(argv[argv.length - 1] ?? "report.json");
    terminal.write(`writing ${destination}\n`);
    return __vsResultSuccess({ who: answered.value, destination });
  })();
}

/**
 * Requirements: Socket. A full connect / write / read / end-of-file round trip.
 * The same code runs against real loopback and against the in-memory double,
 * which accepts during `connect` and so needs no waiting at all.
 */
function echoOnce(message: string): Promise<Result<string, SocketError>> {
  const socket = Socket.context();

  return (async () => {
    let accepted: SocketConnection | undefined;
    let announce: ((connection: SocketConnection) => void) | undefined;
    const acceptedSoon = new Promise<SocketConnection>((resolve) => {
      announce = resolve;
    });
    const listening = __vsInspectResult(await socket.listen(0, (connection) => {
      accepted = connection;
      announce?.(connection);
    }));
    if (!listening.ok) return __vsResultFailure(listening.error);
    const listener = listening.value;

    const connected = __vsInspectResult(await socket.connect(listener.address().host, listener.address().port));
    if (!connected.ok) {
      await listener.close();
      return __vsResultFailure(connected.error);
    }
    const client = connected.value;
    // The double has already accepted; a live host accepts a turn later.
    const server = accepted ?? await acceptedSoon;

    const sent = __vsInspectResult(await client.write(new TextEncoder().encode(message)));
    if (!sent.ok) return __vsResultFailure(sent.error);
    const received = __vsInspectResult(await server.read());
    if (!received.ok) return __vsResultFailure(received.error);
    const bytes = received.value.unwrapOr(new Uint8Array(0));
    const echoed = __vsInspectResult(await server.write(bytes));
    if (!echoed.ok) return __vsResultFailure(echoed.error);

    const back = __vsInspectResult(await client.read());
    if (!back.ok) return __vsResultFailure(back.error);
    await server.close();
    // The peer closed cleanly, so the next read is an absent value, not an error.
    const eof = __vsInspectResult(await client.read());
    const ended = eof.ok && eof.value.isNone();

    await client.close();
    await listener.close();
    return __vsResultSuccess(
      `${new TextDecoder().decode(back.value.unwrapOr(new Uint8Array(0)))}${ended ? " (clean EOF)" : ""}`,
    );
  })();
}

/** The four newest services, all deterministic: no host, no terminal, no port. */
async function servicesRun(): Promise<unknown> {
  const platform = TestPlatform.make({
    argv: ["/usr/bin/vibe", "report.vibe", "archive/reports/latest.json"],
    cwd: "/srv/app",
    pid: 4242,
    platform: "linux",
    input: ["ada"],
    tty: true,
    terminalSize: { columns: 100, rows: 30 },
  });

  const answer = await provideStarted(platform.layer, askWhoFor);
  const echoed = await provideStarted(platform.layer, () => echoOnce("ping"));

  return {
    layout: ARCHIVE_LAYOUT,
    answer: answer.match({ ok: (value) => value, error: (error) => error.message }),
    prompts: platform.terminal.prompts,
    transcript: platform.terminal.text(),
    size: platform.terminal.size().unwrapOr({ columns: 0, rows: 0 }),
    pid: platform.process.pid(),
    echoed: echoed.unwrapOr((error) => error.message),
    // Every port the double handed out has been released.
    boundAfterwards: platform.socket.bound(),
  };
}

/** The same socket exchange over real loopback, on an ephemeral port. */
async function loopbackRun(): Promise<unknown> {
  const layer = nodePlatform({ http: feedRoute() });
  const echoed = await provideStarted(layer, () => echoOnce("ping over 127.0.0.1"));
  return { echoed: echoed.unwrapOr((error) => `${error.name}: ${error.message}`) };
}

console.log(JSON.stringify(
  {
    deterministic: await deterministicRun(),
    retries: await retryRun(),
    services: await servicesRun(),
    live: await liveRun(),
    loopback: await loopbackRun(),
  },
  null,
  2,
));
