import { getAssetStream } from '@/lib/storage';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key: keyParts } = await params;
  const key = keyParts.join('/');
  try {
    const stream = await getAssetStream(key);
    return new Response(stream, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch {
    return new Response('Asset not found', { status: 404 });
  }
}
