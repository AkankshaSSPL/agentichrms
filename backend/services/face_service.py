"""
Face Recognition Service
Wraps MTCNN + InceptionResnetV1 + KNN pipeline.

Expected files (created automatically after first enrolment):
  data/face_models/face_classifier.pkl
  data/face_models/embeddings.npy
  data/face_models/labels.npy
"""

import base64
import logging
import numpy as np
import pickle
import joblib
from io import BytesIO
from PIL import Image
from typing import Optional
from datetime import datetime
from sklearn.neighbors import KNeighborsClassifier

logger = logging.getLogger(__name__)


class FaceRecognitionService:
    """Lazy-loads heavy torch models on first use to keep startup fast."""

    def __init__(self):
        self._mtcnn = None
        self._resnet = None
        self._classifier = None
        self._labels = None
        self._loaded = False
        self._device = None

    # ── Internal: lazy model loading ──────────────────────────────────────────

    def _load_models(self):
        """Load MTCNN + InceptionResnetV1. Classifier is loaded separately
        so enrolment can work even before the classifier file exists."""
        if self._loaded:
            return

        import torch
        from facenet_pytorch import MTCNN, InceptionResnetV1
        from backend.core.config import settings

        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        logger.info("Loading face models on device: %s", device)

        self._mtcnn = MTCNN(
            image_size=160,
            margin=20,
            min_face_size=40,
            thresholds=[0.6, 0.7, 0.7],
            keep_all=False,
            device=device,
        )
        self._resnet = InceptionResnetV1(pretrained="vggface2").eval().to(device)
        self._device = device
        self._loaded = True
        logger.info("Face encoder models loaded.")

    def _load_classifier(self):
        """Load KNN classifier from disk. Raises if file missing."""
        from backend.core.config import settings
        classifier_path = str(settings.BASE_DIR / settings.FACE_CLASSIFIER_PATH)
        labels_path = str(settings.BASE_DIR / settings.FACE_LABELS_PATH)
        self._classifier = joblib.load(classifier_path)
        self._labels = np.load(labels_path, allow_pickle=True)
        logger.info("KNN classifier loaded.")

    # ── Public API: Face recognition ──────────────────────────────────────────

    def recognize_face(self, image_base64: str) -> dict:
        from backend.core.config import settings

        try:
            self._load_models()
            self._load_classifier()
        except Exception as exc:
            logger.error("Model loading failed: %s", exc)
            return {"recognized": False, "username": None, "distance": None,
                    "failure_reason": f"Model loading error: {exc}"}

        try:
            if "," in image_base64:
                image_base64 = image_base64.split(",", 1)[1]
            img_bytes = base64.b64decode(image_base64)
            pil_img = Image.open(BytesIO(img_bytes)).convert("RGB")
        except Exception as exc:
            return {"recognized": False, "username": None, "distance": None,
                    "failure_reason": "Invalid image data"}

        try:
            face_tensor = self._mtcnn(pil_img)
        except Exception as exc:
            return {"recognized": False, "username": None, "distance": None,
                    "failure_reason": "Face detection error"}

        if face_tensor is None:
            return {"recognized": False, "username": None, "distance": None,
                    "failure_reason": "No face detected in frame"}

        import torch
        with torch.no_grad():
            embedding = self._resnet(
                face_tensor.unsqueeze(0).to(self._device)
            ).cpu().numpy()

        try:
            predicted_label = self._classifier.predict(embedding)[0]
            distances, _ = self._classifier.kneighbors(embedding, n_neighbors=1)
            distance = float(distances[0][0])
        except Exception as exc:
            logger.error("KNN prediction error: %s", exc)
            return {"recognized": False, "username": None, "distance": None,
                    "failure_reason": "Classifier error"}

        threshold = settings.FACE_DISTANCE_THRESHOLD
        if distance > threshold:
            return {"recognized": False, "username": None, "distance": distance,
                    "failure_reason": f"Face similarity too low (distance: {distance:.2f})"}

        logger.info("Face recognized as '%s' distance=%.4f", predicted_label, distance)
        return {"recognized": True, "username": str(predicted_label),
                "distance": distance, "failure_reason": None}

    # ── Public API: Face enrolment ────────────────────────────────────────────

    def enroll_faces(self, employee_id: int, images_base64: list) -> dict:
        """
        Extract embeddings from images and store them on the Employee row.
        Does NOT require the KNN classifier file to exist yet — that is
        created/updated by retrain_classifier() called after this.
        """
        # Only need MTCNN + ResNet, NOT the classifier file
        try:
            self._load_models()
        except Exception as exc:
            logger.error("Model loading failed for enrolment: %s", exc)
            return {"success": False, "embeddings_stored": 0, "error": str(exc)}

        from backend.database.session import SessionLocal
        from backend.database.models import Employee
        import torch

        embeddings = []
        for idx, b64 in enumerate(images_base64):
            if "," in b64:
                b64 = b64.split(",", 1)[1]
            try:
                img_bytes = base64.b64decode(b64)
                pil_img = Image.open(BytesIO(img_bytes)).convert("RGB")
            except Exception as e:
                logger.warning("Image %d decode failed: %s", idx + 1, e)
                continue

            face_tensor = self._mtcnn(pil_img)
            if face_tensor is None:
                logger.warning("Image %d: no face detected — skipping", idx + 1)
                continue

            with torch.no_grad():
                emb = self._resnet(
                    face_tensor.unsqueeze(0).to(self._device)
                ).cpu().numpy()
            embeddings.append(emb[0])

        if not embeddings:
            return {"success": False, "embeddings_stored": 0,
                    "error": "No valid face detected in any of the submitted images"}

        embeddings_blob = pickle.dumps(embeddings)

        db = SessionLocal()
        try:
            emp = db.query(Employee).filter(Employee.id == employee_id).first()
            if not emp:
                return {"success": False, "embeddings_stored": 0,
                        "error": "Employee not found"}
            emp.face_embedding = embeddings_blob
            emp.face_registered = True
            emp.face_enrollment_date = datetime.utcnow()
            emp.face_samples_count = len(embeddings)
            db.commit()
            logger.info("Stored %d face embeddings for employee %d", len(embeddings), employee_id)
            return {"success": True, "embeddings_stored": len(embeddings), "error": None}
        except Exception as e:
            db.rollback()
            logger.error("DB error during face enrolment: %s", e)
            return {"success": False, "embeddings_stored": 0, "error": str(e)}
        finally:
            db.close()

    # ── Public API: Detect faces (used during registration capture) ───────────

    # (keep this method available via face_auth.py's /detect-faces endpoint)

    # ── Public API: Retrain global KNN classifier ─────────────────────────────

    def retrain_classifier(self):
        """
        Rebuild the KNN classifier from ALL face embeddings in the database.
        Safe to call even when only 1 employee exists (n_neighbors is clamped).
        Creates the .pkl / .npy files if they don't exist yet.
        """
        from backend.database.session import SessionLocal
        from backend.database.models import Employee
        from backend.core.config import settings

        db = SessionLocal()
        try:
            all_embeddings = []
            all_labels = []

            employees = db.query(Employee).filter(
                Employee.face_embedding.isnot(None)
            ).all()

            for emp in employees:
                try:
                    stored = pickle.loads(emp.face_embedding)
                except Exception as e:
                    logger.warning("Could not unpickle embeddings for emp %s: %s", emp.id, e)
                    continue
                label = emp.email  # email is the identifier (no username field)
                for emb in stored:
                    all_embeddings.append(emb)
                    all_labels.append(label)

            if not all_embeddings:
                logger.info("No face embeddings in DB — skipping retrain.")
                return

            X = np.array(all_embeddings)
            y = np.array(all_labels)

            # Clamp n_neighbors so it never exceeds the number of samples
            n_neighbors = min(1, len(X))
            clf = KNeighborsClassifier(n_neighbors=n_neighbors, metric="euclidean")
            clf.fit(X, y)

            # Ensure output directory exists
            from pathlib import Path
            classifier_path = settings.BASE_DIR / settings.FACE_CLASSIFIER_PATH
            classifier_path.parent.mkdir(parents=True, exist_ok=True)

            joblib.dump(clf, str(classifier_path))
            np.save(str(settings.BASE_DIR / settings.FACE_EMBEDDINGS_PATH), X)
            np.save(str(settings.BASE_DIR / settings.FACE_LABELS_PATH), y)

            # Reload in memory so recognize_face uses updated model immediately
            self._classifier = clf
            self._labels = y

            logger.info(
                "Classifier retrained: %d embeddings, %d unique employees.",
                len(X), len(set(y)),
            )
        except Exception as e:
            logger.error("Error retraining classifier: %s", e)
            raise
        finally:
            db.close()


# Module-level singleton
face_service = FaceRecognitionService()