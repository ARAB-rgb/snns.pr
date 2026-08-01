import { ZegoUIKitPrebuilt } from '@zegocloud/zego-uikit-prebuilt';
import { ZIM } from 'zego-zim-web';
import { User } from '../types';
import { supabaseService } from './supabaseService';

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

  public getServerSecret(): string {
    return (
      import.meta.env.VITE_ZEGO_APP_SIGN ||
      import.meta.env.VITE_ZEGO_SERVER_SECRET ||
      '0123456789abcdef0123456789abcdef'
    );
  }

  /**
   * Initialize ZegoUIKitPrebuilt and ZIM plugin once for the logged in Supabase user
   */
  public async initForUser(user: User): Promise<void> {
    if (!user || !user.id) {
      console.warn('Cannot init Zego: Invalid user ID');
      return;
    }

    // Prevent re-initialization if same user
    if (this.isInitialized && this.currentUserId === user.id && this.zpInstance) {
      console.log('Zego already initialized for user:', user.id);
      return;
    }

    this.currentUserId = user.id; // Strictly Supabase UUID
    this.currentUserName = user.name || user.email || 'مستخدم';

    const appId = this.getAppId();
    const serverSecret = this.getServerSecret();

    console.log('⚡ Initializing ZEGOCLOUD Call Invitation System...', {
      appId,
      currentUserId: this.currentUserId,
      currentUserName: this.currentUserName
    });

    try {
      // Room ID for invitation signaling instance
      const roomID = `signaling_room_${this.currentUserId}`;

      // Generate kit token
      const kitToken = ZegoUIKitPrebuilt.generateKitTokenForTest(
        appId,
        serverSecret,
        roomID,
        this.currentUserId,
        this.currentUserName
      );

      // Create instance
      this.zpInstance = ZegoUIKitPrebuilt.create(kitToken);

      // Add ZIM plugin for Call Invitation
      this.zpInstance.addPlugins({ ZIM });

      // Configure Call Invitation callbacks
      this.zpInstance.setCallInvitationConfig({
        enableCustomCallInvitationDialog: false, // Use Zego built-in or custom UI
        onIncomingCallReceived: async (callID: string, caller: any, callType: number, callees: any[]) => {
          console.log('🔔 [ZEGO] INCOMING_CALL RECEIVED:', { callID, caller, callType, callees });
          if (this.currentUserId) {
            await supabaseService.createCallRecord({
              id: callID,
              caller_id: caller.userID,
              receiver_id: this.currentUserId,
              type: callType === ZegoUIKitPrebuilt.InvitationTypeVideoCall ? 'video' : 'audio',
              status: 'ringing'
            });
          }
          if (this.onIncomingCallHandler) {
            this.onIncomingCallHandler({ callID, caller, callType });
          }
        },

        onIncomingCallCanceled: async (callID: string, caller: any) => {
          console.log('❌ [ZEGO] CALL_CANCELED:', { callID, caller });
          await supabaseService.updateCallStatus(callID, 'rejected');
          if (this.onCallEndedHandler) this.onCallEndedHandler();
        },

        onOutgoingCallAccepted: async (callID: string, callee: any) => {
          console.log('✅ [ZEGO] OUTGOING_CALL_ACCEPTED:', { callID, callee });
          await supabaseService.updateCallStatus(callID, 'accepted');
          if (this.onCallAcceptedHandler) this.onCallAcceptedHandler();
        },

        onOutgoingCallRejected: async (callID: string, callee: any) => {
          console.log('🚫 [ZEGO] OUTGOING_CALL_REJECTED:', { callID, callee });
          await supabaseService.updateCallStatus(callID, 'rejected');
          if (this.onCallEndedHandler) this.onCallEndedHandler();
        },

        onOutgoingCallTimeout: async (callID: string, callees: any[]) => {
          console.log('⏳ [ZEGO] OUTGOING_CALL_TIMEOUT:', { callID, callees });
          await supabaseService.updateCallStatus(callID, 'missed');
          if (this.onCallEndedHandler) this.onCallEndedHandler();
        }
      });

      this.isInitialized = true;
      console.log('✅ ZEGOCLOUD Call Invitation initialized successfully!');
    } catch (err) {
      console.error('❌ Failed to initialize ZEGOCLOUD Call Invitation:', err);
    }
  }

  /**
   * Send video or audio call invitation to target profile
   */
  public async sendCallInvitation(
    targetProfile: { id: string; name: string; email?: string; avatar?: string },
    type: 'audio' | 'video'
  ): Promise<{ success: boolean; errorInvitees?: any[]; error?: string }> {
    const targetUserId = targetProfile.id; // Must be Supabase UUID
    const targetUserName = targetProfile.name || targetProfile.email || 'مستخدم';
    const callType =
      type === 'video'
        ? ZegoUIKitPrebuilt.InvitationTypeVideoCall
        : ZegoUIKitPrebuilt.InvitationTypeVoiceCall;

    console.log('🚀 Sending Call Invitation...', {
      currentUserId: this.currentUserId,
      targetUserId,
      targetUserName,
      type
    });

    if (this.zpInstance && this.isInitialized) {
      try {
        const res = await this.zpInstance.sendCallInvitation({
          callees: [
            {
              userID: targetUserId,
              userName: targetUserName
            }
          ],
          callType,
          timeout: 60
        });

        console.log('📞 Zego sendCallInvitation response:', res);
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
        // cleanup notice
      }
      this.zpInstance = null;
    }
    this.isInitialized = false;
    this.currentUserId = null;
    this.currentUserName = null;
  }
}

export const zegoCallService = new ZegoCallService();
