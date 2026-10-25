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

    // 5. Callback passthrough emits a warning and delegates directly to originalConnect
    test('emits a warning and delegates directly when callback style connect is used', async () => {
        const mockLogger: Logger = { warn: jest.fn() };
        const emitter = new EventEmitter();
        const cbPool = Object.assign(emitter, {
            connect: jest.fn((cb: any) => cb(null, mockClient)),
        }) as unknown as Pool;

        attachPoolHog(cbPool, { threshold: 5000, logger: mockLogger });

        const callback = jest.fn();
        (cbPool.connect as any)(callback);

        expect(mockLogger.warn).toHaveBeenCalledTimes(1);
        expect(mockLogger.warn).toHaveBeenCalledWith(
            expect.stringMatching(/Callback-based pool.connect\(cb\) is not tracked/),
        );
    });

    // 6. Double release calls underlying release twice and does not crash or double-cancel
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

    // 7. Supports adding a poolhogNote to a checked-out client for reporting
    test('includes poolhogNote message in the leak report when set', async () => {
        const mockLogger: Logger = { warn: jest.fn() };
        attachPoolHog(mockPool, { threshold: 5000, logger: mockLogger });

        const client = (await mockPool.connect()) as PoolClient & { poolhogNote?: (msg: string) => void };
        
        expect(typeof client.poolhogNote).toBe('function');
        client.poolhogNote!('known long batch job');

        jest.advanceTimersByTime(5001);

        expect(mockLogger.warn).toHaveBeenCalledTimes(1);
        expect(mockLogger.warn).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                message: 'known long batch job',
            }),
        );
    });

    // 8. Silently ignores poolhogNote called after client is released
    test('silently ignores poolhogNote called after client is released', async () => {
        const mockLogger: Logger = { warn: jest.fn() };
        attachPoolHog(mockPool, { threshold: 5000, logger: mockLogger });

        const client = (await mockPool.connect()) as PoolClient & { poolhogNote?: (msg: string) => void };
        client.release();

        expect(() => client.poolhogNote!('too late')).not.toThrow();

        jest.advanceTimersByTime(6000);
        expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    // 9. Cleans up when the pool emits 'remove' for a checked-out client
    test("cleans up when the pool emits 'remove' for a checked-out client", async () => {
        const mockLogger: Logger = { warn: jest.fn() };
        attachPoolHog(mockPool, { threshold: 5000, logger: mockLogger });

        const client = await mockPool.connect();

        // Simulate pool destroying the connection without app releasing it
        mockPool.emit('remove', client);

        // Advance past threshold
        jest.advanceTimersByTime(6000);

        expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    // 10. Handles 'remove' event for an unknown/untracked client safely
    test("handles 'remove' event for an unknown client without throwing", async () => {
        const mockLogger: Logger = { warn: jest.fn() };
        attachPoolHog(mockPool, { threshold: 5000, logger: mockLogger });

        const unknownClient = { release: jest.fn() } as unknown as PoolClient;

        expect(() => mockPool.emit('remove', unknownClient)).not.toThrow();
    });
});