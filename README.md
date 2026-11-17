# SmartGuard — Smart Home Security System

A small face-recognition door camera. You add the faces of people who are
welcome (family, the guard, a friend). Anyone else who stands in front of the
camera is flagged as an **intruder** and a snapshot is saved.

Built with **Python + Flask + OpenCV** on the server and **HTML, CSS and
JavaScript** in the browser.

![Screenshot](docs/screenshot.jpg)

---

## What you need

- Python 3.9 or newer — <https://python.org> (tick **"Add Python to PATH"** on Windows)
- A webcam
- Chrome, Edge or Firefox

No database, no internet, no accounts. Everything runs on your own laptop.

---

## Setup (Windows)

Open **Command Prompt** in this folder, then run these four lines one by one:

```bat
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Or just double-click **`run_windows.bat`** — it does all four for you.

## Setup (macOS / Linux)

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

Or run **`./run_mac_linux.sh`**.

Then open **<http://127.0.0.1:5000>** in your browser.

> The camera only works on `localhost` or `https`, which is why you must open
> `127.0.0.1:5000` and not the file directly.

---

## How to use it

1. Press **Start camera** and click **Allow** when the browser asks.
2. In *Add a welcome guest*, type a name (for example `Mummy`) and press
   **Save face**. Do this **2–3 times** — turn your head slightly, change the
   light. More photos = better matching.
3. Press **Scan now**. A green box and **"Welcome, Mummy"** should appear.
4. Now let someone else (or nobody) stand in front of the camera and scan.
   You get a red **INTRUDER ALERT**, a snapshot in the gallery, and an entry in
   *Recent activity*.
5. **Auto-scan: on** checks every 2 seconds, hands free.

### Demo mode (hands free, good for a live presentation)

```
http://127.0.0.1:5000/?autostart=1&autoscan=1
```

The camera opens by itself and scans every 2 seconds. Press `F11` for full
screen and it looks like a real security panel.

---

## How it works

1. The browser grabs one frame from the webcam and POSTs it to `/api/recognize`.
2. `app.py` decodes it and converts it to grayscale.
3. OpenCV's Haar cascade finds the biggest face in the frame.
4. That face is cut out, resized to 100×100, histogram-equalised and turned
   into a normalised vector — a simple "face fingerprint".
5. The fingerprint is compared with every saved face using **cosine
   similarity**, a number from -1 to 1.

   - **0.62 or higher → welcome guest**
   - **below 0.62 → intruder** (snapshot saved to `intruders/`)

That is the whole algorithm. It is not the most accurate method in the world —
it is small, readable and easy to explain in a viva.

---

## Files

```
smart-home-security/
├── app.py                    Flask server + all OpenCV code
├── requirements.txt
├── run_windows.bat           one-click start (Windows)
├── run_mac_linux.sh          one-click start (macOS/Linux)
├── templates/
│   └── index.html            the dashboard
├── static/
│   ├── css/style.css
│   └── js/app.js             camera, capture, fetch calls, UI
├── models/
│   └── haarcascade_frontalface_default.xml    face detector (bundled)
├── faces/                    photos of welcome guests (created at runtime)
├── intruders/                snapshots of strangers
├── events.csv                activity log
└── docs/screenshot.jpg
```

`faces/`, `intruders/` and `events.csv` are created automatically on first run.

---

## Tuning the accuracy

Open `app.py` and change the line near the top:

```python
THRESHOLD = 0.62
```

- **Not recognising you?** Lower it to `0.55`.
- **Strangers getting in as guests?** Raise it to `0.70`.

The screen always shows the actual match score, for example `match 0.87
(needs 0.62)`, so you can see exactly how close a decision was.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `This project needs OpenCV 4.x` | Run `pip install "opencv-python==4.10.0.84"`. OpenCV 5 removed the face detector we use. |
| Camera never starts | Click the camera icon in the address bar → Allow, then reload. Close Zoom/Meet/Teams — only one app can use the webcam. |
| "No face detected" | Move closer, face the camera, and put a light in front of you (not behind). |
| Wrong person's name appears | Add 2–3 more photos of each person, then lower `THRESHOLD`. |
| `Address already in use` | Another copy is running. Change `port=5000` to `port=5001` at the bottom of `app.py`. |
| Page loads but looks broken | Hard refresh: `Ctrl + Shift + R`. |

---

## Honest limitations

- This is a **college/demo project**, not real security hardware. Do not use it
  to actually guard a house.
- Matching is pixel-based, so a big change in lighting or a beard can drop the
  score below the threshold.
- Only the largest face in the frame is checked, so two people at the door at
  the same time are treated as one.
- The server listens on `127.0.0.1` only — other devices on your Wi-Fi cannot
  open it. That is intentional.

## If you want to improve it later

- Use `cv2.face.LBPHFaceRecognizer` (from `opencv-contrib-python`) instead of
  cosine similarity — better accuracy, still offline.
- Replace the Haar cascade with `cv2.FaceDetectorYN` (YuNet) — much better in
  low light.
- Add a "two faces at once" loop, or a Telegram/email alert on intruder.

---

## Credits

Face detector: the Haar cascade that ships with OpenCV (Intel licence).
Everything else was written for this project. Free to use for learning.
