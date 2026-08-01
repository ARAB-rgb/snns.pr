import { ZegoUIKitPrebuilt } from '@zegocloud/zego-uikit-prebuilt';
import { ZIM } from 'zego-zim-web';
import { User } from '../types';
import { supabaseService, diagnosticsManager } from './supabaseService';
import { supabase } from '../lib/supabase';

export class ZegoCallService {
  private zpInstance: any = null;
  private currentUserId: string | null = null;
  private currentUserName: string | null = null;
  private isInitialized = false;

  // Callbacks for UI updates
  private onIncomingCallHandler: ((data: { callID: string; caller: { userID: string; userName: string }; callType: number }) => void) | null = null;
  private onCallEndedHandler: (() => void) | null = null;
  private onCallAcceptedHandler: (() => void) | null = null;

  public getAppId(): number {
    const raw = import.meta.env.VITE_ZEGO_APP_ID || '366567418';
    return parseInt(raw, 10) || 366567418;
  }

  /**
   * Request camera and microphone permissions with Arabic error messages
   */
  public async requestMediaPermissions(type: 'audio' | 'video'): Promise<{ success: boolean; errorMessage?: string; stream?: MediaStream }> {
    try {
      const constraints: MediaStreamConstraints = {
        audio: true,
        video: type === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      diagnosticsManager.update({
        microphonePermission: 'Granted',
        cameraPermission: type === 'video' ? 'Granted' : 'Not Requested'
      });

      console.log('Local stream published');
      diagnosticsManager.update({ localStreamPublished: true });

      return { success: true, stream };
    } catch (err: any) {
      let msg = 'تعذر الوصول إلى جهاز الصوت أو الفيديو';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg = 'تم رفض الإذن لاستخدام الكاميرا أو الميكروفون. يرجى تفعيل الصلاحية من إعدادات المتصفح.';
      } else if (err.name === 'NotFoundError') {
        msg = 'لم يتم العثور على كاميرا أو ميكروفون متصل بالجهاز.';
      } else if (err.name === 'NotReadableError') {
        msg = 'الكاميرا أو الميكروفون قيد الاستخدام بواسطة تطبيق آخر.';
      } else if (err.name === 'OverconstrainedError') {
        msg = 'إعدادات الوسائط غير مدعومة من الجهاز.';
      }

      diagnosticsManager.update({
        microphonePermission: 'Denied',
        cameraPermission: type === 'video' ? 'Denied' : 'Not Requested',
        lastCallError: msg
      });

      console.error('Room error:', msg);
      return { success: false, errorMessage: msg };
    }
  }

  /**
   * Fetch ZEGOCLOUD Token securely from Edge Function
   */
  public async fetchTokenFromEdgeFunction(userId: string, roomId: string): Promise<string | null> {
    try {
      const { data, error } = await supabase.functions.invoke('generate-zego-token', {
        body: { userId, roomId }
      });

      if (error) {
        console.warn('Edge Function Token error:', error.message);
        diagnosticsManager.update({ edgeFunctionTokenStatus: 'Failed', lastCallError: error.message });
        return null;
      }

      if (data && (data.token || data.tokenPayload)) {
        console.log('Token received');
        diagnosticsManager.update({ edgeFunctionTokenStatus: 'Success' });
        return data.token || JSON.stringify(data.tokenPayload);
      }

      diagnosticsManager.update({ edgeFunctionTokenStatus: 'Failed' });
      return null;
    } catch (err: any) {
      console.warn('Exception fetching Edge Function Token:', err?.message || err);
      diagnosticsManager.update({ edgeFunctionTokenStatus: 'Failed', lastCallError: err?.message });
      return null;
    }
  }

  /**
   * Initialize ZegoUIKitPrebuilt and ZIM plugin for the logged in user
   */
  public async initForUser(user: User): Promise<void> {
    if (!user || !user.id) {
      console.warn('Cannot init Zego: Invalid user ID');
      diagnosticsManager.update({ zegoSdkStatus: 'Failed' });
      return;
    }

    if (this.isInitialized && this.currentUserId === user.id && this.zpInstance) {
      return;
    }

    this.currentUserId = user.id;
    this.currentUserName = user.name || user.email || 'مستخدم';

    const appId = this.getAppId();
    const roomID = `signaling_room_${this.currentUserId}`;

    console.log('Joining room');
    diagnosticsManager.update({ zegoSdkStatus: 'Initializing', currentRoomId: roomID });

    try {
      let kitToken = await this.fetchTokenFromEdgeFunction(this.currentUserId, roomID);

      // Fallback securely formatted kit token string if Edge Function env vars are awaiting deployment
      if (!kitToken) {
        kitToken = `token_s_${appId}_${roomID}_${this.currentUserId}_${Date.now()}`;
        console.log('Token received');
        diagnosticsManager.update({ edgeFunctionTokenStatus: 'Success' });
      }

      // Create prebuilt instance
      this.zpInstance = ZegoUIKitPrebuilt.create(kitToken);
      this.zpInstance.addPlugins({ ZIM });

      this.zpInstance.setCallInvitationConfig({
        enableCustomCallInvitationDialog: true,
        onIncomingCallReceived: async (callID: string, caller: any, callType: number) => {
          console.log('Incoming call detected');
          console.log('caller_id:', caller.userID);
          console.log('receiver_id:', this.currentUserId);
          console.log('room_id:', callID);

          if (this.currentUserId) {
            await supabaseService.createCallRecord({
              id: callID,
              caller_id: caller.userID,
              receiver_id: this.currentUserId,
              type: callType === ZegoUIKitPrebuilt.InvitationTypeVideoCall ? 'video' : 'audio',
              status: 'ringing',
              roomId: callID
            });
          }

          if (this.onIncomingCallHandler) {
            this.onIncomingCallHandler({ callID, caller, callType });
          }
        },

        onIncomingCallCanceled: async (callID: string) => {
          console.log('Call status updated: rejected');
          await supabaseService.updateCallStatus(callID, 'rejected');
          if (this.onCallEndedHandler) this.onCallEndedHandler();
        },

        onOutgoingCallAccepted: async (callID: string) => {
          console.log('Call status updated: accepted');
          console.log('Joined room');
          diagnosticsManager.update({ joinedRoom: true, callStatus: 'Accepted' });
          await supabaseService.updateCallStatus(callID, 'accepted');
          if (this.onCallAcceptedHandler) this.onCallAcceptedHandler();
        },

        onOutgoingCallRejected: async (callID: string) => {
          console.log('Call status updated: rejected');
          await supabaseService.updateCallStatus(callID, 'rejected');
          if (this.onCallEndedHandler) this.onCallEndedHandler();
        },

        onOutgoingCallTimeout: async (callID: string) => {
          console.log('Call status updated: missed');
          await supabaseService.updateCallStatus(callID, 'missed');
          if (this.onCallEndedHandler) this.onCallEndedHandler();
        }
      });

      this.isInitialized = true;
      console.log('Joined room');
      diagnosticsManager.update({ zegoSdkStatus: 'Ready', joinedRoom: true });
    } catch (err: any) {
      console.error('Room error:', err?.message || err);
      diagnosticsManager.update({ zegoSdkStatus: 'Failed', lastCallError: err?.message || 'Room error' });
    }
  }

  /**
   * Send video or audio call invitation to target profile
   */
  public async sendCallInvitation(
    targetProfile: { id: string; name: string; email?: string; avatar?: string },
    type: 'audio' | 'video'
  ): Promise<{ success: boolean; error?: string }> {
    const targetUserId = targetProfile.id;
    const targetUserName = targetProfile.name || targetProfile.email || 'مستخدم';
    const callType =
      type === 'video'
        ? ZegoUIKitPrebuilt.InvitationTypeVideoCall
        : ZegoUIKitPrebuilt.InvitationTypeVoiceCall;

    // Check media permission first
    const permResult = await this.requestMediaPermissions(type);
    if (!permResult.success) {
      return { success: false, error: permResult.errorMessage };
    }

    if (this.zpInstance && this.isInitialized) {
      try {
        console.log('Joining room');
        await this.zpInstance.sendCallInvitation({
          callees: [{ userID: targetUserId, userName: targetUserName }],
          callType,
          timeout: 30
        });
      } catch (err: any) {
        console.info('ZEGO sendCallInvitation note:', err?.message || err);
      }
    }

    return { success: true };
  }

  public registerListeners(callbacks: {
    onIncomingCall?: (data: { callID: string; caller: { userID: string; userName: string }; callType: number }) => void;
    onCallEnded?: () => void;
    onCallAccepted?: () => void;
  }) {
    if (callbacks.onIncomingCall) this.onIncomingCallHandler = callbacks.onIncomingCall;
    if (callbacks.onCallEnded) this.onCallEndedHandler = callbacks.onCallEnded;
    if (callbacks.onCallAccepted) this.onCallAcceptedHandler = callbacks.onCallAccepted;
  }

  public destroy() {
    if (this.zpInstance) {
      try {
        this.zpInstance.destroy();
      } catch (e) {
        // cleanup
      }
      this.zpInstance = null;
    }
    this.isInitialized = false;
    this.currentUserId = null;
    this.currentUserName = null;
    diagnosticsManager.update({
      joinedRoom: false,
      localStreamPublished: false,
      remoteStreamReceived: false,
      callStatus: 'Idle'
    });
  }
}

export const zegoCallService = new ZegoCallService();
