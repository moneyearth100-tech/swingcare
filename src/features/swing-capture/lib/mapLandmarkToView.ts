/** 정규화 랜드마크(0~1) → 카메라 뷰 픽셀 좌표 매핑 */

export type CoverAlign = 'start' | 'center' | 'stretch';

/**
 * Android thinksys OverlayView LIVE_STREAM은 PreviewView FILL_START와 동일하게
 * cover(max scale) + start 정렬을 쓴다. stretch(x*viewW)로 그리면 좌측으로 치우친다.
 * iOS는 뷰 비율과 맞아 stretch가 잘 맞으므로 기본 stretch 유지.
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

  const scale = Math.max(viewWidth / imageWidth, viewHeight / imageHeight);
  const displayWidth = imageWidth * scale;
  const displayHeight = imageHeight * scale;
  const offsetX = align === 'center' ? (viewWidth - displayWidth) / 2 : 0;
  const offsetY = align === 'center' ? (viewHeight - displayHeight) / 2 : 0;

  return {
    x: normalizedX * displayWidth + offsetX,
    y: normalizedY * displayHeight + offsetY,
  };
}
