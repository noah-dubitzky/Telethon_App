(function ($) {
  'use strict';

  const state = { type: 'all', offset: 0, firstLoad: true, hasMore: true, loading: false, items: [] };

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
    if (!isOutgoing(item) && item.sender_id) {
      params.set('id', item.sender_id);
      params.set('external_id', item.external_sender_id || '');
      params.set('phone', item.sender_phone || '');
      return `/desktop/sender.html?${params.toString()}`;
    }
    return null;
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
    if (conversation) actions.append($('<a class="ml-auto text-xs font-semibold text-slate-500 hover:text-blue-700">').attr('href', conversation).text('View message →'));
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
    $('#mediaMoreWrap').toggleClass('hidden', !state.hasMore || state.loading);
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
    $('#mediaError, #mediaEmpty, #mediaSearchEmpty, #mediaMoreWrap').addClass('hidden');
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

  $(function () {
    $('.media-tab').on('click', function () {
      state.type = $(this).data('media-type');
      $('.media-tab').removeClass('border-blue-600 font-bold text-blue-600').addClass('border-transparent font-semibold text-slate-500');
      $(this).removeClass('border-transparent font-semibold text-slate-500').addClass('border-blue-600 font-bold text-blue-600');
      loadMedia(true);
    });
    $('#mediaSearch').on('input', render);
    $('#loadMoreMedia').on('click', function () { loadMedia(false); });
    $('#retryMedia').on('click', function () { loadMedia(state.items.length === 0); });
    loadMedia(true);
  });
})(jQuery);
