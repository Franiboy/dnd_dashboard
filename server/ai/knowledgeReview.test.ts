import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./opencode.js', () => ({
  runOpenCode: vi.fn(),
  deleteOpenCodeSession: vi.fn(),
}));

import { runOpenCode } from './opencode.js';
import { reviewEntityKnowledge } from './knowledge.js';

describe('reviewEntityKnowledge', () => {
  beforeEach(() => {
    vi.mocked(runOpenCode).mockReset();
  });

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
    expect(call.scopes).toContain('recording:read');
    expect(call.prompt).toContain('Fokus-Entität');
    expect(call.prompt).toContain('Person "Der Abt (Abt der Totenkapelle)"');
    expect(call.prompt).toContain('includeHistory=true');
    expect(call.prompt).toContain('get_session_summary');
    expect(call.prompt).toContain('get_previous_session_summaries');
    expect(call.knowledgeTarget).toEqual({
      entityType: 'persons',
      entityName: 'Der Abt',
      entityQualifier: 'Abt der Totenkapelle',
    });

    // Focus entity is always part of the affected set, nothing changed.
    expect(result.created).toEqual([]);
    expect(result.deleted).toEqual([]);
    expect(result.ended).toEqual([]);
    expect(result.summaries).toHaveLength(1);
    expect(result.summaries[0].entityName).toBe('Der Abt');
  });

  it('builds a complete English review prompt and forwards the captured language', async () => {
    vi.mocked(runOpenCode).mockResolvedValue({
      success: true,
      output: '',
      exitCode: 0,
      sessionId: 'session-en',
    });

    await reviewEntityKnowledge('organizations', 'The Archive', {
      qualifier: 'central library',
      user: { id: 'u1' },
      language: 'en',
    });

    const reviewCall = vi.mocked(runOpenCode).mock.calls[0][0];
    expect(reviewCall.language).toBe('en');
    expect(reviewCall.prompt).toContain('You are an assistant for a D&D diary system.');
    expect(reviewCall.prompt).toContain(
      'Language rule: All content you generate must be written in English.'
    );
    expect(reviewCall.prompt).toContain('Task: Check all stored knowledge');
    expect(reviewCall.prompt).toContain(
      'Focus entity: Organization "The Archive (central library)".'
    );
    expect(reviewCall.prompt).toContain('Procedure:');
    expect(reviewCall.prompt).toContain('includeHistory=true');
    expect(reviewCall.prompt).not.toContain('auf Deutsch');
    expect(reviewCall.prompt).not.toContain('Verfügbare Tools:');

    const summaryCall = vi.mocked(runOpenCode).mock.calls[1][0];
    expect(summaryCall.language).toBe('en');
    expect(summaryCall.prompt).toContain('Task: Create a concise but informative summary');
  });
});
