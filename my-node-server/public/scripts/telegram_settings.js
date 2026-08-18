(function ($) {
  'use strict';

  let attemptId = null;

  const dashboard = /Mobi|Android|iPhone|iPad|iPod/i.test(
    navigator.userAgent
  )
    ? '/mobile/index.html'
    : '/desktop/index.html';

  function notice(text, error = true) {
    $('#settingsMessage')
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

  function errorMessage(xhr, fallback) {
    if (xhr.status === 0) {
      return 'The server is unavailable. Please try again.';
    }

    if (xhr.status === 429) {
      return 'Too many attempts. Please wait before trying again.';
    }

    if (xhr.status === 401) {
      window.location.replace('/');
      return 'Your login expired.';
    }

    return xhr.responseJSON?.error || fallback;
  }

  function pending(form, isPending, pendingLabel) {
    form.find('input, button').prop('disabled', isPending);

    const button = form.find('.submit-button');

    if (!button.data('label')) {
      button.data('label', button.text());
    }

    button.text(isPending ? pendingLabel : button.data('label'));
  }

  function showStep(selector) {
    $('#phoneForm, #codeForm, #passwordForm').addClass('hidden');
    $(selector).removeClass('hidden').find('input').first().trigger('focus');
  }

  function formatDate(value) {
    if (!value) {
      return 'Not available';
    }

    return new Date(value.replace(' ', 'T') + 'Z').toLocaleString();
  }

  function loadAccounts() {
    $('#accountLoading').removeClass('hidden').text('Loading…');

    return $.get('/api/telegram-accounts')
      .done(function (data) {
        const accountList = $('#accountList').empty();

        data.accounts.forEach(function (account) {
          const connected = account.connection_status === 'connected';
          const accountName =
            account.display_name || `Telegram ${account.telegram_user_id}`;

          const accountDetails = $('<div>')
            .append(
              $('<div class="font-semibold">').text(accountName)
            )
            .append(
              $('<div class="text-sm text-slate-500">').text(
                `Last connected: ${formatDate(account.connected_at)}`
              )
            );

          const status = $(
            '<span class="text-sm font-semibold rounded-full px-3 py-1 self-start">'
          )
            .addClass(
              connected
                ? 'bg-green-100 text-green-700'
                : 'bg-amber-100 text-amber-700'
            )
            .text(account.connection_status);

          $(
            '<article class="rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">'
          )
            .append(accountDetails)
            .append(status)
            .appendTo(accountList);
        });

        if (!data.accounts.length) {
          accountList.html(
            '<p class="text-slate-500">No Telegram account is connected yet.</p>'
          );
        }

        $('#connectButton')
          .removeClass('hidden')
          .text(
            data.accounts.length
              ? 'Connect another Telegram account'
              : 'Connect Telegram'
          );
      })
      .fail(function (xhr) {
        notice(
          errorMessage(xhr, 'Unable to load Telegram accounts.')
        );
      })
      .always(function () {
        $('#accountLoading').addClass('hidden');
      });
  }

  function connected() {
    attemptId = null;
    $('#connectFlow').addClass('hidden');
    notice('Telegram is connected.', false);
    loadAccounts();
  }

  $(function () {
    $('#dashboardLink').attr('href', dashboard);
    loadAccounts();

    $('#connectButton').on('click', function () {
      $(this).addClass('hidden');
      $('#connectFlow').removeClass('hidden');
      showStep('#phoneForm');
    });

    $('#phoneForm').on('submit', function (event) {
      event.preventDefault();

      const form = $(this);
      pending(form, true, 'Sending code…');

      $.ajax({
        url: '/api/telegram-connect/start',
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({
          phone_number: form[0].phone.value
        })
      })
        .done(function (data) {
          attemptId = data.attempt_id;
          notice('Telegram sent a verification code.', false);
          showStep('#codeForm');
        })
        .fail(function (xhr) {
          notice(
            errorMessage(xhr, 'Unable to send a Telegram code.')
          );
        })
        .always(function () {
          pending(form, false);
        });
    });

    $('#codeForm').on('submit', function (event) {
      event.preventDefault();

      const form = $(this);
      pending(form, true, 'Verifying…');

      $.ajax({
        url: '/api/telegram-connect/verify-code',
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({
          attempt_id: attemptId,
          code: form[0].code.value
        })
      })
        .done(function (data) {
          if (data.status === 'password_required') {
            showStep('#passwordForm');
          } else {
            connected();
          }
        })
        .fail(function (xhr) {
          notice(
            errorMessage(xhr, 'Unable to verify the Telegram code.')
          );
        })
        .always(function () {
          pending(form, false);
        });
    });

    $('#passwordForm').on('submit', function (event) {
      event.preventDefault();

      const form = $(this);
      const password = form[0].password.value;
      pending(form, true, 'Verifying…');

      $.ajax({
        url: '/api/telegram-connect/verify-password',
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({
          attempt_id: attemptId,
          password
        })
      })
        .done(connected)
        .fail(function (xhr) {
          notice(
            errorMessage(xhr, 'Unable to verify the Telegram password.')
          );
        })
        .always(function () {
          // Do not retain the Telegram password after the request finishes.
          form[0].password.value = '';
          pending(form, false);
        });
    });
  });
})(jQuery);
