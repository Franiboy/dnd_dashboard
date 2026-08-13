import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApi } from '../hooks/useApi';
import { MappingsContext } from './MappingsContext';
import type { EntityMapping } from '../../shared/types';

interface MappingsProviderProps {
  children: ReactNode;
}

export function MappingsProvider({ children }: MappingsProviderProps) {
  const { request } = useApi();
  const [mappings, setMappings] = useState<EntityMapping[]>([]);
  const generationRef = useRef(0);

  const refresh = useCallback(async () => {
    const generation = ++generationRef.current;
    const { data, error } = await request<{ mappings: EntityMapping[] }>('/api/entities/mappings');
    const result = data?.mappings ?? [];
    if (!error && generation === generationRef.current) {
      setMappings(result);
    }
    return result;
  }, [request]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(() => ({ mappings, refresh }), [mappings, refresh]);

  return <MappingsContext.Provider value={value}>{children}</MappingsContext.Provider>;
}
