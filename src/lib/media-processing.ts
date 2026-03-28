import sharp from "sharp";

export const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
export const MAX_IMAGES_PER_CONVERSATION = 4;

const MAX_DIMENSION = 4096; // X API max image dimension
const THUMBNAIL_WIDTH = 400;
const THUMBNAIL_QUALITY = 80;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

interface ProcessedImage {
  buffer: Buffer;
  width: number;
  height: number;
  mimeType: string;
}

interface Thumbnail {
  buffer: Buffer;
  mimeType: string;
}

export function isAllowedMimeType(type: string): type is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(type);
}

export async function processImage(buffer: Buffer, mimeType: string): Promise<ProcessedImage> {
  let pipeline = sharp(buffer, { animated: mimeType === "image/gif" });
  const metadata = await pipeline.metadata();

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  // Resize if exceeds max dimension (preserve aspect ratio)
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    pipeline = pipeline.resize(MAX_DIMENSION, MAX_DIMENSION, {
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  // Strip EXIF/metadata, convert HEIC → JPEG
  const outputFormat =
    mimeType === "image/gif"
      ? "gif"
      : mimeType === "image/png"
        ? "png"
        : mimeType === "image/webp"
          ? "webp"
          : "jpeg";

  pipeline = pipeline.rotate(); // auto-rotate based on EXIF
  const outputBuffer = await pipeline.toFormat(outputFormat).toBuffer();
  const outputMetadata = await sharp(outputBuffer).metadata();

  const outputMimeType =
    outputFormat === "gif"
      ? "image/gif"
      : outputFormat === "png"
        ? "image/png"
        : outputFormat === "webp"
          ? "image/webp"
          : "image/jpeg";

  return {
    buffer: outputBuffer,
    width: outputMetadata.width ?? width,
    height: outputMetadata.height ?? height,
    mimeType: outputMimeType,
  };
}

export async function generateThumbnail(buffer: Buffer): Promise<Thumbnail> {
  const thumbnailBuffer = await sharp(buffer)
    .resize(THUMBNAIL_WIDTH, undefined, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: THUMBNAIL_QUALITY })
    .toBuffer();

  return {
    buffer: thumbnailBuffer,
    mimeType: "image/jpeg",
  };
}
