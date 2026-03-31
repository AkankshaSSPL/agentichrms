import os
import torch
import numpy as np
from PIL import Image
from facenet_pytorch import InceptionResnetV1

# Paths
data_path = r"D:\face_project\dataset_cropped"
print("Dataset path exists:", os.path.exists(data_path))

if not os.path.exists(data_path):
    print("❌ Dataset folder not found.")
    exit()

print("Folders inside dataset:", os.listdir(data_path))

embeddings_path = r"D:\face_project\embeddings.npy"
labels_path = r"D:\face_project\labels.npy"

# Device
device = 'cuda' if torch.cuda.is_available() else 'cpu'

# Load pretrained FaceNet
model = InceptionResnetV1(pretrained='vggface2').eval().to(device)

embeddings = []
labels = []

print("Generating embeddings...")

for person in os.listdir(data_path):

    person_path = os.path.join(data_path, person)

    if not os.path.isdir(person_path):
        continue

    print("Processing:", person)

    for img_name in os.listdir(person_path):

        img_path = os.path.join(person_path, img_name)

        try:
            img = Image.open(img_path).convert('RGB')
        except:
            continue

        img = img.resize((160, 160))

        img_tensor = torch.tensor(np.array(img)).permute(2,0,1).float()
        img_tensor = img_tensor.unsqueeze(0) / 255.0
        img_tensor = img_tensor.to(device)

        with torch.no_grad():
            embedding = model(img_tensor)

        embeddings.append(embedding.cpu().numpy()[0])
        labels.append(person)

# Convert to numpy
embeddings = np.array(embeddings)
labels = np.array(labels)

# Save
np.save(embeddings_path, embeddings)
np.save(labels_path, labels)

print("Embeddings saved successfully ✅")
print("Total samples:", len(labels))
