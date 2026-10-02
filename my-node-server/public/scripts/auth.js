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

    return xhr.responseJSON?.message || xhr.responseJSON?.error || fallback;
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
    if (new URLSearchParams(window.location.search).get('reason') === 'account-not-approved') {
      message('Your Telesaver account has not been approved yet.');
    }
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

    const signup = $('#signupForm');
    let signupId = null;
    let busy = false;
    let resendAt = 0;
    function renderSignup() {
      signup.find('[name=email], [name=password], [name=confirmation]').prop('disabled', busy || Boolean(signupId));
      signup.find('[name=code]').prop('disabled', busy || !signupId).prop('required', Boolean(signupId));
      signup.attr('aria-busy', String(busy));
      $('#signupVerification').prop('hidden', !signupId).toggleClass('hidden', !signupId);
      $('#signupDetails').prop('hidden', Boolean(signupId)).toggleClass('hidden', Boolean(signupId));
      $('#sendSignupCode').attr('type', signupId ? 'button' : 'submit').prop('disabled', busy || Boolean(signupId)).text(busy ? 'Sending code...' : 'Send verification code');
      $('#createSignupAccount').prop('disabled', busy || !signupId).text(busy ? 'Please wait...' : 'Create account');
      const seconds = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
      $('#resendSignupCode').prop('disabled', busy || seconds > 0).text(seconds ? `Resend code (${seconds}s)` : 'Resend code');
      $('#editSignupDetails').prop('disabled', busy);
    }
    setInterval(renderSignup, 1000);
    $('#editSignupDetails').on('click', function () {
      signupRequest('/api/auth/signup/cancel', { signupId }, function () {
        signupId = null;
        resendAt = 0;
        signup[0].reset();
        signup.find('[name=password]').attr('placeholder', 'Create a password');
        signup.find('[name=confirmation]').attr('placeholder', 'Repeat your password');
        $('#authMessage').addClass('hidden');
      });
    });
    function signupRequest(url, data, success) {
      busy = true;
      renderSignup();
      $.ajax({ url, method: 'POST', contentType: 'application/json', data: JSON.stringify(data) })
        .done(success)
        .fail(xhr => message(errorMessage(xhr, 'Unable to complete signup.')))
        .always(function () { busy = false; renderSignup(); if (signupId) signup.find('[name=code]').trigger('focus'); else signup.find('[name=email]').trigger('focus'); });
    }
    $('#resendSignupCode').on('click', function () {
      if (busy || Date.now() < resendAt) return;
      signupRequest('/api/auth/signup/resend-code', { signupId }, function (data) {
        resendAt = Date.now() + data.resendAfter * 1000;
        signup.find('[name=code]').val('');
        message('A new verification code has been sent. Use the latest code.', false);
      });
    });
    signup.on('submit', function (event) {
      event.preventDefault();
      if (busy) return;
      if (signupId) {
        signupRequest('/api/auth/signup/verify', { signupId, code: signup[0].code.value }, function () {
          signupId = null;
          signup[0].reset();
          showForm('login');
          message('Your account has been created and is awaiting administrator approval.', false);
        });
        return;
      }
      if (signup[0].password.value !== signup[0].confirmation.value) {
        message('Passwords do not match.');
        return;
      }
      signupRequest('/api/auth/signup/request-code', { email: signup[0].email.value, password: signup[0].password.value }, function (data) {
        signupId = data.signupId;
        resendAt = Date.now() + data.resendAfter * 1000;
        signup.find('[name=password], [name=confirmation]').val('');
        message('Check your email and enter the six-digit code below. It expires in 10 minutes.', false);
      });
    });
    renderSignup();
  });
})(jQuery);
