/**
 * 주손방향 선택 — 프로필 prefill + users.dominant_hand 저장.
 * 분석 세션에는 로컬 값을 즉시 사용하고, 저장은 백그라운드로 반영.
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { useAuth } from '@/features/auth/hooks/useAuth';
import type { DominantHand } from '@/features/auth/lib/profileTypes';
import { updateDominantHand } from '@/features/auth/lib/userProfile';

export function useDominantHandSelection() {
  const { profile, user, refreshProfile } = useAuth();
  const [dominantHand, setDominantHand] = useState<DominantHand | null>(
    profile?.dominant_hand ?? null,
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDominantHand(profile?.dominant_hand ?? null);
  }, [profile?.dominant_hand]);

  const selectDominantHand = useCallback(
    (next: DominantHand | null) => {
      const previous = dominantHand;
      setDominantHand(next);

      if (!user?.id) {
        return;
      }
      if (previous === next) {
        return;
      }

      setSaving(true);
      void updateDominantHand(user.id, next)
        .then(async () => {
          await refreshProfile();
        })
        .catch((error) => {
          setDominantHand(previous);
          const message =
            error instanceof Error
              ? error.message
              : '주손방향 저장에 실패했습니다.';
          Alert.alert('주손방향', message);
        })
        .finally(() => {
          setSaving(false);
        });
    },
    [dominantHand, refreshProfile, user?.id],
  );

  return { dominantHand, selectDominantHand, saving };
}
