import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { LibraryScanBodyDto } from '@karaokej/shared';
import { LibraryService } from './library.service';
import { LyricsService } from '../lyrics/lyrics.service';
import { CoverService } from '../covers/cover.service';

@Controller('library')
export class LibraryController {
  constructor(
    private readonly library: LibraryService,
    private readonly lyrics: LyricsService,
    private readonly covers: CoverService,
  ) {}

  @Get('status')
  status() {
    return this.library.status();
  }

  @Get('artists/random')
  randomArtist(@Query('exclude') exclude?: string) {
    return this.library.getRandomArtist(exclude);
  }

  @Post('rebase')
  async rebase() {
    return this.library.rebaseCatalogue();
  }

  @Post('scan')
  async scan(@Body() body: LibraryScanBodyDto) {
    await this.library.startScan(body ?? {});
    return this.library.status();
  }

  @Post('scan/cancel')
  cancelScan() {
    this.library.cancelScan();
    return this.library.status();
  }

  @Post('scan/refresh')
  refreshScan() {
    return this.library.refreshScan();
  }

  @Post('fetch-lyrics')
  async fetchLyrics() {
    await this.lyrics.startFetch();
    return this.library.status();
  }

  @Post('fetch-lyrics/cancel')
  cancelFetchLyrics() {
    this.lyrics.cancelFetch();
    return this.library.status();
  }

  @Post('covers')
  createThumbnails() {
    this.covers.startBatch();
    return this.library.status();
  }

  @Post('covers/cancel')
  cancelThumbnails() {
    this.covers.cancelBatch();
    return this.library.status();
  }
}
