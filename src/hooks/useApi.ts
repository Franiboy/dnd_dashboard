import { useError } from './useError';

interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

export function useApi() {
  const { showError } = useError();

  const request = async <T,>(
    path: string,
    options?: RequestInit,
    notify = true,
  ): Promise<ApiResponse<T>> => {
    try {
      const res = await fetch(path, {
        ...options,
        credentials: options?.credentials ?? 'include',
      });

      if (res.ok) {
        const data = (await res.json()) as T;
        return { data, error: null };
      }

      const payload = await res.json().catch(() => ({}));
      const error = payload.error || 'Ein unbekannter Fehler ist aufgetreten';
      if (notify) showError(error);
      return { data: null, error };
    } catch {
      const error = 'Server nicht erreichbar';
      if (notify) showError(error);
      return { data: null, error };
    }
  };

  return { request };
}
