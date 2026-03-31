import cv2
import dlib
import numpy as np
import face_recognition

print(f"✓ OpenCV: {cv2.__version__}")
print(f"✓ Dlib: {dlib.__version__}")
print(f"✓ NumPy: {np.__version__}")
print(f"✓ face_recognition: loaded")

# Test camera
cap = cv2.VideoCapture(0)
if cap.isOpened():
    print("✓ Camera: accessible")
    cap.release()
else:
    print("✗ Camera: not found")