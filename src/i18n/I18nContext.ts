import { createContext } from 'react';
import type { Language } from '../../shared/types';
import type { DateInput, NumberInput } from './format';
import type { TFunction } from './messages';

export type I18nLocale = 'de-DE' | 'en-US';

export interface I18nContextValue {
  language: Language;
  locale: I18nLocale;
  t: TFunction;
  setLanguage: (language: Language | null) => Promise<void>;
  formatDate: (value: DateInput, options?: Intl.DateTimeFormatOptions) => string;
  formatTime: (value: DateInput, options?: Intl.DateTimeFormatOptions) => string;
  formatDateTime: (value: DateInput, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (value: NumberInput, options?: Intl.NumberFormatOptions) => string;
}

export const I18nContext = createContext<I18nContextValue | null>(null);
