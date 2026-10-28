'use strict';
// Injected only on T07 /diary responses. Original T06 HTML stays untouched.
document.addEventListener('DOMContentLoaded', async () => {
  const originalWarning = document.querySelector('.public-warning');
  if (originalWarning) originalWarning.hidden = true;
  let user;
  try {
    const response = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('unauthenticated');
    const data = await response.json();
    user = data.user;
  } catch {
    window.location.replace('/');
    return;
  }
  const bar = document.createElement('div');
  bar.className = 't07-account';
  const email = document.createElement('span');
  email.className = 't07-account-email';
  email.textContent = user.email;
  const logout = document.createElement('button');
  logout.className = 'button ghost';
  logout.type = 'button';
  logout.textContent = '로그아웃';
  logout.addEventListener('click', async () => {
    logout.disabled = true;
    try {
      const result = await fetch('/api/auth/logout', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}'
      });
      if (!result.ok) throw new Error('logout failed');
      window.location.replace('/');
    } catch {
      logout.disabled = false;
      alert('로그아웃 요청에 실패했어요. 다시 시도해 주세요.');
    }
  });
  bar.append(email, logout);
  document.querySelector('.topbar')?.append(bar);
});
