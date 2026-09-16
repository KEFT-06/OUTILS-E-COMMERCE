import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '@/shared/lib/api';
import { type ApiError, toApiError } from '@/shared/lib/apiError';
import type { CreditBalance, FeatureId, Permission, PlanId } from '@/shared/types/auth';

/** Miroir client des réponses de `server/routes/admin.ts`. */

export type Granularity = 'day' | 'month' | 'year';

export const GRANULARITY_RANGE: Record<Granularity, string> = {
  day: '30 derniers jours',
  month: '12 derniers mois',
  year: '5 dernières années',
};

export interface AdminPlan {
  id: PlanId;
  label: string;
  monthlyCredits: number | null;
}

export interface AdminMeta {
  viewer: { id: string; role: 'user' | 'admin'; permissions: Permission[] };
  permissions: { id: Permission; label: string; description: string }[];
  features: { id: FeatureId; label: string }[];
  plans: AdminPlan[];
  /** Devise des statistiques de revenus. */
  reportingCurrency: string;
  currencies: string[];
  paymentMethods: string[];
  authEventTypes: { id: string; label: string }[];
  timezone: string;
}

export interface GenerationTotals {
  byKind: { kind: string; total: number; completed: number; failed: number; last30d: number; declaredByBrowser: number }[];
  byFormat: { format: string; files: number }[];
}

export interface RevenueTotals {
  currency: string;
  today: number;
  month: number;
  previousMonth: number;
  year: number;
  total: number;
  payments: number;
  monthlyRecurring: number;
  activeSubscribers: number;
}

export interface AuditEntry {
  id: string;
  action: string;
  actorEmail: string;
  targetUserId: string | null;
  targetEmail: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface AdminOverview {
  generatedAt: string;
  timezone: string;
  users: { total: number; newToday: number; new7d: number; new30d: number; suspended: number; admins: number; withTwoFactor: number };
  /** Actifs : au moins une requête sur la période, d'après l'historique des connexions. */
  online: { users: number; sessions: number; activeToday: number; active7d: number; active30d: number };
  plans: { id: PlanId; label: string; users: number }[];
  content: GenerationTotals;
  credits: { consumed30d: number; granted30d: number };
  revenue: RevenueTotals | null;
  security: { logins24h: number; failedLogins24h: number; blockedAttempts24h: number; activeLocks: number } | null;
  recentActivity: AuditEntry[] | null;
}

export interface RevenueSeries {
  granularity: Granularity;
  timezone: string;
  currency: string;
  points: { period: string; amount: number; payments: number }[];
  total: number;
  byPlan: { plan: string; label: string; amount: number; payments: number }[];
  byMethod: { method: string; amount: number; payments: number }[];
}

export interface UsageSeries {
  granularity: Granularity;
  timezone: string;
  points: ({ period: string } & Record<string, number | string>)[];
}

export interface ContentStats {
  totals: GenerationTotals;
  series: UsageSeries;
  topCreators: { userId: string; name: string; email: string; generations: number }[];
  creditsByAction: { actionId: string | null; points: number; uses: number }[];
}

/** Vidéos ou visuels générés par les comptes (GET /api/admin/creatives). */
export interface AdminCreativeList {
  kind: 'video' | 'image';
  page: number;
  pageSize: number;
  total: number;
  counts: { pending: number; completed: number; failed: number };
  retentionDays: number;
  entries: {
    id: string;
    status: 'pending' | 'completed' | 'failed';
    creditsCharged: number;
    refunded: boolean;
    createdAt: string;
    completedAt: string | null;
    user: { id: string; name: string; email: string };
    available: boolean;
  }[];
}

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: 'user' | 'admin';
  status: 'active' | 'suspended';
  plan: { id: PlanId; label: string };
  planExpiresAt: string | null;
  credits: { plan: number; bonus: number; total: number };
  /** Points dépensés sur 30 jours, remboursements déduits. */
  creditsUsed30d: number;
  createdAt: string;
  lastLoginAt: string | null;
  lastSeenAt: string | null;
  online: boolean;
  generations: number;
  isStaff: boolean;
  twoFactorEnabled: boolean;
  country: string | null;
}

export interface UserList {
  page: number;
  pageSize: number;
  total: number;
  users: AdminUserRow[];
}

export interface AdminPayment {
  id: string;
  userId: string | null;
  userEmail: string;
  plan: PlanId;
  periodMonths: number;
  /** Montant payé, dans sa devise. */
  amount: number;
  currency: string;
  /** Équivalent en francs CFA au taux du jour du paiement. */
  amountFcfa: number;
  method: string;
  reference: string | null;
  status: 'paid' | 'refunded';
  note: string | null;
  paidAt: string;
  refundedAt: string | null;
  recordedByEmail: string | null;
  createdAt: string;
}

export interface PaymentList {
  page: number;
  pageSize: number;
  total: number;
  payments: AdminPayment[];
}

export interface AdminUserDetail {
  user: {
    id: string;
    name: string;
    email: string;
    role: 'user' | 'admin';
    status: 'active' | 'suspended';
    suspendedReason: string | null;
    plan: { id: PlanId; label: string };
    planExpiresAt: string | null;
    createdAt: string;
    lastLoginAt: string | null;
    lastSeenAt: string | null;
    online: boolean;
    passwordSet: boolean;
    twoFactorEnabled: boolean;
    twoFactorMethods: { app: boolean; code: boolean };
    country: string | null;
    isStaff: boolean;
  };
  credits: CreditBalance;
  /** Points dépensés (remboursements déduits) : cycle mensuel en cours, 30 jours, depuis l'inscription. */
  creditsUsed: { cycle: number; last30d: number; total: number; actions: number };
  /** Les 50 dernières connexions. */
  connections: ConnectionEntry[];
  features: { id: FeatureId; label: string; planDefault: boolean; override: 'granted' | 'revoked' | null; effective: boolean }[];
  permissions: { effective: Permission[]; granted: string[] };
  sessions: { id: string; device: string; ip: string | null; createdAt: string; lastSeenAt: string; online: boolean; mfaVerified: boolean }[];
  ledger: {
    id: string;
    reason: string;
    actionId: string | null;
    delta: number;
    planDelta: number;
    bonusDelta: number;
    balanceAfter: number;
    note: string | null;
    actorEmail: string | null;
    createdAt: string;
  }[];
  generations: {
    id: string;
    kind: string;
    provider: string;
    status: 'pending' | 'completed' | 'failed';
    fileFormat: string | null;
    source: 'server' | 'client';
    creditsCharged: number;
    refunded: boolean;
    createdAt: string;
    completedAt: string | null;
  }[];
  usage: Record<string, number>;
  payments: AdminPayment[];
  securityEvents: { id: string; type: string; label: string; device: string; ip: string | null; createdAt: string }[];
  audit: AuditEntry[];
  integrations: { chariow: { connected: boolean; source: 'own' | 'admin' | null; verifiedAt: string | null } };
}

export interface OnlineUsers {
  windowMinutes: number;
  users: {
    user: { id: string; name: string; email: string; plan: PlanId; role: 'user' | 'admin'; planLabel: string };
    lastSeenAt: string;
    devices: { device: string; ip: string | null; lastSeenAt: string }[];
  }[];
}

export interface SecurityEventPage {
  page: number;
  pageSize: number;
  total: number;
  events: { id: string; type: string; label: string; userId: string | null; email: string | null; device: string; ip: string | null; createdAt: string }[];
}

export interface ThrottleEntry {
  key: string;
  kind: 'ip' | 'email';
  subject: string;
  failures: number;
  lockedUntil: string | null;
  lastFailureAt: string;
}

export interface ConnectionEntry {
  id: string;
  device: string;
  ip: string | null;
  startedAt: string;
  lastSeenAt: string;
  /** Null tant que la session est ouverte. */
  endedAt: string | null;
  endReason: string | null;
  endLabel: string;
  open: boolean;
  online: boolean;
  durationSeconds: number;
}

export interface ActivitySummary {
  online: number;
  activeToday: number;
  active7d: number;
  active30d: number;
  connectionsToday: number;
  /** Durée moyenne d'une connexion close sur 30 jours. */
  averageSeconds: number;
}

export interface ConnectionPage {
  page: number;
  pageSize: number;
  total: number;
  filterUser: { id: string; name: string; email: string } | null;
  summary: ActivitySummary;
  entries: (ConnectionEntry & { user: { id: string; name: string; email: string; country: string | null } })[];
}

export interface AuditPage {
  page: number;
  pageSize: number;
  total: number;
  entries: AuditEntry[];
}

/**
 * Lecture d'une ressource d'administration : chargement, erreur, rechargement et
 * rafraîchissement périodique quand l'onglet est visible. `path` null : rien à charger.
 */
export function useAdminResource<T>(path: string | null, options: { refreshMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!path) {
        setLoading(false);
        return;
      }
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      if (!silent) setLoading(true);

      try {
        const result = await apiRequest<T>(path, { signal: controller.signal });
        setData(result);
        setError(null);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError(toApiError(caught, 'Les données n’ont pas pu être chargées.'));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [path],
  );

  useEffect(() => {
    void load();
    return () => controllerRef.current?.abort();
  }, [load]);

  const { refreshMs } = options;
  useEffect(() => {
    if (!refreshMs || !path) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, refreshMs);
    return () => window.clearInterval(timer);
  }, [load, path, refreshMs]);

  return { data, error, loading, reload: load, setData };
}

let metaCache: AdminMeta | null = null;

/** Catalogues de l'administration (paliers, privilèges, fonctions) : chargés une fois. */
export function useAdminMeta(): AdminMeta | null {
  const [meta, setMeta] = useState<AdminMeta | null>(metaCache);

  useEffect(() => {
    if (metaCache) return;
    let cancelled = false;
    apiRequest<AdminMeta>('/api/admin/meta')
      .then((loaded) => {
        metaCache = loaded;
        if (!cancelled) setMeta(loaded);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return meta;
}

export interface ContactMessageEntry {
  id: string;
  userId: string | null;
  name: string;
  email: string;
  topic: string;
  topicLabel: string;
  message: string;
  status: 'new' | 'read' | 'archived';
  createdAt: string;
}

export interface ContactMessagePage {
  page: number;
  pageSize: number;
  total: number;
  counts: Record<'new' | 'read' | 'archived', number>;
  topics: Record<string, string>;
  entries: ContactMessageEntry[];
}

export interface AudienceSummary {
  days: number;
  timezone: string;
  totals: { visits: number; uniques: number; signups: number; conversionPercent: number | null };
  daily: { day: string; visits: number; uniques: number; signups: number }[];
  pages: { path: string; label: string; visits: number }[];
  /** host null : accès direct ou navigation depuis le site. */
  referrers: { host: string | null; visits: number }[];
}
