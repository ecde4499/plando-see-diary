'use strict';
// One-time T07 staging-only browser capture and clearly labeled SIMULATED sample data.
// No existing A/B test account credentials or T06 endpoints are read.
const { chromium } = require('playwright-core');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const BASE = 'https://plando-see-diary-t07-ecde4499.onrender.com';
const out = path.resolve('test-results/t07-demo-captures');
const dates = ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'];
const minutes = [30, 45, 50, 55, 60];
const names = [
  '시연용 목표 정리', '시연용 첫 집중 세션', '시연용 실습 복습',
  '시연용 규칙 변경 적용', '시연용 결과 정리'
];
const screenshotNames = [];
fs.mkdirSync(out, { recursive: true });

function safeError(msg) {
  // Only known success/failure metadata should enter public CI logs.
  throw new Error(msg);
}
async function requireStatus(res, expected, operation) {
  if (res.status() !== expected) {
    const reason = await res.json().catch(() => ({}));
    safeError(operation + ': HTTP ' + res.status() + ', message=' + String(reason.error || 'unknown').slice(0, 110));
  }
  return res.json().catch(() => ({}));
}
async function main() {
  const chromeCandidates = [
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/opt/google/chrome/chrome', '/usr/bin/chromium'
  ];
  const exe = chromeCandidates.find(p => fs.existsSync(p));
  const browser = await chromium.launch({
    ...(exe ? { executablePath: exe } : {}),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const context = await browser.newContext({
    viewport: { width: 1365, height: 900 },
    deviceScaleFactor: 1, locale: 'ko-KR', timezoneId: 'Asia/Seoul'
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const screenshot = async name => {
    await page.screenshot({ path: path.join(out, name), fullPage: true });
    screenshotNames.push(name);
    console.log('SCREENSHOT', name);
  };
  try {
    const resp = await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 180000 });
    assert.equal(resp.status(), 200, 'staging login screen');
    await page.locator('#authForm').waitFor({ state: 'visible' });
    await screenshot('01-login.png');

    await page.locator('#showRegister').click();
    await page.locator('#passwordHint').waitFor({ state: 'visible' });
    await screenshot('02-register.png');
    const email = 't07-simulation-' + crypto.randomBytes(9).toString('hex') + '@example.test';
    const password = crypto.randomBytes(25).toString('base64url') + 'Aa1!';
    await page.locator('#authEmail').fill(email);
    await page.locator('#authPassword').fill(password);
    const registered = page.waitForResponse(r => r.url().endsWith('/api/auth/register') && r.request().method() === 'POST', { timeout: 60000 });
    await page.locator('#authSubmit').click();
    const regResponse = await registered;
    assert.equal(regResponse.status(), 201, 'one-time simulation account registration');
    await page.locator('#appShell').waitFor({ state: 'visible' });
    console.log('PASS actual browser registration (201) using disposable simulation account');
    const api = async (method, endpoint, data, code) => {
      const response = await context.request.fetch(BASE + endpoint, {
        method,
        ...(data === undefined ? {} : { data }),
        headers: { Origin: BASE },
        timeout: 120000
      });
      return requireStatus(response, code, method + ' ' + endpoint);
    };
    const planInput = {
      title: '[시연용 가상 데이터] 5일 집중 학습 기록 (실사용 아님)',
      start_date: dates[0], end_date: dates[4], priority: '보통',
      success_criteria: '[가상/시연] 60분 세션 목표로 연습하는 설정. 실제 기록이 아닙니다.',
      estimated_minutes: 60
    };
    const plan = await api('POST', '/api/plans', planInput, 201);
    assert.ok(plan.id);
    const taskIds = [];
    for (let i = 0; i < 5; i++) {
      if (i === 2) {
        const changed = {
          ...planInput,
          success_criteria: '[가상/시연] 집중 세션 목표를 60분에서 30분으로 바꾼 설정. 과거 실제 변경이 아닙니다.',
          estimated_minutes: 30
        };
        const newPlan = await api('PUT', '/api/plans/' + plan.id, changed, 200);
        assert.equal(newPlan.id, plan.id);
      }
      const task = await api('POST', '/api/tasks', {
        plan_id: plan.id,
        title: '[가상 ' + (i + 1) + '일차] ' + names[i],
        content: '2026-11-04에 일괄 생성한 가상 데이터입니다. 실제 수행 기록이 아닙니다.',
        due_date: dates[i], priority: i < 2 ? '보통' : '높음',
        tags: ['가상', '시연'], estimated_minutes: i < 2 ? 60 : 30
      }, 201);
      taskIds.push(task.id);
      const h = '09:00:00';
      const endHour = 9 + Math.floor(minutes[i] / 60);
      const endMin = String(minutes[i] % 60).padStart(2, '0');
      const execution = await api('POST', '/api/executions', {
        task_id: task.id,
        started_at: dates[i] + 'T' + h + '+09:00',
        ended_at: dates[i] + 'T' + String(endHour).padStart(2, '0') + ':' + endMin + ':00+09:00',
        actual_minutes: minutes[i],
        blocked_reason: '[가상 데이터] 시험용 입력, 실제 장애나 사용자 경험을 의미하지 않음'
      }, 201);
      assert.equal(execution.actual_minutes, minutes[i]);
      if (i < 4) {
        await api('POST', '/api/tasks/' + task.id + '/complete', {
          idempotency_key: crypto.randomUUID()
        }, 200);
      }
    }
    await api('POST', '/api/reflections', {
      source_plan_id: plan.id,
      improvement_text: '[시연용 가상 회고] 집중 세션을 60분에서 30분으로 변경한 설정을 예시로 사용. 실제 경험 아님.'
    }, 201);

    const plans = await api('GET', '/api/plans', undefined, 200);
    const tasks = await api('GET', '/api/tasks', undefined, 200);
    const executions = await api('GET', '/api/executions', undefined, 200);
    const revisions = await api('GET', '/api/plans/' + plan.id + '/revisions', undefined, 200);
    const exportData = await api('GET', '/api/export', undefined, 200);
    assert.equal(plans.length, 1); assert.equal(tasks.length, 5);
    assert.equal(executions.length, 5); assert.equal(revisions.length, 1);
    assert.equal(exportData.execution_logs.length, 5);
    assert.equal(executions.reduce((sum, x) => sum + x.actual_minutes, 0), 240);
    console.log('PASS sample account isolated records: 1 plan, 5 tasks, 5 logs, 1 revision, 1 reflection');

    const diaryResp = await page.goto(BASE + '/diary', { waitUntil: 'networkidle', timeout: 120000 });
    assert.equal(diaryResp.status(), 200);
    await page.waitForFunction(() => document.getElementById('dashboardLogs')?.textContent.trim() === '5', { timeout: 40000 });
    // The overlay is screenshot-only and is NOT deployed as application UI.
    await page.addStyleTag({ content: '.t07-account-email {display:none!important}' });
    await page.evaluate(() => {
      const note = document.createElement('div');
      note.id = 'demoEvidenceOverlay';
      note.textContent = '시연용 가상 데이터 · 실제 5일 사용 기록 아님';
      note.style.cssText = 'position:fixed;right:14px;bottom:14px;background:#172033;color:white;'+
        'font-size:15px;font-weight:700;padding:10px 14px;border-radius:8px;'+
        'z-index:99999;opacity:.93;pointer-events:none;box-shadow:0 3px 14px #0003';
      document.body.appendChild(note);
    });
    await screenshot('03-dashboard.png');
    const tabs = [
      ['plan', '04-plan.png'], ['tasks', '05-tasks.png'],
      ['do', '06-executions.png'], ['see', '07-see.png']
    ];
    for (const [tab, name] of tabs) {
      await page.locator('[data-tab="' + tab + '"]').click();
      await page.waitForTimeout(600);
      await screenshot(name);
    }
    await page.locator('[data-tab="plan"]').click();
    await page.getByRole('button', { name: '수정 이력' }).first().click();
    await page.locator('#historyDialog[open]').waitFor({ state: 'visible' });
    await screenshot('08-revision-history.png');

    const result = {
      label: 'SIMULATED / DEMO ONLY - NOT ACTUAL USER 5-DAY ACTIVITY',
      created_by: 'GitHub Actions browser test (one-time isolated T07 demo account)',
      date_input_note: 'All five past-dated examples entered during a single test run on 2026-11-04.',
      dates, minutes,
      before_avg_minutes: 37.5, after_avg_minutes: 55,
      difference_minutes_per_day: 17.5, change_percent: 46.7,
      counts: { accounts_created: 1, plans: 1, tasks: 5, executions: 5, revisions: 1, reflections: 1 },
      screenshots: screenshotNames
    };
    fs.writeFileSync(path.join(out, 'SIMULATED_EVIDENCE.json'), JSON.stringify(result, null, 2) + '\n');
    console.log('PASS one-time T07 demo screenshots, images=' + screenshotNames.length);
    // Always revoke the test session at the end; the demo data remains in its own account.
    await api('POST', '/api/auth/logout', {}, 200);
    console.log('PASS demo session revoked');
  } finally {
    await browser.close();
  }
}

main().catch(err => { console.error('DEMO_CAPTURE_FAILED:', err.message); process.exitCode = 1; });
