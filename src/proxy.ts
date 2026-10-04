import { NextResponse, type NextRequest } from 'next/server';
import { checkAppAccess } from '@/lib/access';

export function proxy(request: NextRequest) {
  return checkAppAccess(request.headers.get('authorization')) ?? NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
