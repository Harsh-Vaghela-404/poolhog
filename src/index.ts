import { attachPoolHog } from './pg-adapter.js';
import type { PoolhogOptions, LeakReport, Logger } from './types.js';

export { attachPoolHog };
export type { PoolhogOptions, LeakReport, Logger };

declare module 'pg' {
    interface PoolClient {
        poolhogNote?(message: string): void;
    }
}