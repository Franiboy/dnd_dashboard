import { describe, expect, it, vi } from 'vitest';

vi.mock('./opencode.js', () => ({
  runOpenCode: vi.fn(),
  deleteOpenCodeSession: vi.fn(),
}));

import { runOpenCode } from './opencode.js';
import { reviewEntityKnowledge } from './knowledge.js';

describe('reviewEntityKnowledge', () => {
  it('targets the focus entity and uses the shared-diary verification scopes', async () => {
    vi.mocked(runOpenCode).mockResolvedValue({
      success: true,
      output: '',
      exitCode: 0,
      sessionId: 'session-1',
    });

    const result = await reviewEntityKnowledge('persons', 'Der Abt', {
      qualifier: 'Abt der Totenkapelle',
      user: { id: 'u1' },
    });

    const call = vi.mocked(runOpenCode).mock.calls[0][0];
    expect(call.scopes).toContain('entity:read');
    expect(call.scopes).toContain('knowledge:distribute');
    expect(call.scopes).toContain('diary:read');
    expect(call.scopes).toContain('diary:read-all');
    expect(call.prompt).toContain('Fokus-Entität');
    expect(call.prompt).toContain('Person "Der Abt (Abt der Totenkapelle)"');
    expect(call.prompt).toContain('includeHistory=true');

    // Focus entity is always part of the affected set, nothing changed.
    expect(result.created).toEqual([]);
    expect(result.deleted).toEqual([]);
    expect(result.ended).toEqual([]);
    expect(result.summaries).toHaveLength(1);
    expect(result.summaries[0].entityName).toBe('Der Abt');
  });
});
