import { Pool, PoolClient } from 'pg';
import { PoolhogOptions } from './types.js';
import { createRegistry } from './registry.js';
import { createLeakTimer } from './timer.js';
import { createReporter } from './reporter.js';

export function attachPoolHog(pool: Pool, options: PoolhogOptions): Pool {
    const registry = createRegistry();
    const reporter = createReporter(options.logger);

    const timer = createLeakTimer(options.threshold, (client) => {
        const entry = registry.get(client);
        if (!entry) return;

        reporter.report(entry, Date.now() - entry.checkoutTime);
    });

    const finishClient = (client: PoolClient) => {
        timer.cancel(client);
        registry.untrack(client);
    };

    pool.on('remove', finishClient);

    const originalConnect = pool.connect.bind(pool);

    const setupTrackedClient = (client: PoolClient, stack: string) => {
        registry.track(client, {
            stack,
            checkoutTime: Date.now(),
        });
        timer.schedule(client);

        client.poolhogNote = (message: string) => {
            const activeEntry = registry.get(client);
            if (activeEntry) {
                activeEntry.message = message;
            }
        };

        const originalRelease = client.release;
        client.release = function (...releaseArgs: Parameters<typeof originalRelease>) {
            finishClient(client);
            return originalRelease.apply(client, releaseArgs);
        };

        return client;
    };

    const wrappedConnect = function (...args: any[]) {
        const lastArg = args[args.length - 1];
        const target = {};
        Error.captureStackTrace(target, wrappedConnect);
        const stack = (target as { stack?: string }).stack ?? '';

        if (typeof lastArg === 'function') {
            const userCallback = lastArg;
            args[args.length - 1] = (err: any, client?: PoolClient, done?: Function) => {
                if (err || !client) {
                    return userCallback(err, client, done);
                }

                setupTrackedClient(client, stack);

                const wrappedDone = done
                    ? (...doneArgs: any[]) => {
                          finishClient(client);
                          return done(...doneArgs);
                      }
                    : client.release.bind(client);

                return userCallback(err, client, wrappedDone);
            };

            return (originalConnect as Function)(...args);
        }

        return (originalConnect as () => Promise<PoolClient>)().then((client) => {
            return setupTrackedClient(client, stack);
        });
    };

    pool.connect = wrappedConnect as typeof pool.connect;

    return pool;
}