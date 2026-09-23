// Attach: send a photo or file to the host and type its path into the
// terminal, where an agent can read it ("look at /path/to/photo.png").
export function wireUploads({ send, onStatus }) {
  const input = document.getElementById('attach-input');
  document.querySelector('[data-action="attach"]').addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = ''; // the same file can be picked again
    if (!file) return;
    onStatus(`Uploading ${file.name}…`);
    try {
      const res = await fetch(`/api/uploads?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
      if (!res.ok) throw new Error((await res.text()).trim() || res.statusText);
      const { path } = await res.json();
      // Paths are built by the host from safe characters only, so no quoting is needed.
      send(`${path} `);
      onStatus('');
    } catch (e) {
      onStatus(`Upload failed: ${e.message}`);
    }
  });
}
