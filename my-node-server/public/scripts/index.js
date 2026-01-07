$(document).ready(function () {
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