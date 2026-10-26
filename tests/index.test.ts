import { describe, test, expect } from '@jest/globals';
import { attachPoolHog } from '../src/index.ts';
import type { PoolhogOptions, Logger, LeakReport } from '../src/index.ts';

describe('index entry point', () => {
    test('exports attachPoolHog as a function', () => {
        expect(typeof attachPoolHog).toBe('function');
    });

    test('exports all expected public types at compile-time', () => {
        const _options: PoolhogOptions = { threshold: 1000 };
        const _logger: Logger = { warn: () => {} };
        const _report: LeakReport = { stack: '', heldForMs: 0 };

        expect(_options).toBeDefined();
        expect(_logger).toBeDefined();
        expect(_report).toBeDefined();
    });
});