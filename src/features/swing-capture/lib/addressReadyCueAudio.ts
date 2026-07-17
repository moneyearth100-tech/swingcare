/**
 * iOS 어드레스 준비 큐 — 미리 녹음한 음성 재생.
 *
 * expo-speech는 실기기 Silent 스위치에서 무음이고,
 * AVSpeechSynthesizer.usesApplicationAudioSession 토글만으로는
 * AVCapture 세션과 함께 쓰기 불안정하다.
 *
 * 실패 원인 (코드 근거):
 * 1) allowsRecording:false → AVAudioSession .playback 이
 *    AVCaptureSession(자동 오디오 세션)과 충돌 → play() 가 waiting 에 머묾
 * 2) createAudioPlayer(require) 만으로는 iOS 에서 localUri 미확보 가능
 *    (expo-audio resolveSourceWithDownload 주석: type/URI 미확정 시 AVPlayer 실패)
 * 3) 「700ms 내 audible 아니면 pause+remove」가 카메라 부하 중
 *    실제 재생 시작 전에 플레이어를 죽여 Speech 폴백(역시 무음)으로 감
 * 4) expo-audio 정적 import 는 AudioModule.js 의
 *    requireNativeModule('ExpoAudio') 를 즉시 실행 → 네이티브 미링크 시
 *    캡처 화면 전체가 크래시. 반드시 requireOptionalNativeModule 후
 *    동적 require 만 사용.
 */

import { Asset } from 'expo-asset';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { Alert, Platform } from 'react-native';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ADDRESS_READY_CUE_MODULE = require('../assets/address-ready-cue.mp3');

type AudioStatus = {
  isLoaded: boolean;
  playing: boolean;
  currentTime: number;
  didJustFinish: boolean;
  error?: string | null;
};

type AudioPlayer = {
  volume: number;
  isLoaded: boolean;
  play: () => void;
  pause: () => void;
  remove: () => void;
  seekTo: (seconds: number) => Promise<void>;
  addListener: (
    event: 'playbackStatusUpdate',
    listener: (status: AudioStatus) => void,
  ) => { remove: () => void };
};

type ExpoAudioApi = {
  createAudioPlayer: (
    source: { uri: string },
    options?: {
      keepAudioSessionActive?: boolean;
      updateInterval?: number;
    },
  ) => AudioPlayer;
  setAudioModeAsync: (mode: {
    playsInSilentMode?: boolean;
    allowsRecording?: boolean;
    interruptionMode?: 'mixWithOthers' | 'doNotMix' | 'duckOthers';
    shouldPlayInBackground?: boolean;
    shouldRouteThroughEarpiece?: boolean;
  }) => Promise<void>;
  setIsAudioActiveAsync: (active: boolean) => Promise<void>;
};

/** undefined = 미검사, null = 불가 */
let expoAudioApi: ExpoAudioApi | null | undefined;
let activePlayer: AudioPlayer | null = null;
let activeSubscription: { remove: () => void } | null = null;
let resolvedSource: { uri: string } | null = null;
let resolveSourcePromise: Promise<{ uri: string }> | null = null;
/** 같은 실패를 연달아 Alert 하지 않음 */
let lastDevAlertAtMs = 0;

/**
 * 네이티브 ExpoAudio 모듈 존재 여부.
 * expo-audio JS 를 require 하기 전에 반드시 이걸로 가드.
 * (AudioModule.js → requireNativeModule('ExpoAudio') 가 없으면 throw)
 */
export function isExpoAudioNativeAvailable(): boolean {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return false;
  }
  return requireOptionalNativeModule('ExpoAudio') != null;
}

function loadExpoAudioApi(): ExpoAudioApi | null {
  if (expoAudioApi !== undefined) {
    return expoAudioApi;
  }
  if (!isExpoAudioNativeAvailable()) {
    console.warn(
      '[addressReadyCue] ExpoAudio native NULL — skip expo-audio require (rebuild Dev Client)',
      { platform: Platform.OS },
    );
    expoAudioApi = null;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-audio') as ExpoAudioApi;
    if (
      typeof mod?.createAudioPlayer !== 'function' ||
      typeof mod?.setAudioModeAsync !== 'function' ||
      typeof mod?.setIsAudioActiveAsync !== 'function'
    ) {
      console.warn('[addressReadyCue] expo-audio API incomplete');
      expoAudioApi = null;
      return null;
    }
    console.log('[addressReadyCue] expo-audio API loaded');
    expoAudioApi = mod;
    return mod;
  } catch (error) {
    console.warn('[addressReadyCue] expo-audio require failed', error);
    expoAudioApi = null;
    return null;
  }
}

function alertPlayFailureDev(message: string, detail?: unknown): void {
  if (!__DEV__) {
    return;
  }
  const now = Date.now();
  if (now - lastDevAlertAtMs < 4000) {
    return;
  }
  lastDevAlertAtMs = now;
  const extra =
    detail == null
      ? ''
      : detail instanceof Error
        ? `\n${detail.message}`
        : `\n${String(detail)}`;
  Alert.alert('address-ready 재생 실패', `${message}${extra}`);
}

export function stopAddressReadyCueAudio(): void {
  try {
    activeSubscription?.remove();
  } catch {
    // ignore
  }
  activeSubscription = null;

  if (!activePlayer) {
    return;
  }
  try {
    activePlayer.pause();
  } catch {
    // ignore
  }
  // 플레이어는 재사용 — remove 하면 다음 fire 때 다시 로드 지연
}

function disposePlayer(): void {
  stopAddressReadyCueAudio();
  if (!activePlayer) {
    return;
  }
  try {
    activePlayer.remove();
  } catch {
    // ignore
  }
  activePlayer = null;
}

/**
 * 카메라 녹화 중에도 재생되게 playAndRecord + mixWithOthers + speaker.
 * (.playback 카테고리는 AVCaptureSession 과 충돌해 waiting 에 갇힘)
 */
async function ensurePlaybackAudioMode(api: ExpoAudioApi): Promise<void> {
  await api.setIsAudioActiveAsync(true);
  await api.setAudioModeAsync({
    playsInSilentMode: true,
    allowsRecording: true,
    interruptionMode: 'mixWithOthers',
    shouldPlayInBackground: false,
    shouldRouteThroughEarpiece: false,
  });
}

async function resolveCueSource(): Promise<{ uri: string }> {
  if (resolvedSource?.uri) {
    return resolvedSource;
  }
  if (!resolveSourcePromise) {
    resolveSourcePromise = (async () => {
      const asset = Asset.fromModule(ADDRESS_READY_CUE_MODULE);
      // iOS AVPlayer: downloadAsync 로 localUri + type 확보
      await asset.downloadAsync();
      const uri = asset.localUri ?? asset.uri;
      if (!uri) {
        throw new Error('address-ready-cue.mp3 URI missing after downloadAsync');
      }
      resolvedSource = { uri };
      console.log('[addressReadyCue] iOS asset resolved', {
        uri,
        localUri: asset.localUri,
        type: asset.type,
      });
      return resolvedSource;
    })().catch((error) => {
      resolveSourcePromise = null;
      throw error;
    });
  }
  return resolveSourcePromise;
}

function ensurePlayer(
  api: ExpoAudioApi,
  source: { uri: string },
): AudioPlayer {
  if (activePlayer) {
    return activePlayer;
  }
  const player = api.createAudioPlayer(source, {
    keepAudioSessionActive: true,
    updateInterval: 200,
  });
  player.volume = 1;
  activePlayer = player;
  return player;
}

async function waitUntilLoaded(
  player: AudioPlayer,
  timeoutMs: number,
): Promise<boolean> {
  if (player.isLoaded) {
    return true;
  }
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        sub.remove();
      } catch {
        // ignore
      }
      resolve(ok);
    };
    const sub = player.addListener(
      'playbackStatusUpdate',
      (status: AudioStatus) => {
        if (status.isLoaded) {
          finish(true);
          return;
        }
        if (status.error) {
          console.warn(
            '[addressReadyCue] iOS asset load error',
            status.error,
          );
          finish(false);
        }
      },
    );
    setTimeout(() => finish(player.isLoaded), timeoutMs);
  });
}

/**
 * iOS 전용 큐 재생.
 * play() 호출까지 성공하면 true — 「audible 확인」을 기다리다가
 * 플레이어를 죽이지 않는다 (이전 700ms kill 이 실 무음 원인).
 * ExpoAudio 없으면 false (호출측에서 haptic / Speech / UI 폴백).
 */
export async function playAddressReadyCueAudio(options: {
  generation: number;
  isGenerationCurrent: (generation: number) => boolean;
  reason: string;
  onAudible?: () => void;
  onFinished?: () => void;
}): Promise<boolean> {
  if (Platform.OS !== 'ios') {
    return false;
  }

  const api = loadExpoAudioApi();
  if (!api) {
    console.warn(
      '[addressReadyCue] play skipped — ExpoAudio unavailable (rebuild Dev Client)',
    );
    return false;
  }

  const { generation, isGenerationCurrent, reason, onAudible, onFinished } =
    options;

  console.log('[addressReadyCue] iOS asset cue — prepare', {
    reason,
    generation,
  });

  try {
    await ensurePlaybackAudioMode(api);
  } catch (error) {
    console.warn('[addressReadyCue] setAudioModeAsync failed', error);
    alertPlayFailureDev('setAudioModeAsync 실패', error);
    return false;
  }

  if (!isGenerationCurrent(generation)) {
    console.log(
      '[addressReadyCue] iOS asset cue — invalidated after audio mode',
      { generation },
    );
    return false;
  }

  let source: { uri: string };
  try {
    source = await resolveCueSource();
  } catch (error) {
    console.warn('[addressReadyCue] asset resolve failed', error);
    alertPlayFailureDev('MP3 에셋 resolve 실패', error);
    return false;
  }

  if (!isGenerationCurrent(generation)) {
    return false;
  }

  // 이전 재생만 멈추고 플레이어는 유지
  stopAddressReadyCueAudio();

  try {
    const player = ensurePlayer(api, source);
    player.volume = 1;

    const loaded = await waitUntilLoaded(player, 2500);
    if (!isGenerationCurrent(generation)) {
      return false;
    }
    if (!loaded) {
      console.warn('[addressReadyCue] iOS asset not loaded — recreate');
      disposePlayer();
      const retryPlayer = ensurePlayer(api, source);
      retryPlayer.volume = 1;
      const retryLoaded = await waitUntilLoaded(retryPlayer, 2500);
      if (!retryLoaded || !isGenerationCurrent(generation)) {
        alertPlayFailureDev('AVPlayer isLoaded=false (URI/세션)');
        return false;
      }
    }

    const playPlayer = activePlayer;
    if (!playPlayer) {
      alertPlayFailureDev('player null after load');
      return false;
    }

    try {
      await playPlayer.seekTo(0);
    } catch (error) {
      console.warn('[addressReadyCue] seekTo(0) failed', error);
    }

    if (!isGenerationCurrent(generation)) {
      return false;
    }

    activeSubscription = playPlayer.addListener(
      'playbackStatusUpdate',
      (status: AudioStatus) => {
        if (!isGenerationCurrent(generation)) {
          try {
            playPlayer.pause();
          } catch {
            // ignore
          }
          onFinished?.();
          return;
        }

        if (status.playing || status.currentTime > 0.02) {
          onAudible?.();
        }

        if (status.didJustFinish) {
          console.log('[addressReadyCue] iOS asset cue — finished', {
            reason,
            generation,
          });
          onFinished?.();
        }

        if (status.error) {
          console.warn('[addressReadyCue] iOS playback error', status.error);
          alertPlayFailureDev('playbackStatus error', status.error);
          onFinished?.();
        }
      },
    );

    console.log('[addressReadyCue] iOS asset cue — play()', {
      reason,
      generation,
      uri: source.uri,
      isLoaded: playPlayer.isLoaded,
    });
    playPlayer.play();
    onAudible?.();

    // play() 호출 성공 = OK. 재생 완료를 기다리지 않음.
    // (이전 구현은 700ms 내 audible 없으면 pause+remove → 무음)
    return isGenerationCurrent(generation);
  } catch (error) {
    console.warn('[addressReadyCue] iOS asset cue failed', error);
    alertPlayFailureDev('play() 예외', error);
    disposePlayer();
    return false;
  }
}

/** 녹화 arm 시 오디오 세션 + 에셋 로드를 미리 올려 첫 큐 지연을 줄인다. */
export async function primeAddressReadyCueAudio(): Promise<void> {
  if (Platform.OS !== 'ios') {
    return;
  }
  const api = loadExpoAudioApi();
  if (!api) {
    return;
  }
  try {
    await ensurePlaybackAudioMode(api);
    const source = await resolveCueSource();
    const player = ensurePlayer(api, source);
    await waitUntilLoaded(player, 3000);
    console.log('[addressReadyCue] iOS audio primed', {
      uri: source.uri,
      isLoaded: player.isLoaded,
    });
  } catch (error) {
    console.warn('[addressReadyCue] prime audio failed', error);
  }
}
