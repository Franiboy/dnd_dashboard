import { describe, expect, it } from 'vitest';
import { acquireTimelineRun, isTimelineRunRunning } from './timeline.js';

describe('acquireTimelineRun', () => {
  it('hands out the generation slot exactly once until it is released', () => {
    expect(isTimelineRunRunning()).toBe(false);

    const release = acquireTimelineRun();
    expect(release).toBeTypeOf('function');
    expect(isTimelineRunRunning()).toBe(true);
    // A second entry point (manual run vs targeted regeneration vs nightly
    // job) must not be able to reserve the slot while it is held.
    expect(acquireTimelineRun()).toBeNull();

    release?.();
    expect(isTimelineRunRunning()).toBe(false);

    const again = acquireTimelineRun();
    expect(again).not.toBeNull();
    again?.();
    expect(isTimelineRunRunning()).toBe(false);
  });
});
