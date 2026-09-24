// Attach: send a photo or file to the host and type its path into the
// terminal, where an agent can read it ("look at /path/to/photo.png").
export function wireUploads({ send, onStatus }) {
  const input = document.getElementById('attach-input');
  document.querySelector('[data-action="attach"]').addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = ''; // the same file can be picked again
    if (file) await attach(file, file.name, { send, onStatus });
  });
  wireRecorder(document.querySelector('[data-action="record"]'), { send, onStatus });
}

// upload saves the file on the host and returns its path, or null on failure.
async function upload(blob, name, { onStatus }) {
  onStatus(`Uploading ${name}…`);
  try {
    const res = await fetch(`/api/uploads?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob });
    if (!res.ok) throw new Error((await res.text()).trim() || res.statusText);
    return (await res.json()).path;
  } catch (e) {
    onStatus(`Upload failed: ${e.message}`);
    return null;
  }
}

// Paths are built by the host from safe characters only, so no quoting is needed.
async function attach(blob, name, deps) {
  const path = await upload(blob, name, deps);
  if (!path) return;
  deps.send(`${path} `);
  deps.onStatus('');
}

// Voice notes: tap to record, tap again to stop and upload, like an attachment.
// The path is typed at the prompt; what reads the audio is up to the harness.
// MediaRecorder picks the container the browser supports (WebM on Chrome and
// Android, MP4 on Safari); the file name carries the matching extension.
function wireRecorder(button, deps) {
  let recorder = null;
  const setRecording = (on) => button.setAttribute('aria-pressed', String(on));

  button.addEventListener('click', async () => {
    if (recorder) return recorder.stop();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      deps.onStatus(e.name === 'NotAllowedError' ? 'Allow the microphone to record' : `No microphone: ${e.message}`);
      return;
    }
    const chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop()); // release the mic (and its indicator) at once
      const type = recorder.mimeType || 'audio/webm';
      recorder = null;
      setRecording(false);
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
      attach(new Blob(chunks, { type }), `voice-${stamp}.${ext}`, deps);
    };
    recorder.start();
    setRecording(true);
    deps.onStatus('Recording… tap the mic again to send');
  });
}
