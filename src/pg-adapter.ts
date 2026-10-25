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

    pool.on('remove', (client: PoolClient) => {
        timer.cancel(client);
        registry.untrack(client);
    });

    const originalConnect = pool.connect.bind(pool);

    const setupTrackedClient = (client: PoolClient, stack: string) => {
        const enhancedClient = client as PoolClient & { poolhogNote?: (msg: string) => void };

        registry.track(enhancedClient, {
            stack,
            checkoutTime: Date.now(),
        });
        timer.schedule(enhancedClient);

        enhancedClient.poolhogNote = (message: string) => {
            const activeEntry = registry.get(enhancedClient);
            if (activeEntry) {
                activeEntry.message = message;
            }
        };

        const originalRelease = enhancedClient.release;
        enhancedClient.release = function (...releaseArgs: Parameters<typeof originalRelease>) {
            timer.cancel(enhancedClient);
            registry.untrack(enhancedClient);
            return originalRelease.apply(enhancedClient, releaseArgs);
        };

        return enhancedClient;
    };

    pool.connect = ((...args: any[]) => {
        const lastArg = args[args.length - 1];
        const stack = new Error().stack ?? '';

        if (typeof lastArg === 'function') {
            const userCallback = lastArg;
            args[args.length - 1] = (err: any, client?: PoolClient, done?: Function) => {
                if (err || !client) {
                    return userCallback(err, client, done);
                }

                setupTrackedClient(client, stack);

                const wrappedDone = done
                    ? (...doneArgs: any[]) => {
                          timer.cancel(client);
                          registry.untrack(client);
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
    }) as typeof pool.connect;

    return pool;
}