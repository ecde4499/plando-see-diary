# T07 브랜치 점검 및 안전한 검증 절차

## 이번 코드 변경의 범위
- 대상: `assignment-7` 브랜치 한정. `main`과 기존 Render 운영 배포는 변경하지 않음.
- 원본 `public/index.html`, `public/app.js`, `public/styles.css`는 보존.
- T07 서버는 `/`에 로그인·회원가입 화면을 표시하고, 로그인 후 `/diary`에서 원본 다이어리를 표시함.
- `/account`에 비밀번호 변경 및 확인을 거친 계정 삭제 UI를 제공함.
- 개인 데이터 API의 조회·기록·수정·삭제는 로그인 사용자 ID에 연결된 계획으로 소유권을 검증함.
- T06의 공개 DB 기록은 소유자 `NULL`인 상태로 남고, 회원가입만으로 가져오지 않음.

## 아직 실행하지 않은 사항
- 별도 PostgreSQL 테스트 DB에서의 실제 A/B 회원가입 및 데이터 격리 HTTP 검사.
- 과제6 운영 기록을 특정 계정 소유로 이전하는 절차.
- 운영 Supabase의 인증 마이그레이션, Render 배포.
- 실제 5일간의 작성 기록과 과제7 제출용 측정·설명 자료 완성.

## 안전한 로컬 확인
```bash
git switch assignment-7
git pull origin assignment-7
npm ci
npm test
```
`npm test`에는 기존 규칙 테스트, 인증 로직 구조 검사, 실제 HTTP 요청을 보내는 비인증 접근 smoke 검사가 포함됨. smoke 검사는 접속 불가능한 임시 DB 주소를 강제로 사용하므로 운영 DB를 조회하거나 변경하지 않음. **테스트 통과는 A/B DB 격리 실측을 의미하지 않음.**

## GitHub Actions 전용 DB 자동 검증
- `.github/workflows/t07-verify.yml`은 `assignment-7` 푸시 시 두 검증 작업을 실행하도록 구성함.
- `unit-and-http-smoke`: `npm ci`, `npm test`. 실제 서버 기반 비로그인 401 및 화면 이동 검사 포함.
- `isolated-postgres-http`: 매 실행마다 별도의 GitHub Actions `postgres:16` 서비스에서 `plando_test` 데이터베이스를 준비하고 `npm run test:http` 실행.
- 이 테스트는 저장소에 등록된 Supabase/Render 비밀 환경변수를 읽지 않으며 운영 DB에 연결하지 않음.
- JSON 증거: Actions 실행 결과 → `isolated-postgres-http` 작업 → **Artifacts** → `t07-http-evidence`. 케이스별 기대/실제 HTTP 상태와 검사 시각만 기록하며 이메일, 비밀번호, 쿠키 및 토큰을 기록하지 않음.
- **CI 상태는 실제 GitHub Actions 실행 결과로 확인**해야 하며, 설정 파일 생성만으로 PASS로 간주하지 않음.
- 테스트 DB에 과제6 형식의 계획·할 일·실행 기록을 **인증 마이그레이션 전에** 생성하고, 마이그레이션 후 내용/소유자 NULL 보존, A/B 계정에서 미노출, 다른 계정 삭제 후에도 원본 보존을 검증함.
- 로그아웃, 비밀번호 변경에 따른 세션 무효화, 계정 삭제, 출처 위조 차단도 같은 독립 DB에 대한 실제 HTTP 요청으로 검증하도록 작성함.
- 별도 DB에서 전체 DB 마이그레이션과 계정별 데이터 처리를 검증하더라도 운영 이전은 별도 승인과 백업이 필요함.

## 별도의 A/B 실제 HTTP 검사 (옵션, 별도 DB가 있어야 실행 가능)
```bash
# 운영 DATABASE_URL과 다른 폐기 가능한 PostgreSQL 데이터베이스를 준비
# 데이터베이스 이름에 _test가 포함돼야 함 (예: plando_test)
TEST_DATABASE_URL="postgres://.../plando_test" npm run test:http
```
기본적으로 로컬 테스트 DB만 허용함. 원격 테스트 DB를 사용하려면 폐기 가능한 테스트 DB인지 재확인한 뒤 명시적 옵트인이 필요함. 실행 스크립트는 `db/schema.sql`과 `db/migrations/007_auth_foundation.sql`을 해당 **테스트 DB**에 적용하고 실제 테스트 계정 및 기록을 만듦. 운영 Supabase 주소, 운영 DB 별칭, 기존 데이터가 있는 DB는 절대 사용 금지. 스크립트는 A/B 양방향의 조회·수정·삭제 일부 및 위조 소유자 ID와 헤더를 검사하지만, 전체 엔드포인트와 모든 공격 케이스를 망라하지 않음. 별도 DB에서 실제 결과 기록이 필요함.

## 서버 인증 설계
- 비밀번호: Node 내장 `crypto.scrypt`, 사용자별 무작위 salt, 해시만 저장.
- 세션: 32바이트 무작위 토큰. 서버 DB에는 SHA-256 토큰 해시 저장.
- 세션 쿠키: `HttpOnly`, `SameSite=Strict`, 운영 `NODE_ENV=production`일 때 `Secure`, 유효 기간 7일.
- 상태 변경 API: HTTP `Origin` 검증 및 인증 필수, 사용자 ID는 서버 세션에서만 가져옴.
- 로그아웃: 세션 폐기. 비밀번호 변경: 기존 모든 세션 무효화.
- 로그인/회원가입 간단한 IP 기반 속도 제한: 프로세스별 15회/15분. 다중 인스턴스 공통 제한은 아직 미적용.
- 운영 환경에서는 공인 HTTPS URL을 `PUBLIC_ORIGIN`에 설정하도록 권장 (예: `https://example.com`).

## 주의할 남은 리스크
- 실제 PostgreSQL DB 두 개 계정으로 양방향 접근 차단을 직접 입증해야 함.
- 운영 데이터의 소유자 지정과 백업·복원 리허설이 필요함.
- 분산 환경을 위한 공유 rate limiter, 운영 HTTPS/쿠키 정책 검증이 남음.
- 서비스의 권한 및 민감 요청에 대한 실제 브라우저·HTTP 검사를 완료하기 전에는 공개 배포하지 말 것.

**판정:** 구현 진행 중. 과제7 최종 제출 또는 운영 배포 적합 판정 아님.
