(function () {
  'use strict';
  let csrfToken;
  let page = 0;
  const element = id => document.getElementById(id);
  const message = text => { element('message').textContent = text; };
  function showLogin() { element('dashboard').hidden = true; element('loginPanel').hidden = false; }
  async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch('/api/admin' + path, { method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken || '' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) showLogin();
      throw new Error(data.error || 'Request failed');
    }
    return data;
  }
  async function token() { csrfToken = (await request('/csrf')).csrfToken; }
  async function users() {
    const data = await request('/users?page=' + page);
    element('users').replaceChildren();
    for (const user of data.users) {
      const row = document.createElement('tr');
      const approved = Number(user.is_approved) === 1;
      for (const value of [user.id, user.email || '(No email)', approved ? 'Approved' : 'Not approved', user.created_at]) {
        const cell = document.createElement('td'); cell.textContent = String(value); row.append(cell);
      }
      const cell = document.createElement('td');
      const button = document.createElement('button');
      button.textContent = approved ? 'Revoke Access' : 'Approve';
      if (approved) button.className = 'revoke';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const result = await request('/users/' + encodeURIComponent(user.id) + '/approval', { isApproved: !approved }, 'PATCH');
          await users();
          message(result.worker_pause_pending ? 'Access revoked. Worker stop is awaiting confirmation; the worker also checks approval periodically.'
            : approved ? 'Access revoked. Telegram sessions paused.' : 'Account approved. The user can log in and reconnect Telegram accounts.');
        } catch (error) { message(error.message); button.disabled = false; }
      });
      cell.append(button); row.append(cell); element('users').append(row);
    }
    element('previous').disabled = page === 0;
    element('next').disabled = !data.has_more;
    element('page').textContent = 'Page ' + (page + 1);
    element('loginPanel').hidden = true; element('dashboard').hidden = false;
  }
  element('loginForm').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button'); button.disabled = true;
    try {
      await token();
      const data = await request('/login', { username: form.elements.username.value, password: form.elements.password.value });
      csrfToken = data.csrfToken; form.reset(); page = 0; await users(); message('');
    } catch (error) { message(error.message); }
    finally { button.disabled = false; }
  });
  element('logout').addEventListener('click', async () => {
    try { await request('/logout', {}); showLogin(); message('Logged out.'); await token(); }
    catch (error) { message(error.message); }
  });
  element('refresh').addEventListener('click', () => users().catch(error => message(error.message)));
  for (const [id, delta] of [['previous', -1], ['next', 1]]) element(id).addEventListener('click', () => {
    page += delta; users().catch(error => { page -= delta; message(error.message); });
  });
  (async () => {
    await token();
    await request('/me');
    await users(); message('');
  })().catch(error => { showLogin(); message(error.message === 'Administrator authentication required' ? '' : error.message); });
})();
