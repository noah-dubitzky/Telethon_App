(function ($) {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const accountId = params.get('telegram_account_id');
  const mobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  let currentAccount = null;

  function validAccountId(value) {
    return /^\d+$/.test(value || '') && value !== '0';
  }

  function formatDate(value) {
    if (!value) return 'Not available';
    const normalized = value.includes('T') ? value : value.replace(' ', 'T');
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  function showError(message) {
    $('#manageLoading, #manageContent').addClass('hidden');
    $('#manageError').removeClass('hidden').text(message);
  }

  function requestError(xhr, fallback) {
    if (xhr.status === 401) {
      window.location.replace('/');
      return 'Your login expired.';
    }
    if (xhr.status === 0) return 'The server is unavailable. Please try again.';
    if (xhr.status === 404) return 'Telegram account not found or unavailable.';
    return xhr.responseJSON?.error || fallback;
  }

  function controlMessage(message, error) {
    $('#controlMessage')
      .removeClass('hidden bg-red-50 text-red-700 bg-green-50 text-green-700')
      .addClass(error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700')
      .text(message);
  }

  function setControlsPending(pending) {
    $('#reconnectAccount, #disconnectAccount, #toggleArchive, #removeAccount')
      .prop('disabled', pending);
  }

  function updateAccountControls(account) {
    currentAccount = account;
    const removed = account.connection_status === 'removed' || !account.has_saved_session;
    const connected = account.connection_status === 'connected';

    $('#reconnectAccount').prop('disabled', removed || connected);
    $('#disconnectAccount').prop('disabled', removed || !connected);
    $('#toggleArchive')
      .prop('disabled', removed)
      .text(account.archive_enabled ? 'Pause archiving' : 'Resume archiving');
    $('#removeAccount').prop('disabled', removed);
    $('#archiveStateText').text(removed
      ? 'The saved connection was removed. Archived data is still available.'
      : account.archive_enabled
        ? 'New Telegram messages are being archived.'
        : 'Archiving is paused; new Telegram messages will not be saved.');
    $('#reauthenticateAccount').attr(
      'href',
      `/settings.html?reauthenticate_account_id=${encodeURIComponent(accountId)}`
    );
  }

  function updateFilterState(enabled) {
    $('#filtersEnabled').prop('checked', enabled);
    $('#filterToggleLabel').text(enabled ? 'ON' : 'OFF');
    $('#filterStateText').text(enabled
      ? 'Account-specific allow and block rules are active.'
      : 'Filter rules are bypassed; messages are archived by default.');
  }

  function statusClasses(status) {
    if (status === 'connected') return 'bg-green-100 text-green-700';
    if (status === 'error' || status === 'revoked') return 'bg-red-100 text-red-700';
    return 'bg-amber-100 text-amber-700';
  }

  function render(data) {
    const account = data.account;
    $('#accountName').text(account.display_name || `Telegram ${account.telegram_user_id}`);
    $('#telegramUserId').text(account.telegram_user_id);
    $('#connectionStatus').removeClass().addClass(`self-start rounded-full px-4 py-2 text-sm font-bold capitalize ${statusClasses(account.connection_status)}`).text(account.connection_status);
    $('#connectedAt').text(formatDate(account.connected_at));
    $('#lastSeenAt').text(formatDate(account.last_seen_at));
    $('#createdAt').text(formatDate(account.created_at));
    $('#allowedSenders').text(data.filters.senders.allowed);
    $('#blockedSenders').text(data.filters.senders.blocked);
    $('#allowedChannels').text(data.filters.channels.allowed);
    $('#blockedChannels').text(data.filters.channels.blocked);
    updateFilterState(data.filters.enabled);
    updateAccountControls(account);

    const filterPath = mobile ? '/mobile/filters.html' : '/desktop/filters.html';
    $('#advancedFiltersLink').attr('href', `${filterPath}?telegram_account_id=${encodeURIComponent(accountId)}`);
    $('#accountsBackLink').attr('href', mobile ? '/mobile/index.html' : '/desktop/index.html');
    $('#manageLoading').addClass('hidden');
    $('#manageContent').removeClass('hidden');
  }

  function loadManagement() {
    if (!validAccountId(accountId)) {
      showError('Telegram account not found or unavailable.');
      return;
    }
    $.get(`/api/telegram-accounts/${encodeURIComponent(accountId)}/management`)
      .done(render)
      .fail(function (xhr) {
        showError(requestError(xhr, 'Unable to load Telegram account details.'));
      });
  }

  function accountAction(path, method, data, successMessage) {
    setControlsPending(true);
    $('#controlMessage').addClass('hidden');
    return $.ajax({
      url: `/api/telegram-accounts/${encodeURIComponent(accountId)}/${path}`,
      method,
      contentType: 'application/json',
      data: data === undefined ? undefined : JSON.stringify(data)
    })
      .done(function () {
        controlMessage(successMessage, false);
        loadManagement();
      })
      .fail(function (xhr) {
        controlMessage(requestError(xhr, 'Unable to update this Telegram account.'), true);
      })
      .always(function () {
        setControlsPending(false);
      });
  }

  $(function () {
    loadManagement();

    $('#reconnectAccount').on('click', function () {
      accountAction('reconnect', 'POST', undefined, 'Telegram account reconnected.');
    });

    $('#disconnectAccount').on('click', function () {
      accountAction('disconnect', 'POST', undefined, 'Telegram account disconnected.');
    });

    $('#toggleArchive').on('click', function () {
      if (!currentAccount) return;
      const enabled = !currentAccount.archive_enabled;
      accountAction(
        'archive-enabled',
        'PATCH',
        { enabled },
        enabled ? 'Archiving resumed.' : 'Archiving paused.'
      );
    });

    $('#removeAccount').on('click', function () {
      const confirmed = window.confirm(
        'Remove the saved Telegram connection? Your archived messages, filters, and account history will be kept.'
      );
      if (!confirmed) return;
      accountAction(
        'connection',
        'DELETE',
        undefined,
        'Telegram connection removed. Archived data was preserved.'
      );
    });

    $('#filtersEnabled').on('change', function () {
      const toggle = $(this);
      const previousState = !toggle.prop('checked');
      const requestedState = toggle.prop('checked');
      toggle.prop('disabled', true);
      $('#filterMessage').addClass('hidden');

      $.ajax({
        url: `/api/telegram-accounts/${encodeURIComponent(accountId)}/filters-enabled`,
        method: 'PATCH',
        contentType: 'application/json',
        data: JSON.stringify({ enabled: requestedState })
      })
        .done(function (data) {
          updateFilterState(data.filters_enabled);
        })
        .fail(function (xhr) {
          updateFilterState(previousState);
          $('#filterMessage')
            .removeClass('hidden bg-green-50 text-green-700')
            .addClass('bg-red-50 text-red-700')
            .text(requestError(xhr, 'Unable to update filter state.'));
        })
        .always(function () {
          toggle.prop('disabled', false);
        });
    });
  });
})(jQuery);
