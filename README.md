# Poolhog

A connection-pool leak detector for Node.js, starting with Postgres (`pg`).

## Why this exists

One time, a connection pool at work got completely exhausted — every connection checked out, one query wasn't timing out, and the only fix in the moment was restarting RDS. Nobody could tell which piece of code was holding onto those connections.

The obvious fallback is Postgres's own `pg_stat_activity`, but it doesn't close that gap. It can't tell a leaked connection apart from a healthy idle one; both just show up as `idle`. And it shows you SQL text, not which line of your app issued it.

Java's had a real answer to this for years: HikariCP's `leakDetectionThreshold`, c3p0's `debugUnreturnedConnectionStackTraces`. Nothing reusable exists for Node, and the same need keeps getting reinvented per ecosystem: an open Rails issue asking how to track where a connection was acquired, an open httpcore issue asking for pool visibility, a 2026 Metabase issue asking to bolt c3p0's old feature onto their own pool.

Node makes this harder than it looks, too. Wrapping the checkout call is the easy part. Correctly figuring out who is logically responsible for a connection across `await` boundaries is the real problem, and it's still unsolved for Node.

## What it does

Poolhog wraps `pg`'s `Pool` checkout and checkin. When a connection is held past a threshold, it logs the file, line, and function that checked it out, not just the fact that a connection is busy.

v1 is detection and reporting only. No dashboard. That's how HikariCP works, and it's enough on its own: most production setups already ship logs somewhere centralized, so a leak is visible across every instance without poolhog needing to run its own service. A live UI can come later, once the core mechanism is proven.

## Status

Just started. Nothing built yet. Problem and scope are settled; `pg` instrumentation is next.
