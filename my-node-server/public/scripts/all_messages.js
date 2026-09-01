(function ($) {
  'use strict';

  let offset = 0;
  let loading = false;
  let hasMore = true;
  let firstLoad = true;
  let activeQuery = (new URLSearchParams(window.location.search).get('q') || '').trim();
  let requestGeneration = 0;
  let activeRequest = null;

  function isOutgoing(message) {
    return message.is_outgoing === true || Number(message.is_outgoing) === 1;
  }

  function formatDate(value) {
    if (!value) return 'Time unavailable';
    const normalized = value.includes('T') ? value : value.replace(' ', 'T');
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  function conversationLink(message) {
    const isChannel = Boolean(message.channel_id);
    const outgoing = isOutgoing(message);
    const entityId = isChannel ? message.channel_id : (outgoing ? message.peer_id : message.sender_id);
    if (!entityId) return null;
    const destination = new URL(`/desktop/${isChannel ? 'channels' : 'sender'}.html`, window.location.origin);
    destination.searchParams.set('id', entityId);
    destination.searchParams.set('telegram_account_id', message.telegram_account_id);
    destination.searchParams.set('message_id', message.message_id);
    if (isChannel) destination.searchParams.set('name', message.channel_name || '');
    else {
      destination.searchParams.set('external_id', (outgoing ? message.peer_external_sender_id : message.external_sender_id) || '');
      destination.searchParams.set('phone', (outgoing ? message.peer_phone : message.sender_phone) || '');
    }
    return destination.pathname + destination.search;
  }

  function messageRow(message) {
    const outgoing = isOutgoing(message);
    const sender = message.conversation_name
      || (outgoing ? message.peer_name : message.sender_name)
      || message.channel_name
      || 'Unknown conversation';
    const participantPhone = outgoing ? message.peer_phone : message.sender_phone;
    const account = message.account_name || message.account_phone || 'Telegram account';
    const text = String(message.text || '').trim();
    const preview = text && text !== ' '
      ? text
      : message.media_name || (message.media_type ? `${message.media_type} attachment` : 'Message received');
    const href = conversationLink(message);
    const row = $('<article class="grid gap-4 border-l-4 border-l-transparent px-5 py-5 transition hover:border-l-blue-500 hover:bg-blue-50/60 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6">');
    const content = $('<div class="flex min-w-0 items-start gap-3">');
    content.append($('<span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-sm font-bold text-white shadow-sm">').text(sender.trim().charAt(0).toUpperCase() || '?'));
    const body = $('<div class="min-w-0 flex-1">');
    const labels = $('<div class="flex flex-wrap items-center gap-2">');
    labels.append($('<h3 class="font-bold text-slate-900">').text(sender));
    if (activeQuery) {
      labels.append($(`<span class="rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${outgoing ? 'bg-amber-50 text-amber-700 ring-amber-200' : 'bg-blue-50 text-blue-700 ring-blue-200'}">`).text(outgoing ? 'Outgoing' : 'Incoming'));
    }
    labels.append($('<span class="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-700 ring-1 ring-inset ring-sky-200">').text(account));
    labels.append($(`<span class="rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${message.channel_id ? 'bg-violet-50 text-violet-700 ring-violet-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200'}">`).text(message.channel_id ? 'Channel' : 'Direct message'));
    if (activeQuery && participantPhone) labels.append($('<span class="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">').text(participantPhone));
    if (message.media_id) labels.append($('<span class="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">').text(message.media_type || 'Media'));
    body.append(labels);
    body.append($('<p class="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">').text(preview));
    content.append(body);
    row.append(content);
    const meta = $('<div class="flex shrink-0 items-center justify-between gap-5 sm:flex-col sm:items-end sm:justify-center sm:gap-2">');
    meta.append($('<time class="whitespace-nowrap text-xs font-medium text-slate-500">').attr('datetime', message.sent_at || '').text(formatDate(message.sent_at)));
    if (href) meta.append($('<a class="text-sm font-semibold text-blue-600 hover:text-blue-700">').attr('href', href).text('View conversation →'));
    row.append(meta);
    return row;
  }

  function loadMessages() {
    if (loading || !hasMore) return;
    loading = true;
    const generation = requestGeneration;
    const limit = firstLoad ? 50 : 15;
    const endpoint = activeQuery
      ? `/messages/search?q=${encodeURIComponent(activeQuery)}&limit=${limit}&offset=${offset}`
      : `/messages/recent-received?limit=${limit}&offset=${offset}`;
    $('#messagesLoading').removeClass('hidden');
    $('#messagesError').addClass('hidden');

    activeRequest = $.get(endpoint)
      .done(function (data) {
        if (generation !== requestGeneration) return;
        const messages = Array.isArray(data.messages) ? data.messages : [];
        messages.forEach(message => $('#allMessages').append(messageRow(message)));
        offset += messages.length;
        hasMore = Boolean(data.has_more);
        firstLoad = false;
        $('#messagesEmpty')
          .text(activeQuery ? `No messages match “${activeQuery}”.` : 'No received messages yet.')
          .toggleClass('hidden', offset !== 0);
        $('#messagesEnd').toggleClass('hidden', hasMore || offset === 0);
      })
      .fail(function (xhr, status) {
        if (generation !== requestGeneration || status === 'abort') return;
        if (xhr.status === 401) {
          window.location.replace('/');
          return;
        }
        $('#messagesError').removeClass('hidden');
      })
      .always(function () {
        if (generation !== requestGeneration) return;
        activeRequest = null;
        loading = false;
        $('#messagesLoading').addClass('hidden');
      });
  }

  function resetMessages(query) {
    requestGeneration += 1;
    if (activeRequest) activeRequest.abort();
    activeRequest = null;
    offset = 0;
    loading = false;
    hasMore = true;
    firstLoad = true;
    activeQuery = query.trim();
    $('#allMessages').empty();
    $('#messagesLoading, #messagesEmpty, #messagesError, #messagesEnd').addClass('hidden');
  }

  function runSearch(query) {
    const normalizedQuery = query.trim();
    const url = new URL(window.location.href);
    if (normalizedQuery) url.searchParams.set('q', normalizedQuery);
    else url.searchParams.delete('q');
    window.history.pushState({}, '', `${url.pathname}${url.search}${url.hash}`);
    resetMessages(normalizedQuery);
    $('#messageSearch').val(normalizedQuery);
    loadMessages();
  }

  $(function () {
    $('#retryMessages').on('click', loadMessages);
    $('#messageSearch')
      .val(activeQuery)
      .on('keydown', function (event) {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        runSearch($(this).val());
      });
    $(window).on('popstate', function () {
      const query = (new URLSearchParams(window.location.search).get('q') || '').trim();
      resetMessages(query);
      $('#messageSearch').val(query);
      loadMessages();
    });
    $(window).on('scroll.allMessages', function () {
      const viewportBottom = window.innerHeight + window.scrollY;
      const pageBottom = document.documentElement.scrollHeight;
      if (viewportBottom >= pageBottom - 200) loadMessages();
    });
    loadMessages();
  });
})(jQuery);
