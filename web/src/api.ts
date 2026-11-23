export class ApiError extends Error {
  status: number;
  code: string;
  details?: any;
  constructor(status: number, code: string, message: string, details?: any) {
    super(message);
    this.status = status; this.code = code; this.details = details;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: isForm || body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', "Can't reach the server. Check your connection and try again.");
  }
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  const json = isJson ? await res.json().catch(() => ({})) : {};
  // Dev proxy answers 500/502/504 with a non-JSON body when the API process isn't running
  if (!res.ok && !isJson && res.status >= 500)
    throw new ApiError(0, 'network', "The server isn't responding. Make sure the API is running (npm run dev) and try again.");
  if (!res.ok) {
    const e = json?.error ?? {};
    if (res.status === 401 && path !== '/auth/login') window.dispatchEvent(new Event('auth:expired'));
    throw new ApiError(res.status, e.code ?? 'error', e.message ?? 'Something went wrong.', e.details);
  }
  return json as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b: unknown = {}) => request<T>('POST', p, b),
  patch: <T>(p: string, b: unknown) => request<T>('PATCH', p, b),
};

/** Downscale photos on the device before upload (saves data on mobile). Falls back to the original file. */
async function compress(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
    return blob ?? file;
  } catch {
    return file;
  }
}

export async function uploadPhoto(file: File) {
  const blob = await compress(file);
  const fd = new FormData();
  fd.append('photo', blob, blob === file ? file.name : 'photo.jpg');
  return (await api.post<{ url: string }>('/uploads', fd)).url;
}
