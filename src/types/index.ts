import { LanguageCode } from './i18n';

export interface User {
  id: string;
  name: string;
  avatar: string;
  statusText?: string;
  language: LanguageCode;
  phone?: string;
  email?: string;
  isOnline: boolean;
  lastSeen?: string;
}

export type MessageType = 'text' | 'audio' | 'image' | 'file' | 'call_log';

export interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  text: string;
  timestamp: string; // ISO or formatted
  type: MessageType;
  mediaUrl?: string;
  fileName?: string;
  replyTo?: { id: string; text: string; senderName?: string };
  audioDuration?: number; // seconds
  isRead: boolean;
  isDelivered: boolean;
  originalLang?: LanguageCode;
  translatedText?: string;
  callType?: 'audio' | 'video';
  callDuration?: string;
}

export interface CallLog {
  id: string;
  participantId: string;
  type: 'audio' | 'video';
  direction: 'incoming' | 'outgoing' | 'missed';
  timestamp: string;
  duration?: string;
  zegoRoomId: string;
}

export interface ActiveCallState {
  id: string;
  roomId: string;
  participant: User;
  type: 'audio' | 'video';
  status: 'dialing' | 'ringing' | 'connected' | 'ended';
  isMuted: boolean;
  isVideoOff: boolean;
  isSpeakerOn: boolean;
  isScreenSharing: boolean;
  isFrontCamera: boolean;
  durationSeconds: number;
  hasLocalVideo: boolean;
  hasRemoteVideo: boolean;
  signalQuality: 'excellent' | 'good' | 'poor';
}

export interface ZegoConfig {
  appId: string;
  serverSecret: string;
  userName: string;
  isConfigured: boolean;
  useLiveSdkSimulation: boolean;
}

export interface FirebaseConfigState {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  isInitialized: boolean;
}
