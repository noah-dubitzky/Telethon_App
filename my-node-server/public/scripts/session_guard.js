(function () {
  'use strict';

  let leaving = false;
  function denied(status, body) {
    if (leaving) return;
    if (status === 403 && body?.error === 'ACCOUNT_NOT_APPROVED') {
      leaving = true;
      window.location.replace('/?reason=account-not-approved');
    } else if (status === 401) {
      leaving = true;
      window.location.replace('/');
    }
  }
  // Cover both fetch-based screens and the existing jQuery/XHR screens.
  const originalFetch = window.fetch.bind(window);
  window.fetch = async function (...args) {
    const response = await originalFetch(...args);
    if (response.status === 401 || response.status === 403) {
      const url = new URL(response.url || '/', window.location.origin);
      if (url.origin === window.location.origin) {
        const body = await response.clone().json().catch(() => null);
        denied(response.status, body);
      }
    }
    return response;
  };
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', () => {
      if (![401, 403].includes(this.status)) return;
      const url = new URL(this.responseURL || '/', window.location.origin);
      if (url.origin !== window.location.origin) return;
      let body;
      try { body = this.responseType === 'json' ? this.response : JSON.parse(this.responseText); } catch (_) {}
      denied(this.status, body);
    }, { once: true });
    return originalSend.apply(this, args);
  };
  // Idle pages also leave promptly; backend authorization does not depend on this timer.
  setInterval(() => { window.fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' }).catch(() => {}); }, 15000);

  // Prevent protected page content from briefly appearing before the server
  // confirms that the browser has a valid Telesaver session.
  document.documentElement.style.visibility = 'hidden';

  fetch('/api/auth/me', {
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json'
    }
  })
    .then(function (response) {
      if (response.status === 401 || leaving) {
        return null;
      }

      if (!response.ok) {
        throw new Error('Unable to verify the current session');
      }

      return response.json();
    })
    .then(function (data) {
      if (!data) {
        return;
      }

      window.telesaverUser = data.user;

      document
        .querySelectorAll('[data-user-email], #username')
        .forEach(function (element) {
          element.textContent = data.user.email;
        });

      const emailInitial = String(data.user.email || '').trim().charAt(0).toUpperCase() || '?';
      document
        .querySelectorAll('[data-user-initial]')
        .forEach(function (element) {
          element.textContent = emailInitial;
        });

      document.documentElement.style.visibility = '';

      document.dispatchEvent(
        new CustomEvent('telesaver:authenticated', {
          detail: data.user
        })
      );
    })
    .catch(function () {
      // The APIs on the page remain protected by the server even if the
      // authentication-status request fails for a temporary network reason.
      document.documentElement.style.visibility = '';
    });

  document.addEventListener('click', function (event) {
    const button = event.target.closest('[data-logout]');

    if (!button) {
      return;
    }

    button.disabled = true;
    button.textContent = 'Logging out…';

    fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin'
    }).finally(function () {
      window.location.replace('/');
    });
  });
})();
