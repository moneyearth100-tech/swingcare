/**
 * 게이트 2 — 녹화 중 어드레스 준비 음성/햅틱 큐.
 * expo-speech는 Expo Modules라 NativeModules에 안 보일 수 있음 →
 * requireOptionalNativeModule('ExpoSpeech')로 판별.
 *
 * iOS: expo-speech는 Silent 스위치·AVCapture 중 무음이 흔함.
 *      → expo-audio + 번들 MP3 가 primary. Speech 는 asset 실패 시에만.
 * Android: expo-speech 유지.
 *
 * 디텍터는 isRecording true 전환 시에만 arm (세션당 1회 fire).
 *
 * 회귀 주의: stop()/isSpeakingAsync 를 speak 전·후에 await 하면
 * 이전 세션의 늦은 stop 이 다음 발화를 취소함. speak 는 동기 직행,
 * stop 은 isSpeakingRef 가 true 일 때만 동기 호출.
 * iOS asset 경로의 setAudioModeAsync await 뒤에는 generation 재검증.
 */

import { requireOptionalNativeModule } from 'expo-modules-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Vibration } from 'react-native';

import type { DominantHand } from '../lib/scoring/movementMetrics';
import { trailWristIndexForDominantHand } from '../lib/scoring/movementMetrics';
import type { PoseLandmarks } from '../lib/landmarkTypes';
import {
  ADDRESS_READY_SPEECH_TEXT,
  createAddressReadyDetector,
  type AddressReadyDetector,
  type AddressReadyPhase,
} from '../lib/addressReadyCue';
import {
  isExpoAudioNativeAvailable,
  playAddressReadyCueAudio,
  primeAddressReadyCueAudio,
  stopAddressReadyCueAudio,
} from '../lib/addressReadyCueAudio';
import {
  getAddressReadyVoiceEnabled,
  setAddressReadyVoiceEnabled,
} from '../lib/addressReadyCueSettings';

type SpeechSpeakOptions = {
  language?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  /**
   * iOS only. false = 시스템이 TTS 전용 세션을 만들어 다른 오디오와
   * 믹싱/덕킹 (카메라 AVCapture 녹화 중 앱 세션 공유 시 무음 방지).
   * @see https://docs.expo.dev/versions/v57.0.0/sdk/speech/
   */
  useApplicationAudioSession?: boolean;
  onError?: (error: Error) => void;
  onStart?: () => void;
  onDone?: () => void;
  onStopped?: () => void;
};

function speechErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name || 'Error';
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

type SpeechApi = {
  speak: (text: string, options?: SpeechSpeakOptions) => void;
  stop: () => Promise<void> | void;
};

function loadSpeechApi(): SpeechApi | null {
  const native = requireOptionalNativeModule('ExpoSpeech');
  if (!native) {
    console.warn(
      '[addressReadyCue] ExpoSpeech native NULL — Dev Client must be rebuilt after expo-speech + pod install',
      { platform: Platform.OS },
    );
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-speech') as SpeechApi;
    if (typeof mod?.speak !== 'function') {
      console.warn('[addressReadyCue] expo-speech.speak missing');
      return null;
    }
    console.log('[addressReadyCue] speechAvailable=true', {
      platform: Platform.OS,
      hasStop: typeof mod.stop === 'function',
    });
    return mod;
  } catch (error) {
    console.warn('[addressReadyCue] expo-speech require failed', error);
    return null;
  }
}

export interface UseAddressReadyCueResult {
  phase: AddressReadyPhase;
  voiceEnabled: boolean;
  /** 네이티브 TTS 또는 iOS 에셋 큐 사용 가능 여부 */
  speechAvailable: boolean;
  /**
   * Gate 2 발화(또는 skip 직전 안정) 프레임 timestampMs.
   * trim 윈도우 시작용. 미발화면 null.
   */
  readyAtTimestampMs: number | null;
  setVoiceEnabled: (enabled: boolean) => void;
  /** isRecording effect가 담당. 수동 호출은 동일하게 새 디텍터 arm */
  resetForRecording: () => void;
  /** 포커스 복귀 등 — 진행 중 발화만 끊고 디텍터는 건드리지 않음 */
  silenceSpeech: () => void;
  onRecordingFrame: (
    landmarks: PoseLandmarks,
    timestampMs: number,
  ) => void;
}

export function useAddressReadyCue(options: {
  dominantHand: DominantHand | null;
  isRecording: boolean;
}): UseAddressReadyCueResult {
  const { dominantHand, isRecording } = options;
  const [phase, setPhase] = useState<AddressReadyPhase>('idle');
  const [voiceEnabled, setVoiceEnabledState] = useState(true);
  const [speechAvailable, setSpeechAvailable] = useState(false);
  const [readyAtTimestampMs, setReadyAtTimestampMs] = useState<number | null>(
    null,
  );
  const voiceEnabledRef = useRef(true);
  const speechRef = useRef<SpeechApi | null>(null);
  const iosAudioAvailableRef = useRef(false);
  const detectorRef = useRef<AddressReadyDetector | null>(null);
  const dominantHandRef = useRef(dominantHand);
  /** 현재 디텍터에 적용된 trail wrist — null↔right 동일 인덱스는 재생성 안 함 */
  const armedTrailWristRef = useRef(
    trailWristIndexForDominantHand(dominantHand),
  );
  const isRecordingRef = useRef(isRecording);
  /** 녹화 세션 세대 — 이전 세션의 지연 speak/retry 무시 */
  const cueGenerationRef = useRef(0);
  /** 네이티브 onStart / asset audible 이후 ~ onDone/onError/onStopped 까지만 true */
  const isSpeakingRef = useRef(false);
  /** 프레임 유입 카운트 (스로틀 로그) */
  const frameCountRef = useRef(0);
  const lastFrameLogAtRef = useRef(0);
  const readyAtTimestampMsRef = useRef<number | null>(null);
  dominantHandRef.current = dominantHand;
  isRecordingRef.current = isRecording;

  useEffect(() => {
    const api = loadSpeechApi();
    speechRef.current = api;
    // requireOptionalNativeModule 만 — expo-audio 정적 import 금지
    // (미링크 시 requireNativeModule 이 캡처 탭 전체를 크래시시킴)
    const iosAudio =
      Platform.OS === 'ios' && isExpoAudioNativeAvailable();
    iosAudioAvailableRef.current = iosAudio;
    if (Platform.OS === 'ios' && !iosAudio) {
      console.warn(
        '[addressReadyCue] ExpoAudio native NULL — haptic/on-screen only until Dev Client rebuild',
      );
    } else if (iosAudio) {
      console.log('[addressReadyCue] ExpoAudio available (iOS asset cue)');
    }
    // iOS: Silent 스위치·카메라 중 TTS 무음 → 에셋 재생(ExpoAudio)이 필수.
    // Android: expo-speech 만으로 충분.
    const available =
      Platform.OS === 'ios' ? iosAudio : api != null;
    setSpeechAvailable(available);
    void getAddressReadyVoiceEnabled().then((enabled) => {
      voiceEnabledRef.current = enabled;
      setVoiceEnabledState(enabled);
      console.log('[addressReadyCue] voice settings loaded', {
        voiceEnabled: enabled,
        speechAvailable: available,
        expoSpeech: api != null,
        iosAudioAvailable: iosAudio,
      });
    });
  }, []);

  /**
   * 진행 중 발화만 동기 stop. isSpeakingAsync await 금지 —
   * await 갭 동안 새 speak 가 시작되면 늦은 stop 이 그걸 취소함.
   */
  const stopIfSpeakingNow = useCallback(() => {
    if (Platform.OS === 'ios') {
      stopAddressReadyCueAudio();
    }
    const speech = speechRef.current;
    if (!speech || !isSpeakingRef.current) {
      isSpeakingRef.current = false;
      return;
    }
    isSpeakingRef.current = false;
    try {
      void speech.stop?.();
      console.log('[addressReadyCue] stop (was speaking)');
    } catch (error) {
      console.warn('[addressReadyCue] stop failed', error);
    }
  }, []);

  const setVoiceEnabled = useCallback(
    (enabled: boolean) => {
      voiceEnabledRef.current = enabled;
      setVoiceEnabledState(enabled);
      void setAddressReadyVoiceEnabled(enabled);
      if (!enabled) {
        cueGenerationRef.current += 1;
        stopIfSpeakingNow();
      }
      console.log('[addressReadyCue] voiceEnabled=', enabled);
    },
    [stopIfSpeakingNow],
  );

  const silenceSpeech = useCallback(() => {
    cueGenerationRef.current += 1;
    stopIfSpeakingNow();
  }, [stopIfSpeakingNow]);

  const requestSpeakViaSpeech = useCallback((reason: string) => {
    const speech = speechRef.current ?? loadSpeechApi();
    speechRef.current = speech;
    if (!speech) {
      console.log(
        '[addressReadyCue] speech unavailable — on-screen + haptic only',
        { reason },
      );
      return;
    }

    const generation = cueGenerationRef.current;

    const stillValid = () =>
      generation === cueGenerationRef.current &&
      voiceEnabledRef.current &&
      isRecordingRef.current;

    const attempt = (
      label: string,
      opts: SpeechSpeakOptions,
      onFail?: () => void,
    ) => {
      if (!stillValid()) {
        console.log('[addressReadyCue] speak skipped — invalidated', {
          reason,
          label,
          generation,
          current: cueGenerationRef.current,
        });
        return;
      }

      const sessionFlag =
        Platform.OS === 'ios'
          ? opts.useApplicationAudioSession
          : undefined;

      let started = false;
      let startWatch: ReturnType<typeof setTimeout> | null = null;

      try {
        speech.speak(ADDRESS_READY_SPEECH_TEXT, {
          ...opts,
          onStart: () => {
            started = true;
            if (startWatch) {
              clearTimeout(startWatch);
              startWatch = null;
            }
            if (generation !== cueGenerationRef.current) {
              return;
            }
            isSpeakingRef.current = true;
            console.log('[addressReadyCue] speak onStart', {
              generation,
              reason,
              label,
              platform: Platform.OS,
              useApplicationAudioSession: sessionFlag,
            });
          },
          onDone: () => {
            if (generation === cueGenerationRef.current) {
              isSpeakingRef.current = false;
            }
            console.log('[addressReadyCue] speak onDone', {
              label,
              reason,
              platform: Platform.OS,
            });
          },
          onStopped: () => {
            if (generation === cueGenerationRef.current) {
              isSpeakingRef.current = false;
            }
            console.log('[addressReadyCue] speak onStopped', {
              label,
              reason,
              platform: Platform.OS,
            });
          },
          onError: (error) => {
            if (generation === cueGenerationRef.current) {
              isSpeakingRef.current = false;
            }
            console.warn('[addressReadyCue] speak onError', {
              label,
              reason,
              platform: Platform.OS,
              useApplicationAudioSession: sessionFlag,
              message: speechErrorMessage(error),
              error,
            });
            if (stillValid()) {
              onFail?.();
            }
          },
        });
        console.log('[addressReadyCue] speak requested', {
          generation,
          reason,
          label,
          platform: Platform.OS,
          useApplicationAudioSession: sessionFlag,
        });

        // iOS: onStart 미발화 시 세션 플래그 반전 재시도
        if (Platform.OS === 'ios' && onFail) {
          startWatch = setTimeout(() => {
            if (!started && stillValid()) {
              console.warn(
                '[addressReadyCue] speak onStart timeout — retry alt session',
                { label, reason, sessionFlag },
              );
              try {
                void speech.stop?.();
              } catch {
                // ignore
              }
              onFail();
            }
          }, 500);
        }
      } catch (error) {
        isSpeakingRef.current = false;
        console.warn('[addressReadyCue] Speech.speak failed', {
          label,
          reason,
          platform: Platform.OS,
          message: speechErrorMessage(error),
          error,
        });
        if (stillValid()) {
          onFail?.();
        }
      }
    };

    if (Platform.OS === 'ios') {
      attempt(
        'ios_fallback_session_false',
        {
          language: 'ko-KR',
          rate: 1.0,
          pitch: 1.0,
          volume: 1.0,
          useApplicationAudioSession: false,
        },
        () => {
          attempt('ios_fallback_session_true', {
            language: 'ko-KR',
            rate: 1.0,
            pitch: 1.0,
            volume: 1.0,
            useApplicationAudioSession: true,
          });
        },
      );
      return;
    }

    attempt(
      'primary_ko_KR',
      {
        language: 'ko-KR',
        rate: 1.0,
        pitch: 1.0,
        volume: 1.0,
      },
      () => {
        console.log('[addressReadyCue] speak retry — default lang', {
          reason,
          platform: Platform.OS,
        });
        attempt('retry_default_lang', {
          rate: 1.0,
          pitch: 1.0,
          volume: 1.0,
        });
      },
    );
  }, []);

  const requestSpeak = useCallback(
    (reason: string) => {
      console.log('[addressReadyCue] FIRE → voice path', {
        reason,
        voiceEnabled: voiceEnabledRef.current,
        isRecording: isRecordingRef.current,
        generation: cueGenerationRef.current,
        platform: Platform.OS,
        iosAudioAvailable: iosAudioAvailableRef.current,
        speechAvailable: speechRef.current != null,
      });

      if (!voiceEnabledRef.current) {
        console.log('[addressReadyCue] voice muted — haptic only', {
          reason,
        });
        return;
      }

      if (!isRecordingRef.current) {
        console.log('[addressReadyCue] speak skipped — not recording', {
          reason,
        });
        return;
      }

      const generation = cueGenerationRef.current;

      // iOS primary: 번들 MP3 (Silent 스위치·카메라 세션에서도 재생)
      if (Platform.OS === 'ios' && iosAudioAvailableRef.current) {
        void (async () => {
          const ok = await playAddressReadyCueAudio({
            generation,
            isGenerationCurrent: (g) =>
              g === cueGenerationRef.current &&
              voiceEnabledRef.current &&
              isRecordingRef.current,
            reason,
            onAudible: () => {
              if (generation === cueGenerationRef.current) {
                isSpeakingRef.current = true;
              }
            },
            onFinished: () => {
              if (generation === cueGenerationRef.current) {
                isSpeakingRef.current = false;
              }
            },
          });
          if (ok) {
            console.log('[addressReadyCue] iOS asset cue requested OK', {
              reason,
              generation,
            });
            return;
          }
          if (
            generation !== cueGenerationRef.current ||
            !voiceEnabledRef.current ||
            !isRecordingRef.current
          ) {
            return;
          }
          console.warn(
            '[addressReadyCue] iOS asset failed — Speech fallback',
            { reason, generation },
          );
          if (__DEV__) {
            // addressReadyCueAudio 가 이미 Alert 했을 수 있음 — 폴백만 로그
            console.warn(
              '[addressReadyCue] DEV: banner가 「스윙하세요」인데 무음이면 위 Alert/로그 확인',
            );
          }
          requestSpeakViaSpeech(reason);
        })();
        return;
      }

      if (Platform.OS === 'ios') {
        console.warn(
          '[addressReadyCue] ExpoAudio missing — Speech only (may be silent)',
          { reason },
        );
      }

      requestSpeakViaSpeech(reason);
    },
    [requestSpeakViaSpeech],
  );

  const armForRecording = useCallback(() => {
    cueGenerationRef.current += 1;
    frameCountRef.current = 0;
    lastFrameLogAtRef.current = 0;
    readyAtTimestampMsRef.current = null;
    setReadyAtTimestampMs(null);
    // arm 시 stop() 호출 금지 (이전 세션 늦은 stop 회귀)
    // 단 iOS 에셋 플레이어는 세대 무효화만 — 새 세션 전 잔여 재생 차단
    if (Platform.OS === 'ios') {
      stopAddressReadyCueAudio();
      void primeAddressReadyCueAudio();
    }
    const hand = dominantHandRef.current;
    armedTrailWristRef.current = trailWristIndexForDominantHand(hand);
    detectorRef.current = createAddressReadyDetector({
      dominantHand: hand,
    });
    setPhase('waiting');
    console.log('[addressReadyCue] armed', {
      generation: cueGenerationRef.current,
      dominantHand: hand,
      trailWristIndex: armedTrailWristRef.current,
      speechAvailable: speechRef.current != null,
      iosAudioAvailable: iosAudioAvailableRef.current,
      voiceEnabled: voiceEnabledRef.current,
    });
  }, []);

  const disarm = useCallback(() => {
    cueGenerationRef.current += 1;
    detectorRef.current = null;
    frameCountRef.current = 0;
    setPhase('idle');
    stopIfSpeakingNow();
    console.log('[addressReadyCue] disarmed', {
      readyAtTimestampMs: readyAtTimestampMsRef.current,
    });
  }, [stopIfSpeakingNow]);

  const resetForRecording = armForRecording;

  const armForRecordingRef = useRef(armForRecording);
  armForRecordingRef.current = armForRecording;
  const disarmRef = useRef(disarm);
  disarmRef.current = disarm;

  /**
   * isRecording 전환이 디텍터 생명주기의 단일 소스.
   */
  useEffect(() => {
    if (isRecording) {
      armForRecordingRef.current();
      return;
    }
    disarmRef.current();
  }, [isRecording]);

  /**
   * 녹화 중 타수(좌/우)가 실제로 바뀔 때만 디텍터 교체.
   */
  useEffect(() => {
    if (!isRecordingRef.current || !detectorRef.current) {
      return;
    }
    const current = detectorRef.current.getPhase();
    if (current === 'ready' || current === 'skipped_swing_started') {
      return;
    }
    const nextIndex = trailWristIndexForDominantHand(dominantHand);
    if (nextIndex === armedTrailWristRef.current) {
      return;
    }
    armedTrailWristRef.current = nextIndex;
    detectorRef.current = createAddressReadyDetector({
      dominantHand,
    });
    setPhase('waiting');
    console.log('[addressReadyCue] detector re-armed for hand change', {
      dominantHand,
      trailWristIndex: nextIndex,
    });
  }, [dominantHand]);

  const onRecordingFrame = useCallback(
    (landmarks: PoseLandmarks, timestampMs: number) => {
      const detector = detectorRef.current;
      if (!detector) {
        return;
      }

      frameCountRef.current += 1;
      if (timestampMs - lastFrameLogAtRef.current >= 2000) {
        lastFrameLogAtRef.current = timestampMs;
        console.log('[addressReadyCue] frames flowing', {
          frameCount: frameCountRef.current,
          timestampMs,
          phase: detector.getPhase(),
          speechAvailable: speechRef.current != null,
          iosAudioAvailable: iosAudioAvailableRef.current,
          voiceEnabled: voiceEnabledRef.current,
        });
      }

      const result = detector.push(landmarks, timestampMs);
      const nextPhase = detector.getPhase();
      setPhase((prev) => (prev === nextPhase ? prev : nextPhase));

      if (result !== 'fire') {
        return;
      }

      const fireReason = detector.getLastFireReason() ?? 'stable_hold';
      readyAtTimestampMsRef.current = timestampMs;
      setReadyAtTimestampMs(timestampMs);
      console.log('[addressReadyCue] fire → haptic + speak', {
        fireReason,
        timestampMs,
        generation: cueGenerationRef.current,
      });

      try {
        Vibration.vibrate(Platform.OS === 'android' ? 50 : 40);
      } catch {
        // ignore
      }

      requestSpeak(fireReason);
    },
    [requestSpeak],
  );

  return {
    phase,
    voiceEnabled,
    speechAvailable,
    readyAtTimestampMs,
    setVoiceEnabled,
    resetForRecording,
    silenceSpeech,
    onRecordingFrame,
  };
}
