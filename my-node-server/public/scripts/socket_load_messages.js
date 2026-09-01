(function ($) {
  'use strict';

  if (typeof io !== 'function' || typeof MessagesAPI !== 'function') return;

  const params = new URLSearchParams(window.location.search);
  const accountId = params.get('telegram_account_id');
  const entityId = params.get('id');
  const externalSenderId = params.get('external_id');
  const channelName = params.get('name');
  const contextMessageId = params.get('message_id');
  const isSenderPage = /\/sender\.html$/i.test(window.location.pathname);
  const isChannelPage = /\/channels\.html$/i.test(window.location.pathname);

  if (!accountId || !entityId || (!isSenderPage && !isChannelPage)) return;

  const api = new MessagesAPI();
  const socket = io();
  let refreshInProgress = false;
  let refreshRequested = false;

  function eventMatchesOpenPage(data) {
    if (String(data.telegram_account_id) !== String(accountId)) return false;
    if (isSenderPage) {
      return data.sender_database_id != null
        ? String(data.sender_database_id) === String(entityId)
        : data.sender_id != null && String(data.sender_id) === String(externalSenderId);
    }
    return data.channel_database_id != null
      ? String(data.channel_database_id) === String(entityId)
      : data.channel_name != null && String(data.channel_name) === String(channelName);
  }

  async function reloadOpenConversation() {
    if (refreshInProgress) {
      refreshRequested = true;
      return;
    }
    refreshInProgress = true;
    try {
      const rows = isSenderPage
        ? await api.getMessagesBySender(entityId, 0, accountId)
        : await api.getMessagesByChannel(entityId, 0, accountId);
      const box = $('#messages');
      latest_sent_date = '00-00-0000';
      box.empty();
      if (!rows || rows.length === 0) {
        box.html('<div class="p-6 text-gray-500">No messages found.</div>');
      } else {
        rows.slice().reverse().forEach(function (message) {
          box.append(renderMessage(message));
        });
        scrollMessagesToBottom();
        setTimeout(scrollMessagesToBottom, 300);
      }
    } catch (_error) {
      console.error('Unable to reload live messages');
    } finally {
      refreshInProgress = false;
      if (refreshRequested) {
        refreshRequested = false;
        reloadOpenConversation();
      }
    }
  }

  socket.on('updateMessage', function (data) {
    if (contextMessageId) return;
    if (eventMatchesOpenPage(data || {})) reloadOpenConversation();
  });
})(jQuery);
