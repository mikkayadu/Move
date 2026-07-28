import { BadRequestException, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Move deliberately has no accounts. The client generates a random id on first
 * launch, stores it in localStorage, and sends it as `x-device-id`. That is
 * enough to scope saved destinations and push subscriptions, and it removes an
 * entire login screen from a one-day build.
 */
export const DeviceId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<Request>();
  const header = request.header('x-device-id');

  if (!header || header.trim().length < 8) {
    throw new BadRequestException('Missing or malformed x-device-id header');
  }

  return header.trim().slice(0, 128);
});
