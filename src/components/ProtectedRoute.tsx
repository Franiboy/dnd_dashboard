import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { SafeUser } from '../../shared/types';

interface ProtectedRouteProps {
  user: SafeUser;
  adminOnly?: boolean;
  adminOrPreview?: boolean;
  appId?: string;
  children: ReactNode;
}

export function ProtectedRoute({ user, adminOnly, adminOrPreview, appId, children }: ProtectedRouteProps) {
  if (!user.isApproved && !user.isAdmin) {
    return <Navigate to="/" />;
  }
  if (adminOnly && !user.isAdmin) {
    return <Navigate to="/" />;
  }
  if (adminOrPreview && !user.isAdmin && !user.canAccessPreviews) {
    return <Navigate to="/" />;
  }
  if (appId && user.disabledApps.includes(appId)) {
    return <Navigate to="/" />;
  }
  return children;
}
