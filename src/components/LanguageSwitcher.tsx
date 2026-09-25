import type { ChangeEvent } from 'react';
import { SUPPORTED_LANGUAGES, type Language } from '../../shared/types';
import { useI18n } from '../hooks/useI18n';

interface LanguageSwitcherProps {
  id?: string;
  label?: string;
  className?: string;
  selectClassName?: string;
  disabled?: boolean;
}

const languageLabels: Record<Language, string> = {
  de: 'Deutsch',
  en: 'English',
};

/** Compact language selector shared by public and authenticated surfaces. */
export function LanguageSwitcher({
  id = 'language-switcher',
  label,
  className = '',
  selectClassName = '',
  disabled = false,
}: LanguageSwitcherProps) {
  const { languagePreference, setLanguage, t } = useI18n();
  const resolvedLabel = label ?? t('common.language');

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    void setLanguage(value === 'auto' ? null : (value as Language));
  };

  return (
    <label className={`flex items-center gap-2 text-sm ${className}`} htmlFor={id}>
      <span className="shrink-0 text-slate-400">{resolvedLabel}</span>
      <select
        id={id}
        value={languagePreference ?? 'auto'}
        onChange={handleChange}
        disabled={disabled}
        aria-label={resolvedLabel}
        className={`rounded-lg border border-[var(--border)] bg-slate-800 px-2 py-1.5 text-[var(--text-h)] focus:border-[var(--accent)] focus:outline-none disabled:opacity-50 ${selectClassName}`}
      >
        <option value="auto">{t('common.automatic')}</option>
        {SUPPORTED_LANGUAGES.map((option) => (
          <option key={option} value={option}>
            {languageLabels[option]}
          </option>
        ))}
      </select>
    </label>
  );
}
