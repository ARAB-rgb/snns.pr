import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { User, Message, CallLog } from '../types';

export class SupabaseService {
  // Sync user profile in Supabase 'profiles' table
  async syncUserProfile(user: User): Promise<void> {
    if (!isSupabaseConfigured) return;
    try {
      const payload = {
        id: user.id,
        name: user.name,
        email: user.email || '',
        avatar: user.avatar || '',
        phone: user.phone || '',
        language: user.language || 'ar',
        is_online: true,
        last_seen: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' });
      if (error) {
        console.error('Error syncing profile to Supabase:', error);
      }
    } catch (err) {
      console.error('Error in syncUserProfile:', err);
    }
  }

  // Update user online status
  async setUserPresence(userId: string, isOnline: boolean): Promise<void> {
    if (!isSupabaseConfigured) return;
    try {
      await supabase.from('profiles').update({
        is_online: isOnline,
        last_seen: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq('id', userId);
    } catch (err) {
      console.warn('Failed to update presence in Supabase:', err);
    }
  }

  // Subscribe to real users list from 'profiles' table
  subscribeUsers(currentUserId: string, callback: (users: User[]) => void): () => void {
    if (!isSupabaseConfigured) {
      callback([]);
      return () => {};
    }

    const fetchUsers = async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .neq('id', currentUserId);

      if (!error && data) {
        const userList: User[] = data.map((p: any) => ({
          id: p.id,
          name: p.name || p.email?.split('@')[0] || 'مستخدم',
          avatar: p.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
          email: p.email,
          phone: p.phone,
          language: p.language || 'ar',
          isOnline: p.is_online ?? false,
          lastSeen: p.last_seen
            ? new Date(p.last_seen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : 'غير متصل',
          statusText: p.is_online ? 'متصل الآن' : 'غير متصل'
        }));
        callback(userList);
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
