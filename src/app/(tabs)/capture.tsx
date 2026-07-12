/** 스윙 캡처 라우트 — Dev Client 실기기에서만 카메라/포즈 동작 */

import CaptureConsentGate from '@/features/swing-capture/components/CaptureConsentGate';
import SwingCaptureScreen from '@/features/swing-capture/screens/SwingCaptureScreen';

export default function CaptureRoute() {
  return (
    <CaptureConsentGate>
      <SwingCaptureScreen />
    </CaptureConsentGate>
  );
}
