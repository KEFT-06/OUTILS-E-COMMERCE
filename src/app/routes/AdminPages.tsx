import { lazy } from 'react';

/**
 * Écrans d'administration, chargés à la demande : un créateur qui n'a aucun
 * privilège ne télécharge jamais leur code.
 */

export const AdminLayout = lazy(() => import('@/features/admin/AdminLayout').then((module) => ({ default: module.AdminLayout })));
export const AdminOverviewPage = lazy(() =>
  import('@/features/admin/AdminOverviewPage').then((module) => ({ default: module.AdminOverviewPage })),
);
export const AdminUsersPage = lazy(() => import('@/features/admin/AdminUsersPage').then((module) => ({ default: module.AdminUsersPage })));
export const AdminUserDetailPage = lazy(() =>
  import('@/features/admin/AdminUserDetailPage').then((module) => ({ default: module.AdminUserDetailPage })),
);
export const AdminConnectionsPage = lazy(() =>
  import('@/features/admin/AdminConnectionsPage').then((module) => ({ default: module.AdminConnectionsPage })),
);
export const AdminRevenuePage = lazy(() =>
  import('@/features/admin/AdminRevenuePage').then((module) => ({ default: module.AdminRevenuePage })),
);
export const AdminContentPage = lazy(() =>
  import('@/features/admin/AdminContentPage').then((module) => ({ default: module.AdminContentPage })),
);
export const AdminSecurityPage = lazy(() =>
  import('@/features/admin/AdminSecurityPage').then((module) => ({ default: module.AdminSecurityPage })),
);
export const AdminMessagesPage = lazy(() =>
  import('@/features/admin/AdminMessagesPage').then((module) => ({ default: module.AdminMessagesPage })),
);
export const AdminAudiencePage = lazy(() =>
  import('@/features/admin/AdminAudiencePage').then((module) => ({ default: module.AdminAudiencePage })),
);
