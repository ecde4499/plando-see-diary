# T07 인증 DB 마이그레이션 계획

## 상태
- 코드만 작성함. **운영 DB 미실행**.
- 적용 SQL: `db/migrations/007_auth_foundation.sql`
- 이 파일은 기존 `db/migrate.js`에서 자동 실행되지 않는다.
- T06 데이터는 보존하고 기존 `plans.owner_user_id`는 NULL로 남긴다.

## 스키마
- `app_users`: 정규화된 소문자 이메일(UNIQUE), 암호 해시, 비밀번호 변경 시각
- `auth_sessions`: 서버에서 발급한 난수 세션 토큰의 **해시만** 저장, 사용자 FK, 만료/철회 시각
- `plans.owner_user_id`: 계획 소유자. 기존 계획에는 자동 할당하지 않는다.
- Task, execution, completion, revision, reflection의 소유권은 관련 plan으로부터 조인하여 판정한다.

## 차단 규칙
- 로그인되지 않은 모든 데이터 API는 401.
- 소유자가 NULL인 기존 계획 및 하위 자료는 누구에게도 보이지 않는다.
- 다른 사용자의 계획과 연결된 task/reflection/next plan을 생성·수정할 수 없다.
- 계정 등록은 기존 NULL 자료를 가져오는 수단이 아니다.
- 전체 내보내기는 소유 계획과 그 하위 자료만 반환한다.

## 운영 이전 시 별도 승인 필요
1. Supabase 운영 DB의 안전한 백업 및 복구 가능 여부 확인
2. 마이그레이션을 별도 테스트 DB에서 실행
3. 실제 본인 계정 생성 및 계정 ID 확인
4. 서버 관리자 전용 절차로 기존 계획의 소유자 이전 (사용자 승인, 트랜잭션, 전후 건수 확인)
5. 운영 DB 적용 및 Render 배포는 사용자 승인 후 실시

## 검증
- SQL 문법/실제 DB 적용: NOT RUN
- T06 데이터 수 불변: NOT VERIFIED
- 계정 A/B 데이터 격리: NOT RUN
