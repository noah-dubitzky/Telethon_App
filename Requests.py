import requests
import os

message_url = "http://localhost:80/receive"
#image_url = "http://localhost:80/upload-image"
#video_url = "http://localhost:80/upload-video"

def Send_Message(message):

    response = requests.post(message_url, json=message)  # Use 'json' for JSON data or 'data' for form-encoded data
    print("Status Code:", response.status_code)
    print("Response Text:", response.text)