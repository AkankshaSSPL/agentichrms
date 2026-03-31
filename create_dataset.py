import cv2
import os
from mtcnn import MTCNN

# Initialize detector
detector = MTCNN()

input_dir = "D:\\face_project\\dataset_raw"
output_dir = "D:\\face_project\\dataset_cropped"

print("Input exists:", os.path.exists(input_dir))
print("Folders inside input:", os.listdir(input_dir))

os.makedirs(output_dir, exist_ok=True)

for person in os.listdir(input_dir):
    person_path = os.path.join(input_dir, person)

    if not os.path.isdir(person_path):
        continue

    print("\nProcessing person:", person)

    save_path = os.path.join(output_dir, person)
    os.makedirs(save_path, exist_ok=True)

    for img_name in os.listdir(person_path):
        img_path = os.path.join(person_path, img_name)
        print("Reading:", img_path)

        # Load image
        img = cv2.imread(img_path)

        if img is None:
            print("Image not loaded:", img_name)
            continue

        try:
            results = detector.detect_faces(img)
        except Exception as e:
            print("Detection error in:", img_name)
            continue

        # If no face detected
        if results is None or len(results) == 0:
            print("No face detected:", img_name)
            continue

        # Take first detected face
        x, y, w, h = results[0]['box']

        # Fix negative values
        x, y = abs(x), abs(y)

        # Crop face
        face = img[y:y+h, x:x+w]

        # Check if crop is valid
        if face.size == 0:
            print("Invalid crop:", img_name)
            continue

        try:
            # Resize to FaceNet input size
            face = cv2.resize(face, (160, 160))
        except Exception as e:
            print("Resize failed:", img_name)
            continue

        # Save cropped image
        save_name = os.path.join(save_path, img_name)
        cv2.imwrite(save_name, face)
        print("Saved:", save_name)

print("\nDataset creation completed successfully ✅")
