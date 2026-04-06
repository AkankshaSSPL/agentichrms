"""
Face Recognition Service
Wraps your existing MTCNN + InceptionResnetV1 + KNN pipeline.

Expected files (created by your training script):
  data/face_models/face_classifier.pkl  — sklearn KNN classifier
  data/face_models/embeddings.npy       — stored 512-D embeddings
  data/face_models/labels.npy           — label strings (employee usernames)
"""

import base64
import logging
import numpy as np
from io import BytesIO
from PIL import Image
from typing import Optional

logger = logging.getLogger(__name__)


class FaceRecognitionService:
    """Lazy-loads heavy torch models on first use to keep startup fast."""

    def __init__(self):
        self._mtcnn = None
        self._resnet = None
        self._classifier = None
        self._labels = None
        self._loaded = False

    # ──────────────────────────────────────────────────────────────────────────
    # Internal: lazy model loading
    # ──────────────────────────────────────────────────────────────────────────

    def _load_models(self):
        """Load MTCNN, InceptionResnetV1, and KNN classifier once."""
        if self._loaded:
            return

        import torch
        import joblib
        from facenet_pytorch import MTCNN, InceptionResnetV1
        from backend.core.config import settings

        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        logger.info("Loading face recognition models on device: %s", device)

        # MTCNN — face detector (keep_all=False → single best face)
        self._mtcnn = MTCNN(
            image_size=160,
            margin=20,
            min_face_size=40,
            thresholds=[0.6, 0.7, 0.7],
            keep_all=False,
            device=device,
        )

        # InceptionResnetV1 — face embedder
        self._resnet = InceptionResnetV1(pretrained="vggface2").eval().to(device)
        self._device = device

        # KNN classifier trained on your dataset
        classifier_path = str(settings.BASE_DIR / settings.FACE_CLASSIFIER_PATH)
        self._classifier = joblib.load(classifier_path)

        # Labels array (maps KNN output index → employee username string)
        labels_path = str(settings.BASE_DIR / settings.FACE_LABELS_PATH)
        self._labels = np.load(labels_path, allow_pickle=True)

        self._loaded = True
        logger.info("Face recognition models loaded successfully.")

    # ──────────────────────────────────────────────────────────────────────────
    # Public API
    # ──────────────────────────────────────────────────────────────────────────

    def recognize_face(self, image_base64: str) -> dict:
        """
        Recognize a face from a Base64-encoded image string.

        Returns:
            {
                "recognized": bool,
                "username": str | None,      # Employee.username value
                "distance": float | None,    # Euclidean distance (lower = better)
                "failure_reason": str | None
            }
        """
        from backend.core.config import settings

        try:
            self._load_models()
        except Exception as exc:
            logger.error("Model loading failed: %s", exc)
            return {
                "recognized": False,
                "username": None,
                "distance": None,
                "failure_reason": f"Model loading error: {exc}",
            }

        # ── 1. Decode Base64 → PIL Image ──────────────────────────────────────
        try:
            # Strip the data-URL prefix if present: "data:image/jpeg;base64,..."
            if "," in image_base64:
                image_base64 = image_base64.split(",", 1)[1]
            img_bytes = base64.b64decode(image_base64)
            pil_img = Image.open(BytesIO(img_bytes)).convert("RGB")
        except Exception as exc:
            logger.warning("Image decode failed: %s", exc)
            return {
                "recognized": False,
                "username": None,
                "distance": None,
                "failure_reason": "Invalid image data",
            }

        # ── 2. Detect & Crop Face (MTCNN) ─────────────────────────────────────
        try:
            face_tensor = self._mtcnn(pil_img)   # returns (3,160,160) tensor or None
        except Exception as exc:
            logger.warning("MTCNN detection error: %s", exc)
            return {
                "recognized": False,
                "username": None,
                "distance": None,
                "failure_reason": "Face detection error",
            }

        if face_tensor is None:
            return {
                "recognized": False,
                "username": None,
                "distance": None,
                "failure_reason": "No face detected in frame",
            }

        # ── 3. Generate 512-D Embedding (InceptionResnetV1) ───────────────────
        import torch
        with torch.no_grad():
            embedding = (
                self._resnet(face_tensor.unsqueeze(0).to(self._device))
                .cpu()
                .numpy()
            )  # shape: (1, 512)

        # ── 4. KNN Prediction + Distance Check ────────────────────────────────
        try:
            # predict returns the class label
            predicted_label = self._classifier.predict(embedding)[0]

            # kneighbors gives actual Euclidean distances
            distances, _ = self._classifier.kneighbors(embedding, n_neighbors=1)
            distance = float(distances[0][0])
        except Exception as exc:
            logger.error("KNN prediction error: %s", exc)
            return {
                "recognized": False,
                "username": None,
                "distance": None,
                "failure_reason": "Classifier error",
            }

        # ── 5. Apply Distance Threshold ───────────────────────────────────────
        threshold = settings.FACE_DISTANCE_THRESHOLD  # default 1.2
        if distance > threshold:
            logger.info(
                "Face rejected — distance %.4f > threshold %.4f", distance, threshold
            )
            return {
                "recognized": False,
                "username": None,
                "distance": distance,
                "failure_reason": f"Face similarity too low (distance: {distance:.2f})",
            }

        logger.info(
            "Face recognized as '%s' with distance %.4f", predicted_label, distance
        )
        return {
            "recognized": True,
            "username": str(predicted_label),
            "distance": distance,
            "failure_reason": None,
        }


# Module-level singleton — shared across all requests
face_service = FaceRecognitionService()