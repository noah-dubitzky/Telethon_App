

async function exportChatAsPDF() {
  const entityId = Helpers.getQueryParam('id');
  const entityType = /sender\.html$/i.test(window.location.pathname) ? 'sender' : 'channel';

  if (!entityId) {
    window.alert(`Cannot export this ${entityType}: its id is missing.`);
    return;
  }

  await exportMessagesWithPuppeteer(entityId, entityType);
}

async function exportMessagesWithPuppeteer(entityId, entityType) {
  const button = document.getElementById('download-messages')
    || document.getElementById('download-conversation')
    || document.getElementById('download');
  const originalText = button ? button.innerHTML : '';

  try {
    if (button) {
      button.disabled = true;
      button.innerHTML = 'Preparing PDF...';
    }

    const params = new URLSearchParams();
    params.set('id', entityId);
    params.set('type', entityType);
    params.set(
      'name',
      document.getElementById(entityType === 'sender' ? 'sender-name' : 'channel-name')?.textContent?.trim()
        || Helpers.getQueryParam('name')
        || ''
    );
    params.set('view', window.location.pathname.includes('/mobile/') ? 'mobile' : 'desktop');
    if (entityType === 'sender') {
      params.set('external_id', Helpers.getQueryParam('external_id') || '');
      params.set('phone', Helpers.getQueryParam('phone') || '');
    }

    const response = await fetch(`/export/channel-pdf?${params.toString()}`);
    if (!response.ok) {
      const details = await response.text();
      throw new Error(details || `PDF export failed with status ${response.status}`);
    }

    const pdfData = await response.arrayBuffer();
    const signature = new TextDecoder('ascii').decode(pdfData.slice(0, 5));
    if (signature !== '%PDF-') {
      throw new Error('The server returned an invalid PDF file.');
    }

    const blob = new Blob([pdfData], { type: 'application/pdf' });
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeName = (params.get('name') || `${entityType}_${entityId}`)
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .replace(/\s+/g, '_');

    link.href = blobUrl;
    link.download = `${safeName || `${entityType}_${entityId}`}_messages.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch (err) {
    console.error(`Failed to export ${entityType} PDF:`, err);
    window.alert(`Failed to export the ${entityType} PDF. Check the server console for details.`);
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = originalText;
    }
  }
}

$('#exportPDF').on('click', exportChatAsPDF);
