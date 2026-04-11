// Detect device type
let deviceType = (/Mobi|Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent)) ? "mobile" : "desktop";
sender_ids = [];
channel_ids = [];
const socket = io();

socket.on('updateMessage', (data) => {

    if(data.channel_name == null && !sender_ids.includes(data.external_sender_id)) {
        sender_ids.push(data.external_sender_id);

        UpdateNewSender(data);

        window.alert("new sender added");

    }

});

$(document).ready(function () {

    const container = $("#senders-container");
    container.empty();

    $.get("/messages/entities", function (data) {

        if (data.length === 0) {
            container.append("<p id='no_sender_found' class='text-gray-500'>No senders or channles found.</p>");
        } else {
            data.forEach(entity => {

            if(entity.entity_type === "channel"){

                channel_ids.push(entity.id);

                PrependNewChannel(entity);

            }else{

                sender_ids.push(entity.external_sender_id);
                
                PrependNewSender(entity);
            }
            });
        }

    }).fail(function (xhr) {

        $("#senders-container").html("<p class='text-red-500'>Failed to load channels and senders: " + xhr.responseText + "</p>");
   
    });


});

UpdateNewSender = (sender) => {

    $.get("/messages/senders/" + sender.sender_id, function (data) {

        PrependNewSender(data);
        $("#no_senders_found").remove();
    
    }).fail(function (xhr) {
        
        console.error("❌ Error:", xhr.responseText);
        alert("Error: " + xhr.responseText);
    });

    

}

PrependNewSender = (sender) => {
    let senderPage = deviceType === "mobile" ? "/mobile/sender.html" : "/sender.html";
    $("#senders-container").prepend(
    `<div class="py-3 hover:bg-gray-50 transition">
        <a href="${senderPage}?id=${sender.id}&external_id=${sender.external_sender_id}&phone=${sender.phone}" class="flex items-center text-blue-600 hover:underline">
        <span class="font-medium">${sender.name}</span>
        ${sender.external_sender_id ? `<span class="ml-2 text-gray-500 text-sm">(${sender.external_sender_id})</span>` : ""}
        </a>
    </div>`
    );
}

PrependNewChannel = (channel) => {
    let channelPage = deviceType === "mobile" ? "/mobile/channels.html" : "/channels.html";
    $("#senders-container").prepend(
    `<div class="py-3 hover:bg-gray-50 transition">
        <a href="${channelPage}?id=${channel.id}&name=${(channel.name)}" class="flex items-center text-green-600 hover:underline">
        <span class="font-medium">${channel.name}</span>      
        </a>
    </div>`
    );
}