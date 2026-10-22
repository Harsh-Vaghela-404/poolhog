import { Pool, PoolClient } from 'pg';
import { PoolhogOptions } from './types.js';
import { createRegistry } from './registry.js';
import { createLeakTimer } from './timer.js';
import { createReporter } from './reporter.js';

export function attachPoolHog(pool: Pool, options: PoolhogOptions): Pool {
    let hasWarnedCallbackUsage = false;
    const registry = createRegistry();
    const reporter = createReporter(options.logger);
    const logger = options.logger ?? console;

    const timer = createLeakTimer(options.threshold, (client) => {
        const entry = registry.get(client);
        if (!entry) return;

        reporter.report(entry, Date.now() - entry.checkoutTime);
    });

    const originalConnect = pool.connect.bind(pool);

    pool.connect = (async (...args: any[]) => {
        const lastArg = args[args.length - 1];

        if (typeof lastArg === 'function') {
            if (!hasWarnedCallbackUsage) {
                logger.warn(
                    'Poolhog warning: Callback-based pool.connect(cb) is not tracked for resource leaks. Use Promise/async-await style.',
                );
                hasWarnedCallbackUsage = true;
            }
            return (originalConnect as (cb: Function) => void)(lastArg);
        }

        const stack = new Error().stack ?? '';
        const client: PoolClient = await (originalConnect as () => Promise<PoolClient>)();

        registry.track(client, { stack, checkoutTime: Date.now() });
        timer.schedule(client);

        const originalRelease = client.release;
        client.release = function (...releaseArgs: Parameters<typeof originalRelease>) {
            timer.cancel(client);
            registry.untrack(client);
            return originalRelease.apply(client, releaseArgs);
        };

        return client;
    }) as typeof pool.connect;

    return pool;
}
