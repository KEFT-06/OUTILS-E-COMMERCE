import { useSyncExternalStore } from 'react';
import { createPersistentStore, isRecord, mergeRecords } from '@/shared/lib/persistentStore';
import { AdCopyVariant, BeatText, KitObjective, LaunchKitDraft } from '@/shared/types/launchKit';

/** Saisies du kit de lancement, par produit, conservées sur le compte. */

const OBJECTIVES: readonly string[] = ['sales', 'leads', 'traffic'] satisfies readonly KitObjective[];

export const MAX_COPY_VARIANTS = 3;

export function emptyKitDraft(productId: string): LaunchKitDraft {
  return {
    productId,
    objective: 'sales',
    copies: [{ primaryText: '', headline: '', description: '' }],
    scripts: {},
    ctaByMarket: {},
  };
}

function isCopy(value: unknown): value is AdCopyVariant {
  return (
    isRecord(value) &&
    typeof value.primaryText === 'string' &&
    typeof value.headline === 'string' &&
    typeof value.description === 'string'
  );
}

function isBeatText(value: unknown): value is BeatText {
  return isRecord(value) && typeof value.onScreen === 'string' && typeof value.voiceOver === 'string';
}

function isKitDraft(value: unknown): value is LaunchKitDraft {
  if (!isRecord(value)) return false;

  const { copies, scripts, ctaByMarket } = value;
  if (!Array.isArray(copies) || !isRecord(scripts) || !isRecord(ctaByMarket)) return false;

  return (
    typeof value.productId === 'string' &&
    typeof value.objective === 'string' &&
    OBJECTIVES.includes(value.objective) &&
    copies.length >= 1 &&
    copies.length <= MAX_COPY_VARIANTS &&
    copies.every(isCopy) &&
    Object.values(scripts).every((beats) => isRecord(beats) && Object.values(beats).every(isBeatText)) &&
    Object.values(ctaByMarket).every((buttonId) => typeof buttonId === 'string')
  );
}

type KitDrafts = Record<string, LaunchKitDraft>;

const store = createPersistentStore<KitDrafts>({
  kind: 'launch_kits',
  legacyKey: 'smartcreator_launch_kits_v1',
  parse: (raw) =>
    isRecord(raw)
      ? (Object.fromEntries(
          Object.entries(raw).filter(([id, draft]) => isKitDraft(draft) && draft.productId === id),
        ) as KitDrafts)
      : {},
  empty: {},
  merge: mergeRecords,
});

export function useLaunchKitDrafts() {
  const snapshot = useSyncExternalStore(store.subscribe, store.getState);

  return {
    writeFailed: snapshot.writeFailed,
    get: (productId: string): LaunchKitDraft | undefined => snapshot.value[productId],
    save: (draft: LaunchKitDraft) => store.commit({ ...store.getState().value, [draft.productId]: draft }),
  };
}
