
  // 🧱 Collect chat messages from the DOM
  function collectChatMessages() {

    const messages = [];

    $('.message').each(function() {

      const sender = $(this).find('.sender').text().trim() || '';
      const media = $(this).find('.media').text().trim() || '';
      const text   = $(this).find('.text').text().trim() || '';
      const time   = $(this).find('.time').text().trim() || '';
      messages.push({ sender, media, text, time });

    });

    return messages;

  }

  // 📄 Export collected messages to PDF
  function exportChatAsPDF() {

    const chatMessages = collectChatMessages();
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF();
    let y = 10;
    const margin = 10;

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(12);

    $.each(chatMessages, function(_, msg) {

      const line = `[${msg.time}] ${msg.sender}: ${msg.text}`;
      const splitText = pdf.splitTextToSize(line, 180);
      pdf.text(splitText, margin, y);
      y += splitText.length * 8;

      if (y > 270) { // new page if needed
        pdf.addPage();
        y = margin;
      }

    });

    pdf.save('chat_export.pdf');

  }

  // 📦 Attach event handler
  $('#exportPDF').on('click', exportChatAsPDF);
