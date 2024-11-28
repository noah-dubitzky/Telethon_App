import requests

url = "http://localhost:3000/receive"
data = {"message": "Hello from Python helllo!"}

response = requests.post(url, json=data)  # Use 'json' for JSON data or 'data' for form-encoded data
print("Status Code:", response.status_code)
print("Response Text:", response.text)
