import cv2
import torch
import numpy as np
import joblib
from PIL import Image
from facenet_pytorch import MTCNN, InceptionResnetV1

# Load classifier
clf = joblib.load(r"D:\face_project\face_classifier.pkl")

# Load FaceNet model
device = 'cuda' if torch.cuda.is_available() else 'cpu'
mtcnn = MTCNN(keep_all=True, device=device)
model = InceptionResnetV1(pretrained='vggface2').eval().to(device)

# Unknown threshold (tune this if needed)
THRESHOLD = 0.9

cap = cv2.VideoCapture(0)

print("Starting face recognition... Press Q to quit")

while True:
    ret, frame = cap.read()
    if not ret:
        break

    boxes, _ = mtcnn.detect(frame)

    if boxes is not None:
        for box in boxes:
            x1, y1, x2, y2 = [int(i) for i in box]

            face = frame[y1:y2, x1:x2]

            if face.size == 0:
                continue

            face_img = Image.fromarray(face).resize((160,160))
            face_tensor = torch.tensor(np.array(face_img)).permute(2,0,1).float()
            face_tensor = face_tensor.unsqueeze(0) / 255.0
            face_tensor = face_tensor.to(device)

            with torch.no_grad():
                embedding = model(face_tensor)

            embedding = embedding.cpu().numpy()

            # Get distances from KNN
            distances, indices = clf.kneighbors(embedding, n_neighbors=1)

            min_distance = distances[0][0]

            if min_distance > THRESHOLD:
                name = "Unknown"
            else:
                name = clf.predict(embedding)[0]

            # Draw box
            color = (0,255,0) if name != "Unknown" else (0,0,255)

            cv2.rectangle(frame, (x1,y1), (x2,y2), color, 2)
            cv2.putText(frame, f"{name} ({min_distance:.2f})",
                        (x1,y1-10),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.8, color, 2)

    cv2.imshow("Face Recognition", frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()
