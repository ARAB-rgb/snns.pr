import { ZegoUIKitPrebuilt } from '@zegocloud/zego-uikit-prebuilt';
import { ZIM } from 'zego-zim-web';

import type { User } from '../types';
import { supabase } from '../lib/supabase';
import {
  diagnosticsManager,
  supabaseService,
} from './supabaseService';

type CallType = 'audio' | 'video';

type TargetProfile = {
  id: string;
  name?: string;
  email?: string;
  avatar?: string;
};

type IncomingCallData = {
  callID: string;
  caller: {
    userID: string;
    userName: string;
  };
  callType: number;
};

type CallListeners = {
  onIncomingCall?: (data: IncomingCallData) => void;
  onCallEnded?: () => void;
  onCallAccepted?: () => void;
};

type InvitationResult = {
  errorInvitees?: Array<{
    userID: string;
    userName?: string;
  }>;
};

export class ZegoCallService {
  private zpInstance: any = null;

  private currentUserId: string | null = null;

  private currentUserName: string | null = null;

  private isInitialized = false;

  private initializationPromise: Promise<void> | null = null;

  private onIncomingCallHandler:
    | ((data: IncomingCallData) => void)
    | null = null;

  private onCallEndedHandler: (() => void) | null = null;

  private onCallAcceptedHandler: (() => void) | null = null;

  /**
   * قراءة App ID الخاص بـ ZEGOCLOUD من متغيرات Vite.
   */
  public getAppId(): number {
    const rawValue = import.meta.env.VITE_ZEGO_APP_ID;

    if (!rawValue) {
      throw new Error(
        'متغير VITE_ZEGO_APP_ID غير موجود في إعدادات البيئة.',
      );
    }

    const appId = Number(rawValue);

    if (!Number.isInteger(appId) || appId <= 0) {
      throw new Error(
        'قيمة VITE_ZEGO_APP_ID غير صحيحة.',
      );
    }

    return appId;
  }

  /**
   * طلب صلاحية الكاميرا والميكروفون قبل إرسال المكالمة.
   * يتم إيقاف Stream التجريبي مباشرة بعد التحقق حتى لا تبقى
   * الكاميرا أو الميكروفون محجوزين.
   */
  public async requestMediaPermissions(
    type: CallType,
  ): Promise<{
    success: boolean;
    errorMessage?: string;
  }> {
    if (!navigator.mediaDevices?.getUserMedia) {
      const message =
        'المتصفح لا يدعم الوصول إلى الكاميرا والميكروفون.';

      diagnosticsManager.update({
        microphonePermission: 'Denied',
        cameraPermission:
          type === 'video' ? 'Denied' : 'Not Requested',
        lastCallError: message,
      });

      return {
        success: false,
        errorMessage: message,
      };
    }

    let stream: MediaStream | null = null;

    try {
      const constraints: MediaStreamConstraints = {
        audio: true,
        video:
          type === 'video'
            ? {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'user',
              }
            : false,
      };

      stream =
        await navigator.mediaDevices.getUserMedia(
          constraints,
        );

      diagnosticsManager.update({
        microphonePermission: 'Granted',
        cameraPermission:
          type === 'video'
            ? 'Granted'
            : 'Not Requested',
      });

      return { success: true };
    } catch (error: unknown) {
      const mediaError =
        error instanceof DOMException
          ? error
          : null;

      let message =
        'تعذر الوصول إلى الكاميرا أو الميكروفون.';

      switch (mediaError?.name) {
        case 'NotAllowedError':
        case 'PermissionDeniedError':
          message =
            'تم رفض استخدام الكاميرا أو الميكروفون. فعّل الصلاحية من إعدادات المتصفح.';
          break;

        case 'NotFoundError':
        case 'DevicesNotFoundError':
          message =
            'لم يتم العثور على كاميرا أو ميكروفون متصل بالجهاز.';
          break;

        case 'NotReadableError':
        case 'TrackStartError':
          message =
            'الكاميرا أو الميكروفون مستخدم حاليًا بواسطة تطبيق آخر.';
          break;

        case 'OverconstrainedError':
        case 'ConstraintNotSatisfiedError':
          message =
            'إعدادات الكاميرا المطلوبة غير مدعومة على هذا الجهاز.';
          break;

        case 'SecurityError':
          message =
            'يجب فتح الموقع من خلال HTTPS للسماح باستخدام الكاميرا والميكروفون.';
          break;

        default:
          break;
      }

      console.error(
        'ZEGO_MEDIA_PERMISSION_ERROR:',
        error,
      );

      diagnosticsManager.update({
        microphonePermission: 'Denied',
        cameraPermission:
          type === 'video'
            ? 'Denied'
            : 'Not Requested',
        lastCallError: message,
      });

      return {
        success: false,
        errorMessage: message,
      };
    } finally {
      stream
        ?.getTracks()
        .forEach((track) => track.stop());
    }
  }

  /**
   * الحصول على Token04 حقيقي من Supabase Edge Function.
   *
   * لا يوجد Token تجريبي أو بديل وهمي هنا.
   */
  public async fetchTokenFromEdgeFunction(
    roomId: string,
  ): Promise<string> {
    const normalizedRoomId = roomId.trim();

    if (!normalizedRoomId) {
      throw new Error(
        'معرف غرفة ZEGOCLOUD غير صالح.',
      );
    }

    const {
      data: sessionData,
      error: sessionError,
    } = await supabase.auth.getSession();

    if (
      sessionError ||
      !sessionData.session?.user
    ) {
      throw new Error(
        'انتهت جلسة المستخدم. سجل الدخول مجددًا.',
      );
    }

    try {
      const { data, error } =
        await supabase.functions.invoke(
          'generate-zego-token',
          {
            body: {
              roomId: normalizedRoomId,
            },
          },
        );

      if (error) {
        console.error(
          'ZEGO_EDGE_FUNCTION_ERROR:',
          error,
        );

        diagnosticsManager.update({
          edgeFunctionTokenStatus: 'Failed',
          lastCallError: error.message,
        });

        throw new Error(
          `فشل إصدار ZEGOCLOUD Token: ${error.message}`,
        );
      }

      const token =
        typeof data?.token === 'string'
          ? data.token.trim()
          : '';

      if (!token || !token.startsWith('04')) {
        console.error(
          'ZEGO_INVALID_TOKEN_RESPONSE:',
          data,
        );

        diagnosticsManager.update({
          edgeFunctionTokenStatus: 'Failed',
          lastCallError:
            'Edge Function لم تُرجع Token04 صالحًا.',
        });

        throw new Error(
          'لم يتم إصدار ZEGOCLOUD Token صالح.',
        );
      }

      console.log(
        'ZEGO_TOKEN_RECEIVED:',
        {
          appId: data?.appId,
          userId: data?.userId,
          roomId: data?.roomId,
          expiresAt: data?.expiresAt,
        },
      );

      diagnosticsManager.update({
        edgeFunctionTokenStatus: 'Success',
        lastCallError: undefined,
      });

      return token;
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'فشل الاتصال بخدمة إصدار Token.';

      diagnosticsManager.update({
        edgeFunctionTokenStatus: 'Failed',
        lastCallError: message,
      });

      throw error;
    }
  }

  /**
   * تهيئة ZEGOCLOUD وZIM مرة واحدة للمستخدم المسجل.
   */
  public async initForUser(
    user: User,
  ): Promise<void> {
    const userId = String(user?.id ?? '').trim();

    if (!userId) {
      const message =
        'لا يمكن تشغيل المكالمات بدون معرف مستخدم صحيح.';

      diagnosticsManager.update({
        zegoSdkStatus: 'Failed',
        lastCallError: message,
      });

      throw new Error(message);
    }

    if (
      this.isInitialized &&
      this.currentUserId === userId &&
      this.zpInstance
    ) {
      return;
    }

    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise =
      this.initializeInternal(user);

    try {
      await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }

  private async initializeInternal(
    user: User,
  ): Promise<void> {
    const userId = String(user.id).trim();

    const userName = String(
      user.name ||
        user.email ||
        'مستخدم',
    ).trim();

    this.destroy();

    this.currentUserId = userId;
    this.currentUserName = userName;

    const appId = this.getAppId();

    // غرفة التهيئة الخاصة بإشارات هذا المستخدم.
    const signalingRoomId =
      `signaling_${userId}`;

    diagnosticsManager.update({
      zegoSdkStatus: 'Initializing',
      currentRoomId: signalingRoomId,
      joinedRoom: false,
      lastCallError: undefined,
    });

    console.log('ZEGO_INITIALIZING:', {
      appId,
      userId,
      userName,
      signalingRoomId,
    });

    try {
      const token =
        await this.fetchTokenFromEdgeFunction(
          signalingRoomId,
        );

      const kitToken =
        ZegoUIKitPrebuilt.generateKitTokenForProduction(
          appId,
          token,
          signalingRoomId,
          userId,
          userName,
        );

      this.zpInstance =
        ZegoUIKitPrebuilt.create(kitToken);

      this.zpInstance.addPlugins({ ZIM });

      this.configureCallInvitation();

      this.isInitialized = true;

      diagnosticsManager.update({
        zegoSdkStatus: 'Ready',
        joinedRoom: true,
        currentRoomId: signalingRoomId,
        callStatus: 'Idle',
        lastCallError: undefined,
      });

      console.log('ZEGO_READY:', {
        currentUserId: this.currentUserId,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'فشل تهيئة خدمة المكالمات.';

      console.error(
        'ZEGO_INITIALIZATION_ERROR:',
        error,
      );

      this.zpInstance = null;
      this.isInitialized = false;

      diagnosticsManager.update({
        zegoSdkStatus: 'Failed',
        joinedRoom: false,
        lastCallError: message,
      });

      throw error;
    }
  }

  /**
   * إعداد دعوات الاتصال.
   *
   * النافذة الافتراضية مفعلة مؤقتًا لضمان ظهور الرنين
   * والقبول والرفض قبل بناء النافذة المخصصة.
   */
  private configureCallInvitation(): void {
    if (!this.zpInstance) {
      throw new Error(
        'ZEGOCLOUD instance غير جاهزة.',
      );
    }

    this.zpInstance.setCallInvitationConfig({
      enableCustomCallInvitationDialog: false,
      endCallWhenInitiatorLeave: true,

      onSetRoomConfigBeforeJoining: (
        callType: number,
      ) => ({
        turnOnMicrophoneWhenJoining: true,
        turnOnCameraWhenJoining:
          callType ===
          ZegoUIKitPrebuilt.InvitationTypeVideoCall,
        showMyCameraToggleButton: true,
        showMyMicrophoneToggleButton: true,
        showAudioVideoSettingsButton: true,
        showScreenSharingButton: true,
        showTextChat: false,
        showUserList: false,
        maxUsers: 2,
      }),

      onIncomingCallReceived: async (
        callID: string,
        caller: {
          userID: string;
          userName: string;
        },
        callType: number,
      ) => {
        console.log(
          'ZEGO_INCOMING_CALL:',
          {
            callID,
            caller,
            callType,
            receiverId:
              this.currentUserId,
          },
        );

        diagnosticsManager.update({
          callStatus: 'Ringing',
          currentRoomId: callID,
        });

        if (this.currentUserId) {
          try {
            await supabaseService.createCallRecord({
              id: callID,
              caller_id: caller.userID,
              receiver_id:
                this.currentUserId,
              type:
                callType ===
                ZegoUIKitPrebuilt
                  .InvitationTypeVideoCall
                  ? 'video'
                  : 'audio',
              status: 'ringing',
              roomId: callID,
            });
          } catch (error) {
            // لا نوقف رنين ZEGOCLOUD بسبب خطأ تسجيل السجل.
            console.error(
              'CREATE_INCOMING_CALL_RECORD_ERROR:',
              error,
            );
          }
        }

        this.onIncomingCallHandler?.({
          callID,
          caller,
          callType,
        });
      },

      onIncomingCallCanceled: async (
        callID: string,
      ) => {
        console.log(
          'ZEGO_INCOMING_CALL_CANCELED:',
          callID,
        );

        diagnosticsManager.update({
          callStatus: 'Idle',
        });

        try {
          await supabaseService.updateCallStatus(
            callID,
            'rejected',
          );
        } catch (error) {
          console.error(
            'UPDATE_CANCELED_CALL_ERROR:',
            error,
          );
        }

        this.onCallEndedHandler?.();
      },

      onOutgoingCallAccepted: async (
        callID: string,
        callee?: unknown,
      ) => {
        console.log(
          'ZEGO_OUTGOING_CALL_ACCEPTED:',
          {
            callID,
            callee,
          },
        );

        diagnosticsManager.update({
          joinedRoom: true,
          callStatus: 'Accepted',
          currentRoomId: callID,
        });

        try {
          await supabaseService.updateCallStatus(
            callID,
            'accepted',
          );
        } catch (error) {
          console.error(
            'UPDATE_ACCEPTED_CALL_ERROR:',
            error,
          );
        }

        this.onCallAcceptedHandler?.();
      },

      onOutgoingCallRejected: async (
        callID: string,
        callee?: unknown,
      ) => {
        console.log(
          'ZEGO_OUTGOING_CALL_REJECTED:',
          {
            callID,
            callee,
          },
        );

        diagnosticsManager.update({
          callStatus: 'Rejected',
        });

        try {
          await supabaseService.updateCallStatus(
            callID,
            'rejected',
          );
        } catch (error) {
          console.error(
            'UPDATE_REJECTED_CALL_ERROR:',
            error,
          );
        }

        this.onCallEndedHandler?.();
      },

      onOutgoingCallTimeout: async (
        callID: string,
        callees?: unknown,
      ) => {
        console.log(
          'ZEGO_OUTGOING_CALL_TIMEOUT:',
          {
            callID,
            callees,
          },
        );

        diagnosticsManager.update({
          callStatus: 'Missed',
        });

        try {
          await supabaseService.updateCallStatus(
            callID,
            'missed',
          );
        } catch (error) {
          console.error(
            'UPDATE_MISSED_CALL_ERROR:',
            error,
          );
        }

        this.onCallEndedHandler?.();
      },

      onCallInvitationEnded: (
        reason: unknown,
        data: unknown,
      ) => {
        console.log(
          'ZEGO_CALL_INVITATION_ENDED:',
          {
            reason,
            data,
          },
        );

        diagnosticsManager.update({
          callStatus: 'Idle',
          joinedRoom: false,
        });

        this.onCallEndedHandler?.();
      },
    });
  }

  /**
   * إرسال دعوة اتصال صوتية أو فيديو.
   */
  public async sendCallInvitation(
    targetProfile: TargetProfile,
    type: CallType,
  ): Promise<{
    success: boolean;
    error?: string;
  }> {
    if (
      !this.zpInstance ||
      !this.isInitialized
    ) {
      return {
        success: false,
        error:
          'خدمة المكالمات غير جاهزة. أعد تحميل الصفحة ثم جرّب مجددًا.',
      };
    }

    if (!this.currentUserId) {
      return {
        success: false,
        error:
          'لا يوجد مستخدم مسجل في خدمة المكالمات.',
      };
    }

    const targetUserId = String(
      targetProfile.id ?? '',
    ).trim();

    const targetUserName = String(
      targetProfile.name ||
        targetProfile.email ||
        'مستخدم',
    ).trim();

    if (!targetUserId) {
      return {
        success: false,
        error:
          'معرف المستخدم المطلوب غير صحيح.',
      };
    }

    if (
      targetUserId === this.currentUserId
    ) {
      return {
        success: false,
        error:
          'لا يمكنك الاتصال بحسابك نفسه.',
      };
    }

    const permissionResult =
      await this.requestMediaPermissions(type);

    if (!permissionResult.success) {
      return {
        success: false,
        error:
          permissionResult.errorMessage,
      };
    }

    const callType =
      type === 'video'
        ? ZegoUIKitPrebuilt
            .InvitationTypeVideoCall
        : ZegoUIKitPrebuilt
            .InvitationTypeVoiceCall;

    try {
      console.log(
        'ZEGO_SENDING_INVITATION:',
        {
          currentUserID: this.currentUserId,
          targetUserID: targetUserId,
          callType: type,
        },
      );

      const result =
        (await this.zpInstance.sendCallInvitation(
          {
            callees: [
              {
                userID: targetUserId,
                userName: targetUserName,
              },
            ],
            callType,
            timeout: 30,
          },
        )) as InvitationResult;

      const failedInvitees =
        result?.errorInvitees ?? [];

      console.log(
        'ZEGO_INVITATION_RESULT:',
        {
          currentUserID: this.currentUserId,
          targetUserID: targetUserId,
          callType: type,
          sendCallInvitationResult: result,
          errorInvitees: failedInvitees,
        },
      );

      if (failedInvitees.length > 0) {
        const failedNames =
          failedInvitees
            .map(
              (invitee) =>
                invitee.userName ||
                invitee.userID,
            )
            .join(', ');

        const message =
          `تعذر إرسال الاتصال إلى: ${failedNames}`;

        diagnosticsManager.update({
          callStatus: 'Failed',
          lastCallError: message,
        });

        console.error(
          'ZEGO_ERROR_INVITEES:',
          failedInvitees,
        );

        return {
          success: false,
          error: message,
        };
      }

      diagnosticsManager.update({
        callStatus: 'Ringing',
        lastCallError: undefined,
      });

      return { success: true };
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'فشل إرسال دعوة الاتصال.';

      console.error(
        'ZEGO_SEND_CALL_INVITATION_ERROR:',
        error,
      );

      diagnosticsManager.update({
        callStatus: 'Failed',
        lastCallError: message,
      });

      return {
        success: false,
        error: message,
      };
    }
  }

  public registerListeners(
    callbacks: CallListeners,
  ): void {
    if (callbacks.onIncomingCall) {
      this.onIncomingCallHandler =
        callbacks.onIncomingCall;
    }

    if (callbacks.onCallEnded) {
      this.onCallEndedHandler =
        callbacks.onCallEnded;
    }

    if (callbacks.onCallAccepted) {
      this.onCallAcceptedHandler =
        callbacks.onCallAccepted;
    }
  }

  public isReady(): boolean {
    return Boolean(
      this.isInitialized &&
        this.zpInstance &&
        this.currentUserId,
    );
  }

  public getCurrentUserId():
    | string
    | null {
    return this.currentUserId;
  }

  public destroy(): void {
    if (this.zpInstance) {
      try {
        this.zpInstance.destroy();
      } catch (error) {
        console.warn(
          'ZEGO_DESTROY_WARNING:',
          error,
        );
      }
    }

    this.zpInstance = null;
    this.isInitialized = false;
    this.initializationPromise = null;
    this.currentUserId = null;
    this.currentUserName = null;

    diagnosticsManager.update({
      zegoSdkStatus: 'Idle',
      joinedRoom: false,
      localStreamPublished: false,
      remoteStreamReceived: false,
      callStatus: 'Idle',
      currentRoomId: undefined,
    });
  }
}

export const zegoCallService =
  new ZegoCallService();