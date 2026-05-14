import { LAppDelegate } from '@/lib/live2d/src/lappdelegate';
import { ResourceModel } from '@/lib/protocol';
import { SENTIO_ASR_PLAYBACK_COOLDOWN_MS } from '@/lib/constants';

export class Live2dManager {
  public static getInstance(): Live2dManager {
    if (!this._instance) {
      this._instance = new Live2dManager();
    }

    return this._instance;
  }

  public setReady(ready: boolean) {
    this._ready = ready;
  }

  public isReady(): boolean {
    return this._ready;
  }

  public changeCharacter(character: ResourceModel | null) {
    this._ready = false;
    LAppDelegate.getInstance().changeCharacter(character);
  }

  public setLipFactor(weight: number): void {
    this._lipFactor = weight;
  }

  public getLipFactor(): number {
    return this._lipFactor;
  }

  public setCurrentLipSyncValue(value: number): void {
    this._currentLipSyncValue = Math.max(0, Math.min(1, value));
  }

  public getCurrentLipSyncValue(): number {
    return this._currentLipSyncValue;
  }

  public pushAudioQueue(audioData: ArrayBuffer): void {
    this._ttsQueue.push(audioData);
    this.clearPlaybackCooldownTimer();
    this._playbackBlockUntil = 0;
    this.emitTtsState();
  }

  public playAudioNow(audioData: ArrayBuffer): ArrayBuffer | null {
    this.stopAudio();
    this.pushAudioQueue(audioData);
    return this.playAudio();
  }

  public popAudioQueue(): ArrayBuffer | null {
    if (this._ttsQueue.length > 0) {
      const audioData = this._ttsQueue.shift();
      return audioData ?? null;
    }
    return null;
  }

  public clearAudioQueue(): void {
    this._ttsQueue = [];
  }

  public isAudioPlaying(): boolean {
    return this._audioIsPlaying;
  }

  public async resumeAudioContext(): Promise<boolean> {
    if (this._audioContext.state === 'running') {
      return true;
    }

    try {
      await Promise.race([
        this._audioContext.resume(),
        new Promise<void>((resolve) => window.setTimeout(resolve, 600)),
      ]);
      return (this._audioContext.state as AudioContextState) === 'running';
    } catch (error) {
      console.warn('[Live2D] Failed to resume audio context:', error);
      return false;
    }
  }

  public hasPendingAudio(): boolean {
    return this._audioIsPlaying || this._ttsQueue.length > 0;
  }

  public isPlaybackBlocked(): boolean {
    return this._audioIsPlaying || this._ttsQueue.length > 0 || Date.now() < this._playbackBlockUntil;
  }

  public playAudio(): ArrayBuffer | null {
    if (this._audioIsPlaying) {
      return null;
    }

    if (this._audioContext.state === 'suspended') {
      void this._audioContext.resume().catch((error) => {
        console.warn('[Live2D] Failed to resume audio context:', error);
      });
    }

    const audioData = this.popAudioQueue();
    if (audioData == null) {
      return null;
    }

    this._audioIsPlaying = true;
    this.clearPlaybackCooldownTimer();
    this._playbackBlockUntil = 0;
    this.emitTtsState();
    this.startTalkingMotion();

    const playAudioBuffer = (buffer: AudioBuffer) => {
      console.log('[Live2D] Playing audio buffer, creating analyser...');
      const source = this._audioContext.createBufferSource();
      source.buffer = buffer;

      const analyser = this._audioContext.createAnalyser();
      analyser.fftSize = 256;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength) as Uint8Array<ArrayBuffer>;
      console.log(`[Live2D] Analyser created - FFT size: ${analyser.fftSize}, Buffer length: ${bufferLength}`);

      source.connect(analyser);
      analyser.connect(this._audioContext.destination);
      console.log('[Live2D] Audio nodes connected: source -> analyser -> destination');

      this.stopLipSyncAnalysis();
      this.startLipSyncAnalysis(analyser, dataArray);

      source.onended = () => {
        console.log('[Live2D] Audio ended, stopping lip sync');
        this._audioIsPlaying = false;
        this.stopLipSyncAnalysis();
        this.stopTalkingMotion();
        this.schedulePlaybackUnblock();

        console.log('[Live2D] Checking for next audio in queue...');
        window.setTimeout(() => {
          const nextAudio = this.playAudio();
          if (nextAudio) {
            console.log('[Live2D] Playing next audio from queue');
          } else {
            console.log('[Live2D] No more audio in queue');
          }
        }, 50);
      };

      source.start();
      console.log('[Live2D] Audio source started');
      this._audioSource = source;
      window.setTimeout(() => {
        if (this._audioSource === source && this._audioIsPlaying && this._audioContext.state !== 'running') {
          console.warn('[Live2D] Audio context is still suspended; releasing blocked playback state.');
          this._audioSource = null;
          this._audioIsPlaying = false;
          this.stopLipSyncAnalysis();
          this.stopTalkingMotion();
          this.schedulePlaybackUnblock();
        }
      }, 1200);
    };

    const newAudioData = audioData.slice(0);
    this._audioContext.decodeAudioData(newAudioData).then(
      (buffer) => {
        playAudioBuffer(buffer);
      }
    ).catch((error) => {
      console.error('[Live2D] decodeAudioData failed:', error);
      this._audioIsPlaying = false;
      this.stopLipSyncAnalysis();
      this.stopTalkingMotion();
      const nextAudio = this.playAudio();
      if (!nextAudio) {
        this.schedulePlaybackUnblock();
      }
    });

    return audioData;
  }

  public stopAudio(): void {
    this.clearPlaybackCooldownTimer();
    this.clearAudioQueue();

    if (this._audioSource) {
      this._audioSource.onended = null;
      this._audioSource.stop();
      this._audioSource = null;
    }

    this._audioIsPlaying = false;
    this._playbackBlockUntil = 0;
    this.stopLipSyncAnalysis();
    this.stopTalkingMotion();
    this.emitTtsState();
  }

  public triggerEmotionMotion(emotion: string): void {
    const delegate = LAppDelegate.getInstance();
    const subdelegates = delegate.getSubdelegate();

    if (!subdelegates || subdelegates.getSize() === 0) {
      return;
    }

    const live2dManager = subdelegates.at(0).getLive2DManager();
    const model = live2dManager.getCurrentModel();
    if (!model) {
      return;
    }

    const modelSetting = (model as any)._modelSetting;
    if (!modelSetting) {
      return;
    }

    console.log(`[Live2D] Triggering emotion motion: ${emotion}`);

    let motionGroups: string[] = [];
    let shouldJump = false;

    switch (emotion.toLowerCase()) {
      case 'happy':
      case 'joy':
      case 'excited':
        motionGroups = ['jump', 'Jump', 'happy', 'Happy', 'cheer', 'Cheer', 'celebrate', 'Celebrate'];
        shouldJump = true;
        break;
      case 'sad':
        motionGroups = ['sad', 'Sad', 'cry', 'Cry'];
        break;
      case 'angry':
        motionGroups = ['angry', 'Angry', 'shake', 'Shake'];
        break;
      case 'surprised':
        motionGroups = ['surprised', 'Surprised', 'shock', 'Shock'];
        break;
      default:
        motionGroups = [];
    }

    for (const group of motionGroups) {
      const motionCount = modelSetting.getMotionCount(group);
      if (motionCount && motionCount > 0) {
        const motionNo = Math.floor(Math.random() * motionCount);
        model.startMotion(group, motionNo, 3);
        console.log(`[Live2D] Playing emotion motion: ${group}_${motionNo}`);

        if (shouldJump) {
          this.playJumpAnimation(model);
        }
        return;
      }
    }

    const fallbackGroups = ['TapBody', 'tap_body', 'Pinch', 'pinch', 'Shake', 'shake'];
    for (const group of fallbackGroups) {
      const motionCount = modelSetting.getMotionCount(group);
      if (motionCount && motionCount > 0) {
        const motionNo = Math.floor(Math.random() * motionCount);
        model.startMotion(group, motionNo, 3);
        console.log(`[Live2D] Using fallback motion for emotion: ${group}_${motionNo}`);

        if (shouldJump) {
          this.playJumpAnimation(model);
        }
        return;
      }
    }

    console.log(`[Live2D] No suitable motion found for emotion: ${emotion}`);
  }

  private playJumpAnimation(model: any): void {
    const modelMatrix = (model as any)._modelMatrix;
    if (!modelMatrix) {
      return;
    }

    console.log('[Live2D] Playing jump animation with Y-axis translation');

    const originalY = modelMatrix.getTranslateY();
    const jumpHeight = 0.3;
    const jumpDuration = 600;
    const startTime = Date.now();

    const animateJump = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / jumpDuration, 1.0);

      if (progress < 1.0) {
        const t = progress;
        const currentY = originalY + jumpHeight * (-4 * Math.pow(t - 0.5, 2) + 1);
        modelMatrix.translateY(currentY);
        requestAnimationFrame(animateJump);
      } else {
        modelMatrix.translateY(originalY);
        console.log('[Live2D] Jump animation completed');
      }
    };

    animateJump();
  }

  private startTalkingMotion(): void {
    const delegate = LAppDelegate.getInstance();
    const subdelegates = delegate.getSubdelegate();

    if (!subdelegates || subdelegates.getSize() === 0) {
      return;
    }

    const live2dManager = subdelegates.at(0).getLive2DManager();
    const model = live2dManager.getCurrentModel();
    if (!model) {
      return;
    }

    const modelSetting = (model as any)._modelSetting;
    if (!modelSetting) {
      return;
    }

    const talkGroups = ['talk', 'speak', 'speaking', 'Talk', 'Speak'];

    for (const group of talkGroups) {
      const motionCount = modelSetting.getMotionCount(group);
      if (motionCount && motionCount > 0) {
        const motionNo = Math.floor(Math.random() * motionCount);
        model.startMotion(group, motionNo, 2);
        console.log(`[Live2D] Started talking motion: ${group}_${motionNo}`);
        return;
      }
    }

    const fallbackGroups = ['TapBody', 'tap_body', 'Pinch', 'pinch', 'Shake', 'shake'];
    for (const group of fallbackGroups) {
      const motionCount = modelSetting.getMotionCount(group);
      if (motionCount && motionCount > 0) {
        const motionNo = Math.floor(Math.random() * motionCount);
        model.startMotion(group, motionNo, 2);
        console.log(`[Live2D] Using fallback motion for talking: ${group}_${motionNo}`);
        return;
      }
    }

    try {
      const motionGroupCount = modelSetting.getMotionGroupCount();
      if (motionGroupCount > 0) {
        const availableGroups: string[] = [];
        for (let i = 0; i < motionGroupCount; i++) {
          const groupName = modelSetting.getMotionGroupName(i);
          if (groupName.toLowerCase() !== 'idle') {
            availableGroups.push(groupName);
          }
        }

        if (availableGroups.length > 0) {
          const randomGroup = availableGroups[Math.floor(Math.random() * availableGroups.length)];
          const motionCount = modelSetting.getMotionCount(randomGroup);
          if (motionCount > 0) {
            const motionNo = Math.floor(Math.random() * motionCount);
            model.startMotion(randomGroup, motionNo, 2);
            console.log(`[Live2D] Using random motion for talking: ${randomGroup}_${motionNo}`);
            return;
          }
        }
      }
    } catch (e) {
      console.error('[Live2D] Error trying to get motion groups:', e);
    }

    console.log('[Live2D] No suitable motion found for talking');
  }

  private stopTalkingMotion(): void {
    console.log('[Live2D] Talking motion finished, returning to idle');
  }

  private startLipSyncAnalysis(analyser: AnalyserNode, dataArray: Uint8Array<ArrayBuffer>): void {
    console.log('[Live2D] Starting lip sync analysis...');
    let frameCount = 0;

    const updateLipSync = () => {
      analyser.getByteTimeDomainData(dataArray);

      let sumSquares = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const centered = (dataArray[i] - 128) / 128;
        sumSquares += centered * centered;
      }

      const rms = Math.sqrt(sumSquares / dataArray.length);
      const targetVolume = Math.max(0, Math.min(1, rms * this.getLipFactor() * 6));
      const smoothedVolume = this.getCurrentLipSyncValue() * 0.35 + targetVolume * 0.65;
      const normalizedVolume = smoothedVolume < 0.02 ? 0 : smoothedVolume;
      this.setCurrentLipSyncValue(normalizedVolume);

      if (frameCount % 30 === 0) {
        console.log(`[Live2D] Lip sync - RMS: ${rms.toFixed(3)}, Target: ${targetVolume.toFixed(3)}, Value: ${normalizedVolume.toFixed(3)}`);
      }
      frameCount++;

      this._lipSyncAnimationId = requestAnimationFrame(updateLipSync);
    };

    this._lipSyncAnimationId = null;
    updateLipSync();
  }

  private stopLipSyncAnalysis(): void {
    if (this._lipSyncAnimationId !== null) {
      cancelAnimationFrame(this._lipSyncAnimationId);
      this._lipSyncAnimationId = null;
    }
    this.setCurrentLipSyncValue(0);

    const delegate = LAppDelegate.getInstance();
    const subdelegates = delegate.getSubdelegate();

    if (subdelegates && subdelegates.getSize() > 0) {
      const live2dManager = subdelegates.at(0).getLive2DManager();
      const model = live2dManager.getCurrentModel();
      if (model && (model as any)._model) {
        const lipSyncIds = (model as any)._lipSyncIds;
        const cubismModel = (model as any)._model;
        if (lipSyncIds && lipSyncIds.getSize() > 0) {
          for (let i = 0; i < lipSyncIds.getSize(); i++) {
            const paramId = lipSyncIds.at(i);
            const paramIndex = cubismModel.getParameterIndex(paramId);
            if (paramIndex >= 0) {
              cubismModel.setParameterValueByIndex(paramIndex, 0);
            }
          }
        }
      }
    }
  }

  private emitTtsState(): void {
    if (typeof document === 'undefined') {
      return;
    }

    document.dispatchEvent(new CustomEvent('sentio:tts-state', {
      detail: {
        playing: this._audioIsPlaying,
        blocked: this.isPlaybackBlocked(),
      }
    }));
  }

  private clearPlaybackCooldownTimer(): void {
    if (this._playbackCooldownTimer !== null) {
      window.clearTimeout(this._playbackCooldownTimer);
      this._playbackCooldownTimer = null;
    }
  }

  private schedulePlaybackUnblock(): void {
    this.clearPlaybackCooldownTimer();

    if (this._audioIsPlaying || this._ttsQueue.length > 0) {
      this.emitTtsState();
      return;
    }

    if (SENTIO_ASR_PLAYBACK_COOLDOWN_MS <= 0) {
      this._playbackBlockUntil = 0;
      this.emitTtsState();
      return;
    }

    this._playbackBlockUntil = Date.now() + SENTIO_ASR_PLAYBACK_COOLDOWN_MS;
    this.emitTtsState();
    this._playbackCooldownTimer = window.setTimeout(() => {
      this._playbackCooldownTimer = null;
      if (!this._audioIsPlaying && this._ttsQueue.length === 0) {
        this._playbackBlockUntil = 0;
        this.emitTtsState();
      }
    }, SENTIO_ASR_PLAYBACK_COOLDOWN_MS);
  }

  constructor() {
    this._audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    this._audioIsPlaying = false;
    this._audioSource = null;
    this._lipFactor = 1.0;
    this._currentLipSyncValue = 0;
    this._ready = false;
    this._lipSyncAnimationId = null;
    this._playbackBlockUntil = 0;
    this._playbackCooldownTimer = null;
  }

  private static _instance: Live2dManager;
  private _ttsQueue: ArrayBuffer[] = [];
  private _audioContext: AudioContext;
  private _audioIsPlaying: boolean;
  private _audioSource: AudioBufferSourceNode | null;
  private _lipFactor: number;
  private _currentLipSyncValue: number;
  private _ready: boolean;
  private _lipSyncAnimationId: number | null;
  private _playbackBlockUntil: number;
  private _playbackCooldownTimer: number | null;
}
