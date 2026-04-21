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

        classifier_path = str(settings.BASE_DIR / settings.FACE_CLASSIFIER_PATH)
        self._classifier = joblib.load(classifier_path)

        labels_path = str(settings.BASE_DIR / settings.FACE_LABELS_PATH)
        self._labels = np.load(labels_path, allow_pickle=True)

        self._loaded = True
        logger.info("Face recognition models loaded successfully.")

    # ──────────────────────────────────────────────────────────────────────────
    # Public API – Face recognition
    # ──────────────────────────────────────────────────────────────────────────

    def recognize_face(self, image_base64: str) -> dict:
        """
        Recognize a face from a Base64-encoded image string.

        Returns:
            {
                "recognized": bool,
                "username": str | None,
                "distance": float | None,
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

        # Decode Base64
        try:
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

        # Detect face
        try:
            face_tensor = self._mtcnn(pil_img)
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

        # Generate embedding
        import torch
        with torch.no_grad():
            embedding = (
                self._resnet(face_tensor.unsqueeze(0).to(self._device))
                .cpu()
                .numpy()
            )  # shape (1,512)

        # KNN prediction
        try:
            predicted_label = self._classifier.predict(embedding)[0]
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

        threshold = settings.FACE_DISTANCE_THRESHOLD
        if distance > threshold:
            logger.info("Face rejected — distance %.4f > threshold %.4f", distance, threshold)
            return {
                "recognized": False,
                "username": None,
                "distance": distance,
                "failure_reason": f"Face similarity too low (distance: {distance:.2f})",
            }

        logger.info("Face recognized as '%s' with distance %.4f", predicted_label, distance)
        return {
            "recognized": True,
            "username": str(predicted_label),
            "distance": distance,
            "failure_reason": None,
        }

    # ──────────────────────────────────────────────────────────────────────────
    # Public API – Face enrollment (store multiple embeddings)
    # ──────────────────────────────────────────────────────────────────────────

    def enroll_faces(self, employee_id: int, images_base64: list[str]) -> dict:
        """
        Enroll multiple face images for an employee.
        Returns: { "success": bool, "embeddings_stored": int, "error": str | None }
        """
        try:
            self._load_models()
        except Exception as exc:
            logger.error("Model loading failed for enrollment: %s", exc)
            return {"success": False, "embeddings_stored": 0, "error": str(exc)}

        from backend.database.session import SessionLocal
        from backend.database.models import Employee
        import pickle

        embeddings = []
        for idx, b64 in enumerate(images_base64):
            if "," in b64:
                b64 = b64.split(",", 1)[1]
            try:
                img_bytes = base64.b64decode(b64)
                pil_img = Image.open(BytesIO(img_bytes)).convert("RGB")
            except Exception as e:
                logger.warning(f"Image {idx+1} decode failed: {e}")
                continue

            face_tensor = self._mtcnn(pil_img)
            if face_tensor is None:
                logger.warning(f"Image {idx+1}: no face detected")
                continue

            import torch
            with torch.no_grad():
                emb = (
                    self._resnet(face_tensor.unsqueeze(0).to(self._device))
                    .cpu()
                    .numpy()
                )
            embeddings.append(emb[0])

        if not embeddings:
            return {"success": False, "embeddings_stored": 0, "error": "No valid face detected in any image"}

        embeddings_blob = pickle.dumps(embeddings)

        db = SessionLocal()
        try:
            emp = db.query(Employee).filter(Employee.id == employee_id).first()
            if not emp:
                return {"success": False, "embeddings_stored": 0, "error": "Employee not found"}
            emp.face_embedding = embeddings_blob
            emp.face_registered = True
            emp.face_enrollment_date = datetime.utcnow()
            emp.face_samples_count = len(embeddings)
            db.commit()
            logger.info(f"Enrolled {len(embeddings)} face samples for employee {employee_id}")
            return {"success": True, "embeddings_stored": len(embeddings), "error": None}
        except Exception as e:
            db.rollback()
            logger.error(f"DB error during face enrollment: {e}")
            return {"success": False, "embeddings_stored": 0, "error": str(e)}
        finally:
            db.close()

    # ──────────────────────────────────────────────────────────────────────────
    # Public API – Retrain global classifier from all stored embeddings
    # ──────────────────────────────────────────────────────────────────────────

    def retrain_classifier(self):
        """
        Rebuild the KNN classifier from all face embeddings stored in the database.
        Saves the updated classifier and embedding files to disk.
        """
        from backend.database.session import SessionLocal
        from backend.database.models import Employee
        from backend.core.config import settings
        import pickle

        db = SessionLocal()
        try:
            # Collect all embeddings and labels
            all_embeddings = []
            all_labels = []
            employees = db.query(Employee).filter(Employee.face_embedding.isnot(None)).all()
            for emp in employees:
                # Unpickle the stored embeddings (list of numpy arrays)
                embeddings = pickle.loads(emp.face_embedding)
                label = emp.username or emp.email
                for emb in embeddings:
                    all_embeddings.append(emb)
                    all_labels.append(label)

            if len(all_embeddings) < 1:
                logger.info("No face embeddings found in database. Skipping retrain.")
                return

            X = np.array(all_embeddings)
            y = np.array(all_labels)

            # Train KNN classifier
            clf = KNeighborsClassifier(n_neighbors=1, metric='euclidean')
            clf.fit(X, y)

            # Save classifier and supporting files
            classifier_path = str(settings.BASE_DIR / settings.FACE_CLASSIFIER_PATH)
            embeddings_path = str(settings.BASE_DIR / settings.FACE_EMBEDDINGS_PATH)
            labels_path = str(settings.BASE_DIR / settings.FACE_LABELS_PATH)

            joblib.dump(clf, classifier_path)
            np.save(embeddings_path, X)
            np.save(labels_path, y)

            logger.info(f"Face classifier retrained with {len(X)} embeddings, {len(set(y))} unique labels.")
            print(f"✅ Retrained classifier: {len(X)} embeddings, {len(set(y))} labels")
        except Exception as e:
            logger.error(f"Error retraining classifier: {e}")
            raise
        finally:
            db.close()


# Module-level singleton
face_service = FaceRecognitionService()