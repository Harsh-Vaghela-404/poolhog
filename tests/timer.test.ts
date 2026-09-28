import {expect, describe, test, beforeEach, afterEach, jest} from '@jest/globals';
import { createLeakTimer } from '../src/timer.ts';

describe('createLeakTimer', ()=>{
    beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('should execute onExpire after threshold passed', ()=>{
    let fired = false;
    let recivedKey: object | null = null;

    const timerCallback = (key: object)=> {
        fired = true;
        recivedKey = key
    }

    const timer = createLeakTimer(2000, timerCallback);
    const key = {id : 1};

    timer.schedule(key);

    expect(fired).toBe(false);

    jest.advanceTimersByTime(2000);

    expect(fired).toBe(true);
    expect(recivedKey).toBe(key);
  })

  test('should NOT execute onExpire if timer is cancelled', ()=>{
    let count = 0;

    const timerCallback = ()=>{
        count++;
    }

    const timer = createLeakTimer(2000, timerCallback);
    const key = {id: 1};

    timer.schedule(key);

    jest.advanceTimersByTime(1000);
    timer.cancel(key);

    jest.advanceTimersByTime(1500);
    expect(count).toBe(0);
  })

  test('should track multiple keys independently', ()=>{
    const expiredKeys: object[] = [];

    const timersCallback = (key: object)=>{
        expiredKeys.push(key);
    }

    const timer = createLeakTimer(2000, timersCallback)
    const key1 = {id:1};
    const key2 = {id:2};

    timer.schedule(key1);

    jest.advanceTimersByTime(1000);
    timer.schedule(key2);

    jest.advanceTimersByTime(1000);
    expect(expiredKeys).toEqual([key1]);

    jest.advanceTimersByTime(1200);
    expect(expiredKeys).toEqual([key1, key2])
  })

  test('cancel after expiry should not throw', () => {
    let callCount = 0;
    const timerCallback = () => {
        callCount++;
    };

    const timer = createLeakTimer(2000, timerCallback);
    const key = { id: 1 };

    timer.schedule(key);

    jest.advanceTimersByTime(2000);
    expect(callCount).toBe(1);

    expect(() => timer.cancel(key)).not.toThrow();

  });
  
  test('should call .unref() on the created timer object', () => {
    const timerCallback = () => {};
    const timer = createLeakTimer(2000, timerCallback);
    const key = { id: 1 };

    const originalSetTimeout = globalThis.setTimeout;

    let unrefCalled = false;
    const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout').mockImplementation((...args) => {
        const realTimer = originalSetTimeout(...args)

        const originalUnref = realTimer.unref.bind(realTimer);
        realTimer.unref = function () {
            unrefCalled = true;
            return originalUnref();
        };

        return realTimer;
    });

    try {
        timer.schedule(key);

        expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
        expect(unrefCalled).toBe(true);
    } finally {
        setTimeoutSpy.mockRestore();
    }
  });
})