import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { KARAOKE_DEFAULTS, defaultKaraokeState } from '@karaokej/shared';
import {
  KaraokeAudioEngine,
  resetKaraokeEngineForTests,
} from './karaokeEngine';
import {
  FakeAudioContext,
  createFakeAudioElement,
} from './fakeAudioContext';

describe('KaraokeAudioEngine', () => {
  let audio: HTMLAudioElement;
  let fakeCtx: FakeAudioContext;
  let engine: KaraokeAudioEngine;

  beforeEach(() => {
    resetKaraokeEngineForTests();
    audio = createFakeAudioElement();
    fakeCtx = new FakeAudioContext('running');
    engine = new KaraokeAudioEngine({
      create: () => fakeCtx as unknown as AudioContext,
    });
    engine.bind(audio);
  });

  afterEach(() => {
    engine.dispose();
    resetKaraokeEngineForTests();
  });

  it('does not attach when mode is off initially', () => {
    engine.applyState(defaultKaraokeState(), null);
    expect(engine.getContext()).toBeNull();
    expect(engine.getSource()).toBeNull();
    expect(engine.getAnalyser()).toBeNull();
    expect(audio.play).not.toHaveBeenCalled;
  });

  it('attaches analyser tap via ensureAnalysis without enabling karaoke', async () => {
    await engine.ensureAnalysis();
    expect(engine.getContext()).toBeTruthy();
    expect(engine.getSource()).toBeTruthy();
    expect(engine.getAnalyser()).toBeTruthy();
    const passthrough = engine.getPassthroughOutput();
    expect(passthrough?.gain.value).toBe(1);
    expect(engine.getReductionProcessor().getMixLevel()).toBe(0);
    const analysers = fakeCtx.nodes.filter((n) => n.type === 'AnalyserNode');
    expect(analysers).toHaveLength(1);
  });

  it('creates exactly one context and source when enabling karaoke', async () => {
    engine.applyState(
      {
        ...defaultKaraokeState(),
        mode: 'vocal-reduction',
      },
      null,
    );
    await engine.sync();
    expect(engine.getContext()).toBeTruthy();
    expect(engine.getSource()).toBeTruthy();
    engine.applyState(
      { ...defaultKaraokeState(), mode: 'off' },
      null,
    );
    engine.applyState(
      { ...defaultKaraokeState(), mode: 'vocal-reduction' },
      null,
    );
    await engine.sync();
    const sources = fakeCtx.nodes.filter(
      (n) => n.type === 'MediaElementAudioSourceNode',
    );
    expect(sources).toHaveLength(1);
  });

  it('does not restart playback when switching modes', async () => {
    const playSpy = vi.spyOn(audio, 'play');
    const pauseSpy = vi.spyOn(audio, 'pause');
    const loadSpy = vi.spyOn(audio, 'load');
    const before = audio.currentTime;

    engine.applyState(
      { ...defaultKaraokeState(), mode: 'vocal-reduction' },
      null,
    );
    await engine.sync();
    engine.applyState({ ...defaultKaraokeState(), mode: 'off' }, null);
    engine.applyState(
      { ...defaultKaraokeState(), mode: 'vocal-reduction' },
      null,
    );
    await engine.sync();

    expect(playSpy).not.toHaveBeenCalled();
    expect(pauseSpy).not.toHaveBeenCalled();
    expect(loadSpy).not.toHaveBeenCalled();
    expect(audio.currentTime).toBe(before);
  });

  it('routes bypass when off and reduction when vocal-reduction', async () => {
    engine.applyState(
      { ...defaultKaraokeState(), mode: 'vocal-reduction' },
      null,
    );
    await engine.sync();
    const passthrough = engine.getPassthroughOutput();
    const reduction = engine.getReductionProcessor();
    expect(passthrough?.gain.value).toBe(0);
    expect(reduction.getMixLevel()).toBe(1);

    engine.applyState({ ...defaultKaraokeState(), mode: 'off' }, null);
    await engine.sync();
    expect(passthrough?.gain.value).toBe(1);
    expect(reduction.getMixLevel()).toBe(0);
  });

  it('updates centre matrix coefficients', async () => {
    engine.applyState(
      {
        ...defaultKaraokeState(),
        mode: 'vocal-reduction',
        live: {
          ...KARAOKE_DEFAULTS,
          centerAmount: 0.5,
          eqBands: KARAOKE_DEFAULTS.eqBands.map((b) => ({ ...b })),
        },
      },
      null,
    );
    await engine.sync();
    const proc = engine.getReductionProcessor();
    expect(proc.getMatrixGains(0.5)).toEqual({ same: 0.75, cross: -0.25 });
    expect(proc.getChannelMatrixLevels()).toEqual({
      same: expect.closeTo(0.75),
      cross: expect.closeTo(-0.25),
    });

    engine.applyState(
      {
        ...defaultKaraokeState(),
        mode: 'vocal-reduction',
        live: {
          ...KARAOKE_DEFAULTS,
          centerAmount: 1,
          eqBands: KARAOKE_DEFAULTS.eqBands.map((b) => ({ ...b })),
        },
      },
      null,
    );
    await engine.sync();
    expect(proc.getChannelMatrixLevels()).toEqual({
      same: expect.closeTo(0.5),
      cross: expect.closeTo(-0.5),
    });
  });

  it('reports unsupported when AudioContext is missing', async () => {
    const blockedEngine = new KaraokeAudioEngine({
      create: () => {
        throw new Error('no context');
      },
    });
    blockedEngine.bind(audio);
    blockedEngine.applyState(
      { ...defaultKaraokeState(), mode: 'vocal-reduction' },
      null,
    );
    await blockedEngine.sync();
    expect(blockedEngine.getSnapshot().status).toBe('unsupported');
  });

  it('reports blocked when context is suspended', async () => {
    const blockedEngine = new KaraokeAudioEngine({
      create: () =>
        ({
          state: 'suspended',
          currentTime: 0,
          destination: {},
          resume: async () => undefined,
          close: async () => undefined,
        }) as unknown as AudioContext,
    });
    blockedEngine.bind(audio);
    blockedEngine.applyState(
      { ...defaultKaraokeState(), mode: 'vocal-reduction' },
      null,
    );
    await blockedEngine.sync();
    expect(blockedEngine.getSnapshot().status).toBe('blocked');
  });

  it('disposes all nodes', async () => {
    engine.applyState(
      { ...defaultKaraokeState(), mode: 'vocal-reduction' },
      null,
    );
    await engine.sync();
    const countBefore = fakeCtx.nodes.length;
    expect(countBefore).toBeGreaterThan(0);
    engine.dispose();
    expect(engine.getContext()).toBeNull();
  });

  it('falls back from ai mode when stem is not ready', async () => {
    engine.applyState(
      {
        ...defaultKaraokeState(),
        mode: 'ai',
        stem: {
          trackId: 1,
          status: 'pending',
          url: null,
          model: 'htdemucs',
          modelVersion: null,
          processedAt: null,
          error: null,
        },
      },
      {
        id: 1,
        relativePath: 'a.mp3',
        title: 'Test',
        artist: null,
        album: null,
        albumArtist: null,
        trackNo: null,
        durationMs: 1000,
        format: 'mp3',
        lyricStatus: 'missing',
        lyricSource: null,
        rating: null,
        year: null,
        genres: [],
        metadataStatus: 'ready',
        audioVersion: 1234,
        karaokeStemStatus: null,
        coverGroup: null,
        coverVersion: null,
        coverStatus: 'pending' as const,
        musicbrainzArtistId: null,
        tags: [],
        libraryPlacement: 'organized' as const,
      },
    );
    await engine.sync();
    expect(engine.getSnapshot().aiFallback).toBe(true);
    expect(engine.getSnapshot().status).toBe('ai-fallback');
  });

  it('pins centerAmount to 0 when ai stem is ready', async () => {
    engine.applyState(
      {
        ...defaultKaraokeState(),
        mode: 'ai',
        live: {
          ...KARAOKE_DEFAULTS,
          centerAmount: 0.9,
          eqBands: KARAOKE_DEFAULTS.eqBands.map((b) => ({ ...b })),
        },
        stem: {
          trackId: 1,
          status: 'ready',
          url: '/api/tracks/1/karaoke-stem',
          model: 'htdemucs',
          modelVersion: 'htdemucs',
          processedAt: null,
          error: null,
        },
      },
      null,
    );
    await engine.sync();
    expect(engine.getSnapshot().aiFallback).toBe(false);
    const proc = engine.getReductionProcessor();
    expect(proc.getChannelMatrixLevels()).toEqual({
      same: expect.closeTo(1),
      cross: expect.closeTo(0),
    });
  });
});
