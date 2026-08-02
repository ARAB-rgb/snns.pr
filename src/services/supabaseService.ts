import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { User, Message, CallLog, PrivacySettings, UserStatus } from '../types';

export interface DiagnosticsInfo {
  authStatus: 'Connected' | 'Failed';
  dbStatus: 'Connected' | 'Failed' | 'Testing...';
  realtimeStatus: 'SUBSCRIBED' | 'Connecting' | 'Failed';
  lastInsertStatus: 'Success' | 'Failed' | 'None';
  lastReceivedStatus: 'Success' | 'None';
  lastConversationId?: string;
  lastSenderId?: string;
  lastReceiverId?: string;
  // Calls Diagnostics
  callsRealtimeStatus: 'SUBSCRIBED' | 'Connecting' | 'Failed';
  edgeFunctionTokenStatus: 'Success' | 'Failed' | 'Not Tested';
  zegoSdkStatus: 'Ready' | 'Failed' | 'Initializing' | 'Idle';
  cameraPermission: 'Granted' | 'Denied' | 'Not Requested';
  microphonePermission: 'Granted' | 'Denied' | 'Not Requested';
  currentCallId?: string;
  currentRoomId?: string;
  callStatus: 'Idle' | 'Dialing' | 'Ringing' | 'Accepted' | 'Connected' | 'Rejected' | 'Ended' | 'Missed' | 'Failed';
  joinedRoom: boolean;
  localStreamPublished: boolean;
  remoteStreamReceived: boolean;
  lastCallError?: string;
}

class DiagnosticsManager {
  private info: DiagnosticsInfo = {
    authStatus: 'Connected',
    dbStatus: 'Testing...',
    realtimeStatus: 'Connecting',
    lastInsertStatus: 'None',
    lastReceivedStatus: 'None',
    callsRealtimeStatus: 'Connecting',
    edgeFunctionTokenStatus: 'Not Tested',
    zegoSdkStatus: 'Initializing',
    cameraPermission: 'Not Requested',
    microphonePermission: 'Not Requested',
    callStatus: 'Idle',
    joinedRoom: false,
    localStreamPublished: false,
    remoteStreamReceived: false
  };

  private listeners = new Set<(info: DiagnosticsInfo) => void>();

  getDiagnostics(): DiagnosticsInfo {
    return { ...this.info };
  }

  update(partial: Partial<DiagnosticsInfo>) {
    this.info = { ...this.info, ...partial };
    this.listeners.forEach((l) => l(this.info));
  }

  subscribe(listener: (info: DiagnosticsInfo) => void) {
    this.listeners.add(listener);
    listener(this.info);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async runHealthCheck(currentUserId?: string) {
    if (!isSupabaseConfigured) {
      this.update({ authStatus: 'Failed', dbStatus: 'Failed', realtimeStatus: 'Failed' });
      return;
    }

    try {
      const { error } = await supabase.from('profiles').select('id').limit(1);
      if (error) {
        this.update({ dbStatus: 'Failed' });
      } else {
        this.update({ dbStatus: 'Connected' });
      }
    } catch {
      this.update({ dbStatus: 'Failed' });
    }

    if (currentUserId) {
      this.update({ authStatus: 'Connected' });
    } else {
      this.update({ authStatus: 'Failed' });
    }
  }
}

export const diagnosticsManager = new DiagnosticsManager();

export function toUuidOrText(uid: string): string {
  if (!uid) return '00000000-0000-0000-0000-000000000000';
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(uid)) return uid;

  let hex = '';
  for (let i = 0; i < uid.length; i++) {
    hex += uid.charCodeAt(i).toString(16);
  }
  hex = (hex + '00000000000000000000000000000000').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(12, 15)}-a${hex.slice(15, 18)}-${hex.slice(18, 30)}`;
}

export class SupabaseService {
  // Sync user profile from Supabase Auth user directly into public.profiles
  async syncUserProfileFromAuth(sbUser: any): Promise<void> {
    if (!isSupabaseConfigured || !sbUser) return;
    try {
      const metadata = sbUser.user_metadata || {};
      const fullName = metadata.full_name || metadata.name || sbUser.email?.split('@')[0] || 'مستخدم';
      const avatarUrl =
        metadata.avatar_url ||
        metadata.picture ||
        'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150';

      const now = new Date().toISOString();

      const payload: Record<string, any> = {
        id: sbUser.id,
        user_id: sbUser.id,
        full_name: fullName,
        email: sbUser.email || '',
        avatar_url: avatarUrl,
        language: 'ar',
        profile_visibility: 'public',
        is_online: true,
        last_seen: now,
        updated_at: now
      };

      const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' });
      if (error) {
        console.info('syncUserProfileFromAuth notice:', error.message || error);
      }
    } catch (err) {
      console.info('syncUserProfileFromAuth exception:', err);
    }
  }

  // Helper for localStorage state fallback
  private getLocalFollows(userId: string): string[] {
    try {
      const data = localStorage.getItem(`follows_${userId}`);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  private setLocalFollows(userId: string, follows: string[]) {
    try {
      localStorage.setItem(`follows_${userId}`, JSON.stringify(follows));
    } catch (e) {}
  }

  private getLocalFollowers(userId: string): string[] {
    try {
      const data = localStorage.getItem(`followers_${userId}`);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  private setLocalFollowers(userId: string, followers: string[]) {
    try {
      localStorage.setItem(`followers_${userId}`, JSON.stringify(followers));
    } catch (e) {}
  }

  getLocalPrivacy(userId: string): PrivacySettings {
    const defaultPrivacy: PrivacySettings = {
      lastSeenVisibility: 'everyone',
      hideOnlineStatus: false,
      readReceipts: true,
      profilePhotoVisibility: 'everyone',
      allowCallFrom: 'everyone',
      blockedUserIds: []
    };
    try {
      const data = localStorage.getItem(`privacy_${userId}`);
      return data ? { ...defaultPrivacy, ...JSON.parse(data) } : defaultPrivacy;
    } catch (e) {
      return defaultPrivacy;
    }
  }

  setLocalPrivacy(userId: string, settings: PrivacySettings) {
    try {
      localStorage.setItem(`privacy_${userId}`, JSON.stringify(settings));
    } catch (e) {}
  }

  // Toggle Follow / Unfollow user
  async toggleFollow(currentUserId: string, targetUserId: string): Promise<boolean> {
    const following = this.getLocalFollows(currentUserId);
    const targetFollowers = this.getLocalFollowers(targetUserId);
    const isFollowing = following.includes(targetUserId);

    let nextFollowing: string[];
    let nextTargetFollowers: string[];

    if (isFollowing) {
      nextFollowing = following.filter((id) => id !== targetUserId);
      nextTargetFollowers = targetFollowers.filter((id) => id !== currentUserId);
    } else {
      nextFollowing = [...following, targetUserId];
      nextTargetFollowers = [...targetFollowers, currentUserId];
    }

    this.setLocalFollows(currentUserId, nextFollowing);
    this.setLocalFollowers(targetUserId, nextTargetFollowers);

    // Sync to Supabase if table exists
    if (isSupabaseConfigured) {
      try {
        if (isFollowing) {
          await supabase.from('follows').delete().match({ follower_id: currentUserId, followed_id: targetUserId });
        } else {
          await supabase.from('follows').upsert({ follower_id: currentUserId, followed_id: targetUserId }, { onConflict: 'follower_id,followed_id' });
        }
      } catch (err) {
        // Fallback handled silently
      }
    }

    return !isFollowing;
  }

  // Toggle Block / Unblock user
  async toggleBlockUser(currentUserId: string, targetUserId: string): Promise<boolean> {
    const privacy = this.getLocalPrivacy(currentUserId);
    const isBlocked = privacy.blockedUserIds.includes(targetUserId);

    const nextBlocked = isBlocked
      ? privacy.blockedUserIds.filter((id) => id !== targetUserId)
      : [...privacy.blockedUserIds, targetUserId];

    const updatedPrivacy = { ...privacy, blockedUserIds: nextBlocked };
    this.setLocalPrivacy(currentUserId, updatedPrivacy);

    if (isSupabaseConfigured) {
      try {
        if (isBlocked) {
          await supabase.from('blocked_users').delete().match({ blocker_id: currentUserId, blocked_id: targetUserId });
        } else {
          await supabase.from('blocked_users').upsert({ blocker_id: currentUserId, blocked_id: targetUserId }, { onConflict: 'blocker_id,blocked_id' });
        }
      } catch (e) {}
    }

    return !isBlocked;
  }

  // Update privacy settings
  async updatePrivacySettings(currentUserId: string, settings: PrivacySettings): Promise<void> {
    this.setLocalPrivacy(currentUserId, settings);

    if (isSupabaseConfigured) {
      try {
        await supabase.from('user_privacy').upsert({
          user_id: currentUserId,
          settings,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
      } catch (e) {}
    }
  }

  // Sync user profile in Supabase 'profiles' table with error resilience and fallbacks
  async syncUserProfile(user: User, idToken?: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    try {
      if (idToken && (supabase as any).rest) {
        (supabase as any).rest.headers['Authorization'] = `Bearer ${idToken}`;
      }

      const formattedUuid = toUuidOrText(user.id);

      const payload: Record<string, any> = {
        id: formattedUuid,
        user_id: user.id,
        full_name: user.name,
        email: user.email || '',
        avatar_url: user.avatar || '',
        phone: user.phone || '',
        language: user.language || 'ar',
        is_online: true,
        last_seen: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // 1. Attempt upsert with UUID
      const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' });
      if (error) {
        // 2. Fallback: try raw string id if profiles.id is text
        const rawPayload = { ...payload, id: user.id };
        const { error: rawErr } = await supabase.from('profiles').upsert(rawPayload, { onConflict: 'id' });
        if (rawErr) {
          // 3. Fallback: update by user_id or id
          const { error: updateErr } = await supabase.from('profiles').update(payload).eq('user_id', user.id);
          if (updateErr) {
            console.info('Supabase profiles sync note:', updateErr.message || updateErr);
          }
        }
      }
    } catch (err) {
      console.info('syncUserProfile notice:', err);
    }
  }

  // Update user online status
  async setUserPresence(userId: string, isOnline: boolean): Promise<void> {
    if (!isSupabaseConfigured) return;
    try {
      const formattedUuid = toUuidOrText(userId);
      await supabase.from('profiles').update({
        is_online: isOnline,
        last_seen: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).or(`id.eq.${formattedUuid},id.eq.${userId},user_id.eq.${userId}`);
    } catch (err) {
      console.warn('Failed to update presence in Supabase:', err);
    }
  }

  // Subscribe to real users list from 'profiles' table with Follows & Privacy enrichment
  subscribeUsers(currentUserId: string, callback: (users: User[]) => void): () => void {
    if (!isSupabaseConfigured) {
      callback([]);
      return () => {};
    }

    const currentUuid = toUuidOrText(currentUserId);

    const fetchUsers = async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*');

        if (!error && data) {
          const myFollowing = this.getLocalFollows(currentUserId);
          const myPrivacy = this.getLocalPrivacy(currentUserId);

          // Exclude current user by checking raw id, user_id, and formatted UUID
          const otherProfiles = data.filter(
            (p: any) =>
              p.id !== currentUserId &&
              p.id !== currentUuid &&
              p.user_id !== currentUserId
          );

          const userList: User[] = otherProfiles.map((p: any) => {
            const profileUserId = p.user_id || p.id;
            const userFollowers = this.getLocalFollowers(profileUserId);
            const isFollowed = myFollowing.includes(profileUserId);
            const userPrivacy = this.getLocalPrivacy(profileUserId);

            // Respect privacy setting for online status
            let isOnline = p.is_online ?? false;
            if (userPrivacy.hideOnlineStatus) {
              isOnline = false;
            }

            let lastSeenText = p.last_seen
              ? new Date(p.last_seen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : 'غير متصل';

            if (userPrivacy.lastSeenVisibility === 'nobody') {
              lastSeenText = 'مخفي';
            } else if (userPrivacy.lastSeenVisibility === 'followers' && !isFollowed) {
              lastSeenText = 'للمتابعين فقط';
            }

            return {
              id: profileUserId,
              name: p.full_name || p.email?.split('@')[0] || 'مستخدم',
              avatar: p.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
              email: p.email,
              phone: p.phone,
              language: p.language || 'ar',
              isOnline,
              lastSeen: lastSeenText,
              statusText: isOnline ? 'متصل الآن' : lastSeenText,
              followersCount: userFollowers.length,
              followingCount: this.getLocalFollows(profileUserId).length,
              isFollowedByMe: isFollowed,
              privacySettings: userPrivacy
            };
          });

          // Filter out blocked users
          const filteredList = userList.filter((u) => !myPrivacy.blockedUserIds.includes(u.id));
          callback(filteredList);
        } else if (error) {
          console.info('Supabase profiles fetch note:', error.message || error);
        }
      } catch (err) {
        console.warn('Error in fetchUsers:', err);
      }
    };

    fetchUsers();

    // Subscribe to realtime changes on profiles table
    const channel = supabase
      .channel('profiles_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        () => fetchUsers()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }

  // Get or ensure conversation UUID for two users
  async getConversationId(userId1: string, userId2: string): Promise<string> {
    return await this.ensureConversation(userId1, userId2);
  }

  // Upload file or blob to Supabase Storage ('chat-media' bucket) and return Signed URL or storage path
  async uploadAttachment(fileOrBlob: File | Blob, fileName: string, contentType?: string): Promise<{ storagePath: string; url: string } | null> {
    if (!isSupabaseConfigured) {
      console.warn('Supabase client not configured for file upload');
      return null;
    }

    try {
      const cleanFileName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
      const filePath = `uploads/${cleanFileName}`;
      const mimeType = contentType || fileOrBlob.type || 'application/octet-stream';

      // 1. Try 'chat-media' bucket
      let targetBucket = 'chat-media';
      let { data, error } = await supabase.storage
        .from(targetBucket)
        .upload(filePath, fileOrBlob, {
          contentType: mimeType,
          upsert: true
        });

      // 2. If 'chat-media' bucket fails, try 'attachments' or 'media'
      if (error) {
        console.warn('Upload to chat-media bucket error:', error.message);
        targetBucket = 'attachments';
        const res2 = await supabase.storage
          .from(targetBucket)
          .upload(filePath, fileOrBlob, {
            contentType: mimeType,
            upsert: true
          });
        data = res2.data;
        error = res2.error;

        if (error) {
          targetBucket = 'media';
          const res3 = await supabase.storage
            .from(targetBucket)
            .upload(filePath, fileOrBlob, {
              contentType: mimeType,
              upsert: true
            });
          data = res3.data;
          error = res3.error;
        }
      }

      if (error || !data) {
        console.error('Supabase Storage upload failed:', error?.message || 'Unknown error');
        return null;
      }

      // Generate Signed URL for private bucket access (24 hour validity)
      const { data: signedData, error: signedError } = await supabase.storage
        .from(targetBucket)
        .createSignedUrl(filePath, 86400);

      if (signedError || !signedData?.signedUrl) {
        // Fallback to public URL if bucket is public
        const { data: publicData } = supabase.storage.from(targetBucket).getPublicUrl(filePath);
        if (publicData?.publicUrl) {
          return { storagePath: `${targetBucket}:${filePath}`, url: publicData.publicUrl };
        }
        return null;
      }

      return { storagePath: `${targetBucket}:${filePath}`, url: signedData.signedUrl };
    } catch (err: any) {
      console.error('Exception during Supabase Storage upload:', err?.message || err);
      return null;
    }
  }

  // Get refreshed Signed URL for storage path or media URL
  async getSignedUrl(storagePathOrUrl: string): Promise<string> {
    if (!storagePathOrUrl) return '';
    if (storagePathOrUrl.startsWith('http://') || storagePathOrUrl.startsWith('https://')) {
      return storagePathOrUrl;
    }

    try {
      let bucket = 'chat-media';
      let path = storagePathOrUrl;

      if (storagePathOrUrl.includes(':')) {
        const parts = storagePathOrUrl.split(':');
        bucket = parts[0];
        path = parts[1];
      }

      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 86400);
      if (data?.signedUrl) return data.signedUrl;
    } catch (e) {
      // fallback
    }

    return storagePathOrUrl;
  }

  // Ensure conversation and member rows exist with genuine UUID
  async ensureConversation(user1Id: string, user2Id: string): Promise<string> {
    if (!user1Id || !user2Id) {
      return '';
    }

    if (!isSupabaseConfigured) {
      return crypto.randomUUID();
    }

    try {
      // 1. Check if a conversation already exists between user1Id and user2Id
      const { data: user1Members } = await supabase
        .from('conversation_members')
        .select('conversation_id')
        .eq('user_id', user1Id);

      if (user1Members && user1Members.length > 0) {
        const convIds = user1Members.map((m: any) => m.conversation_id).filter(Boolean);
        if (convIds.length > 0) {
          const { data: sharedMembers } = await supabase
            .from('conversation_members')
            .select('conversation_id')
            .eq('user_id', user2Id)
            .in('conversation_id', convIds)
            .limit(1);

          if (sharedMembers && sharedMembers.length > 0 && sharedMembers[0].conversation_id) {
            return sharedMembers[0].conversation_id;
          }
        }
      }

      // 2. If no existing conversation was found, create a new conversation with a UUID
      const newConvId = crypto.randomUUID();

      const { data: newConv, error: createError } = await supabase
        .from('conversations')
        .insert({
          id: newConvId,
          last_message: '',
          last_sender_id: user1Id,
          last_message_time: new Date().toISOString()
        })
        .select('id')
        .single();

      const finalConvId = newConv?.id || newConvId;

      if (createError) {
        console.error('Error creating conversation row in Supabase:', createError.message || createError);
      }

      // 3. Insert membership rows for both users
      const { error: membersError } = await supabase
        .from('conversation_members')
        .upsert([
          { conversation_id: finalConvId, user_id: user1Id },
          { conversation_id: finalConvId, user_id: user2Id }
        ], { onConflict: 'conversation_id,user_id' });

      if (membersError) {
        console.error('Error inserting conversation_members in Supabase:', membersError.message || membersError);
      }

      return finalConvId;
    } catch (err: any) {
      console.error('Exception in ensureConversation:', err?.message || err);
      return crypto.randomUUID();
    }
  }

  // Subscribe to real conversations for current user
  subscribeConversations(
    currentUserId: string,
    callback: (conversations: Array<{ id: string; otherUserId: string; lastMessage: string; lastMessageTime: string }>) => void
  ): () => void {
    if (!isSupabaseConfigured) {
      callback([]);
      return () => {};
    }

    const fetchConversations = async () => {
      // 1. Get conversation IDs from conversation_members
      const { data: memberRows } = await supabase
        .from('conversation_members')
        .select('conversation_id')
        .eq('user_id', currentUserId);

      const convIds: string[] = (memberRows || []).map((m: any) => m.conversation_id);

      if (convIds.length === 0) {
        callback([]);
        return;
      }

      // Fetch conversation details
      const { data: convs } = await supabase
        .from('conversations')
        .select('*, conversation_members(user_id)')
        .in('id', convIds)
        .order('updated_at', { ascending: false });

      if (convs) {
        const convList = convs.map((c: any) => {
          const members: string[] = (c.conversation_members || []).map((m: any) => m.user_id);
          const otherUserId = members.find((m) => m !== currentUserId) || currentUserId;

          const time = c.last_message_time
            ? new Date(c.last_message_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : 'الآن';

          return {
            id: c.id,
            otherUserId: otherUserId || currentUserId,
            lastMessage: c.last_message || '',
            lastMessageTime: time
          };
        });

        callback(convList);
      }
    };

    fetchConversations();

    const channel = supabase
      .channel('conversations_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        () => fetchConversations()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        () => fetchConversations()
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log(`📡 [Realtime] Conversations channel active for user ${currentUserId}`);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(`⚠️ [Realtime] Conversations subscription notice (${status}):`, err || 'Connecting...');
        }
      });

    const interval = setInterval(fetchConversations, 4000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }

  // Subscribe to real-time messages for a conversation
  subscribeMessages(
    conversationId: string,
    callback: (messages: Message[]) => void
  ): () => void {
    if (!isSupabaseConfigured) {
      callback([]);
      return () => {};
    }

    console.log('Supabase connected');
    diagnosticsManager.update({ authStatus: 'Connected', dbStatus: 'Connected' });

    const fetchMessages = async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching messages from database:', error.message);
        diagnosticsManager.update({ dbStatus: 'Failed' });
      } else if (data) {
        diagnosticsManager.update({ dbStatus: 'Connected' });
        const msgList: Message[] = data.map((m: any) => {
          const dateObj = m.created_at ? new Date(m.created_at) : new Date();
          return {
            id: m.id,
            senderId: m.sender_id,
            receiverId: '',
            text: m.body || '',
            timestamp: dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            type: m.type || 'text',
            mediaUrl: m.media_url || undefined,
            fileName: m.file_name || undefined,
            replyTo: m.reply_to || undefined,
            isRead: m.is_read ?? true,
            isDelivered: m.is_delivered ?? true,
            originalLang: 'ar'
          };
        });
        callback(msgList);
      }
    };

    fetchMessages();

    console.log('Realtime channel created');
    const channelName = `messages_${conversationId}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        (payload: any) => {
          if (!payload.new || payload.new.conversation_id === conversationId) {
            console.log('Message received');
            console.log('conversation_id:', payload.new?.conversation_id || conversationId);
            console.log('sender_id:', payload.new?.sender_id);

            diagnosticsManager.update({
              lastReceivedStatus: 'Success',
              lastConversationId: payload.new?.conversation_id || conversationId,
              lastSenderId: payload.new?.sender_id,
              lastReceiverId: undefined
            });

            fetchMessages();
          }
        }
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log('SUBSCRIBED');
          diagnosticsManager.update({ realtimeStatus: 'SUBSCRIBED' });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(`Realtime channel status notice (${status}):`, err || '');
          diagnosticsManager.update({ realtimeStatus: 'Failed' });
        }
      });

    const interval = setInterval(fetchMessages, 3000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }

  // Send message to Supabase
  async sendMessage(
    senderId: string,
    receiverId: string,
    text: string,
    type: 'text' | 'audio' | 'image' | 'file' = 'text',
    mediaUrl?: string,
    fileName?: string,
    replyTo?: { id: string; text: string; senderName?: string }
  ): Promise<boolean> {
    const convId = await this.ensureConversation(senderId, receiverId);

    if (!isSupabaseConfigured) {
      console.warn('Supabase client is not configured.');
      console.log('Message insert failed');
      console.log('conversation_id:', convId);
      console.log('sender_id:', senderId);
      console.log('receiver_id:', receiverId);
      diagnosticsManager.update({
        lastInsertStatus: 'Failed',
        lastConversationId: convId,
        lastSenderId: senderId,
        lastReceiverId: receiverId
      });
      return false;
    }

    const lastMsgText = type === 'image' ? '📷 صورة' : type === 'audio' ? '🎤 تسجيل صوتي' : type === 'file' ? '📁 ملف' : text;

    const payload = {
      conversation_id: convId,
      sender_id: senderId,
      body: text,
      type,
      media_url: mediaUrl || null,
      file_name: fileName || null,
      reply_to: replyTo?.id || null,
      is_read: false,
      is_delivered: true
    };

    console.log('MESSAGE_INSERT_PAYLOAD', payload);

    try {
      const { data, error: msgError } = await supabase.from('messages').insert(payload).select().single();

      console.log('MESSAGE_INSERT_DATA', data);
      console.error('MESSAGE_INSERT_ERROR', msgError);

      if (msgError) {
        console.error('Message insert failed:', msgError.message || msgError);
        console.log('conversation_id:', convId);
        console.log('sender_id:', senderId);
        console.log('receiver_id:', receiverId);

        diagnosticsManager.update({
          lastInsertStatus: 'Failed',
          lastConversationId: convId,
          lastSenderId: senderId,
          lastReceiverId: receiverId
        });
        return false;
      }

      console.log('Message insert success');
      console.log('conversation_id:', convId);
      console.log('sender_id:', senderId);
      console.log('receiver_id:', receiverId);

      diagnosticsManager.update({
        lastInsertStatus: 'Success',
        lastConversationId: convId,
        lastSenderId: senderId,
        lastReceiverId: receiverId
      });

      // Update conversation summary
      await supabase.from('conversations').update({
        last_message: lastMsgText,
        last_sender_id: senderId,
        last_message_time: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq('id', convId);

      return true;
    } catch (err: any) {
      console.error('MESSAGE_INSERT_ERROR', err);
      console.error('Message insert failed', err?.message || err);
      console.log('conversation_id:', convId);
      console.log('sender_id:', senderId);
      console.log('receiver_id:', receiverId);

      diagnosticsManager.update({
        lastInsertStatus: 'Failed',
        lastConversationId: convId,
        lastSenderId: senderId,
        lastReceiverId: receiverId
      });
      return false;
    }
  }

  // Delete message
  async deleteMessage(conversationId: string, messageId: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    try {
      await supabase.from('messages').delete().eq('id', messageId);
    } catch (err) {
      console.error('Failed to delete message in Supabase:', err);
    }
  }

  // Subscribe to Call Logs
  subscribeCallLogs(currentUserId: string, callback: (calls: CallLog[]) => void): () => void {
    if (!isSupabaseConfigured) {
      callback([]);
      return () => {};
    }

    const fetchCalls = async () => {
      const { data } = await supabase
        .from('calls')
        .select('*')
        .or(`caller_id.eq.${currentUserId},receiver_id.eq.${currentUserId}`)
        .order('started_at', { ascending: false });

      if (data) {
        const logs: CallLog[] = data.map((c: any) => {
          const isCaller = c.caller_id === currentUserId;
          const otherId = isCaller ? c.receiver_id : c.caller_id;
          const direction = isCaller
            ? 'outgoing'
            : c.status === 'rejected' || c.status === 'missed'
            ? 'missed'
            : 'incoming';

          const dateObj = c.started_at ? new Date(c.started_at) : new Date();

          return {
            id: c.id,
            participantId: otherId,
            type: c.type || 'video',
            direction,
            timestamp: dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            duration: c.duration ? `${c.duration}s` : undefined,
            zegoRoomId: c.channel_id || c.id
          };
        });
        callback(logs);
      }
    };

    fetchCalls();

    const channel = supabase
      .channel('calls_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'calls' },
        () => fetchCalls()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }

  // Create call record with status (ringing, accepted, rejected, missed, ended)
  async createCallRecord(params: {
    id?: string;
    caller_id: string;
    receiver_id: string;
    type: 'audio' | 'video';
    status: 'ringing' | 'accepted' | 'rejected' | 'missed' | 'ended';
    roomId?: string;
  }): Promise<string | null> {
    if (!isSupabaseConfigured) {
      console.warn('Supabase client is not configured for call record.');
      return null;
    }

    const roomId = params.roomId || `room_${params.caller_id.slice(0, 8)}_${params.receiver_id.slice(0, 8)}`;

    console.log('Call record created');
    console.log('caller_id:', params.caller_id);
    console.log('receiver_id:', params.receiver_id);
    console.log('room_id:', roomId);

    try {
      const payload: Record<string, any> = {
        caller_id: params.caller_id,
        receiver_id: params.receiver_id,
        callee_id: params.receiver_id,
        room_id: roomId,
        channel_id: roomId,
        type: params.type,
        call_type: params.type,
        status: params.status,
        started_at: new Date().toISOString(),
        created_at: new Date().toISOString()
      };

      if (params.id) {
        payload.id = params.id;
      }

      const { data, error } = await supabase.from('calls').upsert(payload).select('id').single();

      if (error) {
        console.error('Call insert failed:', error.message);
        diagnosticsManager.update({
          currentCallId: params.id,
          currentRoomId: roomId,
          callStatus: 'Failed',
          lastCallError: error.message
        });
        return params.id || null;
      }

      const createdId = data?.id || params.id || null;

      diagnosticsManager.update({
        currentCallId: createdId || undefined,
        currentRoomId: roomId,
        callStatus: 'Ringing'
      });

      return createdId;
    } catch (err: any) {
      console.error('Exception creating call record:', err?.message || err);
      return params.id || null;
    }
  }

  // Create real call row in Supabase
  async createCall(
    callerId: string,
    receiverId: string,
    type: 'audio' | 'video'
  ): Promise<string | null> {
    return this.createCallRecord({
      caller_id: callerId,
      receiver_id: receiverId,
      type,
      status: 'ringing'
    });
  }

  // Subscribe to Incoming Calls in Realtime
  subscribeIncomingCalls(
    currentUserId: string,
    callback: (call: { callId: string; callerId: string; type: 'audio' | 'video'; channelId: string; roomId: string } | null) => void
  ): () => void {
    if (!isSupabaseConfigured) {
      callback(null);
      diagnosticsManager.update({ callsRealtimeStatus: 'Failed' });
      return () => {};
    }

    const checkIncoming = async () => {
      const { data, error } = await supabase
        .from('calls')
        .select('*')
        .or(`receiver_id.eq.${currentUserId},callee_id.eq.${currentUserId}`)
        .eq('status', 'ringing')
        .order('started_at', { ascending: false })
        .limit(1);

      if (error) {
        console.error('Error fetching incoming calls:', error.message);
      } else if (data && data.length > 0) {
        const c = data[0];
        console.log('Incoming call detected');
        console.log('caller_id:', c.caller_id);
        console.log('receiver_id:', c.receiver_id || c.callee_id);
        console.log('room_id:', c.room_id || c.channel_id || c.id);

        diagnosticsManager.update({
          currentCallId: c.id,
          currentRoomId: c.room_id || c.channel_id || c.id,
          callStatus: 'Ringing'
        });

        callback({
          callId: c.id,
          callerId: c.caller_id,
          type: (c.type || c.call_type || 'video') as 'audio' | 'video',
          channelId: c.channel_id || c.room_id || c.id,
          roomId: c.room_id || c.channel_id || c.id
        });
      } else {
        callback(null);
      }
    };

    checkIncoming();

    console.log('Realtime channel created');
    const channelName = `incoming_calls_${currentUserId}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'calls' },
        (payload: any) => {
          const rec = payload.new;
          if (rec && (rec.receiver_id === currentUserId || rec.callee_id === currentUserId)) {
            checkIncoming();
          }
        }
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log('SUBSCRIBED');
          diagnosticsManager.update({ callsRealtimeStatus: 'SUBSCRIBED' });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(`Incoming calls subscription notice (${status}):`, err || '');
          diagnosticsManager.update({ callsRealtimeStatus: 'Failed' });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }

  // Subscribe to specific Call Status updates
  subscribeCallStatus(callId: string, callback: (status: string) => void): () => void {
    if (!isSupabaseConfigured || !callId) return () => {};

    const checkStatus = async () => {
      const { data, error } = await supabase
        .from('calls')
        .select('*')
        .eq('id', callId)
        .single();

      if (error) {
        console.error('Fetch call status error:', error.message);
      } else if (data?.status) {
        diagnosticsManager.update({
          currentCallId: callId,
          currentRoomId: data.room_id || data.channel_id || callId,
          callStatus: data.status.charAt(0).toUpperCase() + data.status.slice(1) as any
        });
        callback(data.status);
      }
    };

    checkStatus();

    const channel = supabase
      .channel(`call_status_${callId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'calls', filter: `id=eq.${callId}` },
        (payload: any) => {
          if (payload.new?.status) {
            console.log('Call status updated:', payload.new.status);
            console.log('caller_id:', payload.new.caller_id);
            console.log('receiver_id:', payload.new.receiver_id || payload.new.callee_id);
            console.log('room_id:', payload.new.room_id || payload.new.channel_id);

            diagnosticsManager.update({
              currentCallId: callId,
              currentRoomId: payload.new.room_id || payload.new.channel_id || callId,
              callStatus: payload.new.status.charAt(0).toUpperCase() + payload.new.status.slice(1) as any
            });

            callback(payload.new.status);
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('SUBSCRIBED');
        }
      });

    const interval = setInterval(checkStatus, 2000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }

  // Update Call Status
  async updateCallStatus(callId: string, status: 'ringing' | 'accepted' | 'rejected' | 'missed' | 'ended' | 'failed', durationSec?: number): Promise<void> {
    if (!isSupabaseConfigured || !callId) return;

    try {
      const updatePayload: Record<string, any> = { status };

      if (status === 'accepted') {
        updatePayload.answered_at = new Date().toISOString();
      }

      if (status === 'ended' || status === 'rejected' || status === 'missed' || status === 'failed') {
        updatePayload.ended_at = new Date().toISOString();
        if (typeof durationSec === 'number') {
          updatePayload.duration_seconds = durationSec;
          updatePayload.duration = durationSec;
        }
      }

      await supabase.from('calls').update(updatePayload).eq('id', callId);

      diagnosticsManager.update({
        currentCallId: callId,
        callStatus: status.charAt(0).toUpperCase() + status.slice(1) as any
      });
    } catch (err) {
      console.warn('Failed to update call status in Supabase:', err);
    }
  }

  // --- USER STATUSES (24-Hour Disappearing Stories) ---
  getLocalStatuses(): UserStatus[] {
    try {
      const stored = localStorage.getItem('snns_user_statuses');
      if (stored) {
        const parsed: UserStatus[] = JSON.parse(stored);
        const now = new Date().getTime();
        return parsed.filter(s => new Date(s.expiresAt).getTime() > now);
      }
    } catch (e) {
      console.warn('Error reading local statuses:', e);
    }

    return [];
  }

  async fetchActiveStatuses(): Promise<UserStatus[]> {
    let statuses = this.getLocalStatuses();

    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('user_statuses')
          .select('*')
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false });

        if (!error && data && data.length > 0) {
          const dbStatuses: UserStatus[] = data.map(d => ({
            id: d.id,
            userId: d.user_id,
            userName: d.user_name || 'User',
            userAvatar: d.user_avatar || '',
            text: d.text || '',
            bgColor: d.bg_color || 'from-cyan-600 to-slate-900',
            mediaUrl: d.media_url,
            createdAt: d.created_at,
            expiresAt: d.expires_at,
            viewsCount: d.views_count || 0
          }));
          // Merge with local statuses by unique ID
          const statusMap = new Map<string, UserStatus>();
          statuses.forEach(s => statusMap.set(s.id, s));
          dbStatuses.forEach(s => statusMap.set(s.id, s));
          statuses = Array.from(statusMap.values());
        }
      } catch (err) {
        console.warn('Using local fallback for statuses:', err);
      }
    }

    // Sort newest first
    return statuses.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async createStatus(params: {
    userId: string;
    userName: string;
    userAvatar: string;
    text: string;
    bgColor?: string;
    mediaUrl?: string;
  }): Promise<UserStatus> {
    const now = new Date();
    const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

    const newStatus: UserStatus = {
      id: `status-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      userId: params.userId,
      userName: params.userName,
      userAvatar: params.userAvatar,
      text: params.text,
      bgColor: params.bgColor || 'from-cyan-600 to-slate-900',
      mediaUrl: params.mediaUrl,
      createdAt: now.toISOString(),
      expiresAt: expires.toISOString(),
      viewsCount: 0
    };

    // Save locally
    const existing = this.getLocalStatuses();
    const updated = [newStatus, ...existing];
    try {
      localStorage.setItem('snns_user_statuses', JSON.stringify(updated));
    } catch (e) {}

    // Save to Supabase if configured
    if (isSupabaseConfigured) {
      try {
        await supabase.from('user_statuses').insert({
          id: newStatus.id,
          user_id: newStatus.userId,
          user_name: newStatus.userName,
          user_avatar: newStatus.userAvatar,
          text: newStatus.text,
          bg_color: newStatus.bgColor,
          media_url: newStatus.mediaUrl,
          created_at: newStatus.createdAt,
          expires_at: newStatus.expiresAt
        });
      } catch (err) {
        console.warn('Failed to insert status to Supabase, saved locally:', err);
      }
    }

    return newStatus;
  }

  async uploadStatusImage(file: File): Promise<string> {
    if (isSupabaseConfigured) {
      try {
        const ext = file.name.split('.').pop() || 'jpg';
        const fileName = `status_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${ext}`;
        
        // Attempt upload to Supabase Storage bucket 'status-media' or 'attachments'
        const { data, error } = await supabase.storage
          .from('status-media')
          .upload(fileName, file, {
            cacheControl: '3600',
            upsert: true
          });

        if (!error && data) {
          const { data: publicUrlData } = supabase.storage
            .from('status-media')
            .getPublicUrl(data.path);
          if (publicUrlData?.publicUrl) {
            return publicUrlData.publicUrl;
          }
        } else {
          // If 'status-media' bucket doesn't exist, try 'attachments' bucket
          const { data: attData, error: attError } = await supabase.storage
            .from('attachments')
            .upload(fileName, file, { upsert: true });

          if (!attError && attData) {
            const { data: attPublicUrlData } = supabase.storage
              .from('attachments')
              .getPublicUrl(attData.path);
            if (attPublicUrlData?.publicUrl) {
              return attPublicUrlData.publicUrl;
            }
          }
        }
      } catch (err) {
        console.warn('Supabase storage status upload failed, falling back to DataURL:', err);
      }
    }

    // Fallback to FileReader DataURL for local mode or if storage bucket is unavailable
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(file);
    });
  }

  async deleteStatus(statusId: string): Promise<void> {
    const existing = this.getLocalStatuses();
    const filtered = existing.filter(s => s.id !== statusId);
    try {
      localStorage.setItem('snns_user_statuses', JSON.stringify(filtered));
    } catch (e) {}

    if (isSupabaseConfigured) {
      try {
        await supabase.from('user_statuses').delete().eq('id', statusId);
      } catch (err) {
        console.warn('Failed to delete status in Supabase:', err);
      }
    }
  }
}

export const supabaseService = new SupabaseService();