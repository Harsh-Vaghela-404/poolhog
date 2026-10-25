import { describe, test, expect } from '@jest/globals';
import { attachPoolHog } from '../src/index.ts';

describe('index entry point', () => {
    test('exports attachPoolHog as a function', () => {
        expect(typeof attachPoolHog).toBe('function');
    });
});