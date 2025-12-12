
// 🧱 Collect chat messages from the DOM (capture text + media src/href)
function collectChatMessages() {

  const messages = [];

  $('.message').each(function() {

    const sender = $(this).find('.sender').text().trim() || '';
    const text   = $(this).find('.text').text().trim() || '';
    const time   = $(this).find('.time').text().trim() || '';

    // detect image, video or attachment link inside .media
    let media = '';
    const $media = $(this).find('.media');
    const $img = $media.find('img');
    const $video = $media.find('video');
    const $link = $media.find('a[href]');

    if ($img.length) media = $img.attr('src') || '';
    else if ($video.length) media = $video.attr('src') || '';
    else if ($link.length) media = $link.attr('href') || '';

    messages.push({ sender, media, text, time });

  });

  return messages;

}

// helper: load image URL into a data URL (PNG) so jspdf can embed it
function loadImageDataURL(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = function() {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        resolve({ dataUrl, width: img.naturalWidth, height: img.naturalHeight });
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = function(e) { reject(e); };
    img.src = url;
  });
}

// 📄 Export collected messages to PDF (supports embedding PNG/JPG images)
async function exportChatAsPDF() {

  const chatMessages = collectChatMessages();
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();
  let y = 10;
  const margin = 10;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const contentWidth = pageWidth - margin * 2;

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(12);

  for (let i = 0; i < chatMessages.length; i++) {
    const msg = chatMessages[i];

    const line = `[${msg.time}] ${msg.sender}: ${msg.text}`;
    const splitText = pdf.splitTextToSize(line, contentWidth);
    pdf.text(splitText, margin, y);
    y += splitText.length * 7;

    // If there's a media URL and it looks like an image, try to embed it
    if (msg.media && (msg.media.match(/\.png|\.jpg|\.jpeg|\.gif/i) || msg.media.startsWith('data:'))) {
      try {
        let imgData, imgW, imgH;

        if (msg.media.startsWith('data:')) {
          imgData = msg.media;
          // can't infer size easily from data URL, use a default max width
          imgW = contentWidth;
          imgH = (contentWidth * 0.6);
        } else {
          const res = await loadImageDataURL(msg.media);
          imgData = res.dataUrl;
          imgW = res.width;
          imgH = res.height;
        }

        // scale to content width while preserving aspect ratio, then reduce size
        const baseScale = Math.min(1, contentWidth / imgW);
        const REDUCTION_FACTOR = 0.3; // make images smaller (60% of their allowed size)
        const scale = baseScale * REDUCTION_FACTOR;
        const displayW = imgW * scale;
        const displayH = imgH * scale;

        if (y + displayH > pageHeight - margin) {
          pdf.addPage();
          y = margin;
        }

        pdf.addImage(imgData, 'PNG', margin, y, displayW, displayH);
        y += displayH + 6;
      } catch (err) {
        // embedding failed — skip image but continue
        console.warn('Failed to embed image in PDF:', err);
      }
    }

    if (y > pageHeight - margin) { // new page if needed
      pdf.addPage();
      y = margin;
    }
  }

  pdf.save('chat_export.pdf');

}

// 📦 Attach event handler (works if there's an element with id exportPDF)
$('#exportPDF').on('click', exportChatAsPDF);
