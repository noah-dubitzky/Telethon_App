import os
import pandas as pd
from telethon import TelegramClient, events
from datetime import datetime
import asyncio
import threading
import tkinter as tk
import time

# Replace these with your own values
api_id = 20349481
api_hash = '2f4e1f6938e13859b0beec42b9a936d7'
phone = '+13052054965'  # E.g., '+123456789'

# Folder where media will be saved
media_folder = 'media_files'
os.makedirs(media_folder, exist_ok=True)

# Excel file where messages will be saved
excel_file = 'conversations_with_media.xlsx'

# Create the client and connect
client = TelegramClient('session_name', api_id, api_hash)


def save_message(sender_name, sender_phone, message, media_path=None, channel_name=None):
    """
    Saves the incoming message and updates the Excel file
    """
    from datetime import datetime
    import pandas as pd
    import os

    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    # If the file doesn't exist, create it with a header
    if not os.path.exists(excel_file):
        df = pd.DataFrame(columns=['Timestamp', 'Sender', 'Phone', 'Message', 'Media', 'Channel'])
    else:
        # Load existing Excel file
        try:
            df = pd.read_excel(excel_file, engine='openpyxl')
        except Exception as e:
            print(f"Failed to load Excel file: {e}")
            return  # Exit if loading the Excel file fails

    message = message.strip() if message else " "

    # Append the new message to the DataFrame
    new_message = pd.DataFrame([[timestamp, sender_name, sender_phone, message, media_path, channel_name]], 
                                columns=['Timestamp', 'Sender', 'Phone', 'Message', 'Media', 'Channel'])
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
        file_path = await event.download_media(file=media_folder)
        return file_path
    return None

# Listen for incoming messages
@client.on(events.NewMessage)
async def handler(event):
    sender = await event.get_sender()
    sender_name = sender.username or sender.first_name or "Unknown"
    sender_phone = sender.phone if sender.phone else "Unknown"  # Get the phone number if available
    message = event.raw_text
    channel_name = None

    # Check if the message has media, and download it
    media_path = await download_media(event)

    if event.is_channel:  # Check if the message is from a channel
        channel_name = event.chat.title  # Get channel name

    # Save the message and media file path (if any)
    save_message(sender_name, sender_phone, message, media_path, channel_name)

async def main():
    # Start the client
    await client.start(phone)
    print("Listening for new messages...")
    await client.run_until_disconnected()

# Create a thread to run the Telegram client
def run_telegram_client():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(main())

if __name__ == '__main__':
    # Create a thread for the Telegram client
    telegram_thread = threading.Thread(target=run_telegram_client, daemon=True)
    telegram_thread.start()

