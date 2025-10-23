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

window.Helpers = {
  getQueryParam,
  convertToNormalTime,
  isImage,
  isVideo,
  cleanMediaPath,
  compareDates
};