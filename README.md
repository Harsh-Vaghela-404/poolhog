# Poolhog

A connection-pool leak detector for Node.js, starting with Postgres (`pg`).

When a connection is held longer than you expect, poolhog logs the full stack trace from the moment it was checked out, and how long it has been held.

## Why this exists

One time, a connection pool at work got completely exhausted. Every connection was checked out and one query wasn't timing out. Killing that query by its backend pid clears the pool, but nobody could tell which piece of code had issued it.

Postgres's own `pg_stat_activity` is where you get that pid, and it doesn't close the gap. It can't tell a leaked connection apart from a healthy idle one; both just show up as `idle`. And it shows you SQL text, not which line of your app issued it.

## Install

Poolhog is not published to npm yet. Once it is:

```sh
npm install poolhog
```

It needs `pg` (8.x) already installed; `pg` is a peer dependency, so poolhog never ships its own copy. If you use TypeScript you also need `@types/pg`. Poolhog is ESM-only.

Until then, clone the repo and build it:

```sh
git clone https://github.com/Harsh-Vaghela-404/poolhog.git
cd poolhog
npm install
npm run build
```

## Usage

Poolhog patches the one pool you hand it. Nothing else in your process is touched.

```js
import pg from 'pg';
import { attachPoolHog } from 'poolhog';

const pool = new pg.Pool({ /* your config */ });

attachPoolHog(pool, {
    threshold: 10_000, // milliseconds a connection may be held before it's reported
});
```

Options:

| Option      | Required | What it does                                                                                     |
| ----------- | -------- | ------------------------------------------------------------------------------------------------ |
| `threshold` | yes      | Milliseconds a connection may be held before it is reported. There is no default (see below).   |
| `logger`    | no       | Any object with a `warn(message, meta)` method (Winston, Pino, `console`, ...). Defaults to `console`. |

**There is no default threshold, on purpose.** "How long is too long" depends heavily on your workload (a reporting service running long analytical queries has a very different normal than a request-handling API), and a guessed default means false positives. A monitor that cries wolf gets turned off. Not calling `attachPoolHog` is how detection stays off, the same way HikariCP's `leakDetectionThreshold` defaults to off.

## What a report looks like

When a connection has been held past the threshold, poolhog calls `logger.warn` once for that checkout (illustrative output; your paths and function names will differ):

```
message: "Resource leak detected: connection held for 10002ms"
meta:    { heldForMs: 10002, stack: "Error\n    at ... \n    at loadDashboard (/app/src/dashboard.js:42:25)\n    ..." }
```

The first one or two frames of the stack are poolhog's and `pg-pool`'s own. The frames below them show the code that asked for the connection (`loadDashboard` above).

Poolhog does not put an app or service name in the report. Your logger usually adds one already (a Pino or Winston child logger, for example), so poolhog doesn't guess it.

The report is emitted once per checkout. A release after that still cleans up normally, and a connection released before the threshold produces nothing. Poolhog only reports; it never closes or kills the connection.

## What it covers

| Way of getting a connection             | Tracked? |
| --------------------------------------- | -------- |
| `await pool.connect()`                  | yes      |
| `pool.connect((err, client, done) => ...)` | yes   |
| `pool.query(...)`                       | yes      |
| `new pg.Client(...)` outside a pool     | no       |

`pool.query()` checks a client out and releases it for you, so you never hold a reference. A query that never finishes still holds a connection the whole time, and poolhog reports it with the line that called `pool.query`.

### Adding a note to one checkout

If a connection is expected to be held for a long time (a batch job, say), attach a note. It appears in the report if the connection does get reported:

```js
const client = await pool.connect();
client.poolhogNote('nightly export, expected to run long');
```

The note appears as `message` in the report's `meta`. Calling it on a connection that has already been released is silently ignored.

In TypeScript, importing poolhog adds an optional `poolhogNote` method to `pg`'s `PoolClient` type, so `client.poolhogNote?.('...')` type-checks without a cast. The method is optional because the type can't know which pool a client came from. A client from a pool you never attached poolhog to doesn't have it.

## Limitations

- **Postgres via `pg` only.** Other drivers are not supported yet.
- **Report only.** There is no UI or dashboard, and poolhog cannot close a leaked connection. For a fleet-wide view, send the logs to your central log store.
- **One threshold per pool.** You can't override it for a single checkout yet.
- **The stack is the call site of the checkout.** It tells you who asked for the connection. It does not follow the connection through later `await` boundaries to decide who is "logically" responsible for it at the moment you read the report.
- **Compatibility is lightly tested.** Poolhog is developed and tested against `pg` 8.23.1 (and checked by hand against a real Postgres 16). The peer range is `^8.0.0`, but older 8.x releases have not been tested.
- **Cost.** Each checkout captures one `Error` stack and starts one unref'd timer, so poolhog never keeps your process alive on its own. I haven't measured the overhead.

## Prior art

The idea of capturing a stack trace at checkout and reporting a connection that isn't returned is not new:

- **Java, HikariCP:** [`leakDetectionThreshold`](https://github.com/brettwooldridge/HikariCP) is the amount of time a connection can be out of the pool before a message is logged about a possible leak. It is off by default (`0`), and the lowest value that enables it is 2000 ms.
- **Java, c3p0:** [`debugUnreturnedConnectionStackTraces`](https://www.mchange.com/projects/c3p0/) captures a stack trace at every checkout and logs it when a connection outlives `unreturnedConnectionTimeout`, "revealing where a Connection was checked out that was not checked in promptly". Unlike poolhog, c3p0 destroys the timed-out connection, and its docs say the debug option is for debugging only because capturing the trace slows checkout.
- **Python, SQLAlchemy:** [`AssertionPool`](https://github.com/sqlalchemy/sqlalchemy/blob/main/lib/sqlalchemy/pool/impl.py) records a traceback of the current checkout and includes it in the error when a second connection is requested. It is a debugging aid for "only one connection at a time" and has no time threshold.

I found nothing reusable for Node. `node-postgres` has no built-in equivalent, and one search of npm and the web turned up no package that does this.

Requests for this keep showing up. Two examples:

- [Metabase #47981](https://github.com/metabase/metabase/issues/47981) (opened September 2024, closed November 2024) asked for c3p0's `debugUnreturnedConnectionStackTraces` to be added to the product so the team could investigate ongoing connection pool problems.
- [httpcore #508](https://github.com/encode/httpcore/issues/508) (opened February 2022, closed June 2025) asked for connection-pool debug logs and tracing: requests waiting for connections, active connections, and connection open/close statistics.

Poolhog exists because the same need keeps getting reinvented per ecosystem, and I found nothing composable for Node.

## How it works

Poolhog replaces `connect` on the pool you pass in, and wraps each client's `release`. At checkout it records the stack and the time, and starts a timer for the threshold. Releasing the client cancels the timer and forgets the checkout. If the timer fires first, the checkout is reported. The pool's `remove` event is used only as a cleanup safety net.

The core (a registry, a per-checkout timer, a reporter) knows nothing about `pg`; the `pg`-specific part is one small adapter file. A second driver or a Go port should be mostly mechanical.

## Status

Pre-release (0.0.1). The `pg` adapter is built and tested, and has been run against a real Postgres. Not yet on npm. Possible later, once the core has proven itself: a live UI, a global patch (no per-pool setup), per-checkout thresholds, other drivers (e.g. MySQL) and a Go port. None of these are scheduled.

## Development

```sh
npm install
npm test        # type-checks src/ and tests/, then runs Jest
npm run build   # compiles src/ to dist/
```

## License

MIT
