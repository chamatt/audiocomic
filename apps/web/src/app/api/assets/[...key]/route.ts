import { getAssetStream } from "@/lib/storage";

export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: keyParts } = await params;
  const key = keyParts.join("/");
  try {
    const stream = await getAssetStream(key);
    const ext = key.split(".").pop()?.toLowerCase() ?? "";
    const mimeTypes: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      svg: "image/svg+xml",
      mp4: "video/mp4",
      webm: "video/webm",
      mp3: "audio/mpeg",
      json: "application/json",
      pdf: "application/pdf",
    };
    const contentType = mimeTypes[ext] ?? "application/octet-stream";
    return new Response(stream, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new Response("Asset not found", { status: 404 });
  }
}
