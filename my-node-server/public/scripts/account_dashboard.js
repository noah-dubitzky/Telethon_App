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

  function initials(account) {
    const value = account.display_name || `Telegram ${account.telegram_user_id}`;
    const words = value.trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'TG';
  }

  function accountName(account) {
    return account.display_name || `Telegram ${account.telegram_user_id}`;
  }

  function accountPhone(account) {
    return account.phone_number || 'Phone unavailable';
  }

  function relativeDate(value) {
    if (!value) return 'No activity yet';
    const normalized = value.includes('T') ? value : value.replace(' ', 'T');
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return value;
    const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
    return date.toLocaleDateString();
  }

  function accountCard(account) {
    const destination = new URL(window.location.href);
    destination.search = '';
    destination.searchParams.set('telegram_account_id', account.id);

    if (!mobile) {
      const name = accountName(account);
      const manageUrl = new URL('/manage-account.html', window.location.origin);
      manageUrl.searchParams.set('telegram_account_id', account.id);
      const card = $('<article class="account-card flex min-h-72 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md">')
        .attr('data-account-search', `${name} ${account.phone_number || ''}`.toLowerCase());
      const heading = $('<div class="flex items-start gap-3">');
      heading.append($('<span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-700 text-sm font-bold text-white shadow-sm">').text(initials(account)));
      const identity = $('<div class="min-w-0 flex-1">');
      identity.append($('<h2 class="truncate text-lg font-bold text-slate-900">').text(name));
      identity.append($('<p class="mt-0.5 truncate text-sm text-slate-500">').text(accountPhone(account)));
      heading.append(identity);
      heading.append($('<span class="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold capitalize">').addClass(statusClasses(account.connection_status)).text(account.connection_status));
      card.append(heading);
      const details = $('<dl class="mt-5 space-y-3 border-y border-slate-100 py-4 text-sm">');
      details.append($('<div class="flex items-center justify-between gap-4"><dt class="text-slate-500">Last activity</dt></div>').append($('<dd class="font-semibold text-slate-700">').text(relativeDate(account.last_seen_at))));
      details.append($('<div class="flex items-center justify-between gap-4"><dt class="text-slate-500">Connected</dt></div>').append($('<dd class="text-right font-medium text-slate-700">').text(formatDate(account.connected_at))));
      card.append(details);
      const actions = $('<div class="mt-auto grid grid-cols-2 gap-3 pt-5">');
      actions.append($('<a class="rounded-xl bg-blue-600 px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-500/20">').attr('href', destination.pathname + destination.search).text('Open archive'));
      actions.append($('<a class="rounded-xl border border-slate-300 px-4 py-2.5 text-center text-sm font-semibold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700">').attr('href', manageUrl.pathname + manageUrl.search).text('Manage'));
      card.append(actions);
      return card;
    }

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
    const manageUrl = new URL('/manage-account.html', window.location.origin);
    manageUrl.searchParams.set('telegram_account_id', account.id);
    card.append($('<a class="self-start rounded-lg border border-blue-300 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 transition">')
      .attr('href', manageUrl.pathname + manageUrl.search)
      .text('Manage'));
    return card;
  }

  function addAccountCard() {
    const classes = mobile
      ? 'min-h-52 rounded-2xl border-2 border-dashed border-slate-300 bg-white/60 hover:border-blue-500 hover:bg-blue-50 transition flex flex-col items-center justify-center p-6 text-center focus:outline-none focus:ring-2 focus:ring-blue-500'
      : 'min-h-72 rounded-2xl border-2 border-dashed border-blue-300 bg-blue-50/30 hover:border-blue-500 hover:bg-blue-50 transition flex flex-col items-center justify-center p-6 text-center focus:outline-none focus:ring-4 focus:ring-blue-500/20';
    return $(`<a class="${classes}">`)
      .attr('href', '/settings.html')
      .append($(`<span class="${mobile ? 'text-4xl leading-none text-blue-600' : 'flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 text-4xl font-light leading-none text-blue-600'}" aria-hidden="true">`).text('+'))
      .append($(`<span class="${mobile ? 'mt-3 text-lg font-bold text-slate-800' : 'mt-5 text-lg font-bold text-blue-700'}">`).text('Add another account'))
      .append($('<span class="mt-1 text-sm text-slate-500">').text('Connect another Telegram account'));
  }

  function renderRecentActivity(accounts) {
    const rows = $('#recentActivityRows');
    if (!rows.length) return;
    rows.empty();
    $('#recentActivityEmpty').toggleClass('hidden', accounts.length !== 0);
    accounts
      .slice()
      .sort((a, b) => new Date(b.last_seen_at || 0) - new Date(a.last_seen_at || 0))
      .forEach(function (account) {
        const destination = new URL(window.location.href);
        destination.search = '';
        destination.searchParams.set('telegram_account_id', account.id);
        const row = $('<tr class="transition hover:bg-slate-50">');
        const accountCell = $('<td class="px-6 py-4">');
        const accountWrap = $('<div class="flex items-center gap-3">');
        accountWrap.append($('<span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">').text(initials(account)));
        accountWrap.append($('<div>').append($('<p class="font-semibold text-slate-900">').text(accountName(account))).append($('<p class="text-xs text-slate-500">').text(accountPhone(account))));
        accountCell.append(accountWrap);
        row.append(accountCell);
        row.append($('<td class="px-6 py-4">').append($('<span class="rounded-full px-2.5 py-1 text-xs font-semibold capitalize">').addClass(statusClasses(account.connection_status)).text(account.connection_status)));
        row.append($('<td class="px-6 py-4 text-slate-600">').append($('<p class="font-medium text-slate-700">').text(relativeDate(account.last_seen_at))).append($('<p class="mt-0.5 text-xs text-slate-500">').text(formatDate(account.last_seen_at))));
        row.append($('<td class="px-6 py-4 text-right">').append($('<a class="font-semibold text-blue-600 hover:text-blue-700">').attr('href', destination.pathname + destination.search).text('Open archive')));
        rows.append(row);
      });
  }

  function bindAccountSearch() {
    const search = $('#accountSearch');
    if (!search.length) return;
    search.off('input.accountSearch').on('input.accountSearch', function () {
      const query = String(this.value || '').trim().toLowerCase();
      let visible = 0;
      $('.account-card').each(function () {
        const matches = !query || String($(this).attr('data-account-search') || '').includes(query);
        $(this).toggleClass('hidden', !matches);
        if (matches) visible += 1;
      });
      $('#accountSearchEmpty').toggleClass('hidden', visible !== 0 || !query);
    });
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
        renderRecentActivity(data.accounts);
        bindAccountSearch();
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
    return $('<a class="flex items-center justify-between gap-3 rounded-xl border border-transparent p-4 hover:border-blue-200 hover:bg-blue-50 transition">')
      .attr('href', destination.pathname + destination.search)
      .append($('<span class="font-semibold text-slate-800">').text(entity.name || 'Unknown'))
      .append($('<span class="text-lg text-slate-400" aria-hidden="true">').text('›'));
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
        $('#selectedManageLink').attr('href', `/manage-account.html?telegram_account_id=${encodeURIComponent(accountId)}`);
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
