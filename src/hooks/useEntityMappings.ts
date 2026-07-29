import { useContext } from 'react';
import { MappingsContext } from '../contexts/MappingsContext';

export function useEntityMappings() {
  const ctx = useContext(MappingsContext);
  if (!ctx) {
    throw new Error('useEntityMappings must be used within a MappingsProvider');
  }
  return ctx;
}
