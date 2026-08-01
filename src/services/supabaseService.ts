import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { User, Message, CallLog, PrivacySettings } from '../types';

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
        name: fullName,
        email: sbUser.email || '',
        avatar_url: avatarUrl,
        avatar: avatarUrl,
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
        name: user.name,
        email: user.email || '',
        avatar: user.avatar || '',
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
              name: p.full_name || p.name || p.email?.split('@')[0] || 'مستخدم',
              avatar: p.avatar_url || p.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
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

  // Deterministic Conversation ID generator
  getConversationId(userId1: string, userId2: string): string {
    return [userId1, userId2].sort().join('_');
  }

  // Ensure conversation and member rows exist
  async ensureConversation(user1Id: string, user2Id: string): Promise<string> {
    const convId = this.getConversationId(user1Id, user2Id);
    if (!isSupabaseConfigured) return convId;

    try {
      const { data: existing } = await supabase
        .from('conversations')
        .select('id')
        .eq('id', convId)
        .single();

      if (!existing) {
        await supabase.from('conversations').insert({
          id: convId,
          last_message: '',
          last_sender_id: user1Id,
          last_message_time: new Date().toISOString()
        });

        await supabase.from('conversation_members').insert([
          { conversation_id: convId, user_id: user1Id },
          { conversation_id: convId, user_id: user2Id }
        ]);
      }
    } catch (err) {
      console.error('Error ensuring conversation in Supabase:', err);
    }
    return convId;
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
      // Get conversation IDs user belongs to
      const { data: memberRows } = await supabase
        .from('conversation_members')
        .select('conversation_id')
        .eq('user_id', currentUserId);

      if (!memberRows || memberRows.length === 0) {
        callback([]);
        return;
      }

      const convIds = memberRows.map((m: any) => m.conversation_id);

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
            otherUserId,
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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
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

    const fetchMessages = async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (!error && data) {
        const msgList: Message[] = data.map((m: any) => {
          const dateObj = m.created_at ? new Date(m.created_at) : new Date();
          return {
            id: m.id,
            senderId: m.sender_id,
            receiverId: m.receiver_id,
            text: m.text || '',
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

    const channel = supabase
      .channel(`messages_${conversationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        () => fetchMessages()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
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
  ): Promise<void> {
    if (!isSupabaseConfigured) return;

    const convId = await this.ensureConversation(senderId, receiverId);
    const lastMsgText = type === 'image' ? '📷 صورة' : type === 'audio' ? '🎤 تسجيل صوتي' : type === 'file' ? '📁 ملف' : text;

    await supabase.from('messages').insert({
      conversation_id: convId,
      sender_id: senderId,
      receiver_id: receiverId,
      text,
      type,
      media_url: mediaUrl || null,
      file_name: fileName || null,
      reply_to: replyTo || null,
      is_read: false,
      is_delivered: true
    });

    await supabase.from('conversations').update({
      last_message: lastMsgText,
      last_sender_id: senderId,
      last_message_time: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', convId);
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

  // Create real call row in Supabase
  async createCall(
    callerId: string,
    receiverId: string,
    type: 'audio' | 'video'
  ): Promise<string | null> {
    if (!isSupabaseConfigured) return null;

    const channelId = `zego_room_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const { data, error } = await supabase.from('calls').insert({
      caller_id: callerId,
      receiver_id: receiverId,
      type,
      status: 'ringing',
      channel_id: channelId,
      started_at: new Date().toISOString()
    }).select('id').single();

    if (error || !data) {
      console.error('Failed to create call row:', error);
      return null;
    }

    // Also add participants
    await supabase.from('call_participants').insert([
      { call_id: data.id, user_id: callerId },
      { call_id: data.id, user_id: receiverId }
    ]);

    return data.id;
  }

  // Subscribe to Incoming Calls in Realtime
  subscribeIncomingCalls(
    currentUserId: string,
    callback: (call: { callId: string; callerId: string; type: 'audio' | 'video'; channelId: string } | null) => void
  ): () => void {
    if (!isSupabaseConfigured) {
      callback(null);
      return () => {};
    }

    const checkIncoming = async () => {
      const { data } = await supabase
        .from('calls')
        .select('*')
        .eq('receiver_id', currentUserId)
        .eq('status', 'ringing')
        .order('started_at', { ascending: false })
        .limit(1);

      if (data && data.length > 0) {
        const c = data[0];
        callback({
          callId: c.id,
          callerId: c.caller_id,
          type: c.type || 'video',
          channelId: c.channel_id
        });
      } else {
        callback(null);
      }
    };

    checkIncoming();

    const channel = supabase
      .channel('incoming_calls')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'calls', filter: `receiver_id=eq.${currentUserId}` },
        () => checkIncoming()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }

  // Update Call Status
  async updateCallStatus(callId: string, status: 'accepted' | 'rejected' | 'ended', durationSec?: number): Promise<void> {
    if (!isSupabaseConfigured) return;

    try {
      await supabase.from('calls').update({
        status,
        ended_at: new Date().toISOString(),
        duration: durationSec || 0
      }).eq('id', callId);
    } catch (err) {
      console.warn('Failed to update call status in Supabase:', err);
    }
  }
}

export const supabaseService = new SupabaseService();
