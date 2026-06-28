import { NextRequest, NextResponse } from 'next/server';
import { getStepResultActor } from '@/lib/actor-actions';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string; stepId: string }> },
) {
  const { key, stepId } = await params;
  const result = await getStepResultActor(key, stepId);
  if (result.ok) {
    return NextResponse.json({ ok: true, data: result.data });
  }
  return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
}
