import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useEntityDialog } from '../hooks/useEntityDialog';

export function EntityDialogRouteSync() {
  const { closeEntity } = useEntityDialog();
  const location = useLocation();
  const pathnameRef = useRef(location.pathname);

  useEffect(() => {
    if (pathnameRef.current !== location.pathname) {
      pathnameRef.current = location.pathname;
      closeEntity();
    }
  }, [location.pathname, closeEntity]);

  return null;
}
