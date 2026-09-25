import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTranslator } from '../i18n';
import { createQuillModules } from './quillConfig';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createQuillModules', () => {
  it('localizes the native table prompts', () => {
    const promptMock = vi.fn().mockReturnValue(null);
    vi.stubGlobal('prompt', promptMock);

    const modules = createQuillModules(createTranslator('en'));
    const tableHandler = modules.toolbar.handlers.table as (this: {
      quill: {
        getSelection: () => null;
        clipboard: { dangerouslyPasteHTML: () => void };
      };
    }) => void;
    tableHandler.call({
      quill: {
        getSelection: () => null,
        clipboard: { dangerouslyPasteHTML: () => undefined },
      },
    });

    expect(promptMock).toHaveBeenNthCalledWith(1, 'Number of rows:', '2');
    expect(promptMock).toHaveBeenNthCalledWith(2, 'Number of columns:', '2');
  });
});
