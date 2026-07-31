import { getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  addDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  Unsubscribe
} from 'firebase/firestore';
import { User, Message, CallLog } from '../types';

let dbInstance: ReturnType<typeof getFirestore> | null = null;

try {
  const app = getApp();
  dbInstance = getFirestore(app);
} catch (e) {
  console.warn('Firestore instance failed to load:', e);
}

export class FirestoreService {
  // Sync or create user profile on login
  async syncUserProfile(user: User): Promise<void> {
    if (!dbInstance) return;
    try {
      const userRef = doc(dbInstance, 'users', user.id);
      const userSnap = await getDoc(userRef);

      const payload = {
        uid: user.id,
        displayName: user.name,
        email: user.email || '',
        photoURL: user.avatar || '',
        phone: user.phone || '',
        language: user.language || 'ar',
        isOnline: true,
        lastSeen: new Date().toISOString(),
        updatedAt: serverTimestamp()
      };

      if (!userSnap.exists()) {
        await setDoc(userRef, {
          ...payload,
          createdAt: serverTimestamp()
        });
      } else {
        await updateDoc(userRef, payload);
      }
    } catch (err) {
      console.error('Error syncing user profile to Firestore:', err);
    }
  }

  // Update online presence
  async setUserPresence(userId: string, isOnline: boolean): Promise<void> {
    if (!dbInstance) return;
    try {
      const userRef = doc(dbInstance, 'users', userId);
      await updateDoc(userRef, {
        isOnline,
        lastSeen: new Date().toISOString(),
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      console.warn('Failed to update presence:', err);
    }
  }

  // Subscribe to real users in 'users' collection
  subscribeUsers(currentUserId: string, callback: (users: User[]) => void): Unsubscribe {
    if (!dbInstance) {
      callback([]);
      return () => {};
    }

    const usersRef = collection(dbInstance, 'users');
    return onSnapshot(usersRef, (snapshot) => {
      const userList: User[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (docSnap.id !== currentUserId) {
          userList.push({
            id: docSnap.id,
            name: data.displayName || data.email?.split('@')[0] || 'User',
            avatar: data.photoURL || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
            email: data.email,
            phone: data.phone,
            language: data.language || 'ar',
            isOnline: data.isOnline ?? false,
            lastSeen: data.lastSeen ? new Date(data.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Offline',
            statusText: data.isOnline ? 'Online' : 'Offline'
          });
        }
      });
      callback(userList);
    });
  }

  // Get or Create conversation between two users
  getConversationId(userId1: string, userId2: string): string {
    return [userId1, userId2].sort().join('_');
  }

  // Subscribe to real-time messages for a conversation
  subscribeMessages(
    conversationId: string,
    callback: (messages: Message[]) => void
  ): Unsubscribe {
    if (!dbInstance) {
      callback([]);
      return () => {};
    }

    const messagesRef = collection(dbInstance, 'conversations', conversationId, 'messages');
    const q = query(messagesRef, orderBy('createdAt', 'asc'));

    return onSnapshot(q, (snapshot) => {
      const msgList: Message[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const dateObj = data.createdAt?.toDate ? data.createdAt.toDate() : new Date();
        msgList.push({
          id: docSnap.id,
          senderId: data.senderId,
          receiverId: data.receiverId,
          text: data.text || '',
          timestamp: dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          type: data.type || 'text',
          mediaUrl: data.mediaUrl,
          isRead: data.isRead ?? true,
          isDelivered: data.isDelivered ?? true,
          originalLang: data.originalLang || 'ar'
        });
      });
      callback(msgList);
    });
  }

  // Send real message
  async sendMessage(
    senderId: string,
    receiverId: string,
    text: string,
    type: 'text' | 'audio' | 'image' = 'text',
    mediaUrl?: string
  ): Promise<void> {
    if (!dbInstance) return;

    const convId = this.getConversationId(senderId, receiverId);
    const messagesRef = collection(dbInstance, 'conversations', convId, 'messages');
    const convRef = doc(dbInstance, 'conversations', convId);

    const msgData = {
      senderId,
      receiverId,
      text,
      type,
      mediaUrl: mediaUrl || null,
      createdAt: serverTimestamp(),
      isRead: false,
      isDelivered: true
    };

    await addDoc(messagesRef, msgData);
    await setDoc(
      convRef,
      {
        members: [senderId, receiverId],
        lastMessage: text,
        lastMessageTime: serverTimestamp(),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  }

  // Subscribe to Call Logs
  subscribeCallLogs(currentUserId: string, callback: (calls: CallLog[]) => void): Unsubscribe {
    if (!dbInstance) {
      callback([]);
      return () => {};
    }

    const callsRef = collection(dbInstance, 'calls');
    const q = query(callsRef, orderBy('startedAt', 'desc'));

    return onSnapshot(q, (snapshot) => {
      const logs: CallLog[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.callerId === currentUserId || data.receiverId === currentUserId) {
          const isCaller = data.callerId === currentUserId;
          const otherId = isCaller ? data.receiverId : data.callerId;
          const direction = isCaller
            ? 'outgoing'
            : data.status === 'rejected' || data.status === 'missed'
            ? 'missed'
            : 'incoming';

          const dateObj = data.startedAt?.toDate ? data.startedAt.toDate() : new Date();

          logs.push({
            id: docSnap.id,
            participantId: otherId,
            type: data.type || 'video',
            direction,
            timestamp: dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            duration: data.duration ? `${data.duration}s` : undefined,
            zegoRoomId: data.channelId || docSnap.id
          });
        }
      });
      callback(logs);
    });
  }

  // Create real call document
  async createCall(
    callerId: string,
    receiverId: string,
    type: 'audio' | 'video'
  ): Promise<string | null> {
    if (!dbInstance) return null;

    const channelId = `zego_room_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const callsRef = collection(dbInstance, 'calls');

    const callDoc = await addDoc(callsRef, {
      callerId,
      receiverId,
      type,
      status: 'ringing',
      channelId,
      startedAt: serverTimestamp()
    });

    return callDoc.id;
  }

  // Subscribe to Incoming Calls in Realtime
  subscribeIncomingCalls(
    currentUserId: string,
    callback: (call: { callId: string; callerId: string; type: 'audio' | 'video'; channelId: string } | null) => void
  ): Unsubscribe {
    if (!dbInstance) {
      callback(null);
      return () => {};
    }

    const callsRef = collection(dbInstance, 'calls');
    const q = query(callsRef, where('receiverId', '==', currentUserId), where('status', '==', 'ringing'));

    return onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        const docSnap = snapshot.docs[0];
        const data = docSnap.data();
        callback({
          callId: docSnap.id,
          callerId: data.callerId,
          type: data.type || 'video',
          channelId: data.channelId
        });
      } else {
        callback(null);
      }
    });
  }

  // Update Call Status
  async updateCallStatus(callId: string, status: 'accepted' | 'rejected' | 'ended', durationSec?: number): Promise<void> {
    if (!dbInstance) return;

    try {
      const callRef = doc(dbInstance, 'calls', callId);
      await updateDoc(callRef, {
        status,
        endedAt: serverTimestamp(),
        duration: durationSec || 0
      });
    } catch (err) {
      console.warn('Failed to update call status:', err);
    }
  }
}

export const firestoreService = new FirestoreService();
