const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export function isUploadableImage(file: File): boolean {
  return ALLOWED_IMAGE_TYPES.includes(file.type) && file.size <= MAX_UPLOAD_BYTES;
}

/** Uploads an image and resolves with its board-relative URL. */
export async function uploadWhiteboardImage(file: File): Promise<string> {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
    reader.readAsDataURL(file);
  });

  const res = await fetch('/api/whiteboard/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ data, type: file.type }),
  });
  if (!res.ok) {
    let message = 'Upload fehlgeschlagen.';
    try {
      message = (await res.json()).error ?? message;
    } catch {
      // keep default message
    }
    throw new Error(message);
  }
  return ((await res.json()) as { url: string }).url;
}

/** Resolves the intrinsic pixel size of an image URL, or null if unloadable. */
export function probeImageSize(url: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Loads an image element for pixel-level operations like cropping. */
export function loadImageElement(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function stripImageExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}
