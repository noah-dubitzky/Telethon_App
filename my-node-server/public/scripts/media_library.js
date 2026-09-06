(function ($) {
  'use strict';

  const state = { type: 'all', offset: 0, firstLoad: true, hasMore: true, loading: false, items: [] };
  const pdfState = { offset: 0, hasMore: true, loading: false, items: [] };

  function isOutgoing(item) {
    return item.is_outgoing === true || Number(item.is_outgoing) === 1;
  }

  function formatDate(value) {
    if (!value) return 'Date unavailable';
    const normalized = value.includes('T') ? value : value.replace(' ', 'T');
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  function formatSize(bytes) {
    const size = Number(bytes);
    if (!Number.isFinite(size) || size < 0) return 'Size unavailable';
    if (size < 1024) return `${size} B`;
    if (size < 1048576) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1073741824) return `${(size / 1048576).toFixed(1)} MB`;
    return `${(size / 1073741824).toFixed(1)} GB`;
  }

  function displayName(item) {
    return item.display_name || item.original_filename || `${item.media_type || 'Media'} attachment`;
  }

  function sourceName(item) {
    return item.channel_name || item.sender_name || item.account_name || item.account_phone || 'Telegram archive';
  }

  function conversationLink(item) {
    const params = new URLSearchParams({ telegram_account_id: item.telegram_account_id, message_id: item.message_id });
    if (item.channel_id) {
      params.set('id', item.channel_id);
      params.set('name', item.channel_name || '');
      return `/desktop/channels.html?${params.toString()}`;
    }
    const participantId = isOutgoing(item) ? item.peer_id : item.sender_id;
    if (participantId) {
      params.set('id', participantId);
      params.set('external_id', (isOutgoing(item) ? item.peer_external_sender_id : item.external_sender_id) || '');
      params.set('phone', (isOutgoing(item) ? item.peer_phone : item.sender_phone) || '');
      return `/desktop/sender.html?${params.toString()}`;
    }
    return null;
  }

  function pdfConversationLink(item) {
    const params = new URLSearchParams({
      id: item.conversation_type === 'channel' ? item.channel_id : item.sender_id,
      telegram_account_id: item.telegram_account_id,
      message_id: item.last_message_id
    });
    if (item.conversation_type === 'channel') {
      params.set('name', item.channel_name || '');
      return `/desktop/channels.html?${params.toString()}`;
    }
    return `/desktop/sender.html?${params.toString()}`;
  }

  function preview(item) {
    const url = `/api/media/${encodeURIComponent(item.media_id)}/content`;
    const mime = String(item.mime_type || '');
    if (item.media_type === 'images' || mime.startsWith('image/')) {
      return $('<img class="aspect-video w-full bg-slate-100 object-cover" loading="lazy">').attr({ src: url, alt: displayName(item) });
    }
    if (item.media_type === 'videos' || mime.startsWith('video/')) {
      return $('<video class="aspect-video w-full bg-slate-900 object-contain" controls preload="metadata">').attr('src', url);
    }
    if (item.media_type === 'audio' || item.media_type === 'voice' || mime.startsWith('audio/')) {
      const wrap = $('<div class="flex aspect-video items-center justify-center bg-gradient-to-br from-violet-100 to-blue-100 p-5">');
      wrap.append($('<audio class="w-full" controls preload="metadata">').attr('src', url));
      return wrap;
    }
    return $('<div class="flex aspect-video items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 text-2xl font-black uppercase text-slate-500">').text((displayName(item).split('.').pop() || 'FILE').slice(0, 5));
  }

  function mediaCard(item) {
    const contentUrl = `/api/media/${encodeURIComponent(item.media_id)}/content`;
    const card = $('<article class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:border-blue-200 hover:shadow-md">');
    card.append(preview(item));
    const body = $('<div class="p-4">');
    body.append($('<h2 class="truncate text-sm font-bold text-slate-900">').text(displayName(item)));
    body.append($('<p class="mt-1 truncate text-xs text-slate-500">').text(`${sourceName(item)} · ${item.account_name || item.account_phone || 'Telegram account'}`));
    body.append($('<p class="mt-1 text-xs text-slate-400">').text(`${formatSize(item.file_size)} · ${formatDate(item.sent_at)}`));
    const actions = $('<div class="mt-4 flex items-center gap-3 border-t border-slate-100 pt-3">');
    actions.append($('<a class="text-xs font-semibold text-blue-600 hover:text-blue-700" target="_blank" rel="noopener">').attr('href', contentUrl).text('Open file'));
    const conversation = conversationLink(item);
    if (conversation) actions.append($('<a class="ml-auto rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100">').attr('href', conversation).text('Open conversation'));
    body.append(actions);
    card.append(body);
    return card;
  }

  function render() {
    const query = $('#mediaSearch').val().trim().toLocaleLowerCase();
    const visible = state.items.filter(item => [displayName(item), sourceName(item), item.account_name, item.account_phone, item.mime_type]
      .some(value => String(value || '').toLocaleLowerCase().includes(query)));
    const grid = $('#mediaGrid').empty();
    visible.forEach(item => grid.append(mediaCard(item)));
    $('#mediaEmpty').toggleClass('hidden', state.items.length !== 0 || state.loading);
    $('#mediaSearchEmpty').toggleClass('hidden', !query || visible.length !== 0 || state.items.length === 0);
  }

  function loadMedia(reset) {
    if (state.loading || (!reset && !state.hasMore)) return;
    if (reset) {
      state.offset = 0;
      state.firstLoad = true;
      state.hasMore = true;
      state.items = [];
      $('#mediaGrid').empty();
    }
    state.loading = true;
    const limit = state.firstLoad ? 50 : 25;
    $('#mediaLoading').removeClass('hidden');
    $('#mediaError, #mediaEmpty, #mediaSearchEmpty').addClass('hidden');
    $.get(`/api/media?type=${encodeURIComponent(state.type)}&limit=${limit}&offset=${state.offset}`)
      .done(function (data) {
        const items = Array.isArray(data.media) ? data.media : [];
        state.items = state.items.concat(items);
        state.offset += items.length;
        state.hasMore = Boolean(data.has_more);
        state.firstLoad = false;
      })
      .fail(function (xhr) {
        if (xhr.status === 401) return window.location.replace('/');
        $('#mediaError').removeClass('hidden');
      })
      .always(function () {
        state.loading = false;
        $('#mediaLoading').addClass('hidden');
        render();
      });
  }

  function pdfExportRow(item) {
    const conversation = item.channel_name || item.sender_name || 'Archived conversation';
    const senderNames = (item.senders || []).map(sender => sender.name).filter(Boolean);
    const row = $('<article class="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">').attr('data-pdf-export-id', item.id);
    const identity = $('<div class="flex min-w-0 items-start gap-4">');
    identity.append($('<span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-50 text-xs font-black text-red-600 ring-1 ring-inset ring-red-100">').text('PDF'));
    const details = $('<div class="min-w-0">');
    details.append($('<h3 class="truncate font-bold text-slate-900">').text(item.export_name));
    details.append($('<p class="mt-1 text-sm text-slate-600">').text(`${conversation} · ${item.account_name || item.account_phone || 'Telegram account'}`));
    details.append($('<p class="mt-1 line-clamp-2 text-xs text-slate-400">').text(senderNames.length ? `Senders: ${senderNames.join(', ')}` : 'No identified senders'));
    details.append($('<p class="mt-1 text-xs text-slate-400">').text(`${item.message_count} messages · ${formatSize(item.file_size)} · ${formatDate(item.created_at)}`));
    identity.append(details);
    row.append(identity);
    const actions = $('<div class="flex shrink-0 items-center gap-3 sm:justify-end">');
    actions.append($('<a class="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">')
      .attr('href', `/api/pdf-exports/${encodeURIComponent(item.id)}/content`).text('Download'));
    actions.append($('<a class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:border-blue-300 hover:text-blue-700">')
      .attr('href', pdfConversationLink(item)).text('Conversation'));
    actions.append($('<button type="button" class="delete-pdf-export rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50">')
      .attr('data-export-id', item.id).text('Delete'));
    row.append(actions);
    return row;
  }

  function renderPdfExports() {
    const query = $('#mediaSearch').val().trim().toLocaleLowerCase();
    const visible = pdfState.items.filter(item => {
      const senderNames = (item.senders || []).map(sender => sender.name).join(' ');
      return [item.export_name, item.channel_name, item.sender_name, item.account_name, item.account_phone, senderNames]
        .some(value => String(value || '').toLocaleLowerCase().includes(query));
    });
    const list = $('#pdfExportList').empty();
    visible.forEach(item => list.append(pdfExportRow(item)));
    $('#pdfExportsEmpty').toggleClass('hidden', pdfState.items.length !== 0 || pdfState.loading);
    $('#pdfExportsMoreWrap').toggleClass('hidden', !pdfState.hasMore || pdfState.loading);
  }

  function loadPdfExports(reset) {
    if (pdfState.loading || (!reset && !pdfState.hasMore)) return;
    if (reset) {
      pdfState.offset = 0;
      pdfState.hasMore = true;
      pdfState.items = [];
      $('#pdfExportList').empty();
    }
    pdfState.loading = true;
    $('#pdfExportsLoading').removeClass('hidden');
    $('#pdfExportsError, #pdfExportsEmpty, #pdfExportsMoreWrap').addClass('hidden');
    $.get(`/api/pdf-exports?limit=25&offset=${pdfState.offset}`)
      .done(function (data) {
        const items = Array.isArray(data.pdf_exports) ? data.pdf_exports : [];
        pdfState.items = pdfState.items.concat(items);
        pdfState.offset += items.length;
        pdfState.hasMore = Boolean(data.has_more);
      })
      .fail(function (xhr) {
        if (xhr.status === 401) return window.location.replace('/');
        $('#pdfExportsError').removeClass('hidden');
      })
      .always(function () {
        pdfState.loading = false;
        $('#pdfExportsLoading').addClass('hidden');
        renderPdfExports();
      });
  }

  function deletePdfExport(exportId, button) {
    if (!window.confirm('Delete this saved PDF export? This cannot be undone.')) return;
    button.prop('disabled', true).text('Deleting…');
    $.ajax({ url: `/api/pdf-exports/${encodeURIComponent(exportId)}`, method: 'DELETE' })
      .done(function () {
        pdfState.items = pdfState.items.filter(item => String(item.id) !== String(exportId));
        pdfState.offset = Math.max(0, pdfState.offset - 1);
        renderPdfExports();
      })
      .fail(function (xhr) {
        if (xhr.status === 401) return window.location.replace('/');
        window.alert('Unable to delete this PDF export.');
        button.prop('disabled', false).text('Delete');
      });
  }

  $(function () {
    $('.media-tab').on('click', function () {
      state.type = $(this).data('media-type');
      $('.media-tab').removeClass('border-blue-600 font-bold text-blue-600').addClass('border-transparent font-semibold text-slate-500');
      $(this).removeClass('border-transparent font-semibold text-slate-500').addClass('border-blue-600 font-bold text-blue-600');
      loadMedia(true);
    });
    $('#mediaSearch').on('input', function () {
      render();
      renderPdfExports();
    });
    $('#mediaGrid').on('scroll.mediaLibrary', function () {
      const distanceFromBottom = this.scrollHeight - this.scrollTop - this.clientHeight;
      if (distanceFromBottom <= 8) loadMedia(false);
    });
    $('#retryMedia').on('click', function () { loadMedia(state.items.length === 0); });
    $('#loadMorePdfExports').on('click', function () { loadPdfExports(false); });
    $('#retryPdfExports').on('click', function () { loadPdfExports(pdfState.items.length === 0); });
    $('#pdfExportList').on('click', '.delete-pdf-export', function () {
      deletePdfExport($(this).data('export-id'), $(this));
    });
    loadMedia(true);
    loadPdfExports(true);
  });
})(jQuery);
