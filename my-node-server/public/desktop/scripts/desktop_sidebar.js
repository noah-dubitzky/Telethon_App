$(function () {
    // Inject sidebar/backdrop HTML if not present
    if (!document.getElementById('sidebarBackdrop')) {
        $("body").prepend(`
          <div
            id="sidebarBackdrop"
            class="fixed inset-0 bg-black/40 opacity-0 pointer-events-none transition-opacity duration-300 z-40"
          ></div>
          <aside
            id="rightSidebar"
            class="fixed top-0 right-0 h-full w-80 max-w-[85vw] bg-white text-black shadow-2xl translate-x-full transition-transform duration-300 z-50"
            role="dialog"
            aria-modal="true"
            aria-label="Sidebar"
          >
            <div class="flex items-center justify-between p-4 border-b">
              <h2 class="text-lg font-semibold">Menu</h2>
              <button id="closeSidebar" class="px-3 py-2 rounded hover:bg-gray-100">✕</button>
            </div>
            <div class="p-4 space-y-2">
              <a href="filters.html" class="block p-3 rounded-lg hover:bg-gray-100">Filters</a>
              <a href="index.html" class="block p-3 rounded-lg hover:bg-gray-100">Messages</a>
              <a href="#" class="block p-3 rounded-lg hover:bg-gray-100">Settings</a>
            </div>
          </aside>
        `);
    }

    const $sidebar  = $("#rightSidebar");
    const $backdrop = $("#sidebarBackdrop");
    const $openBtn  = $("#openSidebar");
    const $closeBtn = $("#closeSidebar");

    function openSidebar() {
      $sidebar.removeClass("translate-x-full");
      $backdrop.removeClass("opacity-0 pointer-events-none");
      $("body").addClass("overflow-hidden");
    }

    function closeSidebar() {
      $sidebar.addClass("translate-x-full");
      $backdrop.addClass("opacity-0 pointer-events-none");
      $("body").removeClass("overflow-hidden");
    }

    // Open
    $openBtn.on("click", function (e) {
      e.stopPropagation();
      openSidebar();
    });

    // Close (X button)
    $closeBtn.on("click", function () {
      closeSidebar();
    });

    // Close when clicking backdrop
    $backdrop.on("click", function () {
      closeSidebar();
    });

    // Close with ESC
    $(document).on("keydown", function (e) {
      if (e.key === "Escape") {
        closeSidebar();
      }
    });
});