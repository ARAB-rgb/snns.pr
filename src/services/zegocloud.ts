import { ZegoConfig } from '../types';

class ZegoCloudService {
  private config: ZegoConfig = {
    appId: import.meta.env.VITE_ZEGO_APP_ID || '1234567890',
    serverSecret: import.meta.env.VITE_ZEGO_APP_SIGN || '',
    userName: 'snns_user',
    isConfigured: true,
    useLiveSdkSimulation: true
  };

  private broadcastChannel: BroadcastChannel | null = null;
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;

  constructor() {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      this.broadcastChannel = new BroadcastChannel('zego_flutter_room_channel');
    }
  }

  getConfig(): ZegoConfig {
    return { ...this.config };
  }

  updateConfig(newConfig: Partial<ZegoConfig>) {
    this.config = { ...this.config, ...newConfig };
    localStorage.setItem('zego_config', JSON.stringify(this.config));
  }

  loadSavedConfig() {
    const saved = localStorage.getItem('zego_config');
    if (saved) {
      try {
        this.config = { ...this.config, ...JSON.parse(saved) };
      } catch (e) {
        console.warn('Failed to load saved Zego config', e);
      }
    }
  }

  generateRoomId(participantId: string): string {
    const cleanId = participantId.replace(/[^a-zA-Z0-9]/g, '');
    return `room_zego_${cleanId}_${Math.floor(1000 + Math.random() * 9000)}`;
  }

  // Request actual camera and microphone stream
  async getLocalUserMedia(video: boolean = true, audio: boolean = true): Promise<MediaStream | null> {
    try {
      if (this.localStream) {
        return this.localStream;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: video ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
        audio: audio ? { echoCancellation: true, noiseSuppression: true } : false
      });
      this.localStream = stream;
      return stream;
    } catch (err) {
      console.warn('Camera/Microphone permission denied or not available:', err);
      return null;
    }
  }

  stopLocalStream() {
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((track) => track.stop());
      this.screenStream = null;
    }
  }

  async getScreenShareStream(): Promise<MediaStream | null> {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });
      this.screenStream = stream;
      return stream;
    } catch (err) {
      console.warn('Screen share canceled:', err);
      return null;
    }
  }

  // Broadcast signaling event across tabs for multi-tab call testing
  sendSignalingEvent(type: 'call_offer' | 'call_accept' | 'call_decline' | 'call_end', roomId: string, payload: unknown) {
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage({ type, roomId, payload, timestamp: Date.now() });
    }
  }

  listenSignalingEvents(callback: (event: { type: string; roomId: string; payload: unknown }) => void) {
    if (!this.broadcastChannel) return () => {};
    const handler = (e: MessageEvent) => {
      if (e.data && e.data.type) {
        callback(e.data);
      }
    };
    this.broadcastChannel.addEventListener('message', handler);
    return () => {
      this.broadcastChannel?.removeEventListener('message', handler);
    };
  }
}

export const zegoService = new ZegoCloudService();
