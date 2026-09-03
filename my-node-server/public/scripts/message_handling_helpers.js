// --- helpers ---
function getQueryParam(key){
    const params = new URLSearchParams(window.location.search);
    return params.get(key);
}

function convertToNormalTime(mysqlTimestamp) {
    // Example input: "2025-10-18 18:15:53"
    const [datePart, timePart] = mysqlTimestamp.split(' ');
    let [hours, minutes, seconds] = timePart.split(':').map(Number);

    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12; // convert 0 -> 12, 13 -> 1, etc.

    // zero-pad minutes/seconds just in case
    const pad = (n) => String(n).padStart(2, '0');
    return `${datePart} ${hours}:${pad(minutes)}:${pad(seconds)} ${ampm}`;
}

function isImage(path){
    return /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(path || "");
}
function isVideo(path){
    return /\.(mp4|webm|ogg|mov|m4v)$/i.test(path || "");
}
function cleanMediaPath(p){
    // if your stored paths include "my-node-server/public", strip it:
    if(!p) return "";
    return p.replace(/^my-node-server\/public\//, "/");
}

function compareDates(dateStr, compareTo) {
    // Parse the first date
    const [month1, day1, year1] = dateStr.split("-").map(Number);
    const date1 = new Date(year1, month1 - 1, day1);

    // Parse the second date or use today
    let date2;
    if (compareTo) {
    const [month2, day2, year2] = compareTo.split("-").map(Number);
    date2 = new Date(year2, month2 - 1, day2);
    } else {
    const now = new Date();
    // Normalize "today" to midnight to compare only dates
    date2 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }

    if (date1.getTime() < date2.getTime()) return -1;
    if (date1.getTime() > date2.getTime()) return 1;
    return 0;
}

// --- render one message card ---
function renderMessage(msg){

    const ts = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : "—";
    const media = msg.media_path
        ? Helpers.cleanMediaPath(msg.media_path)
        : (msg.media_id && msg.s3_key ? `/api/media/${encodeURIComponent(msg.media_id)}/content` : "");

    const outgoing = msg.is_outgoing === true || Number(msg.is_outgoing) === 1;
    const mediaWidth = 320;
    const numericMessageId = Number(msg.message_id);
    const messageAnchor = Number.isSafeInteger(numericMessageId) && numericMessageId > 0
        ? ` id="message-${numericMessageId}" data-message-id="${numericMessageId}"`
        : "";

    date_header = "";

    if(msg.sender_name == null){
    msg.sender_name = "";
    }

    //convert date to 12 hour time
    var time_sent_12hours = Helpers.convertToNormalTime(msg.sent_at);

    if(Helpers.compareDates(msg.sent_at.slice(0,10), latest_sent_date) == 1){
        latest_sent_date = msg.sent_at.slice(0,10);
        date_header = `<div class="w-full flex justify-center my-5">
            <span class="inline-block rounded-full bg-slate-700/75 px-3 py-1 text-xs font-semibold text-white shadow-sm backdrop-blur">
                ${latest_sent_date}
            </span>
        </div>`;
    }

    let mediaHTML = "";
    if (media){
    if (msg.media_type === 'images' || String(msg.mime_type || '').startsWith('image/') || Helpers.isImage(media)){
        mediaHTML = `<img src="${media}" alt="Message attachment" class="mb-2 max-h-80 w-full rounded-xl object-cover">`;
    } else if (msg.media_type === 'videos' || String(msg.mime_type || '').startsWith('video/') || Helpers.isVideo(media)){
        mediaHTML = `<video src="${media}" controls class="mb-2 max-h-96 w-full rounded-xl"></video>`;
    } else {
        mediaHTML = `<a href="${media}" target="_blank" class="mt-3 inline-block text-blue-600 hover:underline">Download attachment</a>`;
    }
    }

    return `
    ${date_header}
    <div class="flex w-full ${outgoing ? 'justify-end' : 'justify-start'} px-3 py-1 sm:px-5">
      <article${messageAnchor} class="message relative max-w-[82%] rounded-2xl px-3.5 py-2.5 shadow-sm ring-1 ring-inset transition-all duration-300 sm:max-w-[70%] ${outgoing ? 'rounded-br-md bg-[#d9fdd3] text-slate-900 ring-emerald-200' : 'rounded-bl-md bg-white text-slate-900 ring-slate-200'}" style="width:min(${mediaWidth}px, 100%);">
        <div class="flex flex-col items-start">
            <span class="sender" style="display:none;">${msg.sender_name || ""}</span>
            <div class="media">${mediaHTML}</div>
            <p class="text w-full whitespace-pre-wrap break-words text-[15px] leading-5">${msg.text || ""}</p>
            <span class="time ml-4 self-end text-[11px] font-medium ${outgoing ? 'text-emerald-800/70' : 'text-slate-400'}">${time_sent_12hours.slice(11,22)}</span>
        </div>
      </article>
    </div>
    `;
}

function focusMessage(messageId) {
    const numericMessageId = Number(messageId);
    if (!Number.isSafeInteger(numericMessageId) || numericMessageId <= 0) return false;
    const target = document.getElementById(`message-${numericMessageId}`);
    if (!target) return false;
    target.scrollIntoView({ block: "center", behavior: "auto" });
    target.classList.add("ring-4", "ring-amber-300", "ring-offset-2");
    window.setTimeout(function () {
        target.classList.remove("ring-4", "ring-amber-300", "ring-offset-2");
    }, 3000);
    return true;
}

function updateNewMessages(msg){

    const box = $("#messages");

    if(Helpers.compareDates(msg.sent_at.slice(0,10), latest_sent_date) == 1){

        latest_sent_date = msg.sent_at.slice(0,10);
        date_header = `<div class="w-full text-center">${latest_sent_date}</div>`;

        box.append(date_header);

    }

    box.append(renderMessage(msg))
}

function scrollMessagesToBottom() {

    const box = document.getElementById('messages');
    if (box) box.scrollTop = box.scrollHeight;
}


window.Helpers = {
  getQueryParam,
  convertToNormalTime,
  isImage,
  isVideo,
  cleanMediaPath,
  compareDates,
  renderMessage,
  focusMessage,
  updateNewMessages,
  scrollMessagesToBottom
};
