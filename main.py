import os
import pandas as pd
from telethon import TelegramClient, events
from datetime import datetime
import asyncio
import threading
import tkinter as tk
import time
from gui import MessageViewerApp  # Import the GUI class
from gui_version_2 import MessageViewerAppVersionTwo

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


def save_message_and_update_gui(sender_name, sender_phone, message, gui, media_path=None):
    """
    Saves the incoming message, updates the Excel file, and refreshes the GUI.
    """

    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    # If the file doesn't exist, create it with a header
    if not os.path.exists(excel_file):
        df = pd.DataFrame(columns=['Timestamp', 'Sender', 'Phone', 'Message', 'Media'])
    else:
        # Load existing Excel file
        df = pd.read_excel(excel_file)

    message = message if message and message.message.strip() else " "

    # Append the new message to the DataFrame
    new_message = pd.DataFrame([[timestamp, sender_name, sender_phone, message, media_path]], columns=['Timestamp', 'Sender', 'Phone', 'Message', 'Media'])
    df = pd.concat([df, new_message], ignore_index=True)

    # Step 4: Save the DataFrame back to the Excel file
    try:
        writer = pd.ExcelWriter(excel_file, engine='openpyxl')
        df.to_excel(writer, index=False)
        writer.close()
        print("Message saved to Excel file.")
    except Exception as e:
        print(f"Failed to save Excel file: {e}")
        return  # Exit if saving the Excel file fails
    
    time.sleep(2)  # Wait for 2 seconds

    # Step 5: After saving, update the GUI with the new message
    try:
        gui.update_messages()  # Assuming the GUI has an update_messages method
        print("GUI updated successfully.")
    except Exception as e:
        print(f"Failed to update the GUI: {e}")

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

    # Check if the message has media, and download it
    media_path = await download_media(event)

    # Save the message and media file path (if any)
    save_message_and_update_gui(sender_name, sender_phone, message, app, media_path)

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

# Start the GUI
def run_gui():
    global app  # Global variable to access the app from the handler
    root = tk.Tk()
    app = MessageViewerAppVersionTwo(root)
    root.mainloop()

if __name__ == '__main__':
    # Create a thread for the Telegram client
    telegram_thread = threading.Thread(target=run_telegram_client, daemon=True)
    telegram_thread.start()

    # Run the GUI in the main thread
    run_gui()