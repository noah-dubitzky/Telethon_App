(function ($) {
  'use strict';

  const dashboard = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    ? '/mobile/index.html'
    : '/desktop/index.html';

  function message(text, error = true) {
    $('#authMessage')
      .removeClass(
        'hidden bg-red-50 text-red-700 bg-green-50 text-green-700'
      )
      .addClass(
        error
          ? 'bg-red-50 text-red-700'
          : 'bg-green-50 text-green-700'
      )
      .text(text);
  }

  function pending(form, isPending, pendingLabel) {
    form.find('input, button').prop('disabled', isPending);

    const button = form.find('.submit-button');

    if (!button.data('label')) {
      button.data('label', button.text());
    }

    button.text(isPending ? pendingLabel : button.data('label'));
  }

  function errorMessage(xhr, fallback) {
    if (xhr.status === 0) {
      return 'The server is unavailable. Please try again.';
    }

    return xhr.responseJSON?.error || fallback;
  }

  function showForm(name) {
    const showLogin = name === 'login';

    $('#loginForm').toggleClass('hidden', !showLogin);
    $('#signupForm').toggleClass('hidden', showLogin);
    $('#showLogin').toggleClass('bg-white shadow', showLogin);
    $('#showSignup').toggleClass('bg-white shadow', !showLogin);
    $('#authMessage').addClass('hidden');
  }

  $(function () {
    $.get('/api/auth/me')
      .done(function () {
        window.location.replace(dashboard);
      })
      .fail(function (xhr) {
        if (xhr.status !== 401) {
          message(errorMessage(xhr, 'Unable to check your session.'));
        }

        $('#startupLoading').addClass('hidden');
        $('#authPanel').removeClass('hidden');
      });

    $('#showLogin').on('click', function () {
      showForm('login');
    });

    $('#showSignup').on('click', function () {
      showForm('signup');
    });

    $('#loginForm').on('submit', function (event) {
      event.preventDefault();

      const form = $(this);
      pending(form, true, 'Logging in…');

      $.ajax({
        url: '/api/auth/login',
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({
          email: form[0].email.value,
          password: form[0].password.value
        })
      })
        .done(function () {
          window.location.assign(dashboard);
        })
        .fail(function (xhr) {
          message(errorMessage(xhr, 'Unable to log in.'));
        })
        .always(function () {
          pending(form, false);
        });
    });

    $('#signupForm').on('submit', function (event) {
      event.preventDefault();

      const form = $(this);
      const password = form[0].password.value;
      const confirmation = form[0].confirmation.value;

      if (password !== confirmation) {
        message('Passwords do not match.');
        return;
      }

      pending(form, true, 'Creating account…');

      $.ajax({
        url: '/api/auth/register',
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({
          email: form[0].email.value,
          password
        })
      })
        .done(function () {
          window.location.assign('/settings.html');
        })
        .fail(function (xhr) {
          message(errorMessage(xhr, 'Unable to create account.'));
        })
        .always(function () {
          pending(form, false);
        });
    });
  });
})(jQuery);
