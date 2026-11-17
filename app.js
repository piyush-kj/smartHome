/* =========================================================
   SmartGuard front-end
   Talks to the Flask server (app.py):
     POST /api/recognize  -> who is at the door
     POST /api/enroll     -> save a new welcome guest
   ========================================================= */

var $ = function (id) { return document.getElementById(id); };

var video = $('video');
var overlay = $('overlay');
var captureCanvas = $('capture');

var stream = null;
var autoTimer = null;
var scanning = false;
var audioCtx = null;

/* ---------------- Camera ---------------- */
async function startCamera() {
  if (stream) return;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setCamMsg('This browser cannot open the camera. Try Chrome, Edge or Firefox on localhost.', true);
    return;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false
    });

    video.srcObject = stream;
    await video.play();

    $('cameraEmpty').classList.add('hide');
    $('camPill').textContent = 'Live';
    $('camPill').className = 'pill pill-green';

    $('startBtn').disabled = true;
    $('scanBtn').disabled = false;
    $('autoBtn').disabled = false;
    $('stopBtn').disabled = false;
    $('enrollBtn').disabled = false;

    setSystem('live', 'Camera on');
    setCamMsg('Camera is on. Press “Scan now”, or turn on auto-scan to check every few seconds.', false);
  } catch (err) {
    var why = 'Camera permission was blocked.';
    if (err && err.name === 'NotFoundError') why = 'No camera found on this computer.';
    if (err && err.name === 'NotAllowedError') why = 'You clicked “Block”. Reload the page and allow the camera.';
    if (err && err.name === 'NotReadableError') why = 'The camera is being used by another app (Zoom, Meet, etc.). Close it and try again.';
    setCamMsg(why, true);
  }
}

function stopCamera() {
  stopAuto();
  if (stream) {
    stream.getTracks().forEach(function (track) { track.stop(); });
    stream = null;
  }
  video.srcObject = null;
  clearBox();

  $('cameraEmpty').classList.remove('hide');
  $('camPill').textContent = 'Not started';
  $('camPill').className = 'pill';

  $('startBtn').disabled = false;
  $('scanBtn').disabled = true;
  $('autoBtn').disabled = true;
  $('stopBtn').disabled = true;
  $('enrollBtn').disabled = true;

  setSystem('off', 'Camera off');
  setCamMsg('Camera stopped.', false);
}

/* Grab one frame from the video as a JPEG data URL */
function captureFrame() {
  var w = video.videoWidth || 640;
  var h = video.videoHeight || 480;
  captureCanvas.width = w;
  captureCanvas.height = h;
  captureCanvas.getContext('2d').drawImage(video, 0, 0, w, h);
  return captureCanvas.toDataURL('image/jpeg', 0.85);
}

/* ---------------- Scanning ---------------- */
async function scan() {
  if (!stream || scanning) return;
  scanning = true;
  $('scanBtn').disabled = true;

  try {
    var response = await fetch('/api/recognize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: captureFrame() })
    });
    var data = await response.json();

    if (!data.ok) {
      showResult('noface', 'Error', data.message || 'The server could not read the photo.');
      return;
    }
    handleResult(data);
  } catch (err) {
    showResult('noface', 'Server not reachable',
      'Is app.py still running? Check the terminal window.');
  } finally {
    scanning = false;
    if (stream) $('scanBtn').disabled = false;
  }
}

function handleResult(data) {
  var box = data.box || null;

  if (data.status === 'known') {
    showResult('known', 'Welcome, ' + data.name, 'Face matched a person on the welcome list.');
    drawBox(box, '#1e8e3e');
    beep('known');
    setSystem('live', 'Welcome: ' + data.name);

  } else if (data.status === 'unknown') {
    showResult('unknown', 'INTRUDER ALERT', 'This face is not on the welcome list. A snapshot was saved.');
    drawBox(box, '#c5221f');
    beep('unknown');
    setSystem('alert', 'Intruder detected');
    loadIntruders();

  } else {
    showResult('noface', 'No face detected', data.message || 'Move closer and face the camera.');
    clearBox();
  }

  if (typeof data.score === 'number') {
    $('scorePill').textContent = 'match ' + data.score.toFixed(2);
    $('scorePill').className = 'pill' + (data.status === 'known' ? ' pill-green' : ' pill-red');
    $('resultMeta').textContent = 'Best match ' + data.score.toFixed(2) +
      ' (needs ' + data.threshold + ') · ' + (data.enrolled || 0) + ' saved face(s)';
  } else {
    $('scorePill').textContent = '—';
    $('scorePill').className = 'pill';
    $('resultMeta').textContent = '';
  }

  loadEvents();
}

function showResult(kind, title, text) {
  var card = $('resultCard');
  card.className = 'card result-card';

  if (kind === 'known') {
    card.classList.add('is-known');
    $('resultIcon').textContent = '\u2713';
  } else if (kind === 'unknown') {
    card.classList.add('is-unknown');
    $('resultIcon').textContent = '!';
  } else {
    card.classList.add('is-noface');
    $('resultIcon').textContent = '?';
  }

  $('resultTitle').textContent = title;
  $('resultText').textContent = text;
}

/* ---------------- Face box on the video ---------------- */
function drawBox(box, colour) {
  var w = video.videoWidth || 640;
  var h = video.videoHeight || 480;
  overlay.width = w;
  overlay.height = h;

  var ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  if (!box) return;

  ctx.strokeStyle = colour;
  ctx.lineWidth = Math.max(3, Math.round(w / 200));
  ctx.strokeRect(box.x, box.y, box.w, box.h);
}

function clearBox() {
  overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
}

/* ---------------- Auto scan ---------------- */
function startAuto() {
  if (autoTimer) return;
  autoTimer = setInterval(scan, 2200);
  $('autoBtn').textContent = 'Auto-scan: on';
  $('autoBtn').className = 'btn btn-primary';
  scan();
}

function stopAuto() {
  if (autoTimer) {
    clearInterval(autoTimer);
    autoTimer = null;
  }
  var btn = $('autoBtn');
  if (btn) {
    btn.textContent = 'Auto-scan: off';
    btn.className = 'btn btn-outline';
  }
}

/* ---------------- Enrolment ---------------- */
async function enroll() {
  var name = $('nameInput').value.trim();
  if (name.length < 2) {
    showEnrollMsg('Please type a name first (at least 2 letters).', false);
    return;
  }
  if (!stream) {
    showEnrollMsg('Start the camera first.', false);
    return;
  }

  $('enrollBtn').disabled = true;
  try {
    var response = await fetch('/api/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, image: captureFrame() })
    });
    var data = await response.json();
    showEnrollMsg(data.message || (data.ok ? 'Saved.' : 'Could not save.'), !!data.ok);

    if (data.ok) {
      $('nameInput').value = '';
      loadPeople();
      beep('known');
    }
  } catch (err) {
    showEnrollMsg('Server not reachable. Is app.py running?', false);
  } finally {
    $('enrollBtn').disabled = false;
  }
}

function showEnrollMsg(text, good) {
  var box = $('enrollMsg');
  box.textContent = text;
  box.className = 'alert show ' + (good ? 'alert-ok' : 'alert-bad');
}

/* ---------------- Lists ---------------- */
async function loadPeople() {
  try {
    var response = await fetch('/api/people');
    var data = await response.json();

    var list = $('peopleList');
    list.innerHTML = '';

    if (!data.people || data.people.length === 0) {
      list.innerHTML = '<p class="empty">No one added yet. Add a face on the left.</p>';
      $('peopleCount').textContent = '0 people';
      $('enrolledCount').textContent = '0 faces saved';
      if (data.threshold) $('thresholdVal').textContent = data.threshold;
      return;
    }

    data.people.forEach(function (person) {
      var card = document.createElement('div');
      card.className = 'person';
      card.innerHTML =
        (person.thumb
          ? '<img src="' + person.thumb + '" alt="' + person.name + '">'
          : '<div class="noimg">?</div>') +
        '<span class="person-name">' + person.name + '</span>' +
        '<span class="person-sub">' + person.samples + ' photo' + (person.samples === 1 ? '' : 's') + '</span>' +
        '<button class="person-remove" data-slug="' + person.slug + '">Remove</button>';
      list.appendChild(card);
    });

    var total = data.people.reduce(function (sum, p) { return sum + p.samples; }, 0);
    $('peopleCount').textContent = data.people.length + ' people';
    $('enrolledCount').textContent = total + ' face' + (total === 1 ? '' : 's') + ' saved';
    if (data.threshold) $('thresholdVal').textContent = data.threshold;
  } catch (err) {
    /* server not up yet, ignore */
  }
}

async function loadEvents() {
  try {
    var response = await fetch('/api/logs');
    var data = await response.json();
    var list = $('eventList');
    list.innerHTML = '';

    if (!data.events || data.events.length === 0) {
      list.innerHTML = '<li class="empty">No activity yet.</li>';
      return;
    }

    data.events.forEach(function (event) {
      var li = document.createElement('li');
      var kind = event.status === 'intruder' ? 'intruder' : 'welcome';
      li.innerHTML =
        '<span class="event-badge ' + kind + '">' + (kind === 'intruder' ? 'Intruder' : 'Welcome') + '</span>' +
        '<span class="event-name">' + event.name + '</span>' +
        '<span class="event-time">' + event.time + '</span>';
      list.appendChild(li);
    });
  } catch (err) {
    /* ignore */
  }
}

async function loadIntruders() {
  try {
    var response = await fetch('/api/intruders');
    var data = await response.json();
    var grid = $('intruderGrid');
    grid.innerHTML = '';

    if (!data.intruders || data.intruders.length === 0) {
      grid.innerHTML = '<p class="empty">No intruders recorded.</p>';
      return;
    }

    data.intruders.forEach(function (item) {
      var fig = document.createElement('figure');
      fig.innerHTML =
        '<img src="' + item.url + '" alt="Intruder snapshot">' +
        '<figcaption>' + formatStamp(item.time) + '</figcaption>';
      grid.appendChild(fig);
    });
  } catch (err) {
    /* ignore */
  }
}

/* "20261117_153012" -> "17-11 15:30" */
function formatStamp(stamp) {
  if (!stamp || stamp.length < 15) return stamp || '';
  return stamp.slice(6, 8) + '-' + stamp.slice(4, 6) + ' ' +
         stamp.slice(9, 11) + ':' + stamp.slice(11, 13);
}

/* ---------------- Small UI helpers ---------------- */
function setSystem(state, text) {
  var dot = $('sysDot');
  dot.className = 'dot' + (state === 'live' ? ' live' : state === 'alert' ? ' alert' : '');
  $('sysText').textContent = text;
}

function setCamMsg(text, bad) {
  var el = $('camMsg');
  el.textContent = text;
  el.style.color = bad ? '#c5221f' : '';
}

/* Short beeps so a person in another room hears the alert */
function beep(kind) {
  try {
    if (!audioCtx) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = new Ctx();
    }
    var notes = kind === 'unknown' ? [220, 220, 180] : [880];
    notes.forEach(function (freq, index) {
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = 0.06;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      var start = audioCtx.currentTime + index * 0.22;
      osc.start(start);
      osc.stop(start + 0.16);
    });
  } catch (err) {
    /* sound is optional */
  }
}

/* ---------------- Wire up the page ---------------- */
document.addEventListener('DOMContentLoaded', function () {
  $('startBtn').addEventListener('click', startCamera);
  $('stopBtn').addEventListener('click', stopCamera);
  $('scanBtn').addEventListener('click', scan);
  $('enrollBtn').addEventListener('click', enroll);

  $('autoBtn').addEventListener('click', function () {
    if (autoTimer) { stopAuto(); } else { startAuto(); }
  });

  $('nameInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') enroll();
  });

  /* Remove a person */
  $('peopleList').addEventListener('click', async function (e) {
    var btn = e.target.closest('button[data-slug]');
    if (!btn) return;
    var slug = btn.getAttribute('data-slug');
    if (!window.confirm('Remove this person from the welcome list?')) return;

    try {
      await fetch('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: slug })
      });
      loadPeople();
    } catch (err) {
      showEnrollMsg('Could not remove. Is app.py running?', false);
    }
  });

  loadPeople();
  loadEvents();
  loadIntruders();

  /* Demo / kiosk mode:
       ?autostart=1  open the camera immediately
       ?autoscan=1   also scan every 2 seconds (hands free)          */
  var query = window.location.search;
  if (query.indexOf('autostart=1') > -1) {
    startCamera().then(function () {
      if (query.indexOf('autoscan=1') > -1) startAuto();
    });
  }
});
