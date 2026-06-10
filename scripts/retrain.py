"""
retrain.py — Rebuilds face_classifier.pkl using your installed sklearn version.
Run from project root: python retrain.py
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import numpy as np
import joblib
import sklearn
from sklearn.neighbors import KNeighborsClassifier

EMBEDDINGS = "data/face_models/embeddings.npy"
LABELS     = "data/face_models/labels.npy"
OUTPUT     = "data/face_models/face_classifier.pkl"

print(f"sklearn version: {sklearn.__version__}")

embeddings = np.load(EMBEDDINGS)
labels     = np.load(LABELS, allow_pickle=True)

print(f"Loaded {len(embeddings)} embeddings, {len(set(labels))} unique labels: {sorted(set(labels))}")

clf = KNeighborsClassifier(n_neighbors=1, metric="euclidean")
clf.fit(embeddings, labels)

joblib.dump(clf, OUTPUT)
print(f"✅ Saved to {OUTPUT} — retrained with sklearn {sklearn.__version__}")

# Quick sanity check
test = clf.predict(embeddings[:1])
print(f"Sanity check — predicts '{test[0]}' for first embedding (should be '{labels[0]}')")