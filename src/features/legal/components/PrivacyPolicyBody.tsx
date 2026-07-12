/**
 * 개인정보 처리방침 본문 (온보딩 모달·전용 화면 공용).
 */

import { StyleSheet, Text, View } from 'react-native';

export default function PrivacyPolicyBody() {
  return (
    <View style={styles.wrap}>
      <Text style={styles.updated}>최종 업데이트: 2026.07.12</Text>

      <Text style={styles.h2}>1. 수집하는 개인정보</Text>
      <Text style={styles.p}>
        SwingCare는 서비스 제공을 위해 계정 정보(이메일·소셜 식별자), 신체·이력
        프로필(연령대·핸디캡·부상 이력 등), 스윙 세션 데이터(자세 좌표·분석
        리포트), 기기 정보, 구독 상태 등을 처리할 수 있습니다.
      </Text>

      <Text style={styles.h2}>2. 촬영 영상 및 라벨링·모델 개선 목적</Text>
      <Text style={styles.p}>
        이용자가 별도로 동의한 경우, 업로드·촬영된 스윙 영상을 서버에 저장하고
        스윙 구간 라벨링(재태깅) 및 AI·규칙 모델 품질 개선 목적으로 활용할 수
        있습니다. 이 과정에서 필요 시 라벨링 작업 위탁업체 등 제3자에게 영상이
        제공될 수 있습니다. 위탁 시에도 목적 달성 범위 내에서만 처리하며,
        관련 계약을 통해 보호 조치를 요구합니다.
      </Text>
      <Text style={styles.p}>
        해당 동의는 온보딩·촬영 동의 화면의 별도 체크박스로 받으며, 동의하지
        않으면 영상 기반 서버 저장·라벨링 활용은 이루어지지 않습니다. (동의
        철회·삭제 요청은 고객센터로 문의해 주세요.)
      </Text>

      <Text style={styles.h2}>3. 처리 목적</Text>
      <Text style={styles.p}>
        회원 관리, 스윙 분석·리포트 제공, 서비스 개선, 고객 지원, 법령상 의무
        이행, (동의 시) 라벨링·모델 고도화.
      </Text>

      <Text style={styles.h2}>4. 보관 및 파기</Text>
      <Text style={styles.p}>
        수집 목적 달성 또는 보관 기간 종료 시 지체 없이 파기합니다. 업로드 원본
        영상은 정책에 따른 보관 기간 후 Storage lifecycle 등으로 삭제될 수
        있습니다.
      </Text>

      <Text style={styles.h2}>5. 이용자 권리</Text>
      <Text style={styles.p}>
        개인정보 열람·정정·삭제·처리 정지·동의 철회를 요청할 수 있습니다. 앱 내
        고객센터 또는 운영 채널로 연락해 주세요.
      </Text>

      <Text style={styles.h2}>6. 문의</Text>
      <Text style={styles.p}>SwingCare 개인정보 보호 담당 · 앱 내 고객센터</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  updated: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9AA1B5',
  },
  h2: {
    fontSize: 15,
    fontWeight: '800',
    color: '#232630',
    marginTop: 4,
  },
  p: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4A5065',
    lineHeight: 21,
  },
});
