(function ($) {
  'use strict';

  let people = [];

  function formatDate(value) {
    if (!value) return 'Activity time unavailable';
    const normalized = value.includes('T') ? value : value.replace(' ', 'T');
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  function conversationLink(person) {
    const params = new URLSearchParams({
      id: person.id,
      telegram_account_id: person.telegram_account_id
    });
    if (person.external_sender_id) params.set('external_id', person.external_sender_id);
    if (person.phone) params.set('phone', person.phone);
    return `/desktop/sender.html?${params.toString()}`;
  }

  function personRow(person) {
    const name = person.name || person.phone || 'Unknown sender';
    const account = person.account_name || person.account_phone || 'Telegram account';
    const initial = name.trim().charAt(0).toUpperCase() || '?';
    const row = $('<article class="flex flex-col gap-4 px-5 py-5 transition hover:bg-blue-50/60 sm:flex-row sm:items-center sm:justify-between sm:px-6">');
    const identity = $('<div class="flex min-w-0 items-center gap-4">');
    identity.append($('<span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-sm font-bold text-white shadow-sm">').text(initial));
    const details = $('<div class="min-w-0">');
    details.append($('<h3 class="truncate font-bold text-slate-900">').text(name));
    const labels = $('<div class="mt-1.5 flex flex-wrap items-center gap-2 text-xs">');
    if (person.phone) labels.append($('<span class="font-medium text-slate-500">').text(person.phone));
    labels.append($('<span class="rounded-full bg-sky-100 px-2.5 py-1 font-semibold text-sky-700 ring-1 ring-inset ring-sky-200">').text(account));
    details.append(labels);
    identity.append(details);
    row.append(identity);
    const action = $('<div class="flex shrink-0 items-center justify-between gap-5 sm:flex-col sm:items-end sm:gap-2">');
    action.append($('<time class="whitespace-nowrap text-xs font-medium text-slate-500">').attr('datetime', person.latest_message_time || '').text(formatDate(person.latest_message_time)));
    action.append($('<a class="text-sm font-semibold text-blue-600 hover:text-blue-700">').attr('href', conversationLink(person)).text('View messages →'));
    row.append(action);
    return row;
  }

  function renderPeople(query = '') {
    const normalized = query.trim().toLocaleLowerCase();
    const visible = people.filter(person => [person.name, person.phone, person.account_name, person.account_phone]
      .some(value => String(value || '').toLocaleLowerCase().includes(normalized)));
    const list = $('#peopleList').empty();
    visible.forEach(person => list.append(personRow(person)));
    $('#peopleEmpty').toggleClass('hidden', people.length !== 0);
    $('#peopleSearchEmpty').toggleClass('hidden', !normalized || visible.length !== 0 || people.length === 0);
  }

  function loadPeople() {
    $('#peopleLoading').removeClass('hidden');
    $('#peopleError').addClass('hidden');
    $.get('/messages/senders')
      .done(function (data) {
        people = Array.isArray(data) ? data : [];
        renderPeople($('#peopleSearch').val());
      })
      .fail(function (xhr) {
        if (xhr.status === 401) {
          window.location.replace('/');
          return;
        }
        $('#peopleError').removeClass('hidden');
      })
      .always(function () {
        $('#peopleLoading').addClass('hidden');
      });
  }

  $(function () {
    $('#peopleSearch').on('input', function () {
      renderPeople($(this).val());
    });
    $('#retryPeople').on('click', loadPeople);
    loadPeople();
  });
})(jQuery);
