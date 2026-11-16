# 베베픽 순번 알리미 — 공용 모바일 사이트

GitHub Pages + Supabase Edge Function 기반. 개인용 `queue.narin.day`과 완전히 별도이며, 공개 주소는 **https://bebepik.narin.day/** 입니다.

## GitHub Pages 설정
1. GitHub 저장소 **Settings → Pages**를 열고, Build and deployment에서 **Deploy from a branch**, Branch **main**, Folder **/(root)** 선택 후 Save.
2. Custom domain은 `bebepik.narin.day`로 지정합니다. (루트의 `CNAME` 파일 포함)
3. Pages 주소 `https://chenarin.github.io/bebepik-community/`가 정상 표시되고, 도메인 DNS 연결을 점검한 뒤 Vercel에서 관리 중인 `narin.day` DNS에 `bebepik` CNAME을 추가합니다.
4. GitHub Pages용 DNS는 `chenarin.github.io`를 가리킵니다. 기존 개인용 도메인 `queue.narin.day`는 변경하지 않습니다.

## 제공 기능
- 이메일 없이 닉네임을 **기기 로컬 저장소**에 저장.
- 베베픽/베베픽 플러스 순번 조회, 검증된 최신 데이터가 있을 때만 3명 전/내 차례 알림.
- 갤럭시 Chrome / 삼성 인터넷 및 아이폰 Safari 홈 화면 추가에 대응.
- 페이지 활성 상태에서 15초 간격으로 조회. **페이지를 닫은 상태의 백그라운드 푸시 미구현.**
- 서버에서 현재 방송의 순번 목록을 전달하지 않으면 '연결 대기'를 표시하고 **임의로 순번을 추측하지 않음**.

## 데이터 백엔드
Supabase 프로젝트 `bebepick-notifier`. `community-queue` Edge Function:
`https://btstscucvmdzvoefzjwf.supabase.co/functions/v1/community-queue`

POST 갱신은 신뢰할 수 있는 운영자 서버에서만 실행해야 하며, 일반 사용자 브라우저에는 service_role을 절대로 포함하지 마세요. 공개 자동 감시 기능 완성에는 정확한 순번 공급원이 추가로 필요합니다.

## 주의
이 저장소는 **Public**입니다. API 비밀키, push 개인키, 베베픽 로그인 정보 및 사용자 개인정보를 업로드하지 마세요.
