import tkinter as tk
from tkinter import ttk, scrolledtext
import pandas as pd
import os

# Path to the Excel file
excel_file = 'conversations_with_media.xlsx'

class MessageViewerApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Message Viewer")
        self.root.geometry("1000x700")

        # Apply a gradient background
        self.root.configure(bg="#F0F4F8")  # A light grey-blue as the background

        # Main layout - 2 columns (Left: Sidebar, Right: Messages & Search)
        self.root.grid_rowconfigure(1, weight=1)
        self.root.grid_columnconfigure(1, weight=1)

        # Sidebar for filters
        self.sidebar_frame = tk.Frame(self.root, bg="#FFFFFF", padx=10, pady=20, relief="flat")
        self.sidebar_frame.grid(row=1, column=0, sticky="ns")
        self.sidebar_frame.grid_rowconfigure(0, weight=1)
        self.sidebar_frame.grid_columnconfigure(0, weight=1)

        # Header for search bar
        self.header_frame = tk.Frame(self.root, bg="#F0F4F8", padx=10, pady=10)
        self.header_frame.grid(row=0, column=1, sticky="ew")

        # Add search box and search button
        self.add_search_box()

        # Scrollable message display area with background
        self.message_frame = tk.Frame(self.root, bg="#E3E8EF", padx=10, pady=10)  # A slightly darker grey-blue for messages
        self.message_frame.grid(row=1, column=1, sticky="nsew")
        self.message_frame.grid_rowconfigure(0, weight=1)
        self.message_frame.grid_columnconfigure(0, weight=1)

        self.message_pane = scrolledtext.ScrolledText(self.message_frame, height=20, wrap="word", 
                                                      bg="#FFFFFF", fg="#333333", font=("Arial", 12), 
                                                      padx=10, pady=10, bd=2, relief="flat")
        self.message_pane.grid(row=0, column=0, sticky="nsew")

        # Sidebar Buttons with rounded, pastel-colored buttons
        self.add_sidebar_buttons()

        # Load messages and display them
        self.messages = self.load_messages()
        self.display_messages(self.messages)

        # Apply custom styles
        self.customize_button_styles()

    def add_search_box(self):
        """Adds the search box and button to the header frame."""
        self.search_box = ttk.Entry(self.header_frame, width=50, font=("Arial", 14))
        self.search_box.pack(side="left", padx=10, pady=10)

        self.search_button = tk.Button(self.header_frame, text="Search", command=self.search_messages, 
                                       bg="#008080", fg="white", relief="flat", font=("Arial", 12), padx=10, pady=5)
        self.search_button.pack(side="left", padx=5)

    def add_sidebar_buttons(self):
        """Adds the filter buttons to the sidebar with curved, pastel-themed styles."""
        self.filter_all = tk.Button(self.sidebar_frame, text="All Messages", command=self.show_all, 
                                    bg="#A2D5F2", fg="white", relief="flat", font=("Arial", 12), padx=20, pady=10, bd=0)
        self.filter_all.pack(fill="x", pady=10)

        self.filter_images = tk.Button(self.sidebar_frame, text="Images Only", command=self.show_images, 
                                       bg="#C7A2F2", fg="white", relief="flat", font=("Arial", 12), padx=20, pady=10, bd=0)
        self.filter_images.pack(fill="x", pady=10)

        self.filter_videos = tk.Button(self.sidebar_frame, text="Videos Only", command=self.show_videos, 
                                       bg="#FFCCB5", fg="white", relief="flat", font=("Arial", 12), padx=20, pady=10, bd=0)
        self.filter_videos.pack(fill="x", pady=10)

    def customize_button_styles(self):
        """Applies hover effects and rounded button styling to the sidebar buttons."""
        buttons = [self.filter_all, self.filter_images, self.filter_videos, self.search_button]

        for button in buttons:
            button.config(borderwidth=0, highlightthickness=0, relief="flat")
            button.bind("<Enter>", lambda e, b=button: self.on_button_hover(b))
            button.bind("<Leave>", lambda e, b=button: self.on_button_leave(b))

    def on_button_hover(self, button):
        """Apply hover color effects to the buttons."""
        hover_colors = {
            "#A2D5F2": "#8BB8E8",  # Light Blue
            "#C7A2F2": "#A685D4",  # Soft Purple
            "#FFCCB5": "#FFA07A",  # Peach
            "#008080": "#007373",  # Teal
        }
        button["bg"] = hover_colors.get(button["bg"], button["bg"])

    def on_button_leave(self, button):
        """Revert button color after hover ends."""
        original_colors = {
            "#8BB8E8": "#A2D5F2",  # Light Blue
            "#A685D4": "#C7A2F2",  # Soft Purple
            "#FFA07A": "#FFCCB5",  # Peach
            "#007373": "#008080",  # Teal
        }
        button["bg"] = original_colors.get(button["bg"], button["bg"])

    def load_messages(self):
        """Loads messages from the Excel file."""
        if os.path.exists(excel_file):
            df = pd.read_excel(excel_file)
            return df
        else:
            tk.messagebox.showerror("Error", "Message file not found")
            return pd.DataFrame()

    def display_messages(self, df):
        """Displays messages in the message pane."""
        self.message_pane.config(state=tk.NORMAL)
        self.message_pane.delete(1.0, tk.END)  # Clear existing messages
        for _, row in df.iterrows():
            sender = f"{row['Sender']} ({row['Phone']})"
            timestamp = row['Timestamp']
            message = row['Message']
            media = row['Media']
            display_text = f"{timestamp} - {sender}: {message}\n"
            if pd.notna(media):
                display_text += f" [Media: {media}]\n"
            self.message_pane.insert(tk.END, display_text + "\n")
        self.message_pane.config(state=tk.DISABLED)

    def search_messages(self):
        """Search messages by querying all relevant fields (Sender, Phone, Message, Media)."""
        query = self.search_box.get().strip().lower()
        if query:
            filtered = self.messages[
                self.messages.apply(
                    lambda row: row.astype(str).str.lower().str.contains(query).any(), axis=1
                )
            ]
            self.display_messages(filtered)
        else:
            self.display_messages(self.messages)

    def show_all(self):
        """Display all messages."""
        self.display_messages(self.messages)

    def show_images(self):
        """Display only image messages."""
        images = self.messages[self.messages['Media'].str.contains('.jpg|.png', na=False)]
        self.display_messages(images)

    def show_videos(self):
        """Display only video messages."""
        videos = self.messages[self.messages['Media'].str.contains('.mp4', na=False)]
        self.display_messages(videos)

    def update_messages(self):
        """Updates the displayed messages in real time."""
        self.messages = self.load_messages()  # Load the latest messages
        self.display_messages(self.messages)   # Update the message display area


# Running the app
if __name__ == "__main__":
    root = tk.Tk()
    app = MessageViewerApp(root)
    root.mainloop()
