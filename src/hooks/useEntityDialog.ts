import { useContext } from 'react';
import { EntityDialogContext } from '../contexts/EntityDialogContext';

export function useEntityDialog() {
  const ctx = useContext(EntityDialogContext);
  if (!ctx) {
    throw new Error('useEntityDialog must be used within EntityDialogProvider');
  }
  return ctx;
}
