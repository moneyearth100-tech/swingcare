/** 정규화 랜드마크(0~1) → 카메라 뷰 픽셀 좌표 매핑 */

export type CoverAlign =
  | 'start'
  | 'center'
  | 'stretch'
  | 'contain'
  | 'android-review';

/**
 * Android: PreviewView fillCenter + ExoPlayer cover(ZOOM) 와 같이
 * cover(max scale) + center. (fillStart/start 는 리뷰 ExoPlayer 중앙 크롭과 어긋남)
 * iOS는 뷰 비율과 맞아 stretch가 잘 맞으므로 기본 stretch 유지.
 *
 * 리뷰:
 * - iOS: VideoView cover + center
 * - Android: VideoView cover + landmark center (라이브와 동일 배율)
 */
export function mapNormalizedToView(
  normalizedX: number,
  normalizedY: number,
  viewWidth: number,
  viewHeight: number,
  imageWidth: number,
  imageHeight: number,
  align: CoverAlign,
): { x: number; y: number } {
  if (
    viewWidth <= 0 ||
    viewHeight <= 0 ||
    align === 'stretch' ||
    imageWidth <= 0 ||
    imageHeight <= 0
  ) {
    return {
      x: normalizedX * viewWidth,
      y: normalizedY * viewHeight,
    };
  }

  const useContain = align === 'contain';
  const scale = useContain
    ? Math.min(viewWidth / imageWidth, viewHeight / imageHeight)
    : Math.max(viewWidth / imageWidth, viewHeight / imageHeight);
  const displayWidth = imageWidth * scale;
  const displayHeight = imageHeight * scale;
  const centerOffsetX = (viewWidth - displayWidth) / 2;
  const centerOffsetY = (viewHeight - displayHeight) / 2;
  let offsetX = 0;
  let offsetY = 0;
  if (align === 'center' || align === 'contain') {
    offsetX = centerOffsetX;
    offsetY = centerOffsetY;
  } else if (align === 'android-review') {
    offsetX = centerOffsetX * 0.5;
    offsetY = centerOffsetY * 0.5;
  }

  return {
    x: normalizedX * displayWidth + offsetX,
    y: normalizedY * displayHeight + offsetY,
  };
}
