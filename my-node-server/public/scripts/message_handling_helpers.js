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
    const media = msg.media_path ? Helpers.cleanMediaPath(msg.media_path) : "";

    // Fixed media width
    const mediaWidth = 280;

    date_header = "";

    if(msg.sender_name == null){
    msg.sender_name = "";
    }

    //convert date to 12 hour time
    var time_sent_12hours = Helpers.convertToNormalTime(msg.sent_at);

    if(Helpers.compareDates(msg.sent_at.slice(0,10), latest_sent_date) == 1){

    latest_sent_date = msg.sent_at.slice(0,10);
    date_header = `<div class="w-full text-center">${latest_sent_date}</div>`;

    }

    let mediaHTML = "";
    if (media){
    if (Helpers.isImage(media)){
        mediaHTML = `<img src="${media}" alt="media" class="mt-3 max-h-80 object-contain" style="width:${mediaWidth}px;">`;
    } else if (Helpers.isVideo(media)){
        mediaHTML = `<video src="${media}" controls class="mt-3 max-h-96" style="width:${mediaWidth}px;"></video>`;
    } else {
        mediaHTML = `<a href="${media}" target="_blank" class="mt-3 inline-block text-blue-600 hover:underline">Download attachment</a>`;
    }
    }

    return `
    ${date_header}
    <article class="bg-blue-400 rounded-lg p-2 m-3 block ml-auto p-6 border-0" style="width:${mediaWidth}px;">
        <div class="flex flex-col items-end">
        ${mediaHTML}
        <p class="w-full text-gray-800 whitespace-pre-wrap break-words">${msg.text || ""}</p>
        <a class="self-end text-xs text-gray-900 hover:text-gray-900">${time_sent_12hours.slice(11,22)}</a>
        </div>
    </article>
    `;
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
  updateNewMessages,
  scrollMessagesToBottom
};