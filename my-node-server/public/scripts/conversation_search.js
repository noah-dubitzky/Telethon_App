(function () {
  'use strict';

  const input = document.getElementById('conversationSearch');
  const messages = document.getElementById('messages');
  const empty = document.getElementById('conversationNoResults');
  if (!input || !messages || !empty) return;

  let settling = false;
  let settleTimer;
  let savedScrollTop = null;
  window.ConversationSearch = {
    blocksPagination: function () { return settling || Boolean(input.value.trim()); }
  };

  function show(element, visible) {
    element.hidden = !visible;
    element.classList.toggle('hidden', !visible);
    element.classList.toggle('visible', visible);
  }

  function filterMessages() {
    const query = input.value.trim().toLocaleLowerCase();
    // Hiding rows can fire scroll events; those must not load older messages.
    settling = true;
    clearTimeout(settleTimer);
    if (query && savedScrollTop === null) savedScrollTop = messages.scrollTop;
    let date = null;
    let matches = 0;

    messages.querySelectorAll('[data-message-row], [data-message-date]').forEach(function (element) {
      show(element, false);
    });
    for (const element of messages.children) {
      if (element.hasAttribute('data-message-date')) {
        date = element;
        if (!query) show(date, true);
      } else if (element.hasAttribute('data-message-row')) {
        const text = element.querySelector('.message .text');
        const time = element.querySelector('.message .time');
        const timestamp = [date?.textContent.trim(), time?.textContent.trim()].filter(Boolean).join(' ');
        const searchable = [text?.textContent || '', timestamp];
        if (!query || searchable.some(value => value.toLocaleLowerCase().includes(query))) {
          show(element, true);
          if (date) show(date, true);
          matches += 1;
        }
      }
    }
    show(empty, Boolean(query) && matches === 0);
    if (!query && savedScrollTop !== null) {
      messages.scrollTop = savedScrollTop;
      savedScrollTop = null;
    }
    settleTimer = setTimeout(function () { settling = false; }, 100);
  }

  input.addEventListener('input', filterMessages);
  input.addEventListener('search', filterMessages);
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') event.preventDefault();
  });
  // Keep the current filter when initial loading, pagination, or live updates
  // replace the rendered rows. Visibility changes do not trigger this observer.
  new MutationObserver(filterMessages).observe(messages, { childList: true });
  filterMessages();
})();
