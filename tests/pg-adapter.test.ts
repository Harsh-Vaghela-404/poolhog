import { describe, expect, test, jest, beforeEach, afterEach } from '@jest/globals';
import { EventEmitter } from 'node:events';
import { Pool, PoolClient } from 'pg';
import { attachPoolHog } from '../src/pg-adapter.ts';
import { Logger } from '../src/types.ts';

describe('attachPoolHog', () => {
    let mockPool: Pool & EventEmitter;
    let mockClient: PoolClient;
    let mockRealRelease: jest.Mock;

    beforeEach(() => {
        jest.useFakeTimers();

        mockRealRelease = jest.fn();
        mockClient = {
            release: mockRealRelease,
            query: jest.fn(),
        } as unknown as PoolClient;

        const emitter = new EventEmitter();
        mockPool = Object.assign(emitter, {
            connect: jest.fn<() => Promise<PoolClient>>().mockResolvedValue(mockClient),
        }) as unknown as Pool & EventEmitter;
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    // 1. Captures a stack trace at the real call site
    test('captures a stack trace at the real call site', async () => {
        const mockLogger: Logger = { warn: jest.fn() };
        attachPoolHog(mockPool, { threshold: 5000, logger: mockLogger });

        async function myApplicationCode() {
            return await mockPool.connect();
        }

        await myApplicationCode();

        jest.advanceTimersByTime(5001);

        expect(mockLogger.warn).toHaveBeenCalledTimes(1);
        expect(mockLogger.warn).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                stack: expect.stringMatching(/myApplicationCode/),
            }),
        );
    });

    // 2. Reports a leak after the threshold elapses if release is never called
    test('reports a leak after the threshold elapses if release is never called', async () => {
        const mockLogger: Logger = { warn: jest.fn() };
        attachPoolHog(mockPool, { threshold: 5000, logger: mockLogger });

        await mockPool.connect();

        jest.advanceTimersByTime(4999);
        expect(mockLogger.warn).not.toHaveBeenCalled();

        jest.advanceTimersByTime(2);
        expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    });

    // 3. Does not report a leak if release is called before the threshold
    test('does not report a leak if release is called before the threshold', async () => {
        const mockLogger: Logger = { warn: jest.fn() };
        attachPoolHog(mockPool, { threshold: 5000, logger: mockLogger });

        const client = await mockPool.connect();

        jest.advanceTimersByTime(2000);
        client.release();

        jest.advanceTimersByTime(5000);

        expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    // 4. Release still works normally
    test('release still works normally', async () => {
        const mockLogger: Logger = { warn: jest.fn() };
        attachPoolHog(mockPool, { threshold: 5000, logger: mockLogger });

        const client = await mockPool.connect();
        client.release();

        expect(mockRealRelease).toHaveBeenCalledTimes(1);
    });

    // 5. Double release calls underlying release twice and does not crash or double-cancel
    test('handles double release gracefully without throwing or crashing', async () => {
        const mockLogger: Logger = { warn: jest.fn() };
        attachPoolHog(mockPool, { threshold: 5000, logger: mockLogger });

        const client = await mockPool.connect();

        client.release();
        expect(mockRealRelease).toHaveBeenCalledTimes(1);

        expect(() => client.release()).not.toThrow();
        expect(mockRealRelease).toHaveBeenCalledTimes(2);

        jest.advanceTimersByTime(6000);
        expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    // 6. Supports adding a poolhogNote to a checked-out client for reporting
    test('includes poolhogNote message in the leak report when set', async () => {
        const mockLogger: Logger = { warn: jest.fn() };
        attachPoolHog(mockPool, { threshold: 5000, logger: mockLogger });

        const client = await mockPool.connect();
        
        expect(typeof client.poolhogNote).toBe('function');
        client.poolhogNote?.('known long batch job');

        jest.advanceTimersByTime(5001);

        expect(mockLogger.warn).toHaveBeenCalledTimes(1);
        expect(mockLogger.warn).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                message: 'known long batch job',
            }),
        );
    });

    // 7. Silently ignores poolhogNote called after client is released
    test('silently ignores poolhogNote called after client is released', async () => {
        const mockLogger: Logger = { warn: jest.fn() };
        attachPoolHog(mockPool, { threshold: 5000, logger: mockLogger });

        const client = await mockPool.connect();
        client.release();

        expect(typeof client.poolhogNote).toBe('function');
        expect(() => client.poolhogNote!('too late')).not.toThrow();

        jest.advanceTimersByTime(6000);
        expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    // 8. Cleans up when the pool emits 'remove' for a checked-out client
    test("cleans up when the pool emits 'remove' for a checked-out client", async () => {
        const mockLogger: Logger = { warn: jest.fn() };
        attachPoolHog(mockPool, { threshold: 5000, logger: mockLogger });

        const client = await mockPool.connect();

        mockPool.emit('remove', client);

        jest.advanceTimersByTime(6000);

        expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    // 9. Handles 'remove' event for an unknown/untracked client safely
    test("handles 'remove' event for an unknown client without throwing", async () => {
        const mockLogger: Logger = { warn: jest.fn() };
        attachPoolHog(mockPool, { threshold: 5000, logger: mockLogger });

        const unknownClient = { release: jest.fn() } as unknown as PoolClient;

        expect(() => mockPool.emit('remove', unknownClient)).not.toThrow();
    });

    // 10. Callback-style connect: Tracks and reports a leak if never released
    test('tracks callback-style connect and reports a leak if never released', async () => {
        const mockLogger: Logger = { warn: jest.fn() };
        
        const emitter = new EventEmitter();
        const cbPool = Object.assign(emitter, {
            connect: jest.fn((cb: any) => {
                cb(null, mockClient, mockRealRelease);
            }),
        }) as unknown as Pool & EventEmitter;

        attachPoolHog(cbPool, { threshold: 5000, logger: mockLogger });

        async function myApplicationCallbackCode() {
            return new Promise((resolve) => {
                (cbPool.connect as any)((err: any, client: any, done: any) => {
                    resolve({ client, done });
                });
            });
        }

        await myApplicationCallbackCode();

        jest.advanceTimersByTime(5001);

        expect(mockLogger.warn).toHaveBeenCalledTimes(1);
        expect(mockLogger.warn).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                stack: expect.stringMatching(/myApplicationCallbackCode/),
            }),
        );
    });

    // 11. Callback-style connect: Releasing via done() before threshold gives no report
    test('does not report a leak if released via done() before threshold', async () => {
        const mockLogger: Logger = { warn: jest.fn() };
        const emitter = new EventEmitter();
        const cbPool = Object.assign(emitter, {
            connect: jest.fn((cb: any) => {
                cb(null, mockClient, mockRealRelease);
            }),
        }) as unknown as Pool & EventEmitter;

        attachPoolHog(cbPool, { threshold: 5000, logger: mockLogger });

        await new Promise((resolve) => {
            cbPool.connect((_err, _client, done) => {
                done();
                resolve(null);
            });
        });

        jest.advanceTimersByTime(5001);

        expect(mockLogger.warn).not.toHaveBeenCalled();
    });

// 12. Callback-style connect: Releasing via client.release() before threshold gives no report
    test('does not report a leak if released via client.release() before threshold', async () => {
        const mockLogger: Logger = { warn: jest.fn() };
        const emitter = new EventEmitter();
        const cbPool = Object.assign(emitter, {
            connect: jest.fn((cb: any) => {
                cb(null, mockClient, mockRealRelease);
            }),
        }) as unknown as Pool & EventEmitter;

        attachPoolHog(cbPool, { threshold: 5000, logger: mockLogger });

        await new Promise((resolve) => {
            cbPool.connect((_err, client) => {
                if (client) {
                    client.release();
                }
                resolve(null);
            });
        });

        jest.advanceTimersByTime(5001);

        expect(mockLogger.warn).not.toHaveBeenCalled();
    });
    
    // 13. Callback-style connect: Error callback tracks nothing and does not throw
    test('handles error callback gracefully and tracks nothing', async () => {
        const mockLogger: Logger = { warn: jest.fn() };
        const emitter = new EventEmitter();
        const cbPool = Object.assign(emitter, {
            connect: jest.fn((cb: any) => {
                cb(new Error('Connection failure'), undefined, undefined);
            }),
        }) as unknown as Pool & EventEmitter;

        attachPoolHog(cbPool, { threshold: 5000, logger: mockLogger });

        let callbackInvoked = false;
        await new Promise((resolve) => {
            cbPool.connect((err) => {
                expect(err).toBeDefined();
                callbackInvoked = true;
                resolve(null);
            });
        });

        expect(callbackInvoked).toBe(true);

        jest.advanceTimersByTime(5001);

        expect(mockLogger.warn).not.toHaveBeenCalled();
    });
});