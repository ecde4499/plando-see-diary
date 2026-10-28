'use strict';
document.addEventListener('DOMContentLoaded', () => {
  const holder = document.querySelector('.t07-card');
  const section = document.createElement('section');
  section.className = 'account-delete-section';
  const title = document.createElement('h2');
  title.textContent = '계정 삭제';
  const notice = document.createElement('p');
  notice.textContent = '해당 계정에 연결된 데이터가 영구 삭제됩니다.';
  const form = document.createElement('form');
  const label = document.createElement('label');
  label.textContent = '계정 비밀번호';
  const password = document.createElement('input');
  password.type = 'password';
  password.required = true;
  label.append(password);
  const button = document.createElement('button');
  button.type = 'submit';
  button.className = 'button danger';
  button.textContent = '계정 영구 삭제';
  form.append(label, button);
  section.append(title, notice, form);
  holder.append(section);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const confirmed = window.confirm('계정과 계정에 연결된 기록을 복구할 수 없게 삭제할까요?');
    if (!confirmed) return;
    button.disabled = true;
    try {
      const response = await fetch('/api/auth/delete-account', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password.value })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || '삭제 실패');
      window.location.replace('/');
    } catch (error) {
      document.getElementById('accountMessage').textContent = error.message;
      button.disabled = false;
    }
  });
});
