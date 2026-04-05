const channelsTableBody = document.querySelector('#channels-table tbody');
const sendersTableBody = document.querySelector('#senders-table tbody');

async function fetchFiltersData() {
    const response = await fetch('/api/filters');
    if (!response.ok) {
        console.error('Failed to load filters data', response.statusText);
        return;
    }

    const data = await response.json();
    populateChannels(data.channels || []);
    populateSenders(data.senders || []);
}

function populateChannels(channels) {
    channelsTableBody.innerHTML = '';
    channels.forEach(channel => {
        const allowed = channel.allowed === true || channel.allowed === 1;
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${sanitize(channel.name || '')}</td>
            <td>
                <span class="status-pill ${allowed ? 'status-allow' : 'status-deny'}">
                    ${allowed ? 'Allowed' : 'Denied'}
                </span>
            </td>
            <td>
                <label class="toggle-switch">
                    <input type="checkbox" class="channel-toggle" data-channel-id="${channel.id}" ${allowed ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
            </td>
        `;
        const toggle = row.querySelector('.channel-toggle');
        toggle.addEventListener('change', () => updateChannelFilter(channel.id, toggle.checked, toggle));
        channelsTableBody.appendChild(row);
    });
}

function populateSenders(senders) {
    sendersTableBody.innerHTML = '';
    senders.forEach(sender => {
        const allowed = sender.allowed === true || sender.allowed === 1;
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${sanitize(sender.name || '')}</td>
            <td>${sanitize(sender.channel_name || '')}</td>
            <td>
                <span class="status-pill ${allowed ? 'status-allow' : 'status-deny'}">
                    ${allowed ? 'Allowed' : 'Denied'}
                </span>
            </td>
            <td>
                <label class="toggle-switch">
                    <input type="checkbox" class="sender-toggle" data-sender-id="${sender.id}" ${allowed ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
            </td>
        `;
        const toggle = row.querySelector('.sender-toggle');
        toggle.addEventListener('change', () => updateSenderFilter(sender.id, toggle.checked, toggle));
        sendersTableBody.appendChild(row);
    });
}

function sanitize(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function setToggleStatus(toggle, allowed) {
    const row = toggle.closest('tr');
    if (!row) return;
    const statusPill = row.querySelector('.status-pill');
    if (!statusPill) return;
    statusPill.textContent = allowed ? 'Allowed' : 'Denied';
    statusPill.classList.toggle('status-allow', allowed);
    statusPill.classList.toggle('status-deny', !allowed);
}

async function updateChannelFilter(channelId, allow, toggle) {
    const previousState = toggle?.checked;
    if (toggle) {
        setToggleStatus(toggle, allow);
    }

    try {
        const response = await fetch(`/api/filters/channel/${channelId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ allow })
        });

        if (!response.ok) {
            console.error('Failed to update channel filter', response.statusText);
            if (toggle) {
                toggle.checked = !allow;
                setToggleStatus(toggle, !allow);
            }
            fetchFiltersData();
        }
    } catch (error) {
        console.error('Error updating channel filter:', error);
        if (toggle) {
            toggle.checked = !allow;
            setToggleStatus(toggle, !allow);
        }
        fetchFiltersData();
    }
}

async function updateSenderFilter(senderId, allow, toggle) {
    const previousState = toggle?.checked;
    if (toggle) {
        setToggleStatus(toggle, allow);
    }

    try {
        const response = await fetch(`/api/filters/sender/${senderId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ allow })
        });

        if (!response.ok) {
            console.error('Failed to update sender filter', response.statusText);
            if (toggle) {
                toggle.checked = !allow;
                setToggleStatus(toggle, !allow);
            }
            fetchFiltersData();
        }
    } catch (error) {
        console.error('Error updating sender filter:', error);
        if (toggle) {
            toggle.checked = !allow;
            setToggleStatus(toggle, !allow);
        }
        fetchFiltersData();
    }
}

fetchFiltersData();