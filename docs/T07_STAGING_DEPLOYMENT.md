# 과제7 별도 Render/Supabase 스테이징 배포 준비서

> **상태: 설정과 코드만 준비. 새 서비스 생성·DB 적용·배포는 실행하지 않았다.**
> 운영 사이트는 과제6의 `main` 브랜치와 기존 Supabase를 그대로 사용한다.

## 왜 완전히 분리하는가
과제7은 회원가입과 사용자별 소유권을 도입한다. 기존 과제6은 로그인 없는 공개형 다이어리다. 두 앱이 운영 DB를 공유하면 `plans.owner_user_id` 도입 전후 화면과 권한 동작이 달라져 원본 기록을 위험에 노출할 수 있다.

따라서 **과제7은 새 Render Web Service + 별도 PostgreSQL DB(새 Supabase 프로젝트 또는 별도 DB)**에서 먼저 검증한다. 동일한 GitHub 저장소를 사용해도 새 서비스의 **배포 브랜치를 `assignment-7`로 따로 선택**한다.

## 준비 순서
1. [GitHub Actions T07 verification](https://github.com/ecde4499/plando-see-diary/actions/workflows/t07-verify.yml)에서 최신 커밋의 `unit-and-http-smoke`, `isolated-postgres-http` 두 작업이 모두 통과했는지 확인한다.
2. 기존 과제6 운영 DB는 백업 방법과 복구 가능 여부를 확인한다. 운영 DB에 T07 SQL을 바로 적용하지 않는다.
3. **과제7 전용 새 Supabase 프로젝트/별도 PostgreSQL DB**를 생성한다. 운영 프로젝트의 DB 접속 정보를 복사하지 않는다.
4. 새 빈 DB에서만 `db/schema.sql`(과제6 기본 6개 테이블) → `db/migrations/007_auth_foundation.sql`(계정 테이블 및 계획 소유자 열)을 **순서대로** 적용한다. 새 DB 이름과 프로젝트 식별자를 적용 전에 다시 확인한다.
5. Render Dashboard에서 **New → Web Service**를 선택해 기존 GitHub 저장소 `ecde4499/plando-see-diary`를 연결한다. **기존 과제6 Web Service의 브랜치/환경변수를 수정하지 않는다.**
6. 새 Web Service는 다음 정보를 사용한다.

| 설정 | 값/설명 |
|---|---|
| 이름 | 새로운 고유 서비스명 (예: `plando-t07-stage`) |
| 브랜치 | **`assignment-7`** |
| 런타임 | Node.js, Node 20 이상 |
| Build Command | `npm ci` |
| Start Command | **`npm run start:t07:staging`** |
| Auto-Deploy | **Off** (수동 배포로 시작) |
| Health Check Path | `/api/health` |
| `NODE_ENV` | `production` |
| `T07_STAGING_DATABASE_URL` | 새로운 과제7 DB의 **서버용** PostgreSQL 연결 문자열 |
| `DATABASE_SSL` | 새 DB가 TLS를 요구하면 `true`; 로컬 전용 테스트 DB만 `false` |
| `PUBLIC_ORIGIN` | **새 Render 서비스의 정확한 HTTPS 주소**, 마지막 슬래시 없이 |
| `T07_STAGING_ACK` | `I_VERIFIED_SEPARATE_DATABASE` |

**스테이징 서비스에는 `DATABASE_URL`을 설정하지 않는다.** 전용 시작 명령이 `T07_STAGING_DATABASE_URL`을 검증한 후 내부적으로만 전달한다. `DATABASE_URL`이 이미 있거나 위 확인 문자열이 없으면 시작을 거부한다.

또한 Render에서 제공되는 `RENDER_GIT_BRANCH`, `RENDER_EXTERNAL_URL`, `RENDER_GIT_REPO_SLUG`이 실제 배포 시 알려지면 코드가 각각 브랜치, 서비스 URL, 저장소를 검사한다.

## 배포 후 반드시 실제로 확인할 것
1. 시크릿 창에서 `/` 열기 → 로그인/회원가입 화면만 표시.
2. `/diary`, `/account` 미로그인 직접 접근 → 로그인 화면으로 이동.
3. 새 계정 A와 B를 생성하고 `/api/auth/me` 본인 정보만 확인.
4. A로 계획 1개/할 일 1개/실행 기록 1개를 직접 등록 → 새로고침해 유지되는지 확인.
5. B 계정으로 로그인하면 A의 기록이 나타나지 않는지 확인.
6. A의 리소스 ID를 B로 요청해 404/빈 목록을 확인. 내보내기 JSON에서도 다른 사용자의 기록이 없는지 확인.
7. 로그아웃 후 이전 세션이 401이 되는지 확인.
8. 비밀번호 변경 후 이전 세션이 폐기되는지 확인.
9. `/api/health`가 DB 연결 성공을 표시하는지 확인.
10. 기존 과제6 운영 주소 `https://plando-see-diary.onrender.com/`가 **그대로 동작**하는지 확인.

## 운영 전환은 별도 작업
새 스테이징 계정에 과제6 기존 기록이 **자동으로 나타나지 않는 것이 정상**이다. 기존 운영 DB의 T06 기록을 새 DB로 옮기는 일은 단순한 계정 소유자 변경만으로 해결되지 않는다. 실제 기록을 이전하려면 **백업·선택적 복제·해당 계정 확인·관계 무결성 검증**을 별도로 설계하고 승인받아야 한다.

새 스테이징 DB는 비어 있고, 테스트 기록만 먼저 만든다. 과제7 제출용 **실제 5일 기록**은 본인이 새 서비스에서 직접 작성해야 한다. 실제로 작성하지 않은 날짜/수치는 생성하지 않는다.

## 주의
- `npm run migrate`는 과제6의 `db/schema.sql`만 실행한다. 과제7 인증 스키마가 자동으로 만들어지는 것은 아니다.
- 새로운 서비스가 자동으로 생성/배포되지 않는다. 이 문서는 나중에 Render 및 새 Supabase 프로젝트를 구성할 때 사용할 절차다.
- `.env`, DB 비밀번호, 쿠키, 세션 토큰 등은 채팅·GitHub·스크린샷에 공개하지 않는다.

## 참고
Render 공식 문서: https://render.com/docs/web-services · https://render.com/docs/deploys · https://render.com/docs/health-checks
