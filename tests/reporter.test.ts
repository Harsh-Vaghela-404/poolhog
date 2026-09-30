import { describe, expect, test, jest } from '@jest/globals';
import { createReporter } from '../src/reporter.ts';
import { Logger, RegistryEntry } from '../src/types.ts';

describe('createReporter', () => {
  // 1. Calls the supplied logger with the report
  test('calls the supplied logger with the report', () => {
    const mockLogger: Logger = {
      warn: jest.fn(),
    };

    const reporter = createReporter(mockLogger);
    const entry: RegistryEntry = {
      stack: 'fake-stack',
      checkoutTime: 1000,
    };
    const heldForMs = 12000;

    reporter.report(entry, heldForMs);

    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/12000ms/),
      expect.objectContaining({
        stack: 'fake-stack',
        heldForMs: 12000,
      })
    );
  });

  // 2. Falls back to console.warn when no logger is supplied
  test('falls back to console.warn when no logger is supplied', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const reporter = createReporter();
      const entry: RegistryEntry = {
        stack: 'fake-stack',
        checkoutTime: 1000,
      };

      reporter.report(entry, 5000);

      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  // 3. Includes the custom message when present on the entry
  test('includes the custom message when present on the entry', () => {
    const mockLogger: Logger = {
      warn: jest.fn(),
    };

    const reporter = createReporter(mockLogger);
    const entry: RegistryEntry = {
      stack: 'fake-stack',
      checkoutTime: 1000,
      message: 'Unclosed DB connection',
    };

    reporter.report(entry, 3000);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        message: 'Unclosed DB connection',
      })
    );
  });
});