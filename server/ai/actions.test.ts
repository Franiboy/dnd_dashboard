import { describe, expect, it } from 'vitest';
import { executeAction, executeAiActions, parseAiActions, type AiAction } from './actions.js';
import { listEntityKnowledge } from '../repositories/entityKnowledge.js';

describe('parseAiActions', () => {
  it('returns an empty array for non-array input', () => {
    expect(parseAiActions(null)).toEqual([]);
    expect(parseAiActions({})).toEqual([]);
    expect(parseAiActions('create entity')).toEqual([]);
  });

  it('parses valid actions and skips invalid ones', () => {
    const raw = [
      { action: 'createEntity', type: 'persons', name: 'Gandalf', aliases: ['Mithrandir'] },
      { action: 'unknownAction', type: 'persons', name: 'Sauron' },
      {
        action: 'createKnowledge',
        type: 'persons',
        name: 'Gandalf',
        title: 'About',
        content: 'A wizard',
      },
    ];

    const actions = parseAiActions(raw);
    expect(actions).toHaveLength(2);
    expect(actions[0].action).toBe('createEntity');
    expect(actions[1].action).toBe('createKnowledge');
  });
});

describe('executeAction', () => {
  it('creates an entity with aliases', () => {
    const action: AiAction = {
      action: 'createEntity',
      type: 'persons',
      name: 'Aragorn',
      aliases: ['Strider'],
    };

    const result = executeAction(action);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ canonical: 'Aragorn' });
  });

  it('creates knowledge for an entity', () => {
    const create: AiAction = {
      action: 'createEntity',
      type: 'persons',
      name: 'Legolas',
    };
    executeAction(create);

    const knowledge: AiAction = {
      action: 'createKnowledge',
      type: 'persons',
      name: 'Legolas',
      title: 'Archer',
      content: 'An elven prince',
    };

    const result = executeAction(knowledge);
    expect(result.success).toBe(true);

    const entries = listEntityKnowledge('persons', 'Legolas');
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });

  it('returns failure for unknown action', () => {
    const action = { action: 'unknown', type: 'persons', name: 'Orc' } as unknown as AiAction;
    const result = executeAction(action);
    expect(result.success).toBe(false);
  });
});

describe('executeAiActions', () => {
  it('executes a batch of create actions', () => {
    const actions: AiAction[] = [
      { action: 'createEntity', type: 'locations', name: 'Rivendell' },
      { action: 'createEntity', type: 'locations', name: 'Mordor' },
    ];

    const results = executeAiActions(actions);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
  });
});
