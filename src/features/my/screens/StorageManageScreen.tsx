/**
 * 로컬 스윙 영상(Documents/swing-videos) 용량 확인·삭제.
 * 삭제 시 해당 세션 리포트(로컬·원격)도 함께 제거한다.
 */

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset } from '@/constants/theme';
import {
  formatBytes,
  listLocalSwingVideos,
  type LocalSwingVideoEntry,
} from '@/features/swing-capture/lib/localSwingVideo';
import {
  getStoredSwingSessionById,
  hydrateSwingSessionStore,
} from '@/features/swing-capture/store/swingSessionStore';
import {
  deleteSwingSessionCompletely,
  deleteSwingSessionsCompletely,
} from '@/services/supabase/swingDelete';

type Row = LocalSwingVideoEntry & {
  createdAtLabel: string | null;
};

type ConfirmState =
  | { kind: 'one'; row: Row }
  | { kind: 'all' }
  | null;

function formatDate(ms: number | null): string | null {
  if (ms == null || !Number.isFinite(ms)) {
    return null;
  }
  try {
    return new Date(ms).toLocaleString('ko-KR');
  } catch {
    return null;
  }
}

export default function StorageManageScreen() {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [totalBytes, setTotalBytes] = useState(0);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    await hydrateSwingSessionStore();
    const entries = listLocalSwingVideos();
    const nextRows: Row[] = [];
    for (const entry of entries) {
      const session = await getStoredSwingSessionById(entry.sessionId);
      const createdAtLabel = session?.createdAt
        ? formatDate(Date.parse(session.createdAt))
        : formatDate(entry.modifiedAtMs);
      nextRows.push({ ...entry, createdAtLabel });
    }
    setRows(nextRows);
    setTotalBytes(nextRows.reduce((sum, row) => sum + row.sizeBytes, 0));
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const runConfirmedDelete = async () => {
    if (!confirm || busy) {
      return;
    }
    const pending = confirm;
    setBusy(true);
    try {
      if (pending.kind === 'one') {
        const result = await deleteSwingSessionCompletely(
          pending.row.sessionId,
        );
        if (!result.ok) {
          setConfirm(null);
          setErrorMessage(
            result.message ?? '원격 리포트를 지우지 못했어요.',
          );
          return;
        }
      } else {
        const result = await deleteSwingSessionsCompletely(
          rows.map((row) => row.sessionId),
        );
        setConfirm(null);
        if (result.failCount > 0) {
          setErrorMessage(
            `${result.okCount}개 삭제, ${result.failCount}개는 실패했어요.`,
          );
        }
        await load();
        return;
      }
      setConfirm(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const confirmTitle =
    confirm?.kind === 'all' ? '전체 삭제' : '리포트 삭제';
  const confirmBody =
    confirm?.kind === 'all'
      ? `로컬 스윙 영상 ${rows.length}개(${formatBytes(totalBytes)})와 해당 리포트를 모두 삭제할까요?\n되돌릴 수 없습니다.`
      : confirm?.kind === 'one'
        ? `${formatBytes(confirm.row.sizeBytes)} 영상과 해당 리포트를 삭제할까요?\n되돌릴 수 없습니다.`
        : '';

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.head}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.backBtn}
        >
          <Text style={styles.backLabel}>‹</Text>
        </Pressable>
        <Text style={styles.title}>저장 공간</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingBottom: insets.bottom + BottomTabInset + 24,
          paddingHorizontal: 16,
        }}
      >
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>로컬 스윙 영상</Text>
          <Text style={styles.summaryValue}>{formatBytes(totalBytes)}</Text>
          <Text style={styles.summaryHint}>
            항목을 누르면 영상과 스켈레톤을 함께 재생해 확인할 수 있어요. 삭제하면
            해당 리포트도 함께 지워집니다.
          </Text>
          {rows.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => setConfirm({ kind: 'all' })}
              style={({ pressed }) => [
                styles.deleteAllBtn,
                pressed && styles.pressed,
                busy && styles.disabled,
              ]}
            >
              <Text style={styles.deleteAllLabel}>전체 삭제</Text>
            </Pressable>
          ) : null}
        </View>

        {loading ? (
          <ActivityIndicator color="#8971EA" style={{ marginTop: 24 }} />
        ) : null}

        {!loading && rows.length === 0 ? (
          <Text style={styles.empty}>저장된 로컬 영상이 없어요.</Text>
        ) : null}

        {rows.map((row) => (
          <View key={row.uri} style={styles.card}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="영상 미리보기"
              onPress={() => router.push(`/review/${row.sessionId}`)}
              style={({ pressed }) => [
                styles.cardBody,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.cardTitle} numberOfLines={1}>
                스윙 영상
              </Text>
              <Text style={styles.cardMeta}>
                {formatBytes(row.sizeBytes)}
                {row.createdAtLabel ? ` · ${row.createdAtLabel}` : ''}
              </Text>
              <Text style={styles.cardPlayHint}>탭하여 스켈레톤과 함께 재생</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="영상 삭제"
              disabled={busy}
              onPress={() => setConfirm({ kind: 'one', row })}
              style={({ pressed }) => [
                styles.deleteBtn,
                pressed && styles.pressed,
                busy && styles.disabled,
              ]}
            >
              <Text style={styles.deleteLabel}>삭제</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>

      <Modal
        transparent
        animationType="fade"
        visible={confirm != null}
        onRequestClose={() => {
          if (!busy) {
            setConfirm(null);
          }
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{confirmTitle}</Text>
            <Text style={styles.modalBody}>{confirmBody}</Text>
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => setConfirm(null)}
                style={({ pressed }) => [
                  styles.modalCancelBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.modalCancelLabel}>취소</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => {
                  void runConfirmedDelete();
                }}
                style={({ pressed }) => [
                  styles.modalDeleteBtn,
                  pressed && styles.pressed,
                  busy && styles.disabled,
                ]}
              >
                {busy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalDeleteLabel}>삭제</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        animationType="fade"
        visible={errorMessage != null}
        onRequestClose={() => setErrorMessage(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>삭제 실패</Text>
            <Text style={styles.modalBody}>{errorMessage}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setErrorMessage(null)}
              style={({ pressed }) => [
                styles.modalDeleteBtn,
                { alignSelf: 'stretch' },
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.modalDeleteLabel}>확인</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F4F7FB' },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backLabel: {
    fontSize: 28,
    lineHeight: 32,
    color: '#1A2333',
    fontWeight: '300',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    color: '#1A2333',
  },
  summaryCard: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 20,
    padding: 18,
    marginTop: 8,
    marginBottom: 12,
  },
  summaryLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7A8198',
  },
  summaryValue: {
    marginTop: 6,
    fontSize: 28,
    fontWeight: '800',
    color: '#1A2333',
  },
  summaryHint: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 18,
    color: '#7A8198',
  },
  deleteAllBtn: {
    marginTop: 14,
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(220, 60, 60, 0.1)',
  },
  deleteAllLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#C62828',
  },
  empty: {
    marginTop: 28,
    textAlign: 'center',
    fontSize: 14,
    color: '#7A8198',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
    gap: 10,
  },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1A2333',
  },
  cardMeta: {
    marginTop: 4,
    fontSize: 13,
    color: '#7A8198',
  },
  cardPlayHint: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '600',
    color: '#2F6BFF',
  },
  deleteBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(220, 60, 60, 0.1)',
  },
  deleteLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#C62828',
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(20, 24, 40, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#1A2333',
  },
  modalBody: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 20,
    color: '#5A6278',
  },
  modalActions: {
    marginTop: 18,
    flexDirection: 'row',
    gap: 10,
  },
  modalCancelBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(30, 40, 70, 0.08)',
  },
  modalCancelLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1A2333',
  },
  modalDeleteBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#C62828',
    minHeight: 46,
  },
  modalDeleteLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
