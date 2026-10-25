# Poolhog

A connection-pool leak detector for Node.js, starting with Postgres (`pg`).

When a connection is held longer than you expect, poolhog logs **which code checked it out**: the full stack trace from the moment of checkout, and how long it has been held.

## Why this exists

One time, a connection pool at work got completely exhausted — every connection checked out, one query wasn't timing out, and the only fix in the moment was restarting RDS. Nobody could tell which piece of code was holding onto those connections.

The obvious fallback is Postgres's own `pg_stat_activity`, but it doesn't close that gap. It can't tell a leaked connection apart from a healthy idle one; both just show up as `idle`. And it shows you SQL text, not which line of your app issued it.

## Prior art

The idea of capturing a stack trace at checkout and reporting a connection that isn't returned is not new:

- **Java, HikariCP:** [`leakDetectionThreshold`](https://github.com/brettwooldridge/HikariCP) is the amount of time a connection can be out of the pool before a message is logged about a possible leak. It is off by default (`0`), and the lowest value that enables it is 2000 ms.
- **Java, c3p0:** [`debugUnreturnedConnectionStackTraces`](https://www.mchange.com/projects/c3p0/) captures a stack trace at every checkout and logs it when a connection outlives `unreturnedConnectionTimeout`, "revealing where a Connection was checked out that was not checked in promptly". Unlike poolhog, c3p0 destroys the timed-out connection, and its docs say the debug option is for debugging only because capturing the trace slows checkout.
- **Python, SQLAlchemy:** [`AssertionPool`](https://github.com/sqlalchemy/sqlalchemy/blob/main/lib/sqlalchemy/pool/impl.py) records a traceback of the current checkout and includes it in the error when a second connection is requested. That is a debugging aid for "only one connection at a time", not a time-based leak detector.

What I couldn't find is something reusable for Node. `node-postgres` has no built-in equivalent, and one search of npm and the web turned up no package that does this (not an exhaustive search).

The need keeps coming up. Two examples:

- [Metabase #47981](https://github.com/metabase/metabase/issues/47981) (opened September 2024, closed November 2024) asked for c3p0's `debugUnreturnedConnectionStackTraces` to be added to the product so the team could investigate ongoing connection pool problems.
- [httpcore #508](https://github.com/encode/httpcore/issues/508) (opened February 2022, closed June 2025) asked for connection-pool debug logs and tracing: requests waiting for connections, active connections, and connection open/close statistics.

Poolhog exists because this keeps getting reinvented ecosystem by ecosystem and nothing composable is available for Node. It is not a claim that nothing like this has ever existed.

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

**There is no default threshold, on purpose.** "How long is too long" depends heavily on your workload — a reporting service running long analytical queries has a very different normal than a request-handling API, and a guessed default means false positives. A monitor that cries wolf gets turned off. Not calling `attachPoolHog` is how detection stays off, the same way HikariCP's `leakDetectionThreshold` defaults to off.

## What a report looks like

When a connection has been held past the threshold, poolhog calls `logger.warn` once for that checkout (illustrative output; your paths and function names will differ):

```
message: "Resource leak detected: connection held for 10002ms"
meta:    { heldForMs: 10002, stack: "Error\n    at ... \n    at loadDashboard (/app/src/dashboard.js:42:25)\n    ..." }
```

The first one or two frames of the stack are poolhog's and `pg-pool`'s own; the frames below them show the code that asked for the connection (`loadDashboard` above). That is the point: the report names your code, not just "a connection is busy".

Poolhog does not put an app or service name in the report. Your logger almost certainly already adds one (for example a Pino or Winston child logger), and guessing it a second time could only disagree with it.

A few details:

- The report is emitted once per checkout. If the connection is released later, that release still cleans up normally.
- A connection that is released before the threshold produces nothing.
- Poolhog only reports. It does not close or kill the connection.

## What it covers

| Way of getting a connection             | Tracked? |
| --------------------------------------- | -------- |
| `await pool.connect()`                  | yes      |
| `pool.connect((err, client, done) => ...)` | yes   |
| `pool.query(...)`                       | yes      |
| `new pg.Client(...)` outside a pool     | no       |

`pool.query()` matters most. It checks a client out and releases it for you, so you never hold a reference — but a query that never finishes still holds a connection the whole time. Poolhog reports those too, with the line that called `pool.query`.

### Adding a note to one checkout

If a connection is expected to be held for a long time (a batch job, say), you can attach a note that shows up in the report if it does get reported:

```js
const client = await pool.connect();
client.poolhogNote('nightly export, expected to run long');
```

The note appears as `message` in the report's `meta`. Calling it on a connection that has already been released is silently ignored. In TypeScript the method isn't in `PoolClient`'s type yet, so you'll need a cast for now.

## Limitations

- **Postgres via `pg` only.** Other drivers are not supported yet.
- **Report only.** There is no UI or dashboard, and poolhog cannot close a leaked connection. If you need a fleet-wide view, ship the logs somewhere central, as you probably already do.
- **One threshold per pool.** You can't override it for a single checkout yet.
- **The stack is the call site of the checkout.** It tells you who asked for the connection. It does not follow the connection through later `await` boundaries to decide who is "logically" responsible for it at the moment you read the report.
- **Compatibility is lightly tested.** Poolhog is developed and tested against `pg` 8.23.1 (and checked by hand against a real Postgres 16). The peer range is `^8.0.0`, but older 8.x releases have not been tested.
- **Cost.** Each checkout captures one `Error` stack and starts one unref'd timer, so poolhog never keeps your process alive on its own. I haven't measured the overhead.

## How it works

Poolhog replaces `connect` on the pool you pass in, and wraps each client's `release`. At checkout it records the stack and the time, and starts a timer for the threshold. Releasing the client cancels the timer and forgets the checkout. If the timer fires first, the checkout is reported. The pool's `remove` event is used only as a cleanup safety net.

The core (a registry, a per-checkout timer, a reporter) knows nothing about `pg`; the `pg`-specific part is one small adapter file. That keeps a second driver, or a Go port, a mechanical addition rather than a rewrite.

## Status

Pre-release (0.0.1). The `pg` adapter is built and tested, and has been run against a real Postgres. Not yet on npm. Possible later, once the core has proven itself: a live UI, a global patch (no per-pool setup), per-checkout thresholds, other drivers (e.g. MySQL) and a Go port. None of these are scheduled.

## Development

```sh
npm install
npm test        # Jest (use `npx tsc --noEmit` too, Jest doesn't type-check)
npm run build   # compiles src/ to dist/
```

## License

MIT
