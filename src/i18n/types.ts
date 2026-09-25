export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

/** Structured, ICU-near plural variants selected with Intl.PluralRules. */
export interface PluralMessage {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

export type MessageValue = string | PluralMessage;
export type MessageTree = {
  readonly [key: string]: string | PluralMessage | MessageTree;
};

export type TranslationValues = Readonly<
  Record<string, string | number | boolean | Date | null | undefined>
>;
