import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { SafeUser } from '../../shared/types';

interface ProtectedRouteProps {
  user: SafeUser;
  adminOnly?: boolean;
  children: ReactNode;
}

export function ProtectedRoute({ user, adminOnly, children }: ProtectedRouteProps) {
  if (!user.isApproved && !user.isAdmin) {
    return <Navigate to="/" />;
  }
  if (adminOnly && !user.isAdmin) {
    return <Navigate to="/" />;
  }
  return children;
}
