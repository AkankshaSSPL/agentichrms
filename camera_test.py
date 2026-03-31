import cv2
 
rtsp_url = "rtsp://admin:admin@192.168.1.220:554/rtsp/streaming?channel=01&sutypeA:0"
 
cap = cv2.VideoCapture(rtsp_url)
 
if not cap.isOpened():
    print("Camera connection failed")
    exit()
 
while True:
    ret, frame = cap.read()
   
    if not ret:
        print("Frame not received")
        break
 
    cv2.imshow("Impact Camera Feed", frame)
 
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break
 
cap.release()
cv2.destroyAllWindows()