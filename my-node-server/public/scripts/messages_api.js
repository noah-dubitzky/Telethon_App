class MessagesAPI {
  constructor(baseUrl = "") {
    this.baseUrl = baseUrl; // keep empty if your API is on the same origin
  }

  accountQuery(accountId, extra = {}) {
    const params = new URLSearchParams(extra);
    if (accountId) params.set('telegram_account_id', accountId);
    return params.toString();
  }

  // ✅ get all senders (with channel_id IS NULL)
  getSenders(accountId = null) {
    return $.get(`${this.baseUrl}/messages/senders?${this.accountQuery(accountId)}`);
  }

  // ✅ get all channels
  getChannels(accountId = null) {
    return $.get(`${this.baseUrl}/messages/channels?${this.accountQuery(accountId)}`);
  }

  // ✅ get latest messages (default limit=50)
  getLatest(limit = 50) {
    return $.get(`${this.baseUrl}/messages?limit=${limit}`);
  }

  // ✅ get all messages from a certain sender
  getMessagesBySender(senderId, offset = 0, accountId = null) {
    return $.get(`${this.baseUrl}/messages/sender/${senderId}?${this.accountQuery(accountId, { offset })}`);
  }

  // ✅ get messages from a certain channel (limit 50)
  getMessagesByChannel(channelId, offset = 0, accountId = null) {
    return $.get(`${this.baseUrl}/messages/channel/${channelId}?${this.accountQuery(accountId, { offset })}`);
  }

  // ✅ post a new message
  postMessage(payload) {
    return $.ajax({
      url: `${this.baseUrl}/messages`,
      type: 'POST',
      data: JSON.stringify(payload),
      contentType: 'application/json'
    });
  }
}

// Make available globally
window.MessagesAPI = MessagesAPI;
