import type { Language } from '../../shared/types';

export type DateInput = Date | string | number;
export type NumberInput = number | bigint;

const localeTags: Record<Language, string> = {
  de: 'de-DE',
  en: 'en-US',
};

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

function formatDateValue(
  language: Language,
  value: DateInput,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }
): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(localeTags[language], options).format(date);
}

function formatTimeValue(
  language: Language,
  value: DateInput,
  options: Intl.DateTimeFormatOptions = { timeStyle: 'short' }
): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(localeTags[language], options).format(date);
}

function formatDateTimeValue(
  language: Language,
  value: DateInput,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }
): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(localeTags[language], options).format(date);
}

function formatNumberValue(
  language: Language,
  value: NumberInput,
  options?: Intl.NumberFormatOptions
): string {
  return new Intl.NumberFormat(localeTags[language], options).format(value);
}

export { formatDateTimeValue, formatDateValue, formatNumberValue, formatTimeValue, localeTags };
