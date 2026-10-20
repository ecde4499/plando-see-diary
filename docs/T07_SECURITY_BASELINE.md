# T07 인증 도입 전 코드 점검 (2026-10-20)

## 확인 범위
- 기준: `assignment-7` 브랜치의 기존 T06 코드
- 파일: `server/index.js`, `server/db.js`, `db/schema.sql`, `db/migrate.js`, `public/index.html`, `public/app.js`, `package.json`, `.gitignore`
- 이 문서는 **정적 코드 점검 결과**이며 실제 DB나 배포 환경의 동작을 검증한 결과가 아니다.

## 기존 구조
- Express + PostgreSQL(`pg`), Vanilla JS 프론트엔드
- 6개 데이터 테이블: `plans`, `plan_revisions`, `tasks`, `execution_logs`, `completion_events`, `reflections`
- 계획 수정 이력, soft delete, 완료 이벤트 멱등성, See 집계/근거, JSON 내보내기 구현

## 인증 전 위험
1. `server/index.js`: 데이터 API에 인증 미들웨어와 소유자 조건이 없다.
2. `GET /api/export`: 6개 테이블 전체를 조회한다. T07에서 반드시 로그인 사용자 소유 자료만 내보내야 한다.
3. `public/index.html`: 공개형 화면이 즉시 제공되고, `public/app.js`는 시작 시 데이터 API를 호출한다. 로그인 전 화면과 데이터 요청을 분리해야 한다.
4. `db/schema.sql`: 사용자/세션 테이블 및 소유자 열이 없다. 기존 레코드의 관계를 유지하는 추가 마이그레이션이 필요하다.
5. `server/db.js`: DB 접속 정보는 서버 환경변수에서 읽는다. 운영 비밀을 Git에 넣지 않는다.

## 안전한 구현 순서
1. 테스트용 격리 DB와 T06 기준 커밋 확인
2. 비파괴적인 users/sessions/owner 스키마 설계 및 마이그레이션 작성 (운영 DB 미실행)
3. 서버 세션·암호 해시·가입/로그인/로그아웃·CSRF 방어 구현
4. 모든 자료 API에 소유자 조건 적용; 연관 객체의 동일 소유자 검증
5. 프론트 로그인 게이트 구현
6. A/B 양방향 HTTP 인가 테스트와 T06 회귀 테스트
7. 운영 데이터 백업 및 계정 귀속 계획을 별도 승인받고 배포

## 검증 상태
- GitHub 코드 열람: 확인
- 운영 DB 백업/마이그레이션: NOT RUN
- 인증/인가 HTTP 테스트: NOT RUN
- Render 배포: NOT RUN
- 실제 5일 사용 기록: NOT RUN
