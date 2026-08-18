(function () {
  'use strict';

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
      if (response.status === 401) {
        window.location.replace('/');
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
