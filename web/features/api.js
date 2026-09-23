// Thin fetch wrapper. Same-origin only; the cookie rides along automatically.

export class Unauthorized extends Error {}

export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new Unauthorized();
  if (!res.ok) throw new Error((await res.text()).trim() || res.statusText);
  return res.status === 204 ? null : res.json();
}
