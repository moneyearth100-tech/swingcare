/**
 * 스윙 썸네일 + 중앙 재생 버튼.
 * - localVideoUri: 기기 로컬 파일 (우선)
 * - videoUrl: Storage 상대경로 → signed URL / 또는 로컬 URI
 * - thumbnailUrl: 저장된 JPEG (있을 때)
 */

import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { isLocalVideoUri } from '../lib/localSwingVideo';
import { createSwingVideoSignedUrl } from '../../../services/supabase/swingPlayback';

type Props = {
  /** Storage 상대경로 (예: swing-uploads/…/id.mp4) 또는 로컬 URI */
  videoUrl: string | null;
  /** 기기 로컬 원본 — Storage보다 우선 */
  localVideoUri?: string | null;
  /** Storage 상대경로 (예: swing-uploads/…/id_thumb.jpg) */
  thumbnailUrl?: string | null;
};

const THUMB_W = 72;
const THUMB_H = 96;

export default function SwingVideoThumb({
  videoUrl,
  localVideoUri,
  thumbnailUrl,
}: Props) {
  const [thumbImageUri, setThumbImageUri] = useState<string | null>(null);
  const [signedVideoUrl, setSignedVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [videoReady, setVideoReady] = useState(false);

  const player = useVideoPlayer(null, (p) => {
    p.muted = true;
    p.loop = false;
  });

  useEffect(() => {
    let cancelled = false;
    setThumbImageUri(null);
    setSignedVideoUrl(null);
    setVideoReady(false);

    const run = async () => {
      setLoading(true);
      try {
        if (thumbnailUrl) {
          const signed = await createSwingVideoSignedUrl(thumbnailUrl);
          if (!cancelled && signed) {
            setThumbImageUri(signed);
            return;
          }
        }
        if (localVideoUri && isLocalVideoUri(localVideoUri)) {
          if (!cancelled) {
            setSignedVideoUrl(localVideoUri);
          }
          return;
        }
        if (videoUrl) {
          if (isLocalVideoUri(videoUrl)) {
            if (!cancelled) {
              setSignedVideoUrl(videoUrl);
            }
            return;
          }
          const signed = await createSwingVideoSignedUrl(videoUrl);
          if (!cancelled && signed) {
            setSignedVideoUrl(signed);
          }
        }
      } catch (e) {
        console.warn('[SwingVideoThumb]', e);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [videoUrl, localVideoUri, thumbnailUrl]);

  useEffect(() => {
    if (!signedVideoUrl || !player || thumbImageUri) {
      return;
    }
    try {
      player.replace(signedVideoUrl);
    } catch (e) {
      console.warn('[SwingVideoThumb] replace', e);
    }

    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') {
        try {
          const duration = Number(player.duration) || 0;
          const seekTo =
            duration > 2 ? 1 : duration > 0.5 ? duration * 0.25 : 0.2;
          player.currentTime = seekTo;
          player.pause();
          setVideoReady(true);
        } catch (e) {
          console.warn('[SwingVideoThumb] seek', e);
          setVideoReady(true);
        }
      }
    });

    return () => {
      sub.remove();
      try {
        player.pause();
      } catch {
        // ignore
      }
    };
  }, [signedVideoUrl, player, thumbImageUri]);

  const showVideo = Boolean(signedVideoUrl) && !thumbImageUri;

  return (
    <View style={styles.thumb}>
      {thumbImageUri ? (
        <Image
          source={{ uri: thumbImageUri }}
          style={styles.media}
          contentFit="cover"
          transition={120}
        />
      ) : showVideo ? (
        <VideoView
          style={styles.media}
          player={player}
          contentFit="cover"
          nativeControls={false}
        />
      ) : (
        <View style={styles.placeholder}>
          {loading ? (
            <ActivityIndicator color="#C9B8FF" size="small" />
          ) : null}
        </View>
      )}
      {(loading || (showVideo && !videoReady)) && (thumbImageUri || showVideo) ? (
        <View style={styles.loadingCover}>
          <ActivityIndicator color="#C9B8FF" size="small" />
        </View>
      ) : null}
      <View style={styles.playOverlay} pointerEvents="none">
        <View style={styles.playCircle}>
          <View style={styles.playTriangle} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  thumb: {
    width: THUMB_W,
    height: THUMB_H,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#12141C',
    position: 'relative',
  },
  media: {
    width: THUMB_W,
    height: THUMB_H,
  },
  placeholder: {
    width: THUMB_W,
    height: THUMB_H,
    backgroundColor: '#1A1D27',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingCover: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(18,20,28,0.35)',
  },
  playOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: THUMB_W,
    height: THUMB_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playTriangle: {
    width: 0,
    height: 0,
    marginLeft: 2,
    borderTopWidth: 6,
    borderBottomWidth: 6,
    borderLeftWidth: 10,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: '#FFFFFF',
  },
});
