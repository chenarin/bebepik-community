# 베베픽 공용 순번 알리미 ♡

**공용 주소:** https://bebepik.narin.day/  
**개인용 알리미:** https://queue.narin.day/ — 별개이며 수정하지 않습니다.

## 현재 구현

- GitHub Pages 정적 PWA (갤럭시 Chrome 및 iPhone Safari 홈 화면 추가).
- 이메일 없이 기기별 무작위 UUID + 256비트 토큰을 로컬 저장. 서버에는 SHA-256 토큰 해시만 저장.
- 사용자별 베베픽/플러스 선택, 방송 시작, 3명 전, 1명 전, 내 차례 알림 설정.
- Web Push API + Service Worker 기반 화면이 꺼진 상태의 푸시 수신 및 본인 기기 시험 발송/해제.
- Supabase `community-queue` 조회·검증된 순번 수신, `community-queue-push` 구독·푸시 발송.
- VAPID 키는 Supabase Vault에 저장; 공개키만 브라우저에 전송.
- 방송 ID / 기기 / 채널 / 알림 종류 단위 DB 발송 기록으로 중복 방지.
- 같은 방송 상태가 지속되면 방송 시작 알림을 반복 발송하지 않음.
- 실제 데이터가 불충분하거나 65초보다 오래되면 순번을 추측하지 않고 '연결 대기' 표시.

## 운영 전 필수 확인

1. **GitHub Pages HTTPS:** 저장소 Settings → Pages에서 사용자 지정 도메인 `bebepik.narin.day` 및 HTTPS 인증서/Enforce HTTPS 상태 확인. DNS CNAME은 `chenarin.github.io`. 인증서가 활성화되기 전에는 iOS 푸시를 사용하기 어렵습니다.
2. **기기 테스트:** 아이폰은 Safari에서 **홈 화면에 추가**한 후 홈 화면 앱에서 알림 허용. 갤럭시는 Chrome에서 알림 허용. '시험 알림 보내기' 버튼으로 실제 수신 확인.
3. **순번 데이터 소스:** 현재 공식적으로 허용된 베베픽 실시간 데이터 공급원이 연결되지 않았습니다. 신뢰할 수 있는 데이터 소스가 `community-queue` Edge Function에 방송 ID, 현재 진행 순번, 전체 순번 목록을 전송해야 실시간 푸시가 발생합니다. 공식 API/허가 없이 자동 수집하지 마세요.

## 서버 전송 형식 (허가된 데이터 공급원 전용)

`POST https://btstscucvmdzvoefzjwf.supabase.co/functions/v1/community-queue`

서버 측 요청만: `apikey` 헤더에 **Supabase service-role key** (공개 코드·브라우저에 넣지 말 것). 요청 본문 예시는 아래와 같습니다.

```json
{"site":"live","broadcastId":"unique-broadcast-id","current":17,"status":"active","entries":[{"nickname":"sample","position":20}]}
```

`site`: `live` 또는 `plus`, `status`: `active` 또는 `ended`. 올바른 상태 전송 시 Edge Function이 기기별 푸시를 트리거합니다. 위 예시를 실제 방송처럼 테스트 목적으로 보내지 마세요. 모든 사용자에게 가짜 알림이 갈 수 있습니다.

## 보안 및 제한

- 기기 알림 등록에는 푸시 구독과 기기별 토큰이 필요합니다. 다른 기기의 토큰을 모르고는 해당 기기를 수정/삭제/시험 발송할 수 없습니다.
- `community_queue_devices`, `community_queue_push_receipts`, 원본 순번표 테이블은 RLS 및 접근 제한 적용.
- 푸시 디스패치는 service-role 인증을 요구하고 공개 API는 인증되지 않은 디스패치를 거부합니다.
- 순번표 원본 목록을 브라우저에 전체 노출하지 않습니다. 단, 닉네임으로 자신의 순번을 조회하는 공개 API는 현재 인증이 없으므로, 운영 전 오남용 방지·개인정보 정책 추가 검토가 필요합니다.
- 이 저장소는 Public입니다. 비밀키·인증 쿠키·브라우저 로그인 정보·사용자별 기기 토큰을 GitHub에 올리지 마세요.
