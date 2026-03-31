import cv2
import os
from mtcnn import MTCNN

# Initialize detector
detector = MTCNN()

# 👉 Change this to the person name you want
person_name = "Suraj"

input_dir = r"D:\face_project\dataset_raw"
output_dir = r"D:\face_project\dataset_cropped"

person_path = os.path.join(input_dir, person_name)
save_path = os.path.join(output_dir, person_name)

print("Processing only:", person_name)

# Check if folder exists
if not os.path.exists(person_path):
    print("Folder not found:", person_path)
    exit()

os.makedirs(save_path, exist_ok=True)

for img_name in os.listdir(person_path):

    img_path = os.path.join(person_path, img_name)
    print("Reading:", img_path)

    img = cv2.imread(img_path)

    if img is None:
        print("Image not loaded:", img_name)
        continue

    try:
        results = detector.detect_faces(img)
    except Exception:
        print("Detection error in:", img_name)
        continue

    if not results:
        print("No face detected:", img_name)
        continue

    x, y, w, h = results[0]['box']
    x, y = abs(x), abs(y)

    face = img[y:y+h, x:x+w]

    if face.size == 0:
        print("Invalid crop:", img_name)
        continue

    try:
        face = cv2.resize(face, (160, 160))
    except:
        print("Resize failed:", img_name)
        continue

    save_name = os.path.join(save_path, img_name)
    cv2.imwrite(save_name, face)
    print("Saved:", save_name)

print("\nAkansha dataset creation completed ✅")
