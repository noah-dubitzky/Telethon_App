(function ($) {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const accountId = params.get('telegram_account_id');
  const mobile = window.location.pathname.includes('/mobile/');
  const pageBase = mobile ? '/mobile' : '/desktop';

  function safeError(xhr, fallback) {
    if (xhr.status === 401) {
      window.location.replace('/');
      return 'Your login expired.';
    }
    if (xhr.status === 404) return 'Telegram account not found.';
    if (xhr.status === 0) return 'The server is unavailable. Please try again.';
    return fallback;
  }

  function formatDate(value) {
    if (!value) return 'Not available';
    const normalized = value.includes('T') ? value : value.replace(' ', 'T');
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  function statusClasses(status) {
    return status === 'connected'
      ? 'bg-green-100 text-green-700'
      : 'bg-amber-100 text-amber-700';
  }

  function accountCard(account) {
    const destination = new URL(window.location.href);
    destination.search = '';
    destination.searchParams.set('telegram_account_id', account.id);

    const card = $('<article class="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition p-5 flex flex-col gap-4">');
    const link = $('<a class="block rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500">')
      .attr('href', destination.pathname + destination.search)
      .attr('aria-label', `Open ${account.display_name || 'Telegram account'} archive`);
    const heading = $('<div class="flex items-start justify-between gap-3">');
    heading.append($('<h3 class="text-lg font-bold text-slate-900">').text(account.display_name || `Telegram ${account.telegram_user_id}`));
    heading.append($('<span class="rounded-full px-3 py-1 text-xs font-semibold capitalize">')
      .addClass(statusClasses(account.connection_status)).text(account.connection_status));
    link.append(heading);
    link.append($('<p class="text-sm text-slate-500 mt-2">').text(`Telegram ID: ${account.telegram_user_id}`));
    link.append($('<p class="text-sm text-slate-500 mt-1">').text(`Connected: ${formatDate(account.connected_at)}`));
    link.append($('<p class="text-sm text-slate-500 mt-1">').text(`Last activity: ${formatDate(account.last_seen_at)}`));
    card.append(link);
    card.append($('<button type="button" disabled class="self-start rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-400 cursor-not-allowed">').text('Manage — Coming soon'));
    return card;
  }

  function addAccountCard() {
    return $('<a class="min-h-52 rounded-2xl border-2 border-dashed border-slate-300 bg-white/60 hover:border-blue-500 hover:bg-blue-50 transition flex flex-col items-center justify-center p-6 text-center focus:outline-none focus:ring-2 focus:ring-blue-500">')
      .attr('href', '/settings.html')
      .append($('<span class="text-4xl leading-none text-blue-600" aria-hidden="true">').text('+'))
      .append($('<span class="mt-3 text-lg font-bold text-slate-800">').text('Add another account'))
      .append($('<span class="mt-1 text-sm text-slate-500">').text('Connect another Telegram account'));
  }

  function loadAccounts() {
    $('#accountListView').removeClass('hidden');
    $('#archiveView').addClass('hidden');
    $.get('/api/telegram-accounts')
      .done(function (data) {
        const grid = $('#accountGrid').empty();
        if (!data.accounts.length) {
          $('#accountEmpty').removeClass('hidden');
        } else {
          $('#accountEmpty').addClass('hidden');
          data.accounts.forEach(function (account) {
            grid.append(accountCard(account));
          });
        }

        // Keep account creation in the same visual hierarchy as account cards.
        grid.append(addAccountCard());
      })
      .fail(function (xhr) {
        $('#accountGrid').html($('<p class="col-span-full text-red-600">').text(safeError(xhr, 'Unable to load Telegram accounts.')));
      })
      .always(function () { $('#accountLoading').addClass('hidden'); });
  }

  function entityLink(entity) {
    const isChannel = entity.entity_type === 'channel';
    const destination = new URL(`${pageBase}/${isChannel ? 'channels' : 'sender'}.html`, window.location.origin);
    destination.searchParams.set('id', entity.id);
    destination.searchParams.set('telegram_account_id', accountId);
    if (isChannel) destination.searchParams.set('name', entity.name || '');
    else {
      destination.searchParams.set('external_id', entity.external_sender_id || '');
      destination.searchParams.set('phone', entity.phone || '');
    }
    return $('<a class="block rounded-xl border border-slate-200 p-4 hover:bg-slate-50 hover:border-blue-300 transition">')
      .attr('href', destination.pathname + destination.search)
      .append($('<span class="font-semibold">').text(entity.name || 'Unknown'));
  }

  function renderEntities(rows) {
    const senders = $('#senderList').empty();
    const channels = $('#channelList').empty();
    const senderRows = rows.filter(row => row.entity_type === 'sender');
    const channelRows = rows.filter(row => row.entity_type === 'channel');
    senderRows.forEach(row => senders.append(entityLink(row)));
    channelRows.forEach(row => channels.append(entityLink(row)));
    $('#senderEmpty').toggleClass('hidden', senderRows.length !== 0);
    $('#channelEmpty').toggleClass('hidden', channelRows.length !== 0);
  }

  function loadArchive() {
    if (!/^\d+$/.test(accountId) || accountId === '0') {
      $('#archiveLoading').addClass('hidden');
      $('#archiveError').removeClass('hidden').text('Telegram account not found.');
      return;
    }
    $('#accountListView').addClass('hidden');
    $('#archiveView').removeClass('hidden');
    const selector = `?telegram_account_id=${encodeURIComponent(accountId)}`;
    $.when($.get(`/api/telegram-accounts/${encodeURIComponent(accountId)}`), $.get(`/messages/entities${selector}`))
      .done(function (accountResponse, entityResponse) {
        $('#selectedAccountName').text(accountResponse[0].account.display_name || `Telegram ${accountResponse[0].account.telegram_user_id}`);
        $('#selectedAccountStatus').text(accountResponse[0].account.connection_status);
        renderEntities(entityResponse[0]);
      })
      .fail(function (xhr) {
        $('#archiveError').removeClass('hidden').text(safeError(xhr, 'Unable to load this Telegram archive.'));
      })
      .always(function () { $('#archiveLoading').addClass('hidden'); });
  }

  $(function () {
    if (accountId) loadArchive(); else loadAccounts();
    if (accountId && typeof io === 'function') {
      const socket = io();
      socket.on('updateMessage', function (data) {
        if (String(data.telegram_account_id) === String(accountId)) loadArchive();
      });
    }
  });
})(jQuery);
