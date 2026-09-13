(function ($) {
  'use strict';

  $(function () {
    const host = $('#appSidebar');
    if (!host.length || host.children().length) return;
    const path = window.location.pathname;
    const mobilePage = path.startsWith('/mobile/');
    const dashboard = mobilePage ? '/mobile/index.html' : '/desktop/index.html';
    const items = [
      ['Dashboard', dashboard, 'grid'],
      ['All Messages', '/desktop/all-messages.html', 'message'],
      ['People', '/desktop/people.html', 'people'],
      ['Channels', '/desktop/archive-channels.html', 'channel'],
      ['Media & Files', '/desktop/media-library.html', 'media'],
      ['Accounts & Settings', '/settings.html', 'settings']
    ];
    const icons = {
      grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
      message: '<path d="M4 5h16v12H7l-3 3V5Z M8 9h8M8 13h5"/>',
      people: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M14 15.5a4 4 0 0 1 6.5 3.1"/>',
      channel: '<path d="m4 13 14-7-4 14-3-5-7-2Z m7 2 3-3"/>',
      media: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="1.5"/><path d="m5 17 4-4 3 3 2-2 5 3"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>'
    };
    host.html(`
      <div id="sidebarBackdrop" class="fixed inset-0 z-40 hidden bg-black/40 lg:hidden"></div>
      <aside id="navigationSidebar" aria-label="Main navigation" class="fixed inset-y-0 left-0 z-50 hidden w-64 max-w-[85vw] flex-col overflow-y-auto overscroll-contain bg-[#061f42] text-left text-white shadow-xl lg:flex">
        <div class="flex shrink-0 items-center justify-between px-6 py-6">
          <a id="sidebarHome" class="flex items-center gap-3 text-white" aria-label="TeleSaver dashboard"><img src="/assets/telesaver.png" alt="" class="h-11 w-11 rounded-xl" /><span class="text-xl font-bold">TeleSaver</span></a>
          <button id="closeNavigation" type="button" class="rounded-lg p-2 text-white hover:bg-white/10 lg:hidden" aria-label="Close navigation">&#10005;</button>
        </div>
        <nav id="sidebarLinks" class="space-y-2 px-4 pb-5" aria-label="Dashboard navigation"></nav>
        <div class="mt-auto shrink-0 border-t border-white/10 p-4">
          <div class="rounded-xl bg-white/5 p-4">
            <p class="text-xs font-medium text-slate-400">Signed in as</p>
            <p data-user-email class="mt-1 truncate text-sm font-semibold">Loading...</p>
            <button data-logout type="button" class="mt-4 text-xs font-semibold text-blue-300 hover:text-white">Log out</button>
          </div>
        </div>
      </aside>`);
    $('#sidebarHome').attr('href', dashboard);
    let activePath = path;
    if (path.endsWith('/sender.html')) activePath = '/desktop/people.html';
    if (path.endsWith('/channels.html')) activePath = '/desktop/archive-channels.html';
    if (path === '/manage-account.html' || path.endsWith('/filters.html')) activePath = '/settings.html';
    items.forEach(function ([label, href, icon]) {
      const destination = new URL(href, window.location.origin);
      const active = destination.pathname === activePath;
      const link = $('<a class="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300">')
        .attr('href', href)
        .addClass(active ? 'bg-blue-500/20 font-semibold text-white ring-1 ring-inset ring-blue-300/10' : 'text-slate-300 hover:bg-white/5 hover:text-white');
      if (active) link.attr('aria-current', destination.pathname === path ? 'page' : 'location');
      link.append($(`<svg aria-hidden="true" class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icons[icon]}</svg>`));
      link.append($('<span>').text(label));
      $('#sidebarLinks').append(link);
    });

    function showUser(user) {
      if (user) host.find('[data-user-email]').text(user.email);
    }
    showUser(window.telesaverUser);
    document.addEventListener('telesaver:authenticated', function (event) { showUser(event.detail); });

    let trigger = $('#openSidebar');
    if (!trigger.length) {
      const toolbar = $('<div class="flex w-full shrink-0 items-center border-b border-slate-200 bg-white px-4 py-2 lg:hidden">');
      trigger = $('<button id="openSidebar" type="button" class="rounded-lg bg-[#061f42] px-4 py-2 text-sm font-semibold text-white">').text('Menu');
      toolbar.append(trigger);
      host.after(toolbar);
    }
    trigger.attr({ 'aria-label': 'Open navigation', 'aria-controls': 'navigationSidebar', 'aria-expanded': 'false' }).addClass('lg:hidden');
    const sidebar = $('#navigationSidebar');
    const desktop = window.matchMedia('(min-width: 1024px)');
    let opened = false;
    let previousFocus;
    let hadOverflowHidden = false;
    let background = $();

    function close() {
      if (!opened) return;
      opened = false;
      sidebar.addClass('hidden').removeClass('flex').removeAttr('role aria-modal');
      $('#sidebarBackdrop').addClass('hidden');
      trigger.attr('aria-expanded', 'false');
      background.removeAttr('inert');
      $('body').toggleClass('overflow-hidden', hadOverflowHidden);
      if (!desktop.matches && previousFocus) previousFocus.focus();
    }
    trigger.on('click', function () {
      if (desktop.matches) return;
      opened = true;
      previousFocus = document.activeElement;
      hadOverflowHidden = $('body').hasClass('overflow-hidden');
      background = $('body').children().not(host).not('script, style, [inert]');
      background.attr('inert', '');
      $('body').addClass('overflow-hidden');
      sidebar.removeClass('hidden').addClass('flex').attr({ role: 'dialog', 'aria-modal': 'true' });
      $('#sidebarBackdrop').removeClass('hidden');
      trigger.attr('aria-expanded', 'true');
      $('#closeNavigation').trigger('focus');
    });
    $('#closeNavigation, #sidebarBackdrop').on('click', close);
    desktop.addEventListener('change', close);
    $(document).on('keydown.sidebar', function (event) {
      if (!opened) return;
      if (event.key === 'Escape') close();
      if (event.key !== 'Tab') return;
      const controls = sidebar.find('a[href], button:not(:disabled)').filter(':visible');
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    });
  });
})(jQuery);
