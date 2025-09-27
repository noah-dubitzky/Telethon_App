class MessagesAPI {
  constructor(baseUrl = "") {
    this.baseUrl = baseUrl; // keep empty if your API is on the same origin
  }

  // ✅ get all senders (with channel_id IS NULL)
  getSenders() {
    return $.get(`${this.baseUrl}/messages/senders`);
  }

  // ✅ get all channels
  getChannels() {
    return $.get(`${this.baseUrl}/messages/channels`);
  }

  // ✅ get latest messages (default limit=50)
  getLatest(limit = 50) {
    return $.get(`${this.baseUrl}/messages?limit=${limit}`);
  }

  // ✅ get all messages from a certain sender
  getMessagesBySender(senderId) {
    return $.get(`${this.baseUrl}/messages/sender/${senderId}`);
  }

  // ✅ get messages from a certain channel (limit 50)
  getMessagesByChannel(channelId) {
    return $.get(`${this.baseUrl}/messages/channel/${channelId}`);
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
