import requests
import os

message_url = "http://localhost:3000/receive"
image_url = "http://localhost:3000/image"
video_url = "http://localhost:3000/video"

def Send_Message(message):

    response = requests.post(message_url, json=message)  # Use 'json' for JSON data or 'data' for form-encoded data
    print("Status Code:", response.status_code)
    print("Response Text:", response.text)

    file_type = determine_file_type(message['media_path'])
    #determin if the file path stores a video or image, and then call the necessary function to send it
    if file_type == "Image":
        Send_Image(message['media_path'])
    elif file_type == "Video":
        Send_Video(message['media_path'])

def Send_Image(media_path):

     # Open the file and send it as a POST request
    with open(media_path, "rb") as file:
        files = {"image": file}  # Key should match the field name in multer setup
        response = requests.post(image_url, files=files)

    # Check the server's response
    if response.status_code == 200:
        print("Image uploaded successfully:", response.text)
    else:
        print("Failed to upload image:", response.status_code, response.text)

def Send_Video(media_path):

     # Open the file and send it as a POST request
    with open(media_path, "rb") as file:
        files = {"video": file}  # Key should match the field name in multer setup
        response = requests.post(video_url, files=files)

    # Check the server's response
    if response.status_code == 200:
        print("Video uploaded successfully:", response.text)
    else:
        print("Failed to upload video:", response.status_code, response.text)

def determine_file_type(file_path):
    # Supported extensions for images and videos
    image_extensions = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".webp"}
    video_extensions = {".mp4", ".avi", ".mkv", ".mov", ".flv", ".wmv", ".webm", ".3gp", ".m4v"}
    
    if len(file_path) == 0:
        return "No file type"

    # Get the file extension
    file_extension = os.path.splitext(file_path)[1].lower()
    
    # Determine the file type
    if file_extension in image_extensions:
        return "Image"
    elif file_extension in video_extensions:
        return "Video"
    else:
        return "Unknown file type"