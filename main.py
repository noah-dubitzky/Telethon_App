import os
import pandas as pd
from telethon import TelegramClient, events
from telethon.tl.types import User, Channel, Chat
from datetime import datetime
from zoneinfo import ZoneInfo
import asyncio
import threading
#import tkinter as tk
import time
import Requests
from datetime import datetime
from filter_client import should_save_message
#import pandas as pd
#import os

# new hash and id may be needed
api_id = 20623301
api_hash = '5111d92b18bd9aa6c60d6506dd9d645a'
phone = '+13052054965'  # E.g., '+123456789'

#api_id = 25991850
#api_hash = 'c25af5fa735f66238cea009a2fb81826'
#phone = '+17863274973'

# Folder where media will be saved
image_folder = 'my-node-server/public/uploads/images'
video_folder = 'my-node-server/public/uploads/videos'

# Excel file where messages will be saved
excel_file = 'conversations_with_media.xlsx'

# Create the client and connect
client = TelegramClient('session_name', api_id, api_hash)

def config_message(message):

    message['text']= message['text'].strip() if message['text'] else " "

def save_message(message):
    """
    Saves the incoming message and updates the Excel file
    """
    # If the file doesn't exist, create it with a header
    if not os.path.exists(excel_file):
        df = pd.DataFrame(columns=['Timestamp', 'Sender', 'Sender Id', 'Phone', 'Message', 'Media', 'Channel'])
    else:
        # Load existing Excel file
        try:
            df = pd.read_excel(excel_file, engine='openpyxl')
        except Exception as e:
            print(f"Failed to load Excel file: {e}")
            return  # Exit if loading the Excel file fails

    # Append the new message to the DataFrame
    new_message = pd.DataFrame([[message['timestamp'], message['sender_name'], message['sender_id'], message['sender_phone'], message['text'], message['media_path'], message['channel_name']]], 
                                columns=['Timestamp', 'Sender', 'Sender Id', 'Phone', 'Message', 'Media', 'Channel'])
    df = pd.concat([df, new_message], ignore_index=True)

    # Save the DataFrame back to the Excel file
    try:
        with pd.ExcelWriter(excel_file, engine='openpyxl') as writer:
            df.to_excel(writer, index=False)
        print("Message saved to Excel file.")
    except Exception as e:
        print(f"Failed to save Excel file: {e}")
        return  # Exit if saving the Excel file fails

async def download_media(event):
    """
    Downloads media from the event (if any) and returns the file path.
    """
    if event.media:
        # Check mime type if available
        if hasattr(event.media, 'document') and event.media.document.mime_type:
            mime_type = event.media.document.mime_type
            if mime_type.startswith("image/"):
                file_path = await event.download_media(file=image_folder)
            elif mime_type.startswith("video/"):
                file_path = await event.download_media(file=video_folder)
            else:
                # fallback: still save to images by default
                file_path = await event.download_media(file=image_folder)
        else:
            # If mime_type not available, just drop into images
            file_path = await event.download_media(file=image_folder)
        return file_path
    return None

def _display_name(entity):
    """Return a human name for Users and title for Channels/Groups."""
    if isinstance(entity, User):
        # prefer username; else combine first+last; else Unknown
        name = entity.username or " ".join(filter(None, [entity.first_name, entity.last_name]))
        return name or "Unknown"
    if isinstance(entity, (Channel, Chat)):
        return getattr(entity, "title", None) or getattr(entity, "username", None) or "Unknown"
    return "Unknown"

# Listen for incoming messages
@client.on(events.NewMessage)
async def handler(event):

   #acts as a heartbeat for the system
    print("EVENT NewMessage:", {
        "chat_id": event.chat_id,
        "msg_id": event.message.id if event.message else None,
        "date": str(event.date),
        "is_channel": event.is_channel,
        "is_group": event.is_group,
        "raw_preview": (event.raw_text or "")[:80],
    })

   # These two cover every case
    sender = await event.get_sender()   # may be None for channel posts
    chat   = await event.get_chat()     # Channel/Chat/User depending on context

    # Names
    sender_name = _display_name(sender) if isinstance(sender, User) else None
    channel_name = _display_name(chat) if isinstance(chat, (Channel, Chat)) else None

    # If it's a channel post (no real "user" sender), use the channel title as the sender label
    effective_sender_name = sender_name or channel_name or "Unknown"

    # IDs
    sender_id = sender.id if isinstance(sender, User) else None
    channel_id = chat.id if isinstance(chat, (Channel, Chat)) else None

    # Phone only exists for User
    sender_phone = sender.phone if isinstance(sender, User) and getattr(sender, "phone", None) else "Unknown"

    # Text + timestamp
    message_text = event.raw_text or ""
    
    local_time = event.date.astimezone(ZoneInfo("America/New_York"))
    timestamp = local_time.strftime("%Y-%m-%d %H:%M:%S")

    # --- FILTER CHECK (must happen BEFORE download_media) ---
    if not should_save_message(sender_id, channel_name):
        print("channel or sender has been blocked by filter rules, skipping message.")
        return  # 🚫 skip: no media download, no POST

    print(timestamp, effective_sender_name)

    # Media (your function)
    media_path = await download_media(event)

    # Flags (optional but handy)
    is_channel_post = bool(event.is_channel and not event.is_group)

    message = {
        "sender_name": effective_sender_name,  # User name or Channel title
        "sender_phone": sender_phone,
        "sender_id": sender_id,                # None for channel posts
        "channel_name": channel_name,          # Title for channel/megagroup; None in private chats
        "channel_id": channel_id,
        "is_channel_post": is_channel_post,
        "text": message_text,
        "media_path": media_path,
        "timestamp": timestamp,
    }


    #prepare the message of saving to excel file
    config_message(message)

    #save the message to the excel file
    #save_message(message)

    # Send the object to the io route so the emitter can send it to the page
    Requests.SendMessageToIOEmitter(message)

    # Send the object with the http post method to the mysql server
    Requests.UploadMessageThroughHTTP(message)

async def main():
    await client.start(phone)
    print("Listening for new messages...")
    await client.run_until_disconnected()

print("connected")
client.start()
client.run_until_disconnected()

