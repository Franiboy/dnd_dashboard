import { useCallback, useEffect, useState } from 'react';
import { useApi } from './useApi';
import type { EntityMapping } from '../../shared/types';

let cachedMappings: EntityMapping[] | null = null;
let loadPromise: Promise<EntityMapping[]> | null = null;

export function useEntityMappings(): { mappings: EntityMapping[]; refresh: () => void } {
  const { request } = useApi();
  const [mappings, setMappings] = useState<EntityMapping[]>(cachedMappings ?? []);

  const load = useCallback(async () => {
    if (loadPromise) return loadPromise;

    loadPromise = request<{ mappings: EntityMapping[] }>('/api/entities/mappings').then(({ data }) => {
      const result = data?.mappings ?? [];
      cachedMappings = result;
      return result;
    });

    const result = await loadPromise;
    setMappings(result);
    return result;
  }, [request]);

  const refresh = useCallback(() => {
    loadPromise = null;
    cachedMappings = null;
    load();
  }, [load]);

  useEffect(() => {
    if (cachedMappings) {
      setMappings(cachedMappings);
    } else {
      load();
    }
  }, [load]);

  return { mappings, refresh };
}
