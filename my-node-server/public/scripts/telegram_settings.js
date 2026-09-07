(function ($) {
  'use strict';

  let attemptId = null;
  let connectionNotice = null;
  const reauthenticateAccountId = new URLSearchParams(window.location.search)
    .get('reauthenticate_account_id');

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
    $('#connectStep').text(({ '#phoneForm': 'Step 1: Phone number', '#codeForm': 'Step 2: Verification code', '#passwordForm': 'Step 3: Two-step verification' })[selector]);
    $(selector).removeClass('hidden').find('input').first().trigger('focus');
  }

  function formatDate(value) {
    if (!value) {
      return 'Not available';
    }

    const raw = String(value).replace(' ', 'T');
    const date = new Date(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : raw + 'Z');
    return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleString();
  }

  function loadAccounts() {
    $('#accountLoading').removeClass('hidden').text('Loading…');

    return $.get('/api/telegram-accounts')
      .done(function (data) {
        const accountList = $('#accountList').empty();

        $('#accountCount').text(data.accounts.length);
        $('#retryAccounts').addClass('hidden');
        data.accounts.forEach(function (account) {
          const connected = account.connection_status === 'connected';
          const paused = account.archive_enabled === false || account.archive_enabled === 0;
          const name = account.display_name || `Telegram ${account.telegram_user_id}`;
          const phone = String(account.phone_number || '');
          const details = $('<div class="min-w-0 flex-1">')
            .append($('<h3 class="break-words font-semibold">').text(name))
            .append($('<p class="mt-1 text-sm text-slate-500">').text(phone ? `Phone ending in ${phone.slice(-4)}` : `Telegram ID: ${account.telegram_user_id}`))
            .append($('<p class="mt-1 text-xs text-slate-400">').text(`Last connected: ${formatDate(account.connected_at)}`));
          const labels = { disconnected: 'Disconnected', reconnecting: 'Reconnecting', error: 'Connection error', revoked: 'Reconnect needed', expired: 'Reconnect needed' };
          const status = $('<span class="shrink-0 rounded-full px-3 py-1 text-xs font-semibold">')
            .addClass(connected && !paused ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')
            .text(connected ? (paused ? 'Archiving paused' : 'Connected') : (labels[account.connection_status] || 'Reconnect needed'));
          $('<article class="flex flex-wrap items-center gap-4 p-5 sm:p-6">')
            .append($('<span aria-hidden="true" class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-50 text-lg font-bold text-blue-600">').text(name.charAt(0).toUpperCase()))
            .append(details)
            .append(status)
            .append($('<a class="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-600">')
              .attr('href', `/manage-account.html?telegram_account_id=${encodeURIComponent(account.id)}`)
              .attr('aria-label', `Manage ${name}`).text('Manage'))
            .appendTo(accountList);
        });
        if (!data.accounts.length) {
          accountList.html('<div class="px-6 py-14 text-center"><div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-2xl text-blue-600" aria-hidden="true">&#8599;</div><h3 class="font-semibold">Your first connection starts here</h3><p class="mt-2 text-sm text-slate-500">Connect a Telegram account to start building your archive.</p></div>');
        }

      })
      .fail(function (xhr) {
        $('#retryAccounts').removeClass('hidden');
        notice(
          errorMessage(xhr, 'Unable to load Telegram accounts.')
        );
      })
      .always(function () {
        $('#accountLoading').addClass('hidden');
      });
  }

  function connected(data) {
    attemptId = null;
    connectionNotice = 'Telegram is connected.';
    document.getElementById('connectDialog').close();
    if (reauthenticateAccountId && String(data?.account?.id) === reauthenticateAccountId) {
      window.location.replace(
        `/manage-account.html?telegram_account_id=${encodeURIComponent(reauthenticateAccountId)}`
      );
      return;
    }
    if (reauthenticateAccountId && data?.account) {
      connectionNotice = 'That was a different Telegram account. Re-authenticate with the account you selected.';
    }
    loadAccounts();
  }

  $(function () {
    $('#dashboardLink').attr('href', dashboard);
    loadAccounts();

    const dialog = document.getElementById('connectDialog');
    function openConnect() {
      attemptId = null;
      $('#phoneForm, #codeForm, #passwordForm').each(function () { this.reset(); });
      $('#settingsMessage').addClass('hidden').appendTo('#dialogNotice');
      $('#connectFlow').removeClass('hidden');
      dialog.showModal();
      showStep('#phoneForm');
    }
    function busy() { return $('#connectFlow .submit-button:disabled').length > 0; }
    $('#closeConnect').on('click', function () { if (!busy()) dialog.close(); });
    dialog.addEventListener('cancel', function (event) { if (busy()) event.preventDefault(); });
    dialog.addEventListener('close', function () {
      attemptId = null;
      $('#phoneForm, #codeForm, #passwordForm').each(function () { this.reset(); });
      $('#settingsMessage').addClass('hidden').appendTo('#pageNotice');
      if (connectionNotice) {
        notice(connectionNotice, connectionNotice !== 'Telegram is connected.');
        connectionNotice = null;
      }
      $('#connectButton').trigger('focus');
    });
    $('#connectButton').on('click', openConnect);
    $('#retryAccounts').on('click', function () {
      $('#settingsMessage').addClass('hidden');
      $(this).addClass('hidden');
      loadAccounts();
    });
    if (/^\d+$/.test(reauthenticateAccountId || '') && reauthenticateAccountId !== '0') {
      openConnect();
      notice('Sign in to the same Telegram account to replace its saved connection.', false);
    }
    const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
    function selectTab(tab) {
      tabs.forEach(function (item) {
        const selected = item === tab;
        item.setAttribute('aria-selected', String(selected));
        item.tabIndex = selected ? 0 : -1;
        document.getElementById(item.getAttribute('aria-controls')).classList.toggle('hidden', !selected);
      });
    }
    tabs.forEach(function (tab, index) {
      tab.addEventListener('click', function () { selectTab(tab); });
      tab.addEventListener('keydown', function (event) {
        let next;
        if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
        if (event.key === 'ArrowLeft') next = tabs[(index + tabs.length - 1) % tabs.length];
        if (event.key === 'Home') next = tabs[0];
        if (event.key === 'End') next = tabs[tabs.length - 1];
        if (next) { event.preventDefault(); selectTab(next); next.focus(); }
      });
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
            connected(data);
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
