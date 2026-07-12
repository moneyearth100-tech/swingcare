/**
 * 사업연계·실험 기능 노출 플래그.
 * 제휴 확정 시 true 로 켜면 메뉴/섹션이 다시 보인다.
 */

export const FEATURE_FLAGS = {
  /** 마이 탭 · 스크린골프 연동 관리 */
  SCREEN_GOLF_MENU: false,
  /** 마이 탭 · 장비 핏 추천 */
  EQUIPMENT_FIT_MENU: false,
  /** 리포트 상세 · 골프존(비거리/구질/방향편차/스핀) 섹션 */
  REPORT_GOLFZON_SECTION: false,
  /**
   * 프리미엄 결제/체크아웃.
   * 세부 지표·AR 가이드 등 유료 가치가 채워지기 전까지 false.
   */
  PREMIUM_CHECKOUT: false,
} as const;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;

export function isFeatureEnabled(key: FeatureFlagKey): boolean {
  return FEATURE_FLAGS[key] === true;
}
