import requests
import json
import os

message_url = "http://localhost:80/receive"
#image_url = "http://localhost:80/upload-image"
#video_url = "http://localhost:80/upload-video"

def SendMessageToIOEmitter(message):

    response = requests.post(message_url, json=message)  # Use 'json' for JSON data or 'data' for form-encoded data
    print("Status Code:", response.status_code)
    print("Response Text:", response.text)

def UploadMessageThroughHTTP(message, port=80, host='localhost'):
    """
    Sends a POST request with the given message to /messages endpoint.
    
    Args:
        lastMessage (dict): The message payload to send.
        port (int): The server port (default 3000).
        host (str): The server hostname or IP (default 'localhost').
    """
    url = f'http://{host}:{port}/messages'

    try:
        response = requests.post(url, json=message)
        response.raise_for_status()  # raise an error for non-2xx status

        try:
            data = response.json()
            print("✅ POST success:", json.dumps(data, indent=2))
            return data
        except ValueError:
            print("✅ POST success (non-JSON):", response.text)
            return response.text

    except requests.exceptions.RequestException as err:
        print("❌ POST failed:", err)
        return None

