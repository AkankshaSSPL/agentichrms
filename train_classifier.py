import numpy as np
from sklearn.neighbors import KNeighborsClassifier
import joblib
import os

# File paths (strings)
emb_path = r"D:\face_project\embeddings.npy"
label_path = r"D:\face_project\labels.npy"

print("Embeddings file exists:", os.path.exists(emb_path))
print("Labels file exists:", os.path.exists(label_path))

if not os.path.exists(emb_path) or not os.path.exists(label_path):
    print("❌ Embedding files not found. Run generate_embeddings.py first.")
    exit()

# Load embeddings
embeddings = np.load(emb_path)
labels = np.load(label_path)

print("Embeddings shape:", embeddings.shape)
print("Labels shape:", labels.shape)

if len(embeddings) == 0:
    print("❌ No embeddings found.")
    exit()

print("Training classifier...")

clf = KNeighborsClassifier(n_neighbors=3, metric='euclidean')
clf.fit(embeddings, labels)

joblib.dump(clf, r"D:\face_project\face_classifier.pkl")

print("Training completed successfully ✅")
