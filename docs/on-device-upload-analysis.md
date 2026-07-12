# 업로드 영상 온디바이스 자세 분석

갤러리/파일에서 선택한 30초 이하 영상은 서버 Vision API로 보내지 않고
Dev Client 안의 MediaPipe Pose Landmarker로 분석한다.

- iOS/Android에서 15fps로 균일 샘플링한다(최대 30fps 허용).
- 각 프레임은 BlazePose 33개 좌표로 저장하며, 미검출 프레임은 0 좌표로 유지한다.
- 앱에서 구간 분할, `load_score_v2`, 이동 지표, 진단을 계산한다.
- 영상과 `frames`, `phases`, `swing_reports`를 Supabase에 저장한 뒤 세션을
  바로 `done`으로 표시한다. 온디바이스 분석 성공 시 Cloudways 분석 큐를 호출하지 않는다.

## Dev Client 재빌드

네이티브 MediaPipe 브리지가 바뀌었으므로 Metro 재시작만으로는 적용되지 않는다.
의존성 설치 후 대상 플랫폼의 Dev Client를 다시 빌드한다.

```bash
npm install
npx expo run:ios
```

```bash
npm install
npx expo run:android
```

## 실기기 확인

1. 새 Dev Client를 실기기에 설치한다.
2. `촬영 → 영상 업로드`에서 사람이 전신으로 나온 30초 이하 MP4/MOV를 고른다.
3. `기기에서 자세 분석 중` 다음 `영상과 분석 리포트 저장 중`이 표시되는지 확인한다.
4. 완료 항목을 눌러 영상/스켈레톤 재생을 확인한다.
5. 리포트 탭에서 종합 점수, 구간, 진단, 이동 지표가 표시되는지 확인한다.

영상 디코딩과 full Pose 모델 추론은 기기 성능과 영상 길이에 따라 수 분 걸릴 수 있다.
Expo Go와 기존 Dev Client에는 새 네이티브 API가 없으므로 사용할 수 없다.
