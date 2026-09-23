# 플랜두씨 다이어리 1 — 내 계획과 실제를 담는 앱

Plan(계획) → Do(실제로 한 일) → See(돌아보기) → Next Plan 흐름을 하나로 연결하는 공개형 다이어리 웹앱입니다. 단순 Todo가 아니라 **예상(Plan/Task)** 과 **실제(Execution)** 를 분리해서 저장하고, 돌아보기 수치에서 실제 근거 기록까지 추적할 수 있게 구성했습니다.

> 지금은 로그인이 없어 링크를 아는 사람은 누구나 볼 수 있습니다. 남이 봐도 괜찮은 내용만 넣으세요

## 기술 스택

- Frontend: HTML / CSS / Vanilla JavaScript
- Backend: Node.js 20+ / Express
- Database: PostgreSQL
- DB Driver: `pg`
- Security headers: `helmet`
- Time: DB의 시각은 `TIMESTAMPTZ`, 표시와 지연 판정은 `Asia/Seoul`
- Duration unit: 모든 예상/실제 소요 시간은 **분(minutes)**

## Plan → Do → See 구조

- **Plan**: 제목, 기간, 우선순위, 성공 기준, 예상 시간을 저장합니다. 수정할 때 기존 내용을 `plan_revisions`에 먼저 보존합니다.
- **Tasks**: 하나의 Plan에 연결됩니다. 마감일/우선순위/태그/예상 시간/상태를 가지며 삭제는 soft delete입니다.
- **Do**: Task에 실제 시작/종료/실제 분/막힌 이유를 기록합니다. 예상 시간은 덮어쓰지 않습니다.
- **See**: 삭제되지 않은 Task를 기준으로 계획 수, 완료 수, 지연 수, 막힘 수, 예상/실제/차이를 계산합니다. 주요 집계 숫자는 클릭해 실제 근거를 볼 수 있습니다.
- **Next Plan**: 돌아보기 개선점을 `reflections`에 저장하고 다음 Plan 생성 시 관계를 DB에 남깁니다.

## 프로젝트 구조

```text
public/                 브라우저 UI
server/                 Express API + 집계 함수
db/schema.sql           PostgreSQL 스키마/마이그레이션 SQL
db/migrate.js           스키마 적용 스크립트
contracts/pds-schema-v2.json
                        DB 계약 파일
tests/                  자동 확인 가능한 테스트
SUBMISSION.md            제출문 템플릿
TEST_RESULTS.md          현재 검증 결과
.env.example             필요한 환경 변수 이름 예시
```

## 실행 방법

1. Node.js 20 이상과 PostgreSQL DB를 준비합니다.
2. 프로젝트 루트에서 `npm install`을 실행합니다.
3. `.env.example`을 복사해 `.env`를 만들고 실제 `DATABASE_URL`을 **서버 환경에만** 입력합니다.
4. `npm run migrate`로 DB 스키마를 생성합니다.
5. `npm start`를 실행합니다.
6. 브라우저에서 `http://localhost:3000`을 엽니다.

예시 명령:

```bash
cp .env.example .env
npm install
npm run migrate
npm test
npm start
```

## DB 설정 방법

`DATABASE_URL`에는 PostgreSQL 연결 문자열을 넣습니다. 로컬 PostgreSQL을 사용하거나 관리형 PostgreSQL/Supabase의 **서버용 PostgreSQL 연결 문자열**을 사용할 수 있습니다.

```env
PORT=3000
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME
DATABASE_SSL=true
```

중요: 실제 값이 들어간 `.env`는 Git에 올리지 않습니다. `.gitignore`에 `.env`가 포함되어 있습니다. 브라우저 JS는 `DATABASE_URL`을 전혀 읽지 않으며 `/api/*`만 호출합니다.

## 데이터 구조

상세 계약은 `contracts/pds-schema-v2.json`을 확인하세요.

- `plans` — 현재 계획
- `plan_revisions` — 계획 수정 직전 버전
- `tasks` — 계획에 연결된 할 일, `deleted_at` 기반 soft delete
- `execution_logs` — 실제 실행 기록
- `completion_events` — 완료 이벤트, DB UNIQUE로 중복 완료 방지
- `reflections` — 돌아보기 개선점과 다음 계획 연결

## 완료 중복 방지

프론트 버튼 잠금만 사용하지 않습니다.

1. 완료 요청에 동일 task용 idempotency key를 보냅니다.
2. 서버는 트랜잭션 안에서 `completion_events`를 기록합니다.
3. DB의 `UNIQUE(task_id, idempotency_key)`와 `UNIQUE INDEX ... (task_id) WHERE active = TRUE`가 동일 task의 활성 완료 이벤트를 한 건만 허용합니다.
4. 완료 → 진행 중으로 되돌릴 때 기존 완료 이벤트는 삭제하지 않고 `active=false`와 `reopened_at`을 기록해 이력을 보존합니다. 이후 다시 완료하면 새 완료 이벤트가 생깁니다.

## XSS 방지

사용자 입력을 화면에 표시할 때 DOM의 `textContent`를 사용합니다. `<script>alert(1)</script>` 같은 문자열을 저장해도 HTML로 실행하지 않고 일반 문자열로 보여 줍니다. 사용자 입력을 `innerHTML`에 넣지 않습니다.

## 전체 데이터 내보내기

상단의 **내 자료 내보내기** 버튼은 다음 데이터를 UTF-8 JSON 한 파일로 내려받습니다.

- plans
- plan_revisions
- tasks
- execution_logs
- completion_events
- reflections

## 테스트 방법

자동 확인:

```bash
npm test
```

자동 테스트는 See 계산 규칙, 0 처리, 경고 문구, 브라우저의 `localStorage`/`innerHTML`/DB 비밀 사용 여부, DB UNIQUE, revision/soft delete, 계약 JSON을 확인합니다.

실제 DB 저장/새로고침 복원/공개 URL/실제 사용자 데이터 수량은 배포 DB와 실제 입력이 필요하므로 `TEST_RESULTS.md`에서 **수동 확인 필요**로 구분합니다. 직접 확인하지 않은 항목을 PASS로 쓰지 않습니다.

## 배포 방법

Node.js 서버 실행과 PostgreSQL 연결을 지원하는 호스팅에 배포할 수 있습니다.

1. Git 저장소에 소스를 올리되 `.env`는 제외합니다.
2. 호스팅에서 Node.js 20+ 앱을 만들고 시작 명령을 `npm start`로 지정합니다.
3. 호스팅의 서버 환경 변수에 `DATABASE_URL`, 필요 시 `DATABASE_SSL=true`, `PORT`를 설정합니다.
4. 배포 전 또는 배포 과정에서 `npm run migrate`를 한 번 실행합니다.
5. 결과물 URL을 시크릿 창에서 로그인 없이 열어 확인합니다.
6. 소스 저장소도 평가자가 로그인 없이 열 수 있도록 공개 상태를 확인합니다.

DB와 웹 서버를 분리해서 배포해도 됩니다. 중요한 점은 **브라우저에 DB 비밀번호/서버 비밀값을 노출하지 않는 것**입니다.

## 실제 제출 데이터

초기 가짜 사용자 데이터는 넣지 않았습니다. 제출 전에 앱에서 직접 다음을 입력해야 합니다.

- **사용자 실제 데이터 입력 필요**: 실제 계획 1개 이상
- **사용자 실제 데이터 입력 필요**: 그 계획의 실제 할 일 5개 이상
- **사용자 실제 데이터 입력 필요**: 실제 실행 기록 3개 이상
- **사용자 실제 데이터 입력 필요**: See 화면 집계가 전부 0이 아닌 상태

## 공개 상태 주의사항

로그인이 없습니다. URL을 아는 사람은 저장된 데이터를 볼 수 있습니다. 개인정보, 비밀번호, 민감한 업무정보를 넣지 마세요.

## 제출 전 필수 수동 확인

- DB에 데이터 저장 후 새로고침해 동일한 ID/날짜/값/단위가 복원되는지
- 완료 버튼을 빠르게 두 번 눌러 `completion_events`가 1건인지
- `<script>alert(1)</script>`를 제목/내용/막힌 이유에 넣어도 실행되지 않는지
- 실제 계획 1+, 할 일 5+, 실행 기록 3+를 본인이 입력했는지
- 공개 결과물 URL/소스 URL이 새 시크릿 창에서 로그인 없이 열리는지
- 배포 파일/브라우저 Network/Console/Git 기록에 서버 비밀값 원문이 없는지

과제 고정 테스트별 상태는 `TEST_RESULTS.md`를 참고하세요.
