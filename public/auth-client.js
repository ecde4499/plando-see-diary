'use strict';
// Authentication UI controller. The diary is unlocked only by /api/auth/me.
document.addEventListener('DOMContentLoaded', () => {
  const byId = id => document.getElementById(id);
  const screen = byId('authScreen');
  if (!screen) return;
  const shell = byId('appShell');
  const form = byId('authForm');
  const error = byId('authError');
  const submit = byId('authSubmit');
  const email = byId('authEmail');
  const password = byId('authPassword');
  let mode = 'login';
  let busy = false;
  const showError = message => {
    error.textContent = message;
    error.hidden = !message;
  };
  const switchMode = next => {
    mode = next;
    byId('showLogin').setAttribute('aria-pressed', String(mode === 'login'));
    byId('showRegister').setAttribute('aria-pressed', String(mode === 'register'));
    byId('showLogin').className = 'button' + (mode === 'login' ? '' : ' secondary');
    byId('showRegister').className = 'button' + (mode === 'register' ? '' : ' secondary');
    byId('passwordHint').hidden = mode !== 'register';
    password.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    submit.textContent = mode === 'register' ? '회원가입' : '로그인';
    showError('');
  };
  async function callAuth(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin', cache: 'no-store', ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data.error || '인증 요청에 실패했습니다.');
      err.status = response.status;
      throw err;
    }
    return data;
  }
  function loggedIn(user) {
    screen.hidden = true;
    shell.hidden = false;
    byId('currentUserEmail').textContent = user.email;
    password.value = '';
    showError('');
    window.dispatchEvent(new Event('pds:authenticated'));
  }
  function loggedOut(message = '') {
    shell.hidden = true;
    screen.hidden = false;
    byId('currentUserEmail').textContent = '';
    password.value = '';
    switchMode('login');
    showError(message);
    window.dispatchEvent(new Event('pds:signed-out'));
  }
  window.pdsAuthRequired = () => loggedOut('로그인이 만료되었습니다. 다시 로그인해 주세요.');
  byId('showLogin').addEventListener('click', () => switchMode('login'));
  byId('showRegister').addEventListener('click', () => switchMode('register'));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    submit.disabled = true;
    showError('');
    try {
      const data = await callAuth('/api/auth/' + mode, {
        method: 'POST', body: JSON.stringify({ email: email.value, password: password.value })
      });
      loggedIn(data.user);
    } catch (err) { showError(err.message); }
    finally { busy = false; submit.disabled = false; }
  });
  byId('logoutBtn').addEventListener('click', async () => {
    try {
      await callAuth('/api/auth/logout', { method: 'POST', body: '{}' });
      loggedOut();
    } catch (err) { showError(err.message); loggedOut('로그아웃을 확인할 수 없습니다. 다시 로그인해 주세요.'); }
  });
  callAuth('/api/auth/me')
    .then(data => loggedIn(data.user))
    .catch(err => {
      if (err.status === 401) loggedOut();
      else loggedOut('서버 인증 상태를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.');
    });
});
