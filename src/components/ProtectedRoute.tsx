import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { SafeUser, VersionInfo } from '../../shared/types';
import { Loading } from './Loading';
import { APPS, isAppVisible } from '../lib/apps';

interface ProtectedRouteProps {
  user: SafeUser;
  adminOnly?: boolean;
  appId?: string;
  version?: VersionInfo | null | undefined;
  children: ReactNode;
}

export function ProtectedRoute({ user, adminOnly, appId, version, children }: ProtectedRouteProps) {
  if (!user.isApproved && !user.isAdmin) {
    return <Navigate to="/" replace />;
  }

  if (adminOnly && !user.isAdmin) {
    return <Navigate to="/" replace />;
  }

  if (appId) {
    const app = APPS.find((a) => a.id === appId);
    if (!app) {
      return <Navigate to="/" replace />;
    }
    if (app.requiresFeature && version === undefined) {
      return <Loading size="sm" />;
    }
    if (!isAppVisible(app, user, version)) {
      return <Navigate to="/" replace />;
    }
  }

  return children;
}
