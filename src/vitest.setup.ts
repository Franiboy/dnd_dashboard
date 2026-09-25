import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * Minimal ResizeObserver stand-in: jsdom has no implementation, and the
 * header components observe their own layout. Tests can fire updates for the
 * latest observer manually via TestResizeObserver.latest.trigger().
 */
export class TestResizeObserver {
  static latest: TestResizeObserver | null = null;
  callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    TestResizeObserver.latest = this;
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}

  trigger(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;

/** Minimal IntersectionObserver stand-in for infinite-scroll components in jsdom. */
export class TestIntersectionObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

globalThis.IntersectionObserver =
  TestIntersectionObserver as unknown as typeof IntersectionObserver;

afterEach(cleanup);
