import dlib

print(f"Dlib version: {dlib.__version__}")
print("Dlib imported successfully!")

# Test basic face detector
detector = dlib.get_frontal_face_detector()
print("Face detector loaded successfully!")