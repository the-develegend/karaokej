import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { LibraryService } from '../library/library.service';
import { LyricsService } from '../lyrics/lyrics.service';
import { RatingService } from '../rating/rating.service';
import { TrackMetadataService } from '../metadata/track-metadata.service';
import { TrackMoveService } from '../library/track-move.service';
import { SeparationService } from '../karaoke/separation.service';
import { StreamService } from '../stream/stream.service';
import { NotFoundException } from '@nestjs/common';
import { ArtistBioService } from '../artist-bio/artist-bio.service';
import {
  ArtistBioChooseDto,
  MetadataSearchRequestDto,
  parseLibrarySort,
  parseTagName,
} from '@karaokej/shared';
import { MetadataSearchService } from '../metadata-search/metadata-search.service';
import { TagsService } from '../tags/tags.service';

function tagKeysFromQuery(tags?: string | string[]): string[] {
  const raw = tags == null ? [] : Array.isArray(tags) ? tags : tags.split(',');
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const parsed = parseTagName(item);
    if (!parsed || seen.has(parsed.key)) {
      continue;
    }
    seen.add(parsed.key);
    keys.push(parsed.key);
  }
  return keys;
}

@Controller('tracks')
export class TracksController {
  constructor(
    private readonly library: LibraryService,
    private readonly lyrics: LyricsService,
    private readonly stream: StreamService,
    private readonly ratings: RatingService,
    private readonly metadata: TrackMetadataService,
    private readonly metadataSearch: MetadataSearchService,
    private readonly trackMove: TrackMoveService,
    private readonly separation: SeparationService,
    private readonly artistBio: ArtistBioService,
    private readonly tags: TagsService,
  ) {}

  @Get()
  search(
    @Query('q') q = '',
    @Query('page') page = '1',
    @Query('limit') limit = '15',
    @Query('minRating') minRating?: string,
    @Query('hideDuplicates') hideDuplicates?: string,
    @Query('tags') tags?: string | string[],
    @Query('orderedIds') orderedIds?: string,
    @Query('sort') sort?: string,
  ) {
    const parsed =
      minRating == null || minRating === '' ? undefined : Number(minRating);
    const dedupe =
      hideDuplicates === '1' ||
      hideDuplicates === 'true' ||
      hideDuplicates === 'yes';
    const tagKeys = tagKeysFromQuery(tags);
    const librarySort = parseLibrarySort(sort);
    if (
      orderedIds === '1' ||
      orderedIds === 'true' ||
      orderedIds === 'yes'
    ) {
      return {
        ids: this.library.orderedTrackIds(q, parsed, dedupe, tagKeys, librarySort),
      };
    }
    return this.library.search(
      q,
      Number(page) || 1,
      Number(limit) || 15,
      parsed,
      dedupe,
      tagKeys,
      librarySort,
    );
  }

  @Get(':id/tags')
  trackTags(@Param('id', ParseIntPipe) id: number) {
    return this.tags.trackState(id);
  }

  @Put(':id/tags')
  assignTags(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { names?: unknown },
  ) {
    return this.tags.assign(id, body?.names);
  }

  @Get(':id/audio')
  audio(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.stream.stream(id, req, res);
  }

  @Get(':id/karaoke-stem')
  karaokeStem(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const absolute = this.separation.getStemFilePath(id);
    this.stream.streamFile(absolute, 'audio/mpeg', req, res);
  }

  @Get(':id/lyrics')
  lyricsFor(@Param('id', ParseIntPipe) id: number) {
    return this.lyrics.getParsed(id);
  }

  @Post(':id/lyrics/fetch')
  fetchLyrics(@Param('id', ParseIntPipe) id: number) {
    return this.lyrics.fetchTrack(id);
  }

  @Get(':id/lyrics/search')
  searchLyrics(
    @Param('id', ParseIntPipe) id: number,
    @Query('q') q = '',
  ) {
    return this.lyrics.searchForTrack(id, q);
  }

  @Post(':id/lyrics/apply')
  applyLyrics(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { lrclibId?: unknown },
  ) {
    const lrclibId = Number(body?.lrclibId);
    return this.lyrics.applyRecord(id, lrclibId);
  }

  @Post(':id/lyrics/unavailable')
  markLyricsUnavailable(@Param('id', ParseIntPipe) id: number) {
    return this.lyrics.markUnavailable(id);
  }

  @Put(':id/rating')
  setRating(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { rating?: unknown },
  ) {
    return this.ratings.setRating(id, body?.rating);
  }

  @Get(':id/metadata')
  readMetadata(@Param('id', ParseIntPipe) id: number) {
    return this.metadata.readFromFile(id);
  }

  @Put(':id/metadata')
  updateMetadata(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, unknown>,
  ) {
    return this.metadata.updateMetadata(id, body);
  }

  @Post(':id/metadata/search')
  searchMetadata(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: MetadataSearchRequestDto,
  ) {
    return this.metadataSearch.searchTrack(id, body.query, body.providerIds);
  }

  @Post(':id/move/preview')
  previewMove(@Param('id', ParseIntPipe) id: number) {
    return this.trackMove.previewMove(id);
  }

  @Post(':id/move')
  executeMove(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { removeEmptyDirs?: unknown },
  ) {
    const removeEmptyDirs = body?.removeEmptyDirs !== false;
    return this.trackMove.executeMove(id, removeEmptyDirs);
  }

  @Get(':id/path')
  path(@Param('id', ParseIntPipe) id: number) {
    return this.library.getTrackPath(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id', ParseIntPipe) id: number): void {
    this.library.deleteTrackFile(id);
  }

  @Get(':id/artist-bio')
  artistBioFor(@Param('id', ParseIntPipe) id: number) {
    return this.artistBio.getForTrack(id);
  }

  @Post(':id/artist-bio/choose')
  chooseArtistBio(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ArtistBioChooseDto,
  ) {
    return this.artistBio.chooseForTrack(id, body);
  }

  @Post(':id/artist-bio/refresh')
  refreshArtistBio(@Param('id', ParseIntPipe) id: number) {
    return this.artistBio.refreshForTrack(id);
  }

  @Get(':id/artist-bio/extras')
  artistBioExtras(@Param('id', ParseIntPipe) id: number) {
    return this.artistBio.getExtrasForTrack(id);
  }

  @Get(':id')
  one(@Param('id', ParseIntPipe) id: number) {
    const track = this.library.getTrackDto(id);
    if (!track) {
      throw new NotFoundException('Track not found');
    }
    return track;
  }
}
