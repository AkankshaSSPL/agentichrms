import cv2
import torch
import numpy as np
import joblib
from PIL import Image
from facenet_pytorch import MTCNN, InceptionResnetV1
from datetime import datetime

# ----------------------------
# Load trained classifier
# ----------------------------
clf = joblib.load(r"D:\face_project\face_classifier.pkl")

# ----------------------------
# Load FaceNet model
# ----------------------------
device = 'cuda' if torch.cuda.is_available() else 'cpu'
mtcnn = MTCNN(keep_all=False, device=device)
model = InceptionResnetV1(pretrained='vggface2').eval().to(device)

THRESHOLD = 1.2

print("Opening camera...")

cap = cv2.VideoCapture(0)

ret, frame = cap.read()

if not ret:
    print("Failed to open camera ❌")
    cap.release()
    exit()

print("Detecting face...")

# ----------------------------
# Detect face
# ----------------------------
boxes, _ = mtcnn.detect(frame)

if boxes is None:
    print("No face detected ❌")
    cap.release()
    cv2.destroyAllWindows()
    exit()

# Take first detected face
box = boxes[0]
x1, y1, x2, y2 = [int(i) for i in box]

face = frame[y1:y2, x1:x2]

if face.size == 0:
    print("Face extraction error ❌")
    cap.release()
    cv2.destroyAllWindows()
    exit()

# ----------------------------
# Create embedding
# ----------------------------
face_img = Image.fromarray(face).resize((160, 160))
face_array = np.array(face_img)

face_tensor = torch.tensor(face_array).permute(2, 0, 1).float()
face_tensor = face_tensor.unsqueeze(0) / 255.0
face_tensor = face_tensor.to(device)

with torch.no_grad():
    embedding = model(face_tensor)

embedding = embedding.cpu().numpy()

# ----------------------------
# Compare with KNN
# ----------------------------
distances, _ = clf.kneighbors(embedding, n_neighbors=1)
min_distance = distances[0][0]

if min_distance > THRESHOLD:
    name = "Unknown"
else:
    name = clf.predict(embedding)[0]

# ----------------------------
# Print result
# ----------------------------
print("\n===== RESULT =====")
print("Detected Person:", name)
print("Distance:", round(min_distance, 3))
print("==================")

# ----------------------------
# Save result to file
# ----------------------------
timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

with open("recognition_result.txt", "a") as f:
    f.write(f"{timestamp} - {name} - Distance: {round(min_distance,3)}\n")

print("Result saved to recognition_result.txt ✅")

# ----------------------------
# Draw result on frame
# ----------------------------
color = (0, 255, 0) if name != "Unknown" else (0, 0, 255)

cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
cv2.putText(frame, f"{name} ({min_distance:.2f})",
            (x1, y1 - 10),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            color,
            2)

cv2.imshow("Recognition Result", frame)
cv2.waitKey(3000)   # show for 3 seconds

# ----------------------------
# Close everything
# ----------------------------
cap.release()
cv2.destroyAllWindows()

print("Camera closed.")
