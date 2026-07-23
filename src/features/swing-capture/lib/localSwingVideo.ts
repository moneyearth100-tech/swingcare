/**
 * 스윙 원본 영상을 앱 Documents에 보관.
 * 일반 리뷰/분석은 로컬 재생, Storage 업로드는 코칭 요청 시에만.
 */

import { Directory, File, Paths } from 'expo-file-system';

function videosDir(): Directory {
  return new Directory(Paths.document, 'swing-videos');
}

function ensureVideosDir(): Directory {
  const dir = videosDir();
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  return dir;
}

function extensionFromHint(
  fileNameOrUri: string,
  mimeType?: string | null,
): string {
  const lower = fileNameOrUri.toLowerCase();
  if (lower.includes('.mov') || mimeType?.includes('quicktime')) {
    return '.mov';
  }
  if (lower.includes('.webm') || mimeType?.includes('webm')) {
    return '.webm';
  }
  if (lower.includes('.m4v')) {
    return '.m4v';
  }
  return '.mp4';
}

/** file:// 또는 일반 로컬 경로인지 (Storage 상대경로와 구분) */
export function isLocalVideoUri(uri: string | null | undefined): boolean {
  if (!uri) {
    return false;
  }
  return (
    uri.startsWith('file://') ||
    uri.startsWith('content://') ||
    uri.startsWith('/') ||
    uri.startsWith('ph://')
  );
}

export function localSwingVideoFileExists(
  uri: string | null | undefined,
): boolean {
  if (!uri || !isLocalVideoUri(uri)) {
    return false;
  }
  try {
    // content:// 등은 File.exists 가 플랫폼마다 다를 수 있어 존재 가정 허용
    if (uri.startsWith('content://') || uri.startsWith('ph://')) {
      return true;
    }
    return new File(uri).exists;
  } catch {
    return false;
  }
}

/**
 * 임시/갤러리 URI를 Documents/swing-videos/{sessionId}.ext 로 복사.
 * 이미 동일 경로면 그대로 반환.
 */
export function persistLocalSwingVideo(input: {
  sessionId: string;
  sourceUri: string;
  fileName?: string | null;
  mimeType?: string | null;
}): { ok: true; uri: string } | { ok: false; message: string } {
  try {
    const dir = ensureVideosDir();
    const ext = extensionFromHint(
      input.fileName ?? input.sourceUri,
      input.mimeType,
    );
    const dest = new File(dir, `${input.sessionId}${ext}`);

    if (dest.uri === input.sourceUri || dest.uri === decodeURI(input.sourceUri)) {
      return { ok: true, uri: dest.uri };
    }

    if (dest.exists) {
      dest.delete();
    }

    const source = new File(input.sourceUri);
    source.copy(dest);

    if (!dest.exists) {
      return { ok: false, message: '로컬 영상 복사에 실패했어요' };
    }
    return { ok: true, uri: dest.uri };
  } catch (error) {
    console.warn('[persistLocalSwingVideo]', error);
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : '로컬 영상 저장에 실패했어요',
    };
  }
}

/** Documents에 저장된 세션 영상 URI (있으면) */
export function findPersistedLocalSwingVideoUri(
  sessionId: string,
): string | null {
  try {
    const dir = videosDir();
    if (!dir.exists) {
      return null;
    }
    for (const ext of ['.mp4', '.mov', '.m4v', '.webm']) {
      const file = new File(dir, `${sessionId}${ext}`);
      if (file.exists) {
        return file.uri;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export function resolvePlayableLocalVideoUri(
  sessionId: string,
  storedUri?: string | null,
): string | null {
  if (localSwingVideoFileExists(storedUri)) {
    return storedUri ?? null;
  }
  return findPersistedLocalSwingVideoUri(sessionId);
}

export type LocalSwingVideoEntry = {
  sessionId: string;
  uri: string;
  fileName: string;
  sizeBytes: number;
  modifiedAtMs: number | null;
};

function sessionIdFromFileName(fileName: string): string | null {
  const match = fileName.match(
    /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(mp4|mov|m4v|webm)$/i,
  );
  return match?.[1] ?? null;
}

/** Documents/swing-videos 목록 (용량·관리 화면용) */
export function listLocalSwingVideos(): LocalSwingVideoEntry[] {
  try {
    const dir = videosDir();
    if (!dir.exists) {
      return [];
    }
    const entries: LocalSwingVideoEntry[] = [];
    for (const item of dir.list()) {
      if (!(item instanceof File) || !item.exists) {
        continue;
      }
      const fileName =
        typeof item.name === 'string' && item.name.length > 0
          ? item.name
          : item.uri.split('/').pop() ?? '';
      const sessionId = sessionIdFromFileName(fileName);
      if (!sessionId) {
        continue;
      }
      const modified =
        typeof item.lastModified === 'number'
          ? item.lastModified
          : typeof item.modificationTime === 'number'
            ? item.modificationTime
            : null;
      entries.push({
        sessionId,
        uri: item.uri,
        fileName,
        sizeBytes: typeof item.size === 'number' ? item.size : 0,
        modifiedAtMs: modified,
      });
    }
    entries.sort((a, b) => {
      const aTime = a.modifiedAtMs ?? 0;
      const bTime = b.modifiedAtMs ?? 0;
      return bTime - aTime;
    });
    return entries;
  } catch (error) {
    console.warn('[listLocalSwingVideos]', error);
    return [];
  }
}

export function getLocalSwingVideosTotalBytes(): number {
  return listLocalSwingVideos().reduce((sum, item) => sum + item.sizeBytes, 0);
}

/** 세션 id에 해당하는 Documents 영상 삭제 (확장자 전부) */
export function deleteLocalSwingVideo(sessionId: string): boolean {
  try {
    const dir = videosDir();
    if (!dir.exists) {
      return false;
    }
    let deleted = false;
    for (const ext of ['.mp4', '.mov', '.m4v', '.webm']) {
      const file = new File(dir, `${sessionId}${ext}`);
      if (file.exists) {
        file.delete();
        deleted = true;
      }
    }
    return deleted;
  } catch (error) {
    console.warn('[deleteLocalSwingVideo]', error);
    return false;
  }
}

/** Documents/swing-videos 전체 삭제 */
export function deleteAllLocalSwingVideos(): {
  deletedCount: number;
  freedBytes: number;
} {
  const entries = listLocalSwingVideos();
  let deletedCount = 0;
  let freedBytes = 0;
  for (const entry of entries) {
    if (deleteLocalSwingVideo(entry.sessionId)) {
      deletedCount += 1;
      freedBytes += entry.sizeBytes;
    }
  }
  return { deletedCount, freedBytes };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
