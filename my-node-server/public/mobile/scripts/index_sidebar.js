// Sidebar swipe gesture
$(function() {
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
    let touchStartX = null;
    let touchStartY = null;
    let touchEndX = null;
    let touchEndY = null;
    const swipeThreshold = 60; // px
    const edgeThreshold = 40; // px from right edge

    function openSidebar() {
      $("#rightSidebar").removeClass("translate-x-full");
      $("#sidebarBackdrop").removeClass("opacity-0 pointer-events-none").addClass("opacity-100");
    }

    function closeSidebar() {
      $("#rightSidebar").addClass("translate-x-full");
      $("#sidebarBackdrop").addClass("opacity-0 pointer-events-none").removeClass("opacity-100");
    }

    $(document).on("touchstart", function (e) {
      if (e.touches && e.touches.length === 1) {
        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
      }
    });

    $(document).on("touchmove", function (e) {
      if (e.touches && e.touches.length === 1) {
        const touch = e.touches[0];
        touchEndX = touch.clientX;
        touchEndY = touch.clientY;
      }
    });

    $(document).on("touchend", function (e) {
      if (touchStartX !== null && touchEndX !== null) {
        // Only trigger if swipe started near right edge and moved left-to-right
        const windowWidth = window.innerWidth;
        if (
          touchStartX > windowWidth - edgeThreshold &&
          touchEndX < touchStartX - swipeThreshold &&
          Math.abs(touchEndY - touchStartY) < 50
        ) {
          openSidebar();
        }
      }
      touchStartX = touchEndX = touchStartY = touchEndY = null;
    });

    // Also keep button and backdrop logic
    $("#openSidebar").on("click", openSidebar);
    $("#closeSidebar, #sidebarBackdrop").on("click", closeSidebar);
});