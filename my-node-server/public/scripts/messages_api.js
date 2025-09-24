// messagesApi.js
class MessagesAPI {
  constructor(baseUrl = "/messages") {
    this.baseUrl = baseUrl;
  }

  // ✅ get all senders (with channel_id IS NULL)
  getSenders() {
    return $.get(`${this.baseUrl}/senders`);
  }

  // ✅ get all channels
  getChannels() {
    return $.get(`${this.baseUrl}/channels`);
  }

  // ✅ get latest messages (default limit=50)
  getLatest(limit = 50) {
    return $.get(`${this.baseUrl}?limit=${limit}`);
  }

  // ✅ get all messages from a certain sender (by external_sender_id)
  getMessagesBySender(senderId) {
    return $.get(`${this.baseUrl}/sender/${senderId}`);
  }

  // ✅ get messages from a certain channel (limit 50)
  getMessagesByChannel(channelName) {
    return $.get(`${this.baseUrl}/channel/${encodeURIComponent(channelName)}`);
  }
}

// export to window so it’s usable directly in browser
window.MessagesAPI = MessagesAPI;
