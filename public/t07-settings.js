'use strict';
document.addEventListener('DOMContentLoaded', async () => {
  const $ = id => document.getElementById(id);
  const message = $('accountMessage');
  const show = (text, error = false) => {
    message.textContent = text;
    message.className = error ? 'danger-text' : 'success-text';
  };
  try {
    const response = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('login');
    const { user } = await response.json();
    $('accountEmail').textContent = user.email;
  } catch {
    window.location.replace('/');
    return;
  }
  $('passwordForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.target.querySelector('button[type="submit"]');
    button.disabled = true;
    show('');
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: $('oldPassword').value,
          new_password: $('nextPassword').value
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '변경 요청에 실패했습니다.');
      event.target.reset();
      show('비밀번호가 변경됐습니다. 다시 로그인해 주세요.');
      window.location.replace('/');
    } catch (error) { show(error.message, true); }
    finally { button.disabled = false; }
  });
});
