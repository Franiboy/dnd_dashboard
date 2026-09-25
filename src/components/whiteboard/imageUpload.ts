import {
  getServerMessagePayload,
  localizeServerMessage,
  type ServerMessageLike,
} from '../../i18n/serverMessages';
import type { TFunction } from '../../i18n/messages';
import type { ServerMessageParams } from '../../../shared/types';

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

export interface WhiteboardImageErrorMessages {
  fileRead: string;
  upload: string;
  imageLoad: string;
  imageEmptyOrTooLarge: string;
}

export class WhiteboardImageLocalizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WhiteboardImageLocalizedError';
  }
}

export class WhiteboardImageServerError extends WhiteboardImageLocalizedError {
  readonly serverPayload: ServerMessageLike;
  readonly serverMessage: string;
  readonly fallback: string;
  readonly errorCode?: string;
  readonly messageKey?: string;
  readonly params?: ServerMessageParams;

  constructor(serverPayload: ServerMessageLike | string, fallback: string) {
    super(fallback);
    this.name = 'WhiteboardImageServerError';
    this.fallback = fallback;
    this.serverPayload =
      typeof serverPayload === 'string' ? { error: serverPayload } : serverPayload;
    this.serverMessage =
      typeof this.serverPayload.error === 'string' && this.serverPayload.error
        ? this.serverPayload.error
        : typeof this.serverPayload.message === 'string' && this.serverPayload.message
          ? this.serverPayload.message
          : fallback;
    this.errorCode = this.serverPayload.errorCode ?? undefined;
    this.messageKey = this.serverPayload.messageKey ?? undefined;
    this.params = this.serverPayload.params;
  }
}

export function localizeWhiteboardImageError(
  error: unknown,
  t: TFunction,
  fallback: string
): string {
  if (!(error instanceof Error)) return fallback;
  if (error instanceof WhiteboardImageServerError) {
    const safeFallback = fallback || error.fallback;
    if (!error.serverPayload.messageKey && !error.serverPayload.errorCode) return safeFallback;

    const localized = localizeServerMessage(
      {
        ...error.serverPayload,
        message: safeFallback,
        error: undefined,
      },
      t,
      { fallback: safeFallback }
    );
    return localized || safeFallback;
  }
  if (error instanceof WhiteboardImageLocalizedError) return error.message || fallback;
  return fallback;
}

export function isUploadableImage(file: File): boolean {
  return ALLOWED_IMAGE_TYPES.includes(file.type) && file.size <= MAX_UPLOAD_BYTES;
}

/** Board-relative URL of a pasted/uploaded board image (not an external link). */
export function isInternalBoardImageUrl(url: string): boolean {
  return url.startsWith('/uploads/whiteboard/');
}

/** Uploads an image and resolves with its board-relative URL. */
export async function uploadWhiteboardImage(
  file: File,
  messages: WhiteboardImageErrorMessages
): Promise<string> {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = () => reject(new WhiteboardImageLocalizedError(messages.fileRead));
    reader.readAsDataURL(file);
  });

  try {
    const res = await fetch('/api/whiteboard/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ data, type: file.type }),
    });
    if (!res.ok) {
      let serverPayload: ServerMessageLike = { error: messages.upload };
      try {
        serverPayload = getServerMessagePayload(await res.json()) ?? serverPayload;
      } catch {
        // Keep the localized fallback when the server does not return JSON.
      }
      throw new WhiteboardImageServerError(serverPayload, messages.upload);
    }
    return ((await res.json()) as { url: string }).url;
  } catch (error) {
    if (error instanceof WhiteboardImageLocalizedError) throw error;
    throw new WhiteboardImageLocalizedError(messages.upload);
  }
}

/**
 * Re-uploads an existing board image so a copied card owns its own file.
 * Keeps deletion simple: removing a copy never orphans or breaks the original.
 */
export async function cloneBoardImage(
  url: string,
  messages: WhiteboardImageErrorMessages
): Promise<string> {
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new WhiteboardImageLocalizedError(messages.imageLoad);
    const blob = await res.blob();
    if (blob.size === 0 || blob.size > MAX_UPLOAD_BYTES) {
      throw new WhiteboardImageLocalizedError(messages.imageEmptyOrTooLarge);
    }
    const extensionFromUrl = /\.(png|jpe?g|gif|webp)$/i.exec(url)?.[0].toLowerCase();
    let type = blob.type;
    if (!ALLOWED_IMAGE_TYPES.includes(type)) type = 'image/png';
    const extension = extensionFromUrl ?? EXTENSION_BY_TYPE[type] ?? '.png';
    return await uploadWhiteboardImage(new File([blob], `kopie${extension}`, { type }), messages);
  } catch (error) {
    if (error instanceof WhiteboardImageLocalizedError) throw error;
    throw new WhiteboardImageLocalizedError(messages.imageLoad);
  }
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
