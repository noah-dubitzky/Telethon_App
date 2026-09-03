(function ($) {
  'use strict';

  let channels = [];

  function formatDate(value) {
    if (!value) return 'Activity time unavailable';
    const normalized = value.includes('T') ? value : value.replace(' ', 'T');
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  function channelLink(channel) {
    const params = new URLSearchParams({
      id: channel.id,
      telegram_account_id: channel.telegram_account_id,
      name: channel.name || ''
    });
    return `/desktop/channels.html?${params.toString()}`;
  }

  function channelRow(channel) {
    const name = channel.name || 'Unnamed channel';
    const account = channel.account_name || channel.account_phone || 'Telegram account';
    const count = Number(channel.message_count) || 0;
    const row = $('<article class="flex flex-col gap-4 px-5 py-5 transition hover:bg-blue-50/60 sm:flex-row sm:items-center sm:justify-between sm:px-6">');
    const identity = $('<div class="flex min-w-0 items-center gap-4">');
    identity.append($('<span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-blue-700 text-white shadow-sm">').html('<svg aria-hidden="true" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m4 13 14-7-4 14-3-5-7-2Z"/><path stroke-linecap="round" d="m11 15 3-3"/></svg>'));
    const details = $('<div class="min-w-0">');
    details.append($('<h3 class="truncate font-bold text-slate-900">').text(name));
    const labels = $('<div class="mt-1.5 flex flex-wrap items-center gap-2 text-xs">');
    labels.append($('<span class="rounded-full bg-sky-100 px-2.5 py-1 font-semibold text-sky-700 ring-1 ring-inset ring-sky-200">').text(account));
    labels.append($('<span class="font-medium text-slate-500">').text(`${count} ${count === 1 ? 'message' : 'messages'}`));
    details.append(labels);
    identity.append(details);
    row.append(identity);
    const action = $('<div class="flex shrink-0 items-center justify-between gap-5 sm:flex-col sm:items-end sm:gap-2">');
    action.append($('<time class="whitespace-nowrap text-xs font-medium text-slate-500">').attr('datetime', channel.latest_message_time || '').text(formatDate(channel.latest_message_time)));
    action.append($('<a class="text-sm font-semibold text-blue-600 hover:text-blue-700">').attr('href', channelLink(channel)).text('View messages →'));
    row.append(action);
    return row;
  }

  function renderChannels(query = '') {
    const normalized = query.trim().toLocaleLowerCase();
    const visible = channels.filter(channel => [channel.name, channel.account_name, channel.account_phone]
      .some(value => String(value || '').toLocaleLowerCase().includes(normalized)));
    const list = $('#channelDirectory').empty();
    visible.forEach(channel => list.append(channelRow(channel)));
    $('#channelsEmpty').toggleClass('hidden', channels.length !== 0);
    $('#channelsSearchEmpty').toggleClass('hidden', !normalized || visible.length !== 0 || channels.length === 0);
  }

  function loadChannels() {
    $('#channelsLoading').removeClass('hidden');
    $('#channelsError').addClass('hidden');
    $.get('/messages/channels')
      .done(function (data) {
        channels = Array.isArray(data) ? data : [];
        renderChannels($('#channelSearch').val());
      })
      .fail(function (xhr) {
        if (xhr.status === 401) return window.location.replace('/');
        $('#channelsError').removeClass('hidden');
      })
      .always(function () { $('#channelsLoading').addClass('hidden'); });
  }

  $(function () {
    $('#channelSearch').on('input', function () { renderChannels($(this).val()); });
    $('#retryChannels').on('click', loadChannels);
    loadChannels();
  });
})(jQuery);
