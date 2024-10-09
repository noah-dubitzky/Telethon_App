import tkinter as tk
from tkinter import ttk, scrolledtext
import pandas as pd
from PIL import Image, ImageTk  # Pillow library for image handling
from tkinter import messagebox
import os

# Path to the Excel file
excel_file = 'conversations_with_media.xlsx'

class MessageViewerAppVersionTwo:
    def __init__(self, root):
        self.root = root
        self.root.title("Message Viewer with Senders")
        self.root.geometry("1000x700")

        # Main layout - 2 columns (Left: Sidebar, Right: Messages & Search)
        self.root.grid_rowconfigure(1, weight=1)
        self.root.grid_columnconfigure(1, weight=1)

        # Sidebar for sender list
        self.sidebar_frame = tk.Frame(self.root, bg="#FFFFFF", padx=10, pady=20, relief="flat")
        self.sidebar_frame.grid(row=1, column=0, sticky="ns")
        self.sidebar_frame.grid_rowconfigure(0, weight=1)
        self.sidebar_frame.grid_columnconfigure(0, weight=1)

        # Header for search bar
        self.header_frame = tk.Frame(self.root, bg="#F0F4F8", padx=10, pady=10)
        self.header_frame.grid(row=0, column=1, sticky="ew")

        # Add search box and search button
        self.add_search_box()

        # Scrollable message display area
        self.message_frame = tk.Frame(self.root, bg="#E3E8EF", padx=10, pady=10)
        self.message_frame.grid(row=1, column=1, sticky="nsew")
        self.message_frame.grid_rowconfigure(0, weight=1)
        self.message_frame.grid_columnconfigure(0, weight=1)

        self.message_pane = scrolledtext.ScrolledText(self.message_frame, height=20, wrap="word", 
                                                      bg="#FFFFFF", fg="#333333", font=("Arial", 12), 
                                                      padx=10, pady=10, bd=2, relief="flat")
        self.message_pane.grid(row=0, column=0, sticky="nsew")

        # Sidebar listbox for senders
        self.sender_listbox = tk.Listbox(self.sidebar_frame, font=("Arial", 12), width=20, height=20)
        self.sender_listbox.pack(fill="y", pady=10)
        self.sender_listbox.bind("<<ListboxSelect>>", self.display_sender_messages)

        #save a global variable of the selected_sender
        self.selected_sender = 0

        # Load messages and display senders in the sidebar
        self.messages = self.load_messages()
    
        if not self.messages.empty:

            self.senders = sorted(self.messages['Sender'].unique())  # Get unique senders
            self.display_senders(self.senders)

        #store images to avoid garabge collection
        self.message_pane.images = []

    def add_search_box(self):
        """Adds the search box and button to the header frame."""
        self.search_box = ttk.Entry(self.header_frame, width=50, font=("Arial", 14))
        self.search_box.pack(side="left", padx=10, pady=10)

        self.search_button = tk.Button(self.header_frame, text="Search", command=self.search_senders, 
                                       bg="#008080", fg="white", relief="flat", font=("Arial", 12), padx=10, pady=5)
        self.search_button.pack(side="left", padx=5)

    def load_messages(self):
        """Loads messages from the Excel file."""
        if os.path.exists(excel_file):
            df = pd.read_excel(excel_file, engine='openpyxl')
            return df
        else:
            tk.messagebox.showerror("Error", "Message file not found")
            return pd.DataFrame()

    def display_senders(self, senders):
        """Displays the list of senders in the sidebar."""
        self.sender_listbox.delete(0, tk.END)
        for sender in senders:
            self.sender_listbox.insert(tk.END, sender)

    def display_sender_messages(self, event):
        """Displays messages from the selected sender."""
        selected_index = self.sender_listbox.curselection()

        if selected_index:
            self.selected_sender = self.sender_listbox.get(selected_index)

        sender_messages = self.messages[self.messages['Sender'] == self.selected_sender]
        self.display_messages(sender_messages)

    def display_messages(self, df):
        """Displays messages and images in the message pane."""
        self.message_pane.config(state=tk.NORMAL)
        self.message_pane.delete(1.0, tk.END)  # Clear existing messages

        for _, row in df.iterrows():
            message = row['Message']
            timestamp = row['Timestamp']
            image_path = row.get('Media')  # Assuming there's an 'Image' column

            # Display the text message
            display_text = f"{message}\n"
            time_text = f"{timestamp}\n"
            self.message_pane.insert(tk.END, display_text, "message")
            self.message_pane.insert(tk.END, time_text, "timestamp")
            
            # Ensure image_path is a valid string and not NaN or None
            if pd.notna(image_path) and isinstance(image_path, str) and os.path.exists(image_path):
                self.display_image(image_path)

        self.message_pane.tag_configure("message", font=("Arial", 12), foreground="#333333")
        self.message_pane.tag_configure("timestamp", font=("Arial", 10), foreground="#888888")
        self.message_pane.config(state=tk.DISABLED)

    def display_image(self, image_path):
        """Inserts an image into the message pane."""
        try:
            # Load the image and resize it if necessary
            image = Image.open(image_path)
            image.thumbnail((300, 300))  
            
            # Resize the image to fit the UI
            tk_image = ImageTk.PhotoImage(image)

            # Display the image in the message pane
            self.message_pane.image_create(tk.END, image=tk_image)
            self.message_pane.insert(tk.END, "\n")  # Add some space after the image

            # IMPORTANT: Keep a reference to avoid garbage collection
            self.message_pane.images.append(tk_image)

        except Exception as e:
            print(f"Failed to load image {image_path}: {e}")

    def search_senders(self):
        """Searches for senders by name and filters the sidebar list."""
        query = self.search_box.get().strip().lower()
        if query:
            filtered_senders = [sender for sender in self.senders if query in sender.lower()]
            self.display_senders(filtered_senders)
        else:
            self.display_senders(self.senders)

    def update_messages(self):
        """Updates messages in real-time."""
        new_messages = self.load_messages()
        if not new_messages.equals(self.messages):  # Check if new messages have been added
            self.messages = new_messages
            self.senders = sorted(self.messages['Sender'].unique())  # Get unique senders
            self.display_senders(self.senders)  # Update sender list
            self.display_sender_messages(None)  #show the new messages

# Running the app
if __name__ == "__main__":
    root = tk.Tk()
    app = MessageViewerAppVersionTwo(root)
    root.mainloop()
