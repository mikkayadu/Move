import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { StaticMapService } from './static-map.service';

@Controller('map')
export class MapController {
  constructor(private readonly staticMap: StaticMapService) {}

  /**
   * Proxies the rendered route image.
   *
   * The `.png` suffix is cosmetic but useful: it makes the response a plain
   * `<img src>` target, so the browser and the service worker cache it like
   * any other image with no extra client code.
   */
  @Get(':id.png')
  @Header('Content-Type', 'image/png')
  // The underlying snapshot never changes, so this is safe to cache hard.
  @Header('Cache-Control', 'public, max-age=86400, immutable')
  async render(@Param('id') id: string, @Res() response: Response): Promise<void> {
    const image = await this.staticMap.render(id);
    response.end(image);
  }
}
