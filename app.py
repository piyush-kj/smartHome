"""
Smart Home Security System - door camera with face recognition
==============================================================
Flask + OpenCV. Deliberately simple.

How it works
------------
1. The browser opens the webcam and sends one photo to this server.
2. OpenCV finds the face in the photo (Haar cascade).
3. We turn the face into a small 100x100 "face fingerprint" (a normalised
   grayscale vector).
4. We compare that fingerprint with every face saved in faces/ using
   cosine similarity (a number from -1 to 1).
5. Score >= THRESHOLD  -> welcome guest.
   Score <  THRESHOLD   -> INTRUDER, and we save a snapshot.

Run:
    pip install -r requirements.txt
    python app.py
Then open http://127.0.0.1:5000
"""

import base64
import csv
import json
import os
import re
import time
from datetime import datetime

import cv2
import numpy as np
from flask import Flask, jsonify, render_template, request, send_from_directory

# --------------------------------------------------------------------------
# Settings - change these if you want
# --------------------------------------------------------------------------
THRESHOLD = 0.62          # 0.55 = looser (more people accepted), 0.75 = stricter
FACE_SIZE = (100, 100)    # size every face is resized to before comparing
MAX_SAMPLES = 5           # max photos stored per person
MAX_PEOPLE = 20           # max people enrolled

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FACES_DIR = os.path.join(BASE_DIR, "faces")
INTRUDER_DIR = os.path.join(BASE_DIR, "intruders")
MODEL_DIR = os.path.join(BASE_DIR, "models")
PEOPLE_FILE = os.path.join(FACES_DIR, "people.json")
LOG_FILE = os.path.join(BASE_DIR, "events.csv")

for folder in (FACES_DIR, INTRUDER_DIR):
    os.makedirs(folder, exist_ok=True)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 12 * 1024 * 1024   # 12 MB per photo

# OpenCV 5 removed CascadeClassifier from the Python package, so this project
# needs OpenCV 4.x. Catch that early with a readable message instead of a
# confusing AttributeError in the middle of a demo.
if not hasattr(cv2, "CascadeClassifier"):
    raise SystemExit(
        "\n  This project needs OpenCV 4.x, but version " + cv2.__version__ + " is installed.\n"
        "  OpenCV 5 removed the face detector we use.\n\n"
        "  Fix it with:\n"
        "      pip install \"opencv-python==4.10.0.84\"\n"
    )


# --------------------------------------------------------------------------
# Load the face detector
# --------------------------------------------------------------------------
def load_cascade():
    """Find haarcascade_frontalface_default.xml and open it.

    We look in our own models/ folder first (always shipped with the project),
    then fall back to the copy that comes with opencv-python. Newer OpenCV
    versions stopped shipping that file, so the local copy is the safe one.
    """
    candidates = [os.path.join(MODEL_DIR, "haarcascade_frontalface_default.xml")]
    try:
        candidates.append(
            os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml")
        )
    except Exception:
        pass

    for path in candidates:
        if os.path.exists(path):
            cascade = cv2.CascadeClassifier(path)
            if not cascade.empty():
                return cascade

    raise RuntimeError(
        "Could not load haarcascade_frontalface_default.xml. "
        "Make sure the models/ folder is next to app.py."
    )


CASCADE = load_cascade()


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------
def decode_image(data_url):
    """Turn a browser 'data:image/jpeg;base64,...' string into an OpenCV image."""
    if not data_url or not isinstance(data_url, str):
        return None
    if "," in data_url:
        data_url = data_url.split(",", 1)[1]
    try:
        raw = base64.b64decode(data_url)
    except Exception:
        return None
    buffer = np.frombuffer(raw, np.uint8)
    image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
    return image


def biggest_face(gray):
    """Return the largest detected face box (x, y, w, h), or None."""
    faces = CASCADE.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(60, 60),
    )
    if len(faces) == 0:
        return None
    # max() picks the biggest box, which is usually the person at the door
    return max(faces, key=lambda box: box[2] * box[3])


def crop_face(image, box, pad=0.18):
    """Cut the face out with a little margin around it."""
    x, y, w, h = [int(v) for v in box]
    margin = int(pad * max(w, h))
    x0 = max(0, x - margin)
    y0 = max(0, y - margin)
    x1 = min(image.shape[1], x + w + margin)
    y1 = min(image.shape[0], y + h + margin)
    return image[y0:y1, x0:x1]


def face_vector(face_bgr):
    """The 'face fingerprint': 100x100 grayscale, histogram equalised, unit length."""
    if face_bgr is None or face_bgr.size == 0:
        return None
    gray = cv2.cvtColor(face_bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, FACE_SIZE)
    gray = cv2.equalizeHist(gray)
    vec = gray.astype(np.float32).ravel()
    vec = vec - vec.mean()
    norm = np.linalg.norm(vec)
    if norm < 1e-6:
        return None
    return vec / norm


def score_between(a, b):
    """Cosine similarity of two face fingerprints, as a float."""
    return float(np.dot(a, b))


def slugify(name):
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "person"


# --------------------------------------------------------------------------
# People who live here (stored in faces/)
# --------------------------------------------------------------------------
def read_people():
    if os.path.exists(PEOPLE_FILE):
        try:
            with open(PEOPLE_FILE, "r", encoding="utf-8") as handle:
                return json.load(handle)
        except Exception:
            return {}
    return {}


def write_people(people):
    with open(PEOPLE_FILE, "w", encoding="utf-8") as handle:
        json.dump(people, handle, indent=2)


def samples_of(slug):
    """All saved photo filenames for one person."""
    return sorted(
        f for f in os.listdir(FACES_DIR)
        if f.startswith(slug + "_") and f.lower().endswith(".jpg")
    )


def load_known_faces():
    """Build the list of (slug, display name, fingerprint) for every saved photo."""
    known = []
    people = read_people()
    for slug in list(people.keys()):
        for filename in samples_of(slug):
            image = cv2.imread(os.path.join(FACES_DIR, filename))
            if image is None:
                continue
            vec = face_vector(image)
            if vec is not None:
                known.append((slug, people[slug], vec))
    return known


# --------------------------------------------------------------------------
# Event log (events.csv)
# --------------------------------------------------------------------------
def log_event(name, status, score):
    new_file = not os.path.exists(LOG_FILE)
    with open(LOG_FILE, "a", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        if new_file:
            writer.writerow(["time", "name", "status", "score"])
        writer.writerow([
            datetime.now().strftime("%d-%m-%Y %H:%M:%S"),
            name,
            status,
            round(score, 3) if score is not None else "",
        ])


def recent_events(limit=12):
    if not os.path.exists(LOG_FILE):
        return []
    with open(LOG_FILE, "r", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    return list(reversed(rows))[:limit]


# --------------------------------------------------------------------------
# Pages and routes
# --------------------------------------------------------------------------
@app.route("/")
def home():
    return render_template("index.html")


@app.route("/faces/<path:filename>")
def serve_face(filename):
    return send_from_directory(FACES_DIR, filename)


@app.route("/intruders/<path:filename>")
def serve_intruder(filename):
    return send_from_directory(INTRUDER_DIR, filename)


@app.route("/api/enroll", methods=["POST"])
def api_enroll():
    """Save a new face for a person. Call it once per photo (1-5 photos is good)."""
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    image = decode_image(data.get("image"))

    if len(name) < 2 or len(name) > 24:
        return jsonify(ok=False, message="Name must be 2 to 24 characters."), 400
    if image is None:
        return jsonify(ok=False, message="No photo received."), 400

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    box = biggest_face(gray)
    if box is None:
        return jsonify(ok=False, message="No face found. Face the camera in good light."), 400

    slug = slugify(name)
    people = read_people()

    if slug not in people and len(people) >= MAX_PEOPLE:
        return jsonify(ok=False, message=f"Only {MAX_PEOPLE} people can be enrolled."), 400

    existing = samples_of(slug)
    if len(existing) >= MAX_SAMPLES:
        return jsonify(
            ok=False,
            message=f"{people.get(slug, name)} already has {MAX_SAMPLES} photos. Remove them first.",
        ), 400

    face = crop_face(image, box)
    filename = f"{slug}_{len(existing) + 1}.jpg"
    cv2.imwrite(os.path.join(FACES_DIR, filename), face)

    people[slug] = name
    write_people(people)

    total = len(samples_of(slug))
    return jsonify(
        ok=True,
        message=f"Saved photo {total} of {name}.",
        name=name,
        slug=slug,
        samples=total,
    )


@app.route("/api/recognize", methods=["POST"])
def api_recognize():
    """Compare one webcam photo against everyone enrolled."""
    data = request.get_json(silent=True) or {}
    image = decode_image(data.get("image"))
    if image is None:
        return jsonify(ok=False, status="error", message="No photo received."), 400

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    box = biggest_face(gray)

    if box is None:
        return jsonify(
            ok=True,
            status="noface",
            message="No face in the frame.",
        )

    face = crop_face(image, box)
    vec = face_vector(face)
    if vec is None:
        return jsonify(ok=True, status="noface", message="Face too dark to read.")

    known = load_known_faces()
    best_name, best_slug, best_score = None, None, -1.0
    for slug, display_name, known_vec in known:
        score = score_between(vec, known_vec)
        if score > best_score:
            best_name, best_slug, best_score = display_name, slug, score

    x, y, w, h = [int(v) for v in box]
    result = {
        "ok": True,
        "box": {"x": x, "y": y, "w": w, "h": h},
        "score": round(best_score, 3) if best_score > -1 else None,
        "threshold": THRESHOLD,
        "enrolled": len(known),
    }

    if best_score >= THRESHOLD:
        result.update(status="known", name=best_name, slug=best_slug,
                      message=f"Welcome, {best_name}!")
        log_event(best_name, "welcome", best_score)
    else:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"intruder_{stamp}.jpg"
        cv2.imwrite(os.path.join(INTRUDER_DIR, filename), face)
        result.update(status="unknown", name="Unknown", slug=None,
                      message="INTRUDER ALERT",
                      snapshot=f"/intruders/{filename}")
        log_event("Unknown", "intruder", best_score if best_score > -1 else None)

    return jsonify(result)


@app.route("/api/people")
def api_people():
    people = read_people()
    out = []
    for slug, name in people.items():
        files = samples_of(slug)
        out.append({
            "slug": slug,
            "name": name,
            "samples": len(files),
            "thumb": f"/faces/{files[0]}" if files else None,
        })
    out.sort(key=lambda item: item["name"].lower())
    return jsonify(people=out, max_samples=MAX_SAMPLES, threshold=THRESHOLD)


@app.route("/api/delete", methods=["POST"])
def api_delete():
    data = request.get_json(silent=True) or {}
    slug = (data.get("slug") or "").strip()
    people = read_people()
    if slug not in people:
        return jsonify(ok=False, message="Person not found."), 404

    for filename in samples_of(slug):
        try:
            os.remove(os.path.join(FACES_DIR, filename))
        except OSError:
            pass
    people.pop(slug, None)
    write_people(people)
    return jsonify(ok=True, message="Removed.")


@app.route("/api/logs")
def api_logs():
    return jsonify(events=recent_events())


@app.route("/api/intruders")
def api_intruders():
    if not os.path.isdir(INTRUDER_DIR):
        return jsonify(intruders=[])
    files = [f for f in os.listdir(INTRUDER_DIR) if f.lower().endswith(".jpg")]
    files.sort(reverse=True)   # newest first, the name has a timestamp
    return jsonify(intruders=[
        {"file": f, "url": f"/intruders/{f}", "time": f.replace("intruder_", "").replace(".jpg", "")}
        for f in files[:8]
    ])


if __name__ == "__main__":
    print("\n  Smart Home Security System")
    print("  --------------------------")
    print(f"  Faces folder    : {FACES_DIR}")
    print(f"  Match threshold : {THRESHOLD}")
    print("  Open http://127.0.0.1:5000 in your browser\n")
    app.run(host="127.0.0.1", port=5000, debug=False)
